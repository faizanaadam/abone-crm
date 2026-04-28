// ── Supabase ──────────────────────────────────────────────────────────────────
const supabaseUrl = 'https://jrvghcxtrpdmyhgjypms.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpydmdoY3h0cnBkbXloZ2p5cG1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDA4ODIsImV4cCI6MjA5MjY3Njg4Mn0.UVlzfHUnkpWQPt-RAmK9m2cpoX20GQNsEPs9m1w8bto';
const db = window.supabase.createClient(supabaseUrl, supabaseKey);

// ── State ─────────────────────────────────────────────────────────────────────
let map, markerCluster;
let doctorsData = [];
let zonesData   = [];
let markersMap  = new Map();   // id → leaflet marker
let polygonsMap = new Map();   // zone_id → leaflet polygon
let activeDoctorId = null;
let activeZone  = 'all';
let activeSpec  = 'all';

const ZONE_COLORS = ['#ef4444','#f97316','#f59e0b','#84cc16','#22c55e',
                     '#10b981','#06b6d4','#3b82f6','#6366f1','#a855f7'];

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    initMap();
    setupBottomSheet();
    setupEventListeners();
    await fetchZones();
    await fetchDoctors();
    setupRealtime();
    setDbStatus(true);
});

// ── Map Init ──────────────────────────────────────────────────────────────────
function initMap() {
    map = L.map('map', { zoomControl: false, touchZoom: true, dragging: true, tap: false })
           .setView([12.9716, 77.5946], 11);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors © CARTO',
        subdomains: 'abcd', maxZoom: 20
    }).addTo(map);

    markerCluster = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 40, spiderfyOnMaxZoom: true });
    map.addLayer(markerCluster);
}

// ── Supabase Fetch ────────────────────────────────────────────────────────────
async function fetchZones() {
    const { data, error } = await db.from('zones').select('*');
    if (error) { console.error(error); return; }
    zonesData = data;
    renderZoneFilters();
    drawZonePolygons();
}

async function fetchDoctors() {
    const { data, error } = await db.from('doctors').select('*');
    if (error) { console.error(error); showError('Failed to load directory.'); return; }
    // Filter out "Exclude" specialization entirely
    doctorsData = (data || []).filter(d => (d.specialization || '').trim().toLowerCase() !== 'exclude');
    renderDoctors(getFilteredDoctors());
}

// ── Filtering helpers ─────────────────────────────────────────────────────────
function getFilteredDoctors() {
    let list = doctorsData;
    if (activeZone !== 'all') list = list.filter(d => d.zone_id == activeZone);
    if (activeSpec !== 'all') list = list.filter(d => (d.spec_category || 'General') === activeSpec);
    return list;
}

// ── Zone Filters ──────────────────────────────────────────────────────────────
function renderZoneFilters() {
    const container = document.getElementById('zoneFilters');
    const allBtn = document.getElementById('zoneAll');
    container.innerHTML = '';
    container.appendChild(allBtn);
    zonesData.forEach(z => {
        const btn = document.createElement('button');
        btn.className = 'zone-filter';
        btn.dataset.zone = z.id;
        btn.textContent = z.name;
        btn.onclick = () => setZoneFilter(z.id);
        container.appendChild(btn);
    });
    allBtn.onclick = () => setZoneFilter('all');
}

function setZoneFilter(zoneId) {
    activeZone = zoneId;
    document.querySelectorAll('.zone-filter').forEach(b => b.classList.toggle('active', b.dataset.zone == zoneId));

    polygonsMap.forEach((poly, id) => {
        if (zoneId === 'all') {
            poly.setStyle({ weight: 2, opacity: 0.7, fillOpacity: 0.08 });
        } else if (id == zoneId) {
            poly.setStyle({ weight: 5, opacity: 0.7, fillOpacity: 0.7 });
        } else {
            poly.setStyle({ weight: 1, opacity: 0.05, fillOpacity: 0.05 });
        }
    });

    if (zoneId !== 'all') {
        const poly = polygonsMap.get(zoneId);
        if (poly) map.fitBounds(poly.getBounds(), { padding: [20, 20] });
    } else {
        map.setView([12.9716, 77.5946], 11);
    }
    renderDoctors(getFilteredDoctors());
}

function setSpecFilter(spec) {
    activeSpec = spec;
    document.querySelectorAll('.spec-filter').forEach(b => b.classList.toggle('active', b.dataset.spec === spec));
    renderDoctors(getFilteredDoctors());
}

