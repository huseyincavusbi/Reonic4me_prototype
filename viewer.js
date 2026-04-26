const API_KEY = window.__API_KEY__;

// ── DOM ──
const statusEl = document.getElementById('status');
const statsEl = document.getElementById('stats');
const addressInput = document.getElementById('address-input');
const demandInput = document.getElementById('demand-input');
const analyzeBtn = document.getElementById('analyze-btn');
const btn2D = document.getElementById('btn-2d');
const btn3D = document.getElementById('btn-3d');
const hasEvInput   = document.getElementById('has-ev-input');
const heatingInput = document.getElementById('heating-input');
const nnPanel      = document.getElementById('nn-panel');
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
    const sorted = [...segments].sort((a, b) => b.stats.areaMeters2 - a.stats.areaMeters2);
    lastSegments = sorted;

    addLeafletLabels(sorted);
    addCesiumLabels(sorted);

    const offer = generateOffer(rec);

    statusEl.innerText = `✅ ${address}`;

    // Nearest neighbour lookup
    const query = {
        energy_demand_wh:      String(demandKwh * 1000),
        energy_price_per_wh:   '0.00032',
        energy_price_increase: '0.03',
        has_ev:                hasEvInput?.checked ? 'True' : 'False',
        has_solar:             'False',
        has_storage:           'False',
        has_wallbox:           'False',
        country:               'Germany',
        heating_existing_type: heatingInput?.value || '',
    };
    loadKNNData().then(cache => {
        const neighbors = knnFindNearest(query, cache, 10);
        displayNNPanel(query, neighbors);
    }).catch(() => {});

    // Roof info — mark unusable segments
    const colors = ['#4ade80', '#facc15', '#60a5fa', '#f97316'];
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
    const SERVICE_TYPES = new Set(['InstallationFee', 'ServiceFee']);
    const itemHtml = item =>
        `<div class="segment">${item.qty}× ${item.name}${item.brand ? ` <span style="color:#888">(${item.brand})</span>` : ''}</div>`;
    const componentsHtml = offer.filter(i => !SERVICE_TYPES.has(i.type)).map(itemHtml).join('');
    const servicesHtml   = offer.filter(i =>  SERVICE_TYPES.has(i.type)).map(itemHtml).join('');

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
        ${componentsHtml}
        <details style="margin-top:6px">
            <summary style="font-size:0.8rem;color:#666;cursor:pointer;list-style:none;padding:4px 0">
                <span style="color:#555">▶</span> Installation &amp; services
            </summary>
            ${servicesHtml}
        </details>

        <p style="margin-top:10px;font-size:0.8rem;color:#aaa">Roof segments: (⛔ = too steep/north)</p>
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

// ── KNN + Classifier ──────────────────────────────────────────────────────────
const KNN_CONTINUOUS  = ['energy_demand_wh', 'energy_price_per_wh', 'energy_price_increase'];
const KNN_BOOLEANS    = ['has_ev', 'has_solar', 'has_storage', 'has_wallbox'];
const KNN_ORDER_COLS  = ['ordered_solar', 'ordered_battery', 'ordered_wallbox', 'ordered_heatpump'];
const KNN_ORDER_LABELS = ['Solar', 'Battery', 'Wallbox', 'Heat pump'];
const FOSSIL_FUELS    = new Set(['Gas', 'Oil', 'OtherNonRenewable']);

let knnCache = null;

async function loadKNNData() {
    if (knnCache) return knnCache;

    const res  = await fetch('data/projects_combined.csv');
    const text = await res.text();
    const lines = text.split('\n').filter(l => l.trim());
    const headers = lines[0].split(',');
    const allRows = lines.slice(1).map(l => {
        const vals = l.split(',');
        return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
    });

    const rows = allRows.filter(r => KNN_ORDER_COLS.some(c => r[c] === 'True'));

    // Medians computed before scaling — used to impute missing query values
    const medians = KNN_CONTINUOUS.map(col => {
        const vals = rows.map(r => parseFloat(r[col])).filter(v => !isNaN(v)).sort((a, b) => a - b);
        return vals[Math.floor(vals.length / 2)];
    });

    function encode(r) {
        const ht = r['heating_existing_type'] || '';
        return [
            ...KNN_CONTINUOUS.map((c, i) => { const v = parseFloat(r[c]); return isNaN(v) ? medians[i] : v; }),
            ...KNN_BOOLEANS.map(c => r[c] === 'True' ? 1.0 : 0.0),
            r['country'] === 'Germany' ? 1.0 : 0.0,
            ht === 'Gas'      ? 1.0 : 0.0,
            ht === 'Oil'      ? 1.0 : 0.0,
            ht === 'Heatpump' ? 1.0 : 0.0,
            ht               ? 1.0 : 0.0,   // known-flag: distinguishes missing from "other"
        ];
    }

    const matrix = rows.map(encode);
    const nCont  = KNN_CONTINUOUS.length;

    const means = KNN_CONTINUOUS.map((_, i) => matrix.reduce((s, r) => s + r[i], 0) / matrix.length);
    const stds  = KNN_CONTINUOUS.map((_, i) => {
        const v = matrix.reduce((s, r) => s + (r[i] - means[i]) ** 2, 0) / matrix.length;
        return Math.sqrt(v) || 1;
    });

    const scaled = matrix.map(r => r.map((v, i) => i < nCont ? (v - means[i]) / stds[i] : v));

    knnCache = { rows, scaled, medians, means, stds, encode, nCont };
    return knnCache;
}

