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

const suggestionsEl = document.getElementById('suggestions');

// ── Address autocomplete ──
let debounceTimer = null;
addressInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = addressInput.value.trim();
    if (q.length < 3) { suggestionsEl.style.display = 'none'; return; }
    debounceTimer = setTimeout(() => fetchSuggestions(q), 300);
});

addressInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { suggestionsEl.style.display = 'none'; analyze(); }
});

async function fetchSuggestions(query) {
    try {
        // Bias towards Germany/Berlin for better results
        const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=de&addressdetails=1`
        );
        const results = await res.json();
        if (!results.length) { suggestionsEl.style.display = 'none'; return; }

        suggestionsEl.innerHTML = results.map(r =>
            `<div class="suggestion" data-lat="${r.lat}" data-lon="${r.lon}" data-name="${r.display_name}">
                ${r.display_name.split(',').slice(0, 3).join(', ')}
                <br><small>${r.type} · ${r.display_name.split(',').slice(-2).join(',').trim()}</small>
            </div>`
        ).join('');
        suggestionsEl.style.display = 'block';

        suggestionsEl.querySelectorAll('.suggestion').forEach(el => {
            el.addEventListener('click', () => {
                addressInput.value = el.dataset.name.split(',').slice(0, 3).join(', ');
                suggestionsEl.style.display = 'none';
                analyze();
            });
        });
    } catch (e) { console.warn('Suggestion error:', e); }
}

// Hide suggestions on click outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('#address-input') && !e.target.closest('#suggestions'))
        suggestionsEl.style.display = 'none';
});

// ── Analyze ──
analyzeBtn.addEventListener('click', analyze);

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
function recommendSystem(demandKwh, maxPanels, maxArea, sunshine, segments) {
    const PANEL_WP = 475;
    const PANEL_AREA = 1.96; // m² per panel (from Google's sizing)
    const PERF_RATIO = 0.8;
    const yieldPerKwp = sunshine * PERF_RATIO;

    // Filter segments: exclude steep (>45°) and north-facing (poor solar)
    const usableSegments = (segments || []).filter(seg => {
        if (seg.pitchDegrees > 45) return false; // walls, not roofs
        const dir = azimuthToDir(seg.azimuthDegrees);
        if (dir === 'N' && seg.pitchDegrees > 15) return false; // steep north = bad
        return true;
    });
    const usableArea = usableSegments.reduce((sum, s) => sum + s.stats.areaMeters2, 0);
    const maxUsablePanels = Math.min(maxPanels, Math.floor(usableArea / PANEL_AREA));

    // How many panels needed to cover demand?
    const targetKwp = demandKwh / yieldPerKwp;
    const targetPanels = Math.ceil(targetKwp / (PANEL_WP / 1000));
    const recPanels = Math.min(targetPanels, maxUsablePanels);
    const recKwp = (recPanels * PANEL_WP) / 1000;
    const recProduction = recKwp * yieldPerKwp;

    // Battery: ~1 kWh per 1 kWp, common sizes from Reonic data
    const rawBattery = recKwp * 1.0;
    const batteryKwh = rawBattery <= 6 ? 5 : rawBattery <= 12 ? 10 : 15;

    // Inverter: ~90% of panel kWp, common sizes from Reonic data
    const rawInverter = recKwp * 0.9;
    const inverterKw = rawInverter <= 6 ? 5 : rawInverter <= 9 ? 8 : rawInverter <= 12 ? 10 : 15;

    // ROI calculation
    const ELECTRICITY_PRICE = 0.35; // €/kWh (German avg)
    const PRICE_INCREASE = 0.03;    // 3% annual increase
    const SYSTEM_COST_PER_KWP = 1400; // € per kWp installed (German avg 2024-2025)
    const BATTERY_COST_PER_KWH = 800;
    const FEEDIN_TARIFF = 0.08;     // €/kWh feed-in (Germany 2024)
    const SELF_CONSUMPTION_RATIO = batteryKwh > 0 ? 0.65 : 0.35; // with/without battery

    const systemCost = recKwp * SYSTEM_COST_PER_KWP + batteryKwh * BATTERY_COST_PER_KWH;
    const selfConsumed = recProduction * SELF_CONSUMPTION_RATIO;
    const exported = recProduction - selfConsumed;
    const annualSavings = selfConsumed * ELECTRICITY_PRICE + exported * FEEDIN_TARIFF;
    const paybackYears = systemCost / annualSavings;

    // 20-year savings with electricity price increase
    let totalSavings20y = 0;
    for (let y = 0; y < 20; y++) {
        const price = ELECTRICITY_PRICE * Math.pow(1 + PRICE_INCREASE, y);
        totalSavings20y += selfConsumed * price + exported * FEEDIN_TARIFF;
    }
    const roi20y = totalSavings20y - systemCost;

    return {
        recPanels, recKwp, recProduction, batteryKwh, inverterKw,
        targetPanels, maxPanels, maxUsablePanels, usableArea,
        systemCost, annualSavings, paybackYears, roi20y, totalSavings20y,
        selfConsumed, exported, usableSegments
    };
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

    const rec = recommendSystem(demandKwh, maxPanels, maxArea, sunshine, segments);
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

    // Roof info — mark unusable segments
    let segHtml = '';
    sorted.slice(0, 6).forEach((seg, i) => {
        const dir = azimuthToDir(seg.azimuthDegrees);
        const color = colors[i % colors.length] || '#888';
        const unusable = seg.pitchDegrees > 45 || (dir === 'N' && seg.pitchDegrees > 15);
        segHtml += `<div class="segment" style="border-left:3px solid ${unusable ? '#666' : color};${unusable ? 'opacity:0.5;' : ''}">
            #${i+1}: ${seg.stats.areaMeters2.toFixed(0)} m² · ${dir} · ${seg.pitchDegrees.toFixed(0)}° tilt${unusable ? ' ⛔' : ' ✓'}
        </div>`;
    });

    // Offer table
    let offerHtml = offer.map(item =>
        `<div class="segment">${item.qty}× ${item.name}${item.brand ? ` <span style="color:#888">(${item.brand})</span>` : ''}</div>`
    ).join('');

    const coveragePercent = (rec.recProduction / demandKwh * 100).toFixed(0);

    statsEl.innerHTML = `
        <p><strong>Roof:</strong> ${totalArea.toFixed(0)} m² total · ${rec.usableArea.toFixed(0)} m² usable for solar</p>
        <p><strong>Sunshine:</strong> ${sunshine.toFixed(0)} hrs/year</p>
        <p><strong>Your demand:</strong> ${demandKwh.toLocaleString()} kWh/year</p>

        <p style="margin-top:10px;font-size:0.8rem;color:#aaa">Recommended system:</p>
        <p class="highlight">⚡ ${rec.recPanels} panels × 475W = ${rec.recKwp.toFixed(1)} kWp</p>
        <p class="highlight">🔋 ${rec.batteryKwh} kWh battery · ${rec.inverterKw} kW inverter</p>
        <p class="highlight">📊 ${(rec.recProduction/1000).toFixed(1)} MWh/year (${coveragePercent}% of demand)</p>
        ${rec.targetPanels > rec.maxUsablePanels ? `<p style="color:#f97316;font-size:0.8rem">⚠️ Usable roof fits ${rec.maxUsablePanels} panels, but ${rec.targetPanels} needed for 100%</p>` : ''}

        <p style="margin-top:10px;font-size:0.8rem;color:#aaa">Financial estimate:</p>
        <p>💰 System cost: ~€${(rec.systemCost/1000).toFixed(1)}k</p>
        <p>💵 Annual savings: ~€${rec.annualSavings.toFixed(0)}/year</p>
        <p class="highlight">📅 Payback: ~${rec.paybackYears.toFixed(1)} years</p>
        <p class="highlight">🏦 20-year profit: ~€${(rec.roi20y/1000).toFixed(1)}k</p>

        <p style="margin-top:10px;font-size:0.8rem;color:#aaa">Offer components:</p>
        ${offerHtml}

        <p style="margin-top:10px;font-size:0.8rem;color:#aaa">Roof segments: (⛔ = too steep/north)</p>
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