// ── Draw Polygons ─────────────────────────────────────────────────────────────
function drawZonePolygons() {
    zonesData.forEach((zone, i) => {
        if (!zone.polygon_coords || !zone.polygon_coords.length) return;
        const color = ZONE_COLORS[i % ZONE_COLORS.length];
        const poly = L.polygon(zone.polygon_coords, {
            color, fillColor: color, fillOpacity: 0.08, weight: 2, opacity: 0.7
        }).addTo(map);
        poly.bindTooltip(`<b>Zone ${zone.id}:</b> ${zone.name}`, { sticky: true });
        poly.on('click', () => setZoneFilter(zone.id));
        polygonsMap.set(zone.id, poly);
    });
}

// ── Marker icon ───────────────────────────────────────────────────────────────
function getSpecClass(doc) {
    if (doc.is_approximate) return 'spec-approximate';
    const cat = (doc.spec_category || '').toLowerCase();
    if (cat === 'spine')   return 'spec-spine';
    if (cat === 'trauma')  return 'spec-trauma';
    if (cat === 'both')    return 'spec-both';
    return 'spec-general';
}

// ── Navigation URL (3-tier priority) ─────────────────────────────────────────
function getNavUrl(doc) {
    // Priority 1: explicit Google Maps link
    if (doc.hospital_maps_link && doc.hospital_maps_link.startsWith('http')) {
        return doc.hospital_maps_link;
    }
    // Priority 2: precise coordinates (Blue Pin)
    if (!doc.is_approximate && doc.lat && doc.lon) {
        return `https://www.google.com/maps/search/?api=1&query=${doc.lat},${doc.lon}`;
    }
    // Priority 3: approximate (Grey Circle) — search by name + area
    const clinicPart = encodeURIComponent((doc.clinic_name || doc.hospitals_practice || doc.name || '').trim());
    const areaPart   = encodeURIComponent((doc.area_name || '').trim());
    return `https://www.google.com/maps/search/?api=1&query=${clinicPart}+${areaPart}+Bangalore`;
}

// ── Render Doctors ────────────────────────────────────────────────────────────
function renderDoctors(docs) {
    const list = document.getElementById('doctorList');
    list.innerHTML = '';
    markerCluster.clearLayers();
    markersMap.clear();

    document.getElementById('doctorCount').textContent = `${docs.length} doctors`;

    if (!docs.length) {
        list.innerHTML = '<div class="text-slate-400 text-center py-10 text-sm">No doctors found.</div>';
        return;
    }

    const frag = document.createDocumentFragment();

    docs.forEach(doc => {
        // Bounding box guard
        if (doc.lat && doc.lon) {
            if (doc.lat < 12.7 || doc.lat > 13.25 || doc.lon < 77.3 || doc.lon > 77.85) return;
        }

        // ── Map Marker ───────────────────────────────────────────────────────
        if (doc.lat && doc.lon) {
            const specClass = getSpecClass(doc);
            const icon = L.divIcon({
                className: `custom-marker ${specClass}`,
                iconSize: [30, 42],
                iconAnchor: [15, 42],
                html: `<div class="marker-pin"></div>`
            });
            const marker = L.marker([doc.lat, doc.lon], { icon });

            // Immediate navigation on marker click
            marker.on('click', () => window.open(getNavUrl(doc), '_blank'));

            markerCluster.addLayer(marker);
            markersMap.set(doc.id, marker);
        }

        // ── Sidebar Card ─────────────────────────────────────────────────────
        const card = document.createElement('div');
        card.id = `doc-card-${doc.id}`;
        card.className = 'doctor-card bg-white border border-slate-100 mx-3 my-1.5 rounded-2xl p-4 cursor-pointer shadow-sm';

        const specBadge = doc.spec_category || 'General';
        const badgeColor = { Spine: 'bg-green-100 text-green-700', Trauma: 'bg-orange-100 text-orange-700',
                             Both: 'bg-yellow-100 text-yellow-700', General: 'bg-blue-100 text-blue-700' }[specBadge] || 'bg-slate-100 text-slate-600';

        card.innerHTML = `
            <div class="flex justify-between items-start gap-2">
                <div class="min-w-0">
                    <h3 class="font-bold text-slate-800 text-sm leading-tight truncate">${doc.name}</h3>
                    <p class="text-xs text-slate-500 truncate mt-0.5">${doc.hospitals_practice || doc.clinic_name || '—'}</p>
                </div>
                <span class="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeColor}">${specBadge}</span>
            </div>
            ${doc.phone ? `
            <div class="mt-2.5 flex gap-2">
                <a href="tel:${doc.phone}" onclick="event.stopPropagation()"
                   class="flex-1 bg-green-600 text-white text-xs py-2 rounded-xl font-semibold flex items-center justify-center gap-1 active:scale-95 transition-transform">
                    <i class="ph-fill ph-phone"></i> Call
                </a>
                <button onclick="event.stopPropagation(); showDetail(${doc.id})"
                   class="flex-1 bg-slate-100 text-slate-700 text-xs py-2 rounded-xl font-semibold flex items-center justify-center gap-1 active:scale-95 transition-transform">
                    <i class="ph ph-info"></i> Details
                </button>
            </div>` : `
            <div class="mt-2.5">
                <button onclick="event.stopPropagation(); showDetail(${doc.id})"
                   class="w-full bg-slate-100 text-slate-700 text-xs py-2 rounded-xl font-semibold flex items-center justify-center gap-1 active:scale-95 transition-transform">
                    <i class="ph ph-info"></i> View Details
                </button>
            </div>`}
        `;
        card.onclick = () => showDetail(doc.id);
        frag.appendChild(card);
    });

    list.appendChild(frag);
}

