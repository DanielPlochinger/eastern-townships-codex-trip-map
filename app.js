const data = window.TRIP_DATA;
const byId = new Map(data.places.map((place) => [place.id, place]));
const categories = new Map(data.categories.map((category) => [category.id, category]));

const state = {
  panel: "map",
  query: "",
  selectedCategories: new Set(),
  selectedPlaceId: null,
  userLayer: null
};

const displayPositions = buildDisplayPositions(data.places);

const map = L.map("map", {
  zoomControl: false,
  minZoom: 7,
  maxZoom: 18
}).setView([45.39, -72.05], 9);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap"
}).addTo(map);

L.control.zoom({ position: "bottomright" }).addTo(map);

const LocateControl = L.Control.extend({
  options: { position: "bottomright" },
  onAdd() {
    const button = L.DomUtil.create("button", "leaflet-control locate-control");
    button.type = "button";
    button.id = "locate";
    button.title = "Show my location";
    button.setAttribute("aria-label", "Show my location");
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 4 18-4-3-4 3 4-18Z"/></svg>`;
    L.DomEvent.disableClickPropagation(button);
    L.DomEvent.on(button, "click", () => locateUser());
    return button;
  }
});

map.addControl(new LocateControl());

const markerLayer = L.layerGroup().addTo(map);
const overlayLayer = L.layerGroup().addTo(map);
const markers = new Map();

const search = document.querySelector("#search");
const guideSearch = document.querySelector("#guide-search");
const detailSheet = document.querySelector("#detail-sheet");

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function category(place) {
  return categories.get(place.category);
}

