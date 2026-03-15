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
let currentFuel = localStorage.getItem('fuel') || 'Gazole';
let stationMarkers = []; // [{station, marker}]

// ── Map init ────────────────────────────────────────────────────────────────

function initMap() {
  const saved = JSON.parse(localStorage.getItem('mapView') || 'null');
  const initCenter = saved ? [saved.lat, saved.lng] : [46.5, 2.5];
  const initZoom   = saved ? saved.zoom : 6;

  const isMobile = window.innerWidth <= 768;
  map = L.map('map', {
    center: initCenter,
    zoom: initZoom,
    zoomControl: true,
    scrollWheelZoom: true,
    doubleClickZoom: false,
    touchZoom: isMobile,
    boxZoom: false,
    keyboard: false,
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
          color: '#7aa0d4',
          weight: 0.8,
          fillColor: '#ccdcf5',
          fillOpacity: 0.15,
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

  clusterGroup = L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: 40,
    disableClusteringAtZoom: 9,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: false,
  });
  map.addLayer(clusterGroup);
}

// ── Utilities ────────────────────────────────────────────────────────────────

function haversine(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── OSM brand fetch + spatial index ──────────────────────────────────────────

const BRAND_COLORS = {
  'TotalEnergies': '#e40000', 'Total': '#e40000', 'Total Access': '#e40000',
  'BP': '#00a550',
  'Shell': '#e2a900',
  'Esso': '#003087',
  'Elf': '#e40000',
  'Agip': '#e40000',
  'Avia': '#ff6600',
  'Dyneff': '#003087',
  'E.Leclerc': '#003da5', 'Leclerc': '#003da5',
  'Intermarché': '#e2001a',
  'Carrefour': '#004a97', 'Carrefour Market': '#004a97',
  'Auchan': '#e2001a',
  'Casino': '#00843d', 'Géant Casino': '#00843d',
  'Super U': '#e2001a', 'Hyper U': '#e2001a', 'Système U': '#e2001a',
  'Netto': '#c8a800',
  'Lidl': '#0050aa',
  'Vito': '#ff6600',
};


const BRAND_LOGO = {
  'TotalEnergies': 'totalenergies', 'Total': 'totalenergies', 'Total Access': 'totalenergies',
  'BP': 'bp',
  'Shell': 'shell',
  'Esso': 'esso',
  'Elf': 'totalenergies',
  'Avia': 'avia',
  'E.Leclerc': 'leclerc', 'Leclerc': 'leclerc',
  'Intermarché': 'intermarche',
  'Carrefour': 'carrefour', 'Carrefour Market': 'carrefour',
  'Auchan': 'auchan',
  'Casino': 'casino', 'Géant Casino': 'casino',
  'Super U': 'systeme-u', 'Hyper U': 'systeme-u', 'Système U': 'systeme-u',
  'Netto': 'netto',
  'Lidl': 'lidl',
};

function brandLogoUrl(brand) {
  const file = brand ? BRAND_LOGO[brand] : null;
  return file ? `logos/${file}.png` : null;
}

const OSM_CACHE_KEY = 'osm_fuel_brands_v1';
const OSM_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 jours

async function fetchOSMStations() {
  const cached = JSON.parse(localStorage.getItem(OSM_CACHE_KEY) || 'null');
  if (cached && Date.now() - cached.ts < OSM_CACHE_TTL) return cached.data;

  const query = `[out:json][timeout:60];node["amenity"="fuel"](41.3,-5.1,51.1,9.6);out body qt;`;
  const res   = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
  const json  = await res.json();

  const data = json.elements
    .map(el => ({
      lat:   el.lat,
      lon:   el.lon,
      brand: el.tags?.brand || el.tags?.operator || el.tags?.name || null,
    }))
    .filter(s => s.brand);

  try {
    localStorage.setItem(OSM_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch {} // quota dépassé : on continue sans cache

  return data;
}

function buildSpatialIndex(osmStations) {
  const index = new Map();
  for (const s of osmStations) {
    const key = `${Math.round(s.lat * 100)},${Math.round(s.lon * 100)}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(s);
  }
  return index;
}

function findBrandInIndex(lat, lng, index) {
  let bestBrand = null, bestDist = 0.35; // max 350m
  for (let dlat = -1; dlat <= 1; dlat++) {
    for (let dlng = -1; dlng <= 1; dlng++) {
      const key = `${Math.round(lat * 100) + dlat},${Math.round(lng * 100) + dlng}`;
      for (const c of index.get(key) ?? []) {
        const d = haversine(lat, lng, c.lat, c.lon);
        if (d < bestDist) { bestDist = d; bestBrand = c.brand; }
      }
    }
  }
  return bestBrand;
}

function brandLogoHtml(brand) {
  if (!brand) return '';
  const url = brandLogoUrl(brand);
  return url
    ? `<img src="${url}" height="22" style="border-radius:3px;margin-right:6px;vertical-align:middle;" onerror="this.style.display='none'">`
    : '';
}

// ── Data fetching ─────────────────────────────────────────────────────────────

const PRICE_CACHE_KEY = 'fuel_prices_v1';
const PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchPriceData() {
  const cached = JSON.parse(localStorage.getItem(PRICE_CACHE_KEY) || 'null');
  if (cached && Date.now() - cached.ts < PRICE_CACHE_TTL) return cached.data;

  const res = await fetch('https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/exports/json?limit=-1');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  try {
    localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch {} // quota dépassé : on continue sans cache

  return data;
}

async function loadData() {
  showLoading(true);
  try {
    const [priceData, osmStations] = await Promise.all([
      fetchPriceData(),
      fetchOSMStations().catch(() => []), // enseigne non bloquant
    ]);

    const index = buildSpatialIndex(osmStations);

    // Enrichissement : attache le brand directement sur chaque station
    allStations = priceData.map(s => {
      const lat = s.geom?.lat;
      const lng = s.geom?.lon;
      return { ...s, brand: (lat && lng) ? findBrandInIndex(lat, lng, index) : null };
    });

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

function makeIcon(color, price, brand) {
  const label   = price.toFixed(2);
  const logoUrl = brandLogoUrl(brand);
  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" width="14" height="14" style="border-radius:2px;vertical-align:middle;margin-right:3px;" onerror="this.style.display='none'">`
    : '';
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
      display:flex;
      align-items:center;
    ">${logoHtml}${label}€</div>`,
    iconSize: null,
    iconAnchor: [24, 14],
    popupAnchor: [0, -18],
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
  const adresseLine = [station.adresse, station.cp].filter(Boolean).join(' ');
  const cityLine    = [station.ville, station.departement].filter(Boolean).join(', ');
  const fullAddr    = [adresseLine, cityLine].filter(Boolean).join(', ');

  const lat = station.geom?.lat;
  const lng = station.geom?.lon;
  const wazeUrl  = lat ? `https://waze.com/ul?ll=${lat},${lng}&navigate=yes` : null;
  const gmapsUrl = lat ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : null;

  const addrLink = `<address>${fullAddr || '—'}</address>`;

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

  const title = station.brand || 'Station';

  return `<div class="popup-content">
    <div class="popup-header">${brandLogoHtml(station.brand)}<span class="popup-title">${title}</span></div>
    <div class="address">${addrLink}</div>
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

  stationMarkers = [];

  allStations.forEach(station => {
    const price = getStationPrice(station, currentFuel);
    if (price == null) return;

    const lat = station.geom?.lat;
    const lng = station.geom?.lon;
    if (!lat || !lng) return;

    const ratio  = (max === min) ? 0.5 : (price - min) / (max - min);
    const color  = priceColor(ratio);
    const marker = L.marker([lat, lng], { icon: makeIcon(color, price, station.brand) });
    marker.bindPopup(buildPopup(station, currentFuel), { maxWidth: 260 });
    clusterGroup.addLayer(marker);
    stationMarkers.push({ station, marker });
  });

  updateStatsFromBounds();
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function updateStats(count, avg, min, max) {
  document.getElementById('stat-count').textContent = count.toLocaleString('fr-FR');
  document.getElementById('stat-avg').textContent   = avg  != null ? avg.toFixed(3)  + ' €' : '—';
  document.getElementById('stat-min').textContent   = min  != null ? min.toFixed(3)  + ' €' : '—';
  document.getElementById('stat-max').textContent   = max  != null ? max.toFixed(3)  + ' €' : '—';
}

let visibleMinMarker = null;
let visibleMaxMarker = null;

function updateStatsFromBounds() {
  const bounds = map.getBounds();
  const visible = stationMarkers.filter(({ station }) => {
    const lat = station.geom?.lat;
    const lng = station.geom?.lon;
    return lat && lng && bounds.contains([lat, lng]);
  });

  const withPrice = visible
    .map(({ station, marker }) => ({ price: getStationPrice(station, currentFuel), station, marker }))
    .filter(({ price }) => price != null);

  if (withPrice.length === 0) {
    visibleMinMarker = null;
    visibleMaxMarker = null;
    updateStats(0, null, null, null);
    return;
  }

  withPrice.sort((a, b) => a.price - b.price);
  visibleMinMarker = withPrice[0].marker;
  visibleMaxMarker = withPrice[withPrice.length - 1].marker;

  const prices = withPrice.map(x => x.price);
  const min = prices[0];
  const max = prices[prices.length - 1];
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  updateStats(prices.length, avg, min, max);
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

const fuelSelect = document.getElementById('fuel-select');
fuelSelect.value = currentFuel;
fuelSelect.addEventListener('change', e => {
  currentFuel = e.target.value;
  localStorage.setItem('fuel', currentFuel);
  renderMarkers();
});

let pulseMarker = null;

function pulseOnMarker(marker) {
  if (!marker) return;
  const latlng = marker.getLatLng();

  if (pulseMarker) { pulseMarker.remove(); pulseMarker = null; }

  pulseMarker = L.marker(latlng, {
    icon: L.divIcon({
      className: '',
      html: '<div class="pulse-ring"></div>',
      iconSize: [60, 60],
      iconAnchor: [30, 30],
    }),
    interactive: false,
    zIndexOffset: 2000,
  }).addTo(map);

  setTimeout(() => { if (pulseMarker) { pulseMarker.remove(); pulseMarker = null; } }, 3000);
}

document.getElementById('stat-min').closest('.stat-box').addEventListener('click', () => pulseOnMarker(visibleMinMarker));
document.getElementById('stat-max').closest('.stat-box').addEventListener('click', () => pulseOnMarker(visibleMaxMarker));

// ── Geolocation ───────────────────────────────────────────────────────────────

let userMarker = null;

document.getElementById('locate-btn').addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('La géolocalisation n\'est pas supportée par votre navigateur.');
    return;
  }

  const btn = document.getElementById('locate-btn');
  btn.textContent = '⏳ Localisation...';
  btn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const { latitude: lat, longitude: lng } = coords;

      if (userMarker) userMarker.remove();

      userMarker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="
            width:16px;height:16px;
            background:#4a90e2;
            border:3px solid #fff;
            border-radius:50%;
            box-shadow:0 0 0 3px rgba(74,144,226,0.4);
          "></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
        zIndexOffset: 1000,
      }).addTo(map).bindPopup('Vous êtes ici');

      map.setView([lat, lng], 11);
      btn.textContent = '📍 Ma position';
      btn.disabled = false;
    },
    () => {
      alert('Impossible d\'obtenir votre position.');
      btn.textContent = '📍 Ma position';
      btn.disabled = false;
    }
  );
});

// ── Route ─────────────────────────────────────────────────────────────────────

let routeLayer    = null;
let routeMarkers  = [];

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=fr`;
  const res  = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
  const data = await res.json();
  if (!data.length) throw new Error(`Lieu introuvable : "${query}"`);
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

async function fetchRoute(from, to) {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  const res  = await fetch(url);
  const data = await res.json();
  if (data.code !== 'Ok') throw new Error('Impossible de calculer l\'itinéraire');
  return data.routes[0].geometry.coordinates; // [[lng, lat], …]
}


function minDistToRoute(lat, lng, routeCoords) {
  let min = Infinity;
  for (const [rLng, rLat] of routeCoords) {
    const d = haversine(lat, lng, rLat, rLng);
    if (d < min) min = d;
  }
  return min;
}

function clearRoute() {
  if (routeLayer)  { routeLayer.remove(); routeLayer = null; }
  routeMarkers.forEach(m => m.remove());
  routeMarkers = [];
  document.getElementById('route-stations').innerHTML = '';
  document.getElementById('route-clear').classList.add('hidden');
  document.getElementById('route-error').classList.add('hidden');
}

async function calculateRoute() {
  const fromVal = document.getElementById('route-from').value.trim();
  const toVal   = document.getElementById('route-to').value.trim();
  if (!fromVal || !toVal) return;

  clearRoute();
  document.getElementById('route-loading').classList.remove('hidden');
  document.getElementById('route-error').classList.add('hidden');

  try {
    const fromInput = document.getElementById('route-from');
    const toInput   = document.getElementById('route-to');
    const from = fromInput.dataset.lat
      ? { lat: parseFloat(fromInput.dataset.lat), lng: parseFloat(fromInput.dataset.lng) }
      : await geocode(fromVal);
    const to = toInput.dataset.lat
      ? { lat: parseFloat(toInput.dataset.lat), lng: parseFloat(toInput.dataset.lng) }
      : await geocode(toVal);
    const routeCoords = await fetchRoute(from, to);

    // Trace la route
    routeLayer = L.polyline(routeCoords.map(([lng, lat]) => [lat, lng]), {
      color: '#4a90e2', weight: 4, opacity: 0.8,
    }).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });

    // Stations à moins de 5 km du trajet, avec prix disponible
    const RADIUS_KM = 5;
    const nearby = allStations
      .map(s => {
        const lat   = s.geom?.lat;
        const lng   = s.geom?.lon;
        const price = getStationPrice(s, currentFuel);
        if (!lat || !lng || price == null) return null;
        const dist = minDistToRoute(lat, lng, routeCoords);
        return dist <= RADIUS_KM ? { s, lat, lng, price, dist } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.price - b.price);

    if (nearby.length === 0) {
      document.getElementById('route-error').textContent = 'Aucune station trouvée sur cet itinéraire.';
      document.getElementById('route-error').classList.remove('hidden');
      document.getElementById('route-clear').classList.remove('hidden');
      return;
    }

    // Affiche les 5 moins chères avec marqueur étoile
    const top = nearby.slice(0, 5);
    const list = document.getElementById('route-stations');
    list.innerHTML = `<li class="route-list-header">⭐ ${top.length} moins chères (sur ${nearby.length} stations)</li>`;

    top.forEach(({ s, lat, lng, price }, i) => {
      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="route-star-marker">${i + 1}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 46],
          popupAnchor: [0, -50],
        }),
        zIndexOffset: 1500,
      }).addTo(map).bindPopup(buildPopup(s, currentFuel), { maxWidth: 260 });
      routeMarkers.push(marker);

      const li = document.createElement('li');
      li.className = 'route-station-item';
      li.innerHTML = `<span class="route-rank">${i + 1}</span>
        <span class="route-info">
          <span class="route-addr">${s.adresse || '—'}, ${s.ville || ''}</span>
          <span class="route-price">${price.toFixed(3)} €/L</span>
        </span>`;
      li.addEventListener('click', () => {
        map.setView([lat, lng], Math.max(map.getZoom(), 13));
        marker.openPopup();
      });
      list.appendChild(li);
    });

    document.getElementById('route-clear').classList.remove('hidden');
  } catch (err) {
    document.getElementById('route-error').textContent = err.message;
    document.getElementById('route-error').classList.remove('hidden');
  } finally {
    document.getElementById('route-loading').classList.add('hidden');
  }
}