function knnFindNearest(query, cache, k = 10) {
    const { rows, scaled, means, stds, encode, nCont } = cache;
    const raw  = encode(query);
    const qVec = raw.map((v, i) => i < nCont ? (v - means[i]) / stds[i] : v);
    return rows
        .map((row, idx) => ({
            dist: Math.sqrt(scaled[idx].reduce((s, v, i) => s + (v - qVec[i]) ** 2, 0)),
            row,
        }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, k);
}

function heatpumpRecommendation(heatingType) {
    if (FOSSIL_FUELS.has(heatingType)) {
        return { cls: 'yes', symbol: '✅', confidence: 'high confidence',
            reason: `Current ${heatingType} heating — fossil fuel systems are strong heat pump candidates. 14 of 14 buyers with known heating type in the dataset used fossil fuels.` };
    } else if (heatingType === 'Heatpump') {
        return { cls: 'no', symbol: '❌', confidence: 'high confidence',
            reason: 'Already has a heat pump. No buyers in the dataset added a second unit.' };
    } else {
        return { cls: 'ask', symbol: '❓', confidence: 'low confidence',
            reason: 'Heating type unknown. Ask if Gas or Oil — if so, recommend heat pump.' };
    }
}

function displayNNPanel(query, neighbors) {
    const probs = KNN_ORDER_COLS.map((comp, i) => ({
        label: KNN_ORDER_LABELS[i],
        prob:  neighbors.filter(n => n.row[comp] === 'True').length / neighbors.length,
    }));

    const probBars = probs.map(({ label, prob }) => {
        const pct = Math.round(prob * 100);
        const color = prob >= 0.7 ? '#4ade80' : prob >= 0.4 ? '#facc15' : '#888';
        return `<div class="prob-row">
            <span class="prob-label">${label}</span>
            <div class="prob-track"><div class="prob-fill" style="width:${pct}%;background:${color}"></div></div>
            <span class="prob-pct" style="color:${color}">${pct}%</span>
        </div>`;
    }).join('');

    const hp   = heatpumpRecommendation(query.heating_existing_type || '');
    const hpBox = `<div class="hp-box ${hp.cls}">
        <strong>${hp.symbol} Heat pump — ${hp.confidence}</strong><br>${hp.reason}
    </div>`;

    const topNeighbors = neighbors.slice(0, 3).map(({ dist, row }) => {
        const tags = [];
        if (row.ordered_solar    === 'True') tags.push(`☀️ ${row.primary_module_count || '?'} panels`);
        if (row.ordered_battery  === 'True') tags.push(`🔋 ${row.primary_battery_kwh || '?'} kWh`);
        if (row.ordered_wallbox  === 'True') tags.push(`🔌 ${row.primary_wallbox_kw || '?'} kW`);
        if (row.ordered_heatpump === 'True') tags.push('♨️ heat pump');
        const demand = row.energy_demand_wh ? `${(parseFloat(row.energy_demand_wh)/1000).toFixed(0)} kWh` : '—';
        const ht     = row.heating_existing_type || '?';
        const ev     = row.has_ev === 'True' ? ' · EV' : '';
        return `<div class="nn-neighbor">
            <strong>${demand} · ${ht}${ev}</strong><br>${tags.join(' · ') || '—'}
        </div>`;
    }).join('');

    nnPanel.innerHTML = `
        <p style="font-size:0.8rem;color:#aaa;margin:0 0 8px">Similar households (${neighbors.length} matches)</p>

        <p style="font-size:0.72rem;color:#666;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 5px">Component likelihood</p>
        ${probBars}

        <p style="font-size:0.72rem;color:#666;text-transform:uppercase;letter-spacing:0.04em;margin:10px 0 4px">Heat pump</p>
        ${hpBox}

        <p style="font-size:0.72rem;color:#666;text-transform:uppercase;letter-spacing:0.04em;margin:10px 0 4px">Closest projects</p>
        ${topNeighbors}
    `;
    nnPanel.style.display = 'block';
}