// ── Detail View ───────────────────────────────────────────────────────────────
function showDetail(id) {
    const doc = doctorsData.find(d => d.id === id);
    if (!doc) return;

    // Swap views
    document.getElementById('doctorList').classList.add('hidden');
    const detailCard = document.getElementById('detail-card');
    detailCard.classList.remove('hidden');
    detailCard.classList.add('flex');

    if (isMobile()) setSheetState('half');

    // Build detail HTML
    const rating  = parseFloat(doc.hospital_rating) || 0;
    const reviews = doc.hospital_reviews ? `(${doc.hospital_reviews})` : '';
    let starsHtml = '';
    if (rating > 0) {
        for (let i = 1; i <= 5; i++) {
            if (i <= rating)        starsHtml += '<i class="ph-fill ph-star text-yellow-400 text-sm"></i>';
            else if (i-0.5 <= rating) starsHtml += '<i class="ph-fill ph-star-half text-yellow-400 text-sm"></i>';
            else                    starsHtml += '<i class="ph ph-star text-slate-300 text-sm"></i>';
        }
        starsHtml += `<span class="text-xs text-slate-500 ml-1">${rating} ${reviews}</span>`;
    } else {
        starsHtml = '<span class="text-xs text-slate-400">No ratings</span>';
    }

    const approxWarning = doc.is_approximate ? `
        <div class="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-xl p-3 mb-4">
            <span class="text-lg">📍</span>
            <p class="text-xs text-orange-700 font-medium">Location estimated. Opening Google Search for this clinic.</p>
        </div>` : '';

    const navUrl = getNavUrl(doc);

    document.getElementById('detailContent').innerHTML = `
        <div class="p-5 pb-2">
            ${approxWarning}
            <h2 class="text-xl font-bold text-slate-800 leading-tight">${doc.name}</h2>
            <p class="text-sm text-slate-500 mt-1 mb-4">${doc.specialization || 'General Ortho'}</p>

            <div class="space-y-3">
                <div class="bg-slate-50 rounded-xl p-3.5 border border-slate-100">
                    <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Clinic / Hospital</div>
                    <div class="text-sm font-medium text-slate-700">${doc.clinic_name || doc.hospitals_practice || '—'}</div>
                    <div class="flex items-center mt-1.5">${starsHtml}</div>
                </div>

                <div class="bg-slate-50 rounded-xl p-3.5 border border-slate-100">
                    <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Consultation Timing</div>
                    <div class="text-sm text-slate-700">${doc.consultation_timing || 'Not available'}</div>
                </div>

                <div class="bg-slate-50 rounded-xl p-3.5 border border-slate-100">
                    <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Address</div>
                    <div class="text-sm text-slate-700">${doc.hospital_address || doc.clinic_location || 'Not available'}</div>
                    <a href="${navUrl}" target="_blank"
                       class="mt-2 inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline">
                        <i class="ph ph-navigation-arrow"></i> Open in Google Maps
                    </a>
                </div>

                ${doc.phone ? `
                <a href="tel:${doc.phone}"
                   class="flex items-center justify-center gap-2 w-full bg-green-600 text-white py-4 rounded-2xl font-bold text-base shadow-md active:scale-95 transition-transform mt-4">
                    <i class="ph-fill ph-phone text-xl"></i> Call Doctor
                </a>` : `
                <button disabled class="w-full bg-slate-200 text-slate-400 py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 cursor-not-allowed mt-4">
                    <i class="ph-fill ph-phone-slash text-xl"></i> No Phone Listed
                </button>`}

                <button onclick="openEditModal(${doc.id})"
                   class="w-full bg-blue-50 text-blue-700 border border-blue-200 py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform">
                    <i class="ph-fill ph-pencil-simple"></i> Edit Notes
                </button>
            </div>
        </div>
    `;

    // Fly map to marker and blink
    const marker = markersMap.get(id);
    if (marker) {
        if (activeDoctorId && markersMap.has(activeDoctorId)) {
            const prev = markersMap.get(activeDoctorId);
            if (prev.getElement()) L.DomUtil.removeClass(prev.getElement(), 'marker-blinking');
        }
        activeDoctorId = id;
        map.flyTo(marker.getLatLng(), 16, { animate: true, duration: 1 });
        setTimeout(() => {
            if (marker.getElement()) L.DomUtil.addClass(marker.getElement(), 'marker-blinking');
        }, 1000);
    }
}

