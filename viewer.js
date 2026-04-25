const API_KEY = window.__API_KEY__;

// ── DOM ──
const statusEl = document.getElementById('status');
const statsEl = document.getElementById('stats');
const addressInput = document.getElementById('address-input');
const demandInput = document.getElementById('demand-input');
const analyzeBtn = document.getElementById('analyze-btn');
const mapContainer = document.getElementById('map-container');

// ── Leaflet Map ──
let leafletMap = null;
let mapLayers = [];

function initMap(lat, lon) {
    if (!leafletMap) {
        leafletMap = L.map('map-container').setView([lat, lon], 19);
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 21, attribution: 'Tiles © Esri'
        }).addTo(leafletMap);
    } else {
        leafletMap.setView([lat, lon], 19);
    }
    mapLayers.forEach(l => leafletMap.removeLayer(l));
    mapLayers = [];
    const marker = L.marker([lat, lon]).addTo(leafletMap);
    mapLayers.push(marker);
}

// ── Roof mask overlay ──
async function loadRoofOverlay(url) {
    try {
        const res = await fetch(url + `&key=${API_KEY}`);
        const arrayBuffer = await res.arrayBuffer();
        const georaster = await parseGeoraster(arrayBuffer);
        const layer = new GeoRasterLayer({
            georaster, opacity: 0.45, resolution: 512,
            pixelValuesToColorFn: (vals) => {
                if (!vals[0] || vals[0] === 0) return null;
                return 'rgba(74,222,128,0.7)';
            }
        });
        layer.addTo(leafletMap);
        mapLayers.push(layer);
    } catch (e) { console.warn('Could not load roof overlay:', e); }
}

// ── Analyze ──
analyzeBtn.addEventListener('click', analyze);
addressInput.addEventListener('keydown', e => { if (e.key === 'Enter') analyze(); });

