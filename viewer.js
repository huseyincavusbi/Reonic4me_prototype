const API_KEY = window.__API_KEY__;

// ── DOM ──
const statusEl = document.getElementById('status');
const statsEl = document.getElementById('stats');
const addressInput = document.getElementById('address-input');
const demandInput = document.getElementById('demand-input');
const analyzeBtn = document.getElementById('analyze-btn');
const btn2D = document.getElementById('btn-2d');
const btn3D = document.getElementById('btn-3d');
const mapContainer = document.getElementById('map-container');
const cesiumContainer = document.getElementById('cesium-container');

// ── State ──
let currentLat = null, currentLon = null;
let is3D = false;
let lastSegments = null;

// ── Leaflet (2D) ──
let leafletMap = null;
let mapLayers = [];

function initLeaflet(lat, lon) {
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
}

function addLeafletLabels(segments) {
    const colors = ['#4ade80', '#facc15', '#60a5fa', '#f97316'];
    segments.slice(0, 4).forEach((seg, i) => {
        if (!seg.center) return;
        const label = L.marker([seg.center.latitude, seg.center.longitude], {
            icon: L.divIcon({
                className: '',
                html: `<div style="background:${colors[i]};color:#000;font-size:11px;font-weight:bold;padding:2px 6px;border-radius:4px;white-space:nowrap;">${seg.stats.areaMeters2.toFixed(0)}m² ${azimuthToDir(seg.azimuthDegrees)}</div>`,
                iconAnchor: [20, 10],
            })
        });
        label.addTo(leafletMap);
        mapLayers.push(label);
    });
}

// ── Cesium (3D) ──
let cesiumViewer = null;

function initCesium() {
    if (cesiumViewer) return;
    cesiumViewer = new Cesium.Viewer('cesium-container', {
        imageryProvider: false,
        baseLayerPicker: false,
        requestRenderMode: true,
        animation: false,
        timeline: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        geocoder: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
    });
    cesiumViewer.scene.globe.show = false;

    Cesium.Cesium3DTileset.fromUrl(
        `https://tile.googleapis.com/v1/3dtiles/root.json?key=${API_KEY}`
    ).then(tileset => {
        tileset.showCreditsOnScreen = true;
        cesiumViewer.scene.primitives.add(tileset);
        if (currentLat !== null) flyTo(currentLat, currentLon);
        if (lastSegments) addCesiumLabels(lastSegments);
    }).catch(e => console.error('3D tileset load failed:', e));
}

function flyTo(lat, lon) {
    if (!cesiumViewer) return;
    cesiumViewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 250),
        orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-45),
            roll: 0,
        },
        duration: 1.5,
    });
}

function addCesiumLabels(segments) {
    if (!cesiumViewer) return;
    cesiumViewer.entities.removeAll();
    const colors = [
        Cesium.Color.fromCssColorString('#4ade80'),
        Cesium.Color.fromCssColorString('#facc15'),
        Cesium.Color.fromCssColorString('#60a5fa'),
        Cesium.Color.fromCssColorString('#f97316'),
    ];
    segments.slice(0, 4).forEach((seg, i) => {
        if (!seg.center) return;
        cesiumViewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(seg.center.longitude, seg.center.latitude, 40),
            label: {
                text: `${seg.stats.areaMeters2.toFixed(0)}m² ${azimuthToDir(seg.azimuthDegrees)}`,
                font: 'bold 13px sans-serif',
                fillColor: Cesium.Color.BLACK,
                backgroundColor: colors[i].withAlpha(0.85),
                showBackground: true,
                backgroundPadding: new Cesium.Cartesian2(6, 4),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        });
    });
}

// ── View toggle ──
btn2D.addEventListener('click', () => {
    if (!is3D) return;
    is3D = false;
    btn2D.classList.add('active');
    btn3D.classList.remove('active');
    cesiumContainer.style.display = 'none';
    mapContainer.style.display = '';
    if (leafletMap) leafletMap.invalidateSize();
});