// ── Back to List ──────────────────────────────────────────────────────────────
function backToList() {
    document.getElementById('detail-card').classList.add('hidden');
    document.getElementById('detail-card').classList.remove('flex');
    document.getElementById('doctorList').classList.remove('hidden');

    if (activeDoctorId && markersMap.has(activeDoctorId)) {
        const m = markersMap.get(activeDoctorId);
        if (m.getElement()) L.DomUtil.removeClass(m.getElement(), 'marker-blinking');
    }
    activeDoctorId = null;
    if (isMobile()) setSheetState('half');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isMobile() { return window.innerWidth < 768; }

// ── Bottom Sheet (3 snap points — mobile only) ────────────────────────────────
let setSheetState;
function setupBottomSheet() {
    const sheet      = document.getElementById('bottomSheet');
    const handle     = document.getElementById('dragHandle');
    const sheetH     = () => sheet.offsetHeight;

    // SNAP POSITIONS (translateY values, sheet height = 92vh)
    // peek = only handle visible (92vh - 56px)
    // half = half screen
    // full = fully open (10% from top)
    const snapY = () => ({
        peek: sheetH() - 56,
        half: window.innerHeight * 0.5,
        full: window.innerHeight * 0.08,
    });

    setSheetState = function(state) {
        if (!isMobile()) {
            // Desktop: sidebar is always visible, no transforms
            sheet.style.transition = 'none';
            sheet.style.transform  = 'none';
            return;
        }
        const y = snapY();
        const val = state === 'full' ? y.full : state === 'half' ? y.half : y.peek;
        sheet.style.transition = 'transform 0.32s cubic-bezier(0.25, 0.8, 0.25, 1)';
        sheet.style.transform  = `translateY(${val}px)`;
        sheet._state = state;
    };

    let startY, startTranslate, dragging = false;

    handle.addEventListener('touchstart', e => {
        if (!isMobile()) return;
        startY = e.touches[0].clientY;
        const m = (sheet.style.transform || '').match(/translateY\((.+)px\)/);
        startTranslate = m ? parseFloat(m[1]) : snapY().peek;
        dragging = true;
        sheet.style.transition = 'none';
    }, { passive: true });

    handle.addEventListener('touchmove', e => {
        if (!dragging) return;
        const delta = e.touches[0].clientY - startY;
        let newY = startTranslate + delta;
        const { full, peek } = snapY();
        newY = Math.max(full, Math.min(peek, newY));
        sheet.style.transform = `translateY(${newY}px)`;
    }, { passive: true });

    handle.addEventListener('touchend', e => {
        if (!dragging) return;
        dragging = false;
        const m = (sheet.style.transform || '').match(/translateY\((.+)px\)/);
        const curY = m ? parseFloat(m[1]) : snapY().half;
        const { peek, half, full } = snapY();
        if      (curY < (full  + half) / 2)  setSheetState('full');
        else if (curY < (half  + peek) / 2)  setSheetState('half');
        else                                   setSheetState('peek');
    });

    window.addEventListener('resize', () => {
        if (isMobile()) setSheetState(sheet._state || 'half');
        else setSheetState('desktop');
    });
    if (isMobile()) setSheetState('half');
}

// ── Event Listeners ───────────────────────────────────────────────────────────
function setupEventListeners() {
    document.getElementById('backToListBtn').onclick = backToList;

    // Search
    document.getElementById('searchInput').addEventListener('input', e => {
        const q = e.target.value.toLowerCase().trim();
        let list = getFilteredDoctors();
        if (q) list = list.filter(d =>
            (d.name || '').toLowerCase().includes(q) ||
            (d.hospitals_practice || '').toLowerCase().includes(q) ||
            (d.clinic_name || '').toLowerCase().includes(q) ||
            (d.specialization || '').toLowerCase().includes(q) ||
            (d.phone || '').includes(q)
        );
        renderDoctors(list);
    });

    // Spec filters
    document.querySelectorAll('.spec-filter').forEach(btn => {
        btn.onclick = () => setSpecFilter(btn.dataset.spec);
    });

    // Near Me FAB
    document.getElementById('nearMeBtn').onclick = findNearMe;

    // Edit Modal
    document.getElementById('closeModalBtn').onclick  = closeEditModal;
    document.getElementById('cancelEditBtn').onclick  = closeEditModal;
    document.getElementById('saveEditBtn').onclick    = saveEdit;
}

// ── Near Me ───────────────────────────────────────────────────────────────────
function findNearMe() {
    if (!navigator.geolocation) { alert('Geolocation not supported.'); return; }
    const btn = document.getElementById('nearMeBtn');
    btn.innerHTML = '<i class="ph-fill ph-spinner-gap animate-spin text-2xl"></i>';
    navigator.geolocation.getCurrentPosition(pos => {
        const { latitude: uLat, longitude: uLon } = pos.coords;
        const withDist = doctorsData
            .filter(d => d.lat && d.lon)
            .map(d => ({ ...d, _dist: haversine(uLat, uLon, d.lat, d.lon) }))
            .sort((a, b) => a._dist - b._dist)
            .slice(0, 10);

        renderDoctors(withDist);
        L.circleMarker([uLat, uLon], { radius: 8, fillColor: '#3b82f6', color: '#fff', weight: 2, fillOpacity: 0.9 })
         .addTo(map).bindPopup('You are here').openPopup();
        map.setView([uLat, uLon], 13);
        btn.innerHTML = '<i class="ph-fill ph-navigation-arrow text-2xl"></i>';
        document.querySelectorAll('.zone-filter').forEach(b => b.classList.remove('active'));
    }, () => {
        alert('Unable to get location.');
        btn.innerHTML = '<i class="ph-fill ph-navigation-arrow text-2xl"></i>';
    });
}

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371, toR = Math.PI / 180;
    const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*toR)*Math.cos(lat2*toR)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── Edit Modal ────────────────────────────────────────────────────────────────
