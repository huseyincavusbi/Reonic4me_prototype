import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const API_KEY = window.__API_KEY__;

// ── DOM ──
const statusEl = document.getElementById('status');
const statsEl = document.getElementById('stats');
const addressInput = document.getElementById('address-input');
const analyzeBtn = document.getElementById('analyze-btn');
const modelSelect = document.getElementById('model-select');
const loadBtn = document.getElementById('load-btn');
const mapContainer = document.getElementById('map-container');
const canvasContainer = document.getElementById('canvas-container');

// ── Mode switching ──
document.getElementById('tab-address').addEventListener('click', () => switchMode('address'));
document.getElementById('tab-glb').addEventListener('click', () => switchMode('glb'));

function switchMode(mode) {
    document.getElementById('tab-address').classList.toggle('active', mode === 'address');
    document.getElementById('tab-glb').classList.toggle('active', mode === 'glb');
    document.getElementById('address-section').classList.toggle('active', mode === 'address');
    document.getElementById('glb-section').classList.toggle('active', mode === 'glb');
    mapContainer.classList.toggle('active', mode === 'address');
    canvasContainer.classList.toggle('active', mode === 'glb');
    if (mode === 'glb') initThree();
    if (mode === 'address' && leafletMap) leafletMap.invalidateSize();
}

// ── Leaflet Map ──
let leafletMap = null;
let mapLayers = [];

function initLeafletMap(lat, lon) {
    if (!leafletMap) {
        leafletMap = L.map('map-container').setView([lat, lon], 19);
        // ESRI satellite tiles (free)
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 21,
            attribution: 'Tiles © Esri'
        }).addTo(leafletMap);
    } else {
        leafletMap.setView([lat, lon], 19);
    }
    // Clear old layers
    mapLayers.forEach(l => leafletMap.removeLayer(l));
    mapLayers = [];

    // Add marker
    const marker = L.marker([lat, lon]).addTo(leafletMap);
    mapLayers.push(marker);
}

// ── Load roof mask GeoTIFF — shows only actual roof surfaces ──
async function loadRoofOverlay(url) {
    try {
        statusEl.innerText = 'Loading roof overlay...';
        const res = await fetch(url + `&key=${API_KEY}`);
        const arrayBuffer = await res.arrayBuffer();
        const georaster = await parseGeoraster(arrayBuffer);

        const layer = new GeoRasterLayer({
            georaster,
            opacity: 0.45,
            resolution: 512,
            pixelValuesToColorFn: (vals) => {
                const v = vals[0];
                if (!v || v === 0) return null; // not a roof pixel
                return 'rgba(74,222,128,0.7)';  // green = roof
            }
        });
        layer.addTo(leafletMap);
        mapLayers.push(layer);
    } catch (e) {
        console.warn('Could not load roof overlay:', e);
    }
}

// ── Address analysis ──
analyzeBtn.addEventListener('click', analyzeAddress);
addressInput.addEventListener('keydown', e => { if (e.key === 'Enter') analyzeAddress(); });

