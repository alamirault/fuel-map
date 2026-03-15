// ── Configuration ──────────────────────────────────────────────────────────

const API_URL =
  'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/' +
  'prix-des-carburants-en-france-flux-instantane-v2/records' +
  '?limit=100&offset=0';

const FUEL_LABELS = {
  Gazole: 'Gazole',
  SP95:   'SP95',
  SP98:   'SP98',
  E10:    'E10',
  E85:    'E85',
  GPLc:   'GPLc',
};

// ── State ───────────────────────────────────────────────────────────────────

let map;
let clusterGroup;
let allStations = [];
let currentFuel = 'Gazole';

// ── Map init ────────────────────────────────────────────────────────────────

function initMap() {
  map = L.map('map', {
    center: [46.5, 2.5],
    zoom: 6,
    zoomControl: true,
  });

  // Fond neutre avec noms de villes intégrés
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
    maxZoom: 19,
  }).addTo(map);

  fetch('departements.geojson')
    .then(r => r.json())
    .then(geojson => {
      L.geoJSON(geojson, {
        style: {
          color: '#2255bb',
          weight: 2,
          fillColor: '#ccdcf5',
          fillOpacity: 0.25,
        },
        onEachFeature(feature, layer) {
          layer.bindTooltip(feature.properties.nom, {
            permanent: false,
            direction: 'center',
            className: 'dept-tooltip',
          });
        },
      }).addTo(map);
    });

  clusterGroup = L.markerClusterGroup({ chunkedLoading: true });
  map.addLayer(clusterGroup);
}

// ── Data fetching ────────────────────────────────────────────────────────────

async function fetchAllStations() {
  const batchSize = 100;
  let offset = 0;
  let total = null;
  const results = [];

  showLoading(true);

  try {
    while (true) {
      const url = `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records?limit=${batchSize}&offset=${offset}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      if (total === null) total = json.total_count;
      results.push(...json.results);

      offset += batchSize;
      if (offset >= total || offset >= 3000) break; // cap at 3 000 stations for performance
    }

    allStations = results;
    renderMarkers();
  } catch (err) {
    showError(`Impossible de charger les données.<br>${err.message}`);
  } finally {
    showLoading(false);
  }
}

// ── Markers ───────────────────────────────────────────────────────────────────

function getStationPrice(station, fuel) {
  const fieldMap = {
    Gazole: 'gazole_prix',
    SP95:   'sp95_prix',
    SP98:   'sp98_prix',
    E10:    'e10_prix',
    E85:    'e85_prix',
    GPLc:   'gplc_prix',
  };
  const field = fieldMap[fuel];
  const val = station[field];
  return val != null ? parseFloat(val) : null;
}

function priceColor(ratio) {
  // ratio: 0 = cheapest (green), 1 = most expensive (red)
  const r = Math.round(255 * ratio);
  const g = Math.round(200 * (1 - ratio));
  return `rgb(${r},${g},40)`;
}

function makeIcon(color, price) {
  const label = price.toFixed(2);
  return L.divIcon({
    className: '',
    html: `<div style="
      background:${color};
      color:#fff;
      font-size:10px;
      font-weight:700;
      font-family:sans-serif;
      padding:3px 5px;
      border-radius:6px;
      border:2px solid rgba(255,255,255,0.8);
      box-shadow:0 1px 4px rgba(0,0,0,0.4);
      white-space:nowrap;
      line-height:1;
    ">${label}€</div>`,
    iconSize: null,
    iconAnchor: [20, 12],
    popupAnchor: [0, -16],
  });
}

function formatPrice(price) {
  return price != null ? price.toFixed(3) + ' €/L' : '—';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return dateStr; }
}

function buildPopup(station, highlightedFuel) {
  const name   = station.nom || station.enseignes || 'Station';
  const addr   = [station.adresse, station.ville].filter(Boolean).join(', ');

  const allFuels = ['Gazole', 'SP95', 'SP98', 'E10', 'E85', 'GPLc'];
  const priceRows = allFuels.map(fuel => {
    const p = getStationPrice(station, fuel);
    if (p == null) return '';
    const hl = fuel === highlightedFuel ? 'highlighted' : '';
    return `<div class="price-row ${hl}">
      <span class="fuel-name">${FUEL_LABELS[fuel]}</span>
      <span class="fuel-price">${formatPrice(p)}</span>
    </div>`;
  }).join('');

  const dateField = `${highlightedFuel.toLowerCase()}_maj`;
  const dateVal   = station[dateField];

  return `<div class="popup-content">
    <h3>⛽ ${name}</h3>
    <div class="address">${addr}</div>
    <div class="prices">${priceRows || '<em>Aucun prix disponible</em>'}</div>
    ${dateVal ? `<div class="update-date">Mis à jour le ${formatDate(dateVal)}</div>` : ''}
  </div>`;
}

function renderMarkers() {
  clusterGroup.clearLayers();

  const prices = allStations
    .map(s => getStationPrice(s, currentFuel))
    .filter(p => p != null);

  if (prices.length === 0) {
    updateStats(0, null, null, null);
    return;
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

  let count = 0;

  allStations.forEach(station => {
    const price = getStationPrice(station, currentFuel);
    if (price == null) return;

    const lat = station.geom?.lat;
    const lng = station.geom?.lon;
    if (!lat || !lng) return;

    const ratio  = (max === min) ? 0.5 : (price - min) / (max - min);
    const color  = priceColor(ratio);
    const marker = L.marker([lat, lng], { icon: makeIcon(color, price) });
    marker.bindPopup(buildPopup(station, currentFuel), { maxWidth: 260 });
    clusterGroup.addLayer(marker);
    count++;
  });

  updateStats(count, avg, min, max);
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function updateStats(count, avg, min, max) {
  document.getElementById('stat-count').textContent = count.toLocaleString('fr-FR');
  document.getElementById('stat-avg').textContent   = avg  != null ? avg.toFixed(3)  + ' €' : '—';
  document.getElementById('stat-min').textContent   = min  != null ? min.toFixed(3)  + ' €' : '—';
  document.getElementById('stat-max').textContent   = max  != null ? max.toFixed(3)  + ' €' : '—';
}

function showLoading(visible) {
  document.getElementById('loading').classList.toggle('hidden', !visible);
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.innerHTML = msg;
  el.classList.remove('hidden');
}

// ── Events ────────────────────────────────────────────────────────────────────

document.getElementById('fuel-select').addEventListener('change', e => {
  currentFuel = e.target.value;
  renderMarkers();
});

// ── Boot ───────────────────────────────────────────────────────────────────────

initMap();
fetchAllStations();