document.getElementById('route-btn').addEventListener('click', calculateRoute);
document.getElementById('route-clear').addEventListener('click', clearRoute);

// ── Autocomplete ──────────────────────────────────────────────────────────────

function setupAutocomplete(inputId, suggestionsId) {
  const input = document.getElementById(inputId);
  const list  = document.getElementById(suggestionsId);
  let debounceTimer = null;

  input.addEventListener('input', () => {
    delete input.dataset.lat;
    delete input.dataset.lng;
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 3) { list.classList.add('hidden'); return; }

    debounceTimer = setTimeout(async () => {
      try {
        const url  = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=fr&bbox=-5.1,41.3,9.6,51.1`;
        const res  = await fetch(url);
        const data = await res.json();

        list.innerHTML = '';
        if (!data.features?.length) { list.classList.add('hidden'); return; }

        data.features.forEach(item => {
          const p    = item.properties;
          const parts = [p.name, p.street && p.housenumber ? `${p.housenumber} ${p.street}` : p.street, p.city || p.town || p.village, p.postcode].filter(Boolean);
          const label = [...new Set(parts)].join(', ');
          const [lng, lat] = item.geometry.coordinates;

          const li = document.createElement('li');
          li.textContent = label;
          li.addEventListener('mousedown', e => {
            e.preventDefault();
            input.value = label;
            input.dataset.lat = lat;
            input.dataset.lng = lng;
            list.classList.add('hidden');
          });
          list.appendChild(li);
        });
        list.classList.remove('hidden');
      } catch { list.classList.add('hidden'); }
    }, 300);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { list.classList.add('hidden'); calculateRoute(); }
    if (e.key === 'Escape') list.classList.add('hidden');
  });

  input.addEventListener('blur', () => {
    setTimeout(() => list.classList.add('hidden'), 150);
  });
}

setupAutocomplete('route-from', 'route-from-suggestions');
setupAutocomplete('route-to',   'route-to-suggestions');

// ── Mobile sidebar toggle ─────────────────────────────────────────────────────

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

document.getElementById('sidebar-handle').addEventListener('click', toggleSidebar);
document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);



// ── Boot ───────────────────────────────────────────────────────────────────────

initMap();
map.on('click', () => {
  if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
});
map.on('moveend zoomend', () => {
  const { lat, lng } = map.getCenter();
  localStorage.setItem('mapView', JSON.stringify({ lat, lng, zoom: map.getZoom() }));
  updateStatsFromBounds();
});
loadData();