async function analyzeAddress() {
    const address = addressInput.value.trim();
    if (!address) return;
    statusEl.innerText = 'Geocoding...';
    statsEl.innerHTML = '';
    analyzeBtn.disabled = true;

    try {
        // Geocode with Nominatim
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`);
        const geoData = await geoRes.json();
        if (!geoData.length) { statusEl.innerText = 'Address not found'; analyzeBtn.disabled = false; return; }

        const lat = parseFloat(geoData[0].lat);
        const lon = parseFloat(geoData[0].lon);

        // Init map
        initLeafletMap(lat, lon);

        // Solar API - building insights
        statusEl.innerText = 'Fetching solar data...';
        let solar = await fetchSolar(lat, lon, 'HIGH');
        if (solar.error) solar = await fetchSolar(lat, lon, 'MEDIUM');
        if (solar.error) { statusEl.innerText = 'No solar data for this location'; analyzeBtn.disabled = false; return; }

        // Solar API - data layers (for heatmap + mask)
        const layersRes = await fetch(
            `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lon}&radiusMeters=50&view=FULL_LAYERS&requiredQuality=HIGH&pixelSizeMeters=0.5&key=${API_KEY}`
        );
        const layers = await layersRes.json();

        // Load roof mask overlay — only shows actual roof pixels
        if (layers.maskUrl) await loadRoofOverlay(layers.maskUrl);

        displaySolarResults(solar, address);
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

function displaySolarResults(data, address) {
    const sp = data.solarPotential;
    if (!sp) { statusEl.innerText = 'No solar potential data'; return; }

    const segments = sp.roofSegmentStats || [];
    const totalArea = sp.wholeRoofStats?.areaMeters2 || 0;
    const maxPanels = sp.maxArrayPanelsCount || 0;
    const maxArea = sp.maxArrayAreaMeters2 || 0;
    const sunshine = sp.maxSunshineHoursPerYear || 0;
    const systemKwp = (maxPanels * 475) / 1000;
    const annualKwh = systemKwp * sunshine * 0.8;

    // Draw only top segments as subtle labels (not circles for every segment)
    const sorted = [...segments].sort((a, b) => b.stats.areaMeters2 - a.stats.areaMeters2);
    const topSegments = sorted.slice(0, 4);
    const colors = ['#4ade80', '#facc15', '#60a5fa', '#f97316'];
    topSegments.forEach((seg, i) => {
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

    let segHtml = '';
    sorted.slice(0, 6).forEach((seg, i) => {
        const dir = azimuthToDir(seg.azimuthDegrees);
        const color = colors[i % colors.length] || '#888';
        segHtml += `<div class="segment" style="border-left:3px solid ${color}">
            #${i+1}: ${seg.stats.areaMeters2.toFixed(0)} m² · ${dir} · ${seg.pitchDegrees.toFixed(0)}° tilt
        </div>`;
    });

    statsEl.innerHTML = `
        <p><strong>Total roof:</strong> ${totalArea.toFixed(0)} m²</p>
        <p><strong>Usable for solar:</strong> ${maxArea.toFixed(0)} m²</p>
        <p><strong>Sunshine:</strong> ${sunshine.toFixed(0)} hrs/year</p>
        <p class="highlight">⚡ ${maxPanels} panels × 475W = ${systemKwp.toFixed(1)} kWp</p>
        <p class="highlight">📊 Est. ${(annualKwh/1000).toFixed(1)} MWh/year</p>
        <p style="margin-top:8px;font-size:0.8rem;color:#aaa">Roof segments:</p>
        ${segHtml}
    `;
}

function azimuthToDir(deg) {
    const dirs = ['N','NE','E','SE','S','SW','W','NW'];
    return dirs[Math.round(deg / 45) % 8];
}

// ── Three.js for GLB ──
let threeInited = false, scene3d, camera3d, renderer3d, controls3d, currentModel = null;
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

function initThree() {
    if (threeInited) return;
    threeInited = true;
    scene3d = new THREE.Scene();
    scene3d.background = new THREE.Color(0x222222);
    camera3d = new THREE.PerspectiveCamera(75, canvasContainer.clientWidth / canvasContainer.clientHeight, 0.1, 1000);
    renderer3d = new THREE.WebGLRenderer({ antialias: true });
    renderer3d.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
    renderer3d.setPixelRatio(window.devicePixelRatio);
    canvasContainer.appendChild(renderer3d.domElement);
    controls3d = new OrbitControls(camera3d, renderer3d.domElement);
    controls3d.enableDamping = true;
    scene3d.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dl = new THREE.DirectionalLight(0xffffff, 1.5);
    dl.position.set(50, 100, 50);
    scene3d.add(dl);
    (function animate() { requestAnimationFrame(animate); controls3d.update(); renderer3d.render(scene3d, camera3d); })();
}

loadBtn.addEventListener('click', () => { initThree(); loadGLB(modelSelect.value); });

function loadGLB(name) {
    if (currentModel) scene3d.remove(currentModel);
    statsEl.innerHTML = '';
    statusEl.innerText = `Loading ${name}...`;
    gltfLoader.load(
        encodeURI(`Exp 3D-Modells/3D_Modell ${name}.glb`),
        (gltf) => {
            const model = gltf.scene;
            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            model.position.sub(center);
            currentModel = model;
            scene3d.add(model);
            const size = box.getSize(new THREE.Vector3());
            const dist = Math.max(size.x, size.y, size.z) / (2 * Math.tan(camera3d.fov * Math.PI / 360)) * 1.5;
            camera3d.position.set(0, dist * 0.5, dist);
            controls3d.target.set(0, 0, 0);
            controls3d.update();
            statusEl.innerText = `Loaded ${name}`;
        },
        (xhr) => { if (xhr.lengthComputable) statusEl.innerText = `Loading ${name}: ${Math.round(xhr.loaded/xhr.total*100)}%`; },
        (err) => { console.error(err); statusEl.innerText = 'Error loading model'; }
    );
}

window.addEventListener('resize', () => {
    if (renderer3d) {
        camera3d.aspect = canvasContainer.clientWidth / canvasContainer.clientHeight;
        camera3d.updateProjectionMatrix();
        renderer3d.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
    }
    if (leafletMap) leafletMap.invalidateSize();
});