async function analyze() {
    const address = addressInput.value.trim();
    const demandKwh = parseFloat(demandInput.value) || 4500;
    if (!address) return;
    statusEl.innerText = 'Geocoding...';
    statsEl.innerHTML = '';
    analyzeBtn.disabled = true;

    try {
        // Geocode
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`);
        const geoData = await geoRes.json();
        if (!geoData.length) { statusEl.innerText = 'Address not found'; analyzeBtn.disabled = false; return; }
        const lat = parseFloat(geoData[0].lat);
        const lon = parseFloat(geoData[0].lon);

        initMap(lat, lon);
        statusEl.innerText = 'Fetching solar data...';

        // Solar API
        let solar = await fetchSolar(lat, lon, 'HIGH');
        if (solar.error) solar = await fetchSolar(lat, lon, 'MEDIUM');
        if (solar.error) { statusEl.innerText = 'No solar data for this location'; analyzeBtn.disabled = false; return; }

        displayResults(solar, address, demandKwh);
    } catch (err) {
        console.error(err);
        statusEl.innerText = `Error: ${err.message}`;
    }
    analyzeBtn.disabled = false;
}

async function fetchSolar(lat, lon, quality) {
    const res = await fetch(
        `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lon}&requiredQuality=${quality}&key=${API_KEY}`
    );
    return res.json();
}

// ── Recommendation engine (based on Reonic CSV data patterns) ──
function recommendSystem(demandKwh, maxPanels, maxArea, sunshine) {
    // From real Reonic data analysis:
    // - Typical panel: 450-475W, ~1.7m²
    // - Installers size systems to cover 80-120% of annual demand
    // - Annual yield per kWp in Germany: ~900-1050 kWh (sunshine * 0.8 perf ratio)
    const PANEL_WP = 475;
    const PERF_RATIO = 0.8;
    const yieldPerKwp = sunshine * PERF_RATIO; // kWh per kWp per year

    // How many kWp needed to cover demand?
    const targetKwp = demandKwh / yieldPerKwp;
    const targetPanels = Math.ceil(targetKwp / (PANEL_WP / 1000));

    // Clamp to what the roof can fit
    const recPanels = Math.min(targetPanels, maxPanels);
    const recKwp = (recPanels * PANEL_WP) / 1000;
    const recProduction = recKwp * yieldPerKwp;

    // Battery recommendation from Reonic data:
    // Most projects pair ~1 kWh battery per 1 kWp solar
    // Common sizes: 5, 9.6, 10, 15 kWh
    const rawBattery = recKwp * 1.0;
    const batteryKwh = rawBattery <= 6 ? 5 : rawBattery <= 12 ? 10 : 15;

    // Inverter: sized to ~80-100% of panel kWp
    // Common sizes from data: 5, 8, 10, 15 kW
    const rawInverter = recKwp * 0.9;
    const inverterKw = rawInverter <= 6 ? 5 : rawInverter <= 9 ? 8 : rawInverter <= 12 ? 10 : 15;

    return { recPanels, recKwp, recProduction, batteryKwh, inverterKw, targetPanels, maxPanels };
}

function generateOffer(rec) {
    // Based on real Reonic project component patterns
    return [
        { type: 'Module', name: `Solar Panel 475W`, brand: 'Sunpro', qty: rec.recPanels, unit: 'pcs' },
        { type: 'Inverter', name: `Hybrid Inverter ${rec.inverterKw}kW`, brand: 'Sigenergy', qty: 1, unit: 'pcs' },
        { type: 'BatteryStorage', name: `Battery ${rec.batteryKwh}kWh`, brand: 'Sigenergy', qty: 1, unit: 'pcs' },
        { type: 'Mounting', name: 'Roof Mounting System', brand: 'SL Rack', qty: rec.recPanels, unit: 'pcs' },
        { type: 'InstallationFee', name: 'Installation Solar + Storage', brand: '', qty: 1, unit: '' },
        { type: 'ServiceFee', name: 'Grid Registration', brand: '', qty: 1, unit: '' },
        { type: 'ServiceFee', name: 'System Planning & Design', brand: '', qty: 1, unit: '' },
        { type: 'ServiceFee', name: 'Delivery to Site', brand: '', qty: 1, unit: '' },
    ];
}

// ── Display ──
function displayResults(data, address, demandKwh) {
    const sp = data.solarPotential;
    if (!sp) { statusEl.innerText = 'No solar potential data'; return; }

    const segments = sp.roofSegmentStats || [];
    const totalArea = sp.wholeRoofStats?.areaMeters2 || 0;
    const maxPanels = sp.maxArrayPanelsCount || 0;
    const maxArea = sp.maxArrayAreaMeters2 || 0;
    const sunshine = sp.maxSunshineHoursPerYear || 0;

    const rec = recommendSystem(demandKwh, maxPanels, maxArea, sunshine);
    const offer = generateOffer(rec);

    // Map labels for top segments
    const sorted = [...segments].sort((a, b) => b.stats.areaMeters2 - a.stats.areaMeters2);
    const colors = ['#4ade80', '#facc15', '#60a5fa', '#f97316'];
    sorted.slice(0, 4).forEach((seg, i) => {
        if (seg.center) {
            const label = L.marker([seg.center.latitude, seg.center.longitude], {
                icon: L.divIcon({
                    className: '',
                    html: `<div style="background:${colors[i]};color:#000;font-size:11px;font-weight:bold;padding:2px 6px;border-radius:4px;white-space:nowrap;">${seg.stats.areaMeters2.toFixed(0)}m² ${azimuthToDir(seg.azimuthDegrees)}</div>`,
                    iconAnchor: [20, 10],
                })
            });
            label.addTo(leafletMap);
            mapLayers.push(label);
        }
    });

    statusEl.innerText = `✅ ${address}`;

    // Roof info
    let segHtml = '';
    sorted.slice(0, 6).forEach((seg, i) => {
        const dir = azimuthToDir(seg.azimuthDegrees);
        const color = colors[i % colors.length] || '#888';
        segHtml += `<div class="segment" style="border-left:3px solid ${color}">
            #${i+1}: ${seg.stats.areaMeters2.toFixed(0)} m² · ${dir} · ${seg.pitchDegrees.toFixed(0)}° tilt
        </div>`;
    });

    // Offer table
    let offerHtml = offer.map(item =>
        `<div class="segment">${item.qty}× ${item.name}${item.brand ? ` <span style="color:#888">(${item.brand})</span>` : ''}</div>`
    ).join('');

    const selfConsumption = Math.min(demandKwh, rec.recProduction);
    const coveragePercent = (rec.recProduction / demandKwh * 100).toFixed(0);

    statsEl.innerHTML = `
        <p><strong>Roof:</strong> ${totalArea.toFixed(0)} m² total · ${maxArea.toFixed(0)} m² usable</p>
        <p><strong>Sunshine:</strong> ${sunshine.toFixed(0)} hrs/year</p>
        <p><strong>Your demand:</strong> ${demandKwh.toLocaleString()} kWh/year</p>

        <p style="margin-top:10px;font-size:0.8rem;color:#aaa">Recommended system:</p>
        <p class="highlight">⚡ ${rec.recPanels} panels × 475W = ${rec.recKwp.toFixed(1)} kWp</p>
        <p class="highlight">🔋 ${rec.batteryKwh} kWh battery</p>
        <p class="highlight">📊 ${(rec.recProduction/1000).toFixed(1)} MWh/year (${coveragePercent}% of demand)</p>
        ${rec.targetPanels > rec.maxPanels ? `<p style="color:#f97316;font-size:0.8rem">⚠️ Roof fits ${rec.maxPanels} panels, but ${rec.targetPanels} needed for 100% coverage</p>` : ''}

        <p style="margin-top:10px;font-size:0.8rem;color:#aaa">Offer components:</p>
        ${offerHtml}

        <p style="margin-top:10px;font-size:0.8rem;color:#aaa">Roof segments:</p>
        ${segHtml}
    `;
}

function azimuthToDir(deg) {
    const dirs = ['N','NE','E','SE','S','SW','W','NW'];
    return dirs[Math.round(deg / 45) % 8];
}

// ── Resize ──
window.addEventListener('resize', () => {
    if (leafletMap) leafletMap.invalidateSize();
});
