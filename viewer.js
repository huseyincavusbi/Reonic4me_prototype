const API_KEY = window.__API_KEY__;

// ── DOM ──
const statusEl = document.getElementById('status');
const statsEl = document.getElementById('stats');
const addressInput = document.getElementById('address-input');
const demandInput = document.getElementById('demand-input');
const analyzeBtn = document.getElementById('analyze-btn');
const hasEvInput = document.getElementById('has-ev-input');
const nnPanel   = document.getElementById('nn-panel');
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

    // Nearest neighbour lookup
    const query = {
        energy_demand_wh:    String(demandKwh * 1000),
        energy_price_per_wh: '0.00032',
        energy_price_increase: '0.03',
        has_ev:      hasEvInput.checked ? 'True' : 'False',
        has_solar:   'False',
        has_storage: 'False',
        has_wallbox: 'False',
        country:     'Germany',
    };
    loadKNNData().then(cache => {
        const [nearest] = knnFindNearest(query, cache, 1);
        displayNNPanel(query, nearest);
    });

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

// ── KNN Nearest Neighbour ─────────────────────────────────────────────────────
const KNN_CONTINUOUS = ['energy_demand_wh', 'energy_price_per_wh', 'energy_price_increase'];
const KNN_BOOLEANS   = ['has_ev', 'has_solar', 'has_storage', 'has_wallbox'];
const KNN_ORDER_COLS = ['ordered_solar', 'ordered_battery', 'ordered_wallbox', 'ordered_heatpump'];

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

    // Only rows with at least one purchase
    const rows = allRows.filter(r => KNN_ORDER_COLS.some(c => r[c] === 'True'));

    // Pre-scale medians for imputation
    const medians = KNN_CONTINUOUS.map(col => {
        const vals = rows.map(r => parseFloat(r[col])).filter(v => !isNaN(v)).sort((a, b) => a - b);
        return vals[Math.floor(vals.length / 2)];
    });

    function encode(r) {
        return [
            ...KNN_CONTINUOUS.map((c, i) => { const v = parseFloat(r[c]); return isNaN(v) ? medians[i] : v; }),
            ...KNN_BOOLEANS.map(c => r[c] === 'True' ? 1.0 : 0.0),
            r['country'] === 'Germany' ? 1.0 : 0.0,
        ];
    }

    const matrix = rows.map(encode);
    const nCont  = KNN_CONTINUOUS.length;

    // Fit StandardScaler on continuous columns
    const means = KNN_CONTINUOUS.map((_, i) => matrix.reduce((s, r) => s + r[i], 0) / matrix.length);
    const stds  = KNN_CONTINUOUS.map((_, i) => {
        const v = matrix.reduce((s, r) => s + (r[i] - means[i]) ** 2, 0) / matrix.length;
        return Math.sqrt(v) || 1;
    });

    const scaled = matrix.map(r => r.map((v, i) => i < nCont ? (v - means[i]) / stds[i] : v));

    knnCache = { rows, scaled, medians, means, stds, encode, nCont };
    return knnCache;
}

function knnFindNearest(query, cache, k = 1) {
    const { rows, scaled, means, stds, encode, nCont } = cache;
    const raw  = encode(query);
    const qVec = raw.map((v, i) => i < nCont ? (v - means[i]) / stds[i] : v);
    return rows
        .map((row, idx) => ({ dist: Math.sqrt(scaled[idx].reduce((s, v, i) => s + (v - qVec[i]) ** 2, 0)), row }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, k);
}

function displayNNPanel(query, nearest) {
    const { dist, row } = nearest;
    const kwh  = v => v ? `${(parseFloat(v) / 1000).toFixed(0)} kWh` : '—';
    const price = v => v ? `${(parseFloat(v) * 1000).toFixed(2)} €/kWh` : '—';
    const bool  = v => v === 'True'
        ? '<span style="color:#4ade80">Yes</span>'
        : '<span style="color:#555">No</span>';

    const ordered = [];
    if (row.ordered_solar   === 'True') {
        const panels = row.primary_module_count || '?';
        const kwp    = row.primary_module_count ? (parseFloat(row.primary_module_count) * 0.475).toFixed(1) + ' kWp' : '';
        ordered.push(`☀️ Solar: ${panels} panels${kwp ? ' · ' + kwp : ''}`);
    }
    if (row.ordered_battery === 'True') ordered.push(`🔋 Battery: ${row.primary_battery_kwh || '?'} kWh`);
    if (row.ordered_wallbox === 'True') ordered.push(`🔌 Wallbox: ${row.primary_wallbox_kw || '?'} kW`);
    if (row.ordered_heatpump=== 'True') ordered.push(`♨️ Heat pump`);

    const similarity = Math.max(0, 1 - dist / 3);

    nnPanel.innerHTML = `
        <p style="font-size:0.8rem;color:#aaa;margin-bottom:6px">
            Most similar historical project
            <span style="float:right;color:#4ade80;font-size:0.72rem">match ${(similarity * 100).toFixed(0)}%</span>
        </p>
        <div class="nn-grid">
            <div></div>
            <div class="nn-col-head">Your house</div>
            <div class="nn-col-head">Match</div>
            <div class="nn-label">Demand</div>
            <div class="nn-val">${kwh(query.energy_demand_wh)}</div>
            <div class="nn-val match">${kwh(row.energy_demand_wh)}</div>
            <div class="nn-label">Price</div>
            <div class="nn-val">${price(query.energy_price_per_wh)}</div>
            <div class="nn-val match">${price(row.energy_price_per_wh)}</div>
            <div class="nn-label">EV</div>
            <div class="nn-val">${bool(query.has_ev)}</div>
            <div class="nn-val match">${bool(row.has_ev)}</div>
            <div class="nn-label">Existing solar</div>
            <div class="nn-val">${bool(query.has_solar)}</div>
            <div class="nn-val match">${bool(row.has_solar)}</div>
        </div>
        <p style="font-size:0.72rem;color:#555;text-transform:uppercase;letter-spacing:0.04em;margin:8px 0 4px">They subsequently ordered:</p>
        ${ordered.map(s => `<div class="segment">${s}</div>`).join('')}
    `;
    nnPanel.style.display = 'block';
}