btn3D.addEventListener('click', () => {
    if (is3D) return;
    is3D = true;
    btn3D.classList.add('active');
    btn2D.classList.remove('active');
    mapContainer.style.display = 'none';
    cesiumContainer.style.display = '';
    initCesium();
    if (currentLat !== null) flyTo(currentLat, currentLon);
});

// ── Address autocomplete ──
const suggestionsEl = document.getElementById('suggestions');
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
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`);
        const geoData = await geoRes.json();
        if (!geoData.length) { statusEl.innerText = 'Address not found'; analyzeBtn.disabled = false; return; }
        const lat = parseFloat(geoData[0].lat);
        const lon = parseFloat(geoData[0].lon);

        currentLat = lat;
        currentLon = lon;
        initLeaflet(lat, lon);
        if (is3D) flyTo(lat, lon);
        statusEl.innerText = 'Fetching solar data...';

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

// ── Recommendation engine ──
function recommendSystem(demandKwh, maxPanels, maxArea, sunshine) {
    const PANEL_WP = 475;
    const PERF_RATIO = 0.8;
    const yieldPerKwp = sunshine * PERF_RATIO;

    const targetKwp = demandKwh / yieldPerKwp;
    const targetPanels = Math.ceil(targetKwp / (PANEL_WP / 1000));
    const recPanels = Math.min(targetPanels, maxPanels);
    const recKwp = (recPanels * PANEL_WP) / 1000;
    const recProduction = recKwp * yieldPerKwp;

    const rawBattery = recKwp * 1.0;
    const batteryKwh = rawBattery <= 6 ? 5 : rawBattery <= 12 ? 10 : 15;

    const rawInverter = recKwp * 0.9;
    const inverterKw = rawInverter <= 6 ? 5 : rawInverter <= 9 ? 8 : rawInverter <= 12 ? 10 : 15;

    return { recPanels, recKwp, recProduction, batteryKwh, inverterKw, targetPanels, maxPanels };
}

function generateOffer(rec) {
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

    const sorted = [...segments].sort((a, b) => b.stats.areaMeters2 - a.stats.areaMeters2);
    lastSegments = sorted;

    addLeafletLabels(sorted);
    addCesiumLabels(sorted);

    const rec = recommendSystem(demandKwh, maxPanels, maxArea, sunshine);
    const offer = generateOffer(rec);

    statusEl.innerText = `✅ ${address}`;

    const htmlColors = ['#4ade80', '#facc15', '#60a5fa', '#f97316'];
    let segHtml = '';
    sorted.slice(0, 6).forEach((seg, i) => {
        const color = htmlColors[i % htmlColors.length] || '#888';
        segHtml += `<div class="segment" style="border-left:3px solid ${color}">
            #${i+1}: ${seg.stats.areaMeters2.toFixed(0)} m² · ${azimuthToDir(seg.azimuthDegrees)} · ${seg.pitchDegrees.toFixed(0)}° tilt
        </div>`;
    });

    const SERVICE_TYPES = new Set(['InstallationFee', 'ServiceFee']);
    const itemHtml = item =>
        `<div class="segment">${item.qty}× ${item.name}${item.brand ? ` <span style="color:#888">(${item.brand})</span>` : ''}</div>`;
    const componentsHtml = offer.filter(i => !SERVICE_TYPES.has(i.type)).map(itemHtml).join('');
    const servicesHtml   = offer.filter(i =>  SERVICE_TYPES.has(i.type)).map(itemHtml).join('');

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
        ${componentsHtml}
        <details style="margin-top:6px">
            <summary style="font-size:0.8rem;color:#666;cursor:pointer;list-style:none;padding:4px 0">
                <span style="color:#555">▶</span> Installation &amp; services
            </summary>
            ${servicesHtml}
        </details>

        <p style="margin-top:10px;font-size:0.8rem;color:#aaa">Roof segments:</p>
        ${segHtml}
    `;
}

function azimuthToDir(deg) {
    const dirs = ['N','NE','E','SE','S','SW','W','NW'];
    return dirs[Math.round(deg / 45) % 8];
}

window.addEventListener('resize', () => {
    if (leafletMap && !is3D) leafletMap.invalidateSize();
});