function matchesQuery(place) {
  if (!state.query) return true;
  const haystack = [
    place.title,
    place.baseTitle,
    place.description,
    place.section,
    place.subsection,
    place.address,
    place.resolvedName
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(state.query.toLowerCase());
}

function visiblePlaces() {
  return data.places.filter((place) => {
    const categoryMatch = state.selectedCategories.size === 0 || state.selectedCategories.has(place.category);
    return categoryMatch && matchesQuery(place);
  });
}

function buildDisplayPositions(places) {
  const groups = new Map();
  for (const place of places) {
    const key = `${place.lat.toFixed(5)},${place.lng.toFixed(5)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(place);
  }

  const positions = new Map();
  for (const group of groups.values()) {
    if (group.length === 1) {
      positions.set(group[0].id, { lat: group[0].lat, lng: group[0].lng });
      continue;
    }

    const radius = 0.0065;
    group.forEach((place, index) => {
      const angle = (index / group.length) * Math.PI * 2 - Math.PI / 2;
      positions.set(place.id, {
        lat: place.lat + Math.sin(angle) * radius * 0.72,
        lng: place.lng + Math.cos(angle) * radius
      });
    });
  }
  return positions;
}

function displayPosition(place) {
  return displayPositions.get(place.id) || { lat: place.lat, lng: place.lng };
}

function markerIcon(place, selected = false) {
  const meta = category(place);
  return L.divIcon({
    className: "",
    iconSize: selected ? [35, 35] : [29, 29],
    iconAnchor: selected ? [17, 33] : [14, 28],
    html: `<div class="marker-pin ${selected ? "selected" : ""}" style="--pin:${meta.color}"><span>${meta.icon}</span></div>`
  });
}

function routeLoop(place) {
  const points = [];
  const distance = Number(place.description.match(/≈\s*([\d.]+)/)?.[1]) || 45;
  const radius = Math.max(0.038, Math.min(0.13, distance / (2 * Math.PI * 111)));
  const center = displayPosition(place);
  for (let i = 0; i <= 36; i += 1) {
    const angle = (i / 36) * Math.PI * 2;
    points.push([
      center.lat + Math.sin(angle) * radius * 0.72,
      center.lng + Math.cos(angle) * radius
    ]);
  }
  return points;
}

function renderMap() {
  markerLayer.clearLayers();
  overlayLayer.clearLayers();
  markers.clear();

  const places = visiblePlaces();
  for (const place of places) {
    const meta = category(place);
    const selected = state.selectedPlaceId === place.id;

    if (place.category === "bike") {
      L.polyline(routeLoop(place), {
        color: meta.color,
        weight: selected ? 3.5 : 2.75,
        opacity: selected ? 0.9 : 0.66,
        dashArray: "6 7"
      }).addTo(overlayLayer);
    }

    if (place.line) {
      L.polyline(place.line, {
        color: meta.color,
        weight: selected ? 5 : 4,
        opacity: selected ? 0.86 : 0.52,
        lineCap: "round"
      }).addTo(overlayLayer);
    }

    const pos = displayPosition(place);
    const marker = L.marker([pos.lat, pos.lng], {
      icon: markerIcon(place, selected),
      keyboard: true,
      title: place.title
    }).addTo(markerLayer);

    marker.on("click", (event) => {
      event.originalEvent?.stopPropagation();
      selectPlace(place.id, { pan: false });
    });
    markers.set(place.id, marker);
  }
}

function renderCategories(targetId) {
  const target = document.querySelector(targetId);
  target.innerHTML = "";
  const all = document.createElement("button");
  all.className = `chip ${state.selectedCategories.size === 0 ? "active" : ""}`;
  all.type = "button";
  all.style.setProperty("--chip", "#111827");
  all.innerHTML = `<span class="chip-dot"></span><span>All</span>`;
  all.addEventListener("click", () => setCategory("all"));
  target.appendChild(all);

  for (const cat of data.categories) {
    const button = document.createElement("button");
    button.className = `chip ${state.selectedCategories.has(cat.id) ? "active" : ""}`;
    button.type = "button";
    button.style.setProperty("--chip", cat.color);
    button.innerHTML = `<span class="chip-dot"></span><span>${escapeHtml(cat.label)}</span>`;
    button.addEventListener("click", () => setCategory(cat.id));
    target.appendChild(button);
  }
}

function setCategory(categoryId) {
  if (categoryId === "all") {
    state.selectedCategories.clear();
  } else if (state.selectedCategories.has(categoryId)) {
    state.selectedCategories.delete(categoryId);
  } else {
    state.selectedCategories.add(categoryId);
  }
  if (state.selectedPlaceId && !visiblePlaces().some((place) => place.id === state.selectedPlaceId)) {
    state.selectedPlaceId = null;
    renderDetail(null);
  }
  render();
}

function renderDetail(place) {
  if (!place) {
    detailSheet.classList.add("hidden");
    detailSheet.innerHTML = "";
    return;
  }
  detailSheet.classList.remove("hidden");
  const meta = category(place);
  const rating = place.rating ? `<span class="pill">Rating ${place.rating}/5</span>` : "";
  const address = place.address ? `<span class="pill">${escapeHtml(place.address)}</span>` : "";
  const status = place.status ? `<span class="pill status">${escapeHtml(place.status)}</span>` : "";
  const resolved = place.resolvedName && place.resolvedName !== place.title ? `<span class="pill">${escapeHtml(place.resolvedName)}</span>` : "";

  detailSheet.innerHTML = `
    <div class="sheet-handle"></div>
    <article class="place-detail">
      <button class="card-close" type="button" id="close-detail" aria-label="Close place details">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
      <div class="detail-kicker"><span class="chip-dot" style="--chip:${meta.color}"></span>${escapeHtml(meta.label)}</div>
      <h2 class="detail-title">${escapeHtml(place.title)}</h2>
      <p class="detail-text">${escapeHtml(place.description)}</p>
      <div class="detail-meta">${status}${rating}${resolved}${address}</div>
      <div class="detail-actions">
        <a class="action secondary" href="${place.mapsUrl}" target="_blank" rel="noreferrer" title="${escapeHtml(place.mapsUrl)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11Z"/><path d="M12 10.5h.01"/></svg>
          Google Maps
        </a>
        <button class="action secondary" type="button" id="open-guide">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12a2 2 0 0 1 2 2v14H8a4 4 0 0 1-4-4V6a2 2 0 0 1 2-2Z"/><path d="M8 4v16m4-11h4m-4 4h4"/></svg>
          Guide
        </button>
      </div>
    </article>
  `;
  detailSheet.querySelector("#close-detail")?.addEventListener("click", () => selectPlace(null));
  detailSheet.querySelector("#open-guide")?.addEventListener("click", () => openPlaceInGuide(place.id));
}

function selectPlace(id, options = {}) {
  state.selectedPlaceId = id;
  const place = id ? byId.get(id) : null;
  renderDetail(place);
  renderMap();

  if (place && options.pan) {
    state.selectedCategories = new Set([place.category]);
    syncCategoryStrips();
    const pos = displayPosition(place);
    map.panTo([pos.lat, pos.lng], { animate: true, duration: 0.45 });
  }
}

function renderGuide() {
  const list = document.querySelector("#guide-list");
  const places = visiblePlaces();
  list.innerHTML = "";

  for (const cat of data.categories) {
    const items = places.filter((place) => place.category === cat.id);
    if (!items.length) continue;
    const section = document.createElement("section");
    section.className = "guide-section";
    section.innerHTML = `<h2>${escapeHtml(cat.label)}</h2>`;
    for (const place of items) {
      const article = document.createElement("article");
      article.className = "guide-row";
      article.dataset.placeId = place.id;
      const status = place.status ? `<span class="pill status">${escapeHtml(place.status)}</span>` : "";
      const rating = place.rating ? `<span class="pill">Rating ${place.rating}/5</span>` : "";
      const address = place.address ? `<span class="pill">${escapeHtml(place.address)}</span>` : "";
      const route = place.routeUrl ? `
        <a class="action secondary" href="${place.routeUrl}" target="_blank" rel="noreferrer">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5m0 0 6 3 6-3 4 2v14l-4-2-6 3-6-3"/><path d="M10 8v14m6-17v14"/></svg>
          Route
        </a>` : "";
      article.innerHTML = `
        <div>
          <div class="row-kicker"><span class="chip-dot" style="--chip:${cat.color}"></span>${escapeHtml(place.linkLabel === "Maps" ? cat.label : place.linkLabel)}</div>
          <h3>${escapeHtml(place.title)}</h3>
          <p>${escapeHtml(place.description)}</p>
          <div class="detail-meta">${status}${rating}${address}</div>
          <div class="guide-actions">
            <a class="action secondary" href="${place.mapsUrl}" target="_blank" rel="noreferrer" title="${escapeHtml(place.mapsUrl)}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11Z"/><path d="M12 10.5h.01"/></svg>
              Google Maps
            </a>
            ${route}
            <button class="action secondary show-map" type="button" data-place-id="${escapeHtml(place.id)}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15m6-12v15"/></svg>
              Map
            </button>
          </div>
        </div>
      `;
      article.querySelector(".show-map").addEventListener("click", () => {
        showPanel("map");
        selectPlace(place.id, { pan: true });
      });
      section.appendChild(article);
    }
    list.appendChild(section);
  }
}

function syncCategoryStrips() {
  renderCategories("#category-strip");
  renderCategories("#guide-category-strip");
}

function render() {
  syncCategoryStrips();
  renderMap();
  renderGuide();
}

function showPanel(panel) {
  state.panel = panel;
  document.querySelectorAll(".panel").forEach((el) => el.classList.toggle("active", el.id === `${panel}-panel`));
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.panel === panel));
  if (panel === "map") {
    requestAnimationFrame(() => map.invalidateSize());
  }
}

function openPlaceInGuide(placeId) {
  const place = byId.get(placeId);
  if (!place) return;
  state.selectedCategories = new Set([place.category]);
  showPanel("guide");
  render();
  requestAnimationFrame(() => {
    const row = document.querySelector(`[data-place-id="${CSS.escape(placeId)}"]`);
    row?.scrollIntoView({ block: "start", behavior: "smooth" });
    row?.classList.add("focused");
    window.setTimeout(() => row?.classList.remove("focused"), 1200);
  });
}

function setQuery(value) {
  state.query = value.trim();
  search.value = value;
  guideSearch.value = value;
  if (state.selectedPlaceId && !visiblePlaces().some((place) => place.id === state.selectedPlaceId)) {
    selectPlace(null);
  }
  render();
}

search.addEventListener("input", (event) => setQuery(event.target.value));
guideSearch.addEventListener("input", (event) => setQuery(event.target.value));

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => showPanel(tab.dataset.panel));
});

map.on("click", () => selectPlace(null));

function locateUser() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((position) => {
    const latLng = [position.coords.latitude, position.coords.longitude];
    if (state.userLayer) state.userLayer.remove();
    state.userLayer = L.marker(latLng, {
      icon: L.divIcon({ className: "", iconSize: [18, 18], iconAnchor: [9, 9], html: "<div class=\"user-dot\"></div>" }),
      title: "Your location"
    }).addTo(map);
    map.panTo(latLng, { animate: true, duration: 0.45 });
  }, () => {}, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

document.querySelector("#reload-app").addEventListener("click", () => {
  window.location.reload();
});

render();

const bounds = L.latLngBounds(data.places.map((place) => {
  const pos = displayPosition(place);
  return [pos.lat, pos.lng];
}));
map.fitBounds(bounds.pad(0.08), { animate: false });