function openEditModal(id) {
    const doc = doctorsData.find(d => d.id === id);
    if (!doc) return;
    document.getElementById('editDocId').value   = doc.id;
    document.getElementById('editPhone').value   = doc.phone || '';
    document.getElementById('editTiming').value  = doc.consultation_timing || '';
    document.getElementById('editNotes').value   = doc.rep_notes || '';
    const modal = document.getElementById('editModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeEditModal() {
    const modal = document.getElementById('editModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function saveEdit() {
    const id     = document.getElementById('editDocId').value;
    const phone  = document.getElementById('editPhone').value;
    const timing = document.getElementById('editTiming').value;
    const notes  = document.getElementById('editNotes').value;
    const btn    = document.getElementById('saveText');
    btn.textContent = 'Saving…';

    const { error } = await db.from('doctors')
        .update({ phone, consultation_timing: timing, rep_notes: notes })
        .eq('id', id);

    if (error) {
        alert('Save failed: ' + error.message);
        btn.textContent = 'Save Changes';
        return;
    }
    const idx = doctorsData.findIndex(d => d.id == id);
    if (idx !== -1) { doctorsData[idx].phone = phone; doctorsData[idx].consultation_timing = timing; doctorsData[idx].rep_notes = notes; }
    btn.textContent = 'Saved!';
    setTimeout(() => { closeEditModal(); btn.textContent = 'Save Changes'; }, 900);
}

// ── Realtime Sync ─────────────────────────────────────────────────────────────
function setupRealtime() {
    db.channel('schema-db-changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'doctors' }, payload => {
          const idx = doctorsData.findIndex(d => d.id === payload.new.id);
          if (idx !== -1) doctorsData[idx] = payload.new;
      }).subscribe();
}

// ── DB Status Indicator ───────────────────────────────────────────────────────
function setDbStatus(ok) {
    document.getElementById('db-dot').className   = `w-2 h-2 rounded-full ${ok ? 'bg-green-500' : 'bg-red-400'}`;
    document.getElementById('db-label').textContent = ok ? 'Live' : 'Offline';
}

function showError(msg) {
    document.getElementById('doctorList').innerHTML = `<div class="text-red-500 text-center p-6 text-sm">${msg}</div>`;
}
