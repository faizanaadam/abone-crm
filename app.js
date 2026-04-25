// Supabase Configuration
const supabaseUrl = 'https://jrvghcxtrpdmyhgjypms.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpydmdoY3h0cnBkbXloZ2p5cG1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDA4ODIsImV4cCI6MjA5MjY3Njg4Mn0.UVlzfHUnkpWQPt-RAmK9m2cpoX20GQNsEPs9m1w8bto';
const db = window.supabase.createClient(supabaseUrl, supabaseKey);

// State
let map;
let markerCluster;
let doctorsData = [];
let zonesData = [];
let markersMap = new Map(); // id -> leaflet marker
let polygonsMap = new Map(); // zone_id -> leaflet polygon
let activeDoctorId = null;

// Colors
const zoneColors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7'];

document.addEventListener('DOMContentLoaded', async () => {
    initMap();
    await fetchZones();
    await fetchDoctors();
    setupEventListeners();
    setupRealtime();
});

function initMap() {
    map = L.map('map').setView([12.9716, 77.5946], 11); // Center Bangalore
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    markerCluster = L.markerClusterGroup({
        chunkedLoading: true,
        maxClusterRadius: 40,
        spiderfyOnMaxZoom: true
    });
    map.addLayer(markerCluster);
}

async function fetchZones() {
    const { data, error } = await db.from('zones').select('*');
    if (error) {
        console.error('Error fetching zones:', error);
        return;
    }
    zonesData = data;
    renderZoneFilters();
    drawZonePolygons();
}

async function fetchDoctors() {
    const { data, error } = await db.from('doctors').select('*');
    if (error) {
        console.error('Error fetching doctors:', error);
        document.getElementById('doctorList').innerHTML = '<div class="text-red-500 text-center p-4">Failed to load directory.</div>';
        return;
    }
    doctorsData = data;
    renderDoctors(doctorsData);
}

function renderZoneFilters() {
    const container = document.getElementById('zoneFilters');
    // Keep 'All Zones' button, remove others if re-rendering
    const allBtn = container.querySelector('[data-zone="all"]');
    container.innerHTML = '';
    container.appendChild(allBtn);

    zonesData.forEach(zone => {
        const btn = document.createElement('button');
        btn.className = 'zone-filter';
        btn.dataset.zone = zone.id;
        btn.textContent = zone.name;
        btn.onclick = () => filterByZone(zone.id);
        container.appendChild(btn);
    });

    allBtn.onclick = () => filterByZone('all');
}

function drawZonePolygons() {
    zonesData.forEach((zone, index) => {
        if (zone.polygon_coords && zone.polygon_coords.length > 0) {
            const color = zoneColors[index % zoneColors.length];
            const polygon = L.polygon(zone.polygon_coords, {
                color: color,
                fillColor: color,
                fillOpacity: 0.1,
                weight: 2,
                opacity: 0.8
            }).addTo(map);
            
            polygon.bindTooltip(`<b>Zone ${zone.id}:</b> ${zone.name}`, { sticky: true });
            
            // Clicking polygon filters to that zone
            polygon.on('click', () => {
                filterByZone(zone.id);
                map.fitBounds(polygon.getBounds());
            });

            polygonsMap.set(zone.id, polygon);
        }
    });
}

function getSpecClass(specialization) {
    if (!specialization) return 'spec-unknown';
    const spec = specialization.toLowerCase();
    if (spec.includes('spine') && spec.includes('trauma')) return 'spec-spine-trauma';
    if (spec.includes('spine')) return 'spec-spine';
    if (spec.includes('trauma')) return 'spec-trauma';
    if (spec.includes('general') || spec.includes('ortho')) return 'spec-general';
    return 'spec-unknown';
}

function renderDoctors(docs) {
    const list = document.getElementById('doctorList');
    list.innerHTML = '';
    markerCluster.clearLayers();
    markersMap.clear();

    if (docs.length === 0) {
        list.innerHTML = '<div class="text-slate-500 text-center p-8">No doctors found.</div>';
        return;
    }

    docs.forEach(doc => {
        // --- 1. Map Marker ---
        if (doc.lat && doc.lon) {
            const specClass = getSpecClass(doc.specialization);
            const icon = L.divIcon({
                className: `custom-marker ${specClass}`,
                iconSize: [30, 30],
                iconAnchor: [15, 30],
                html: `<div class="marker-pin"></div>`
            });

            const marker = L.marker([doc.lat, doc.lon], { icon });
            marker.bindPopup(`
                <div class="p-2 min-w-[200px]">
                    <h3 class="font-bold text-sm mb-1">${doc.name}</h3>
                    <p class="text-xs text-slate-600 mb-2">${doc.specialization || 'Orthopedic'}</p>
                    <a href="https://www.google.com/maps/dir/?api=1&destination=${doc.lat},${doc.lon}" target="_blank" class="w-full block text-center bg-blue-600 text-white py-1.5 rounded text-xs font-medium hover:bg-blue-700 transition">
                        Navigate Here
                    </a>
                </div>
            `);

            marker.on('click', () => highlightDoctorInList(doc.id));
            markerCluster.addLayer(marker);
            markersMap.set(doc.id, marker);
        }

        // --- 2. Sidebar Card ---
        const card = document.createElement('div');
        card.id = `doc-card-${doc.id}`;
        card.className = 'doctor-card bg-white border border-slate-200 rounded-xl p-4 cursor-pointer relative overflow-hidden group';
        
        card.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <div>
                    <h3 class="font-bold text-slate-800 text-sm">${doc.name}</h3>
                    <p class="text-xs font-medium text-slate-500">${doc.specialization || 'General Ortho'}</p>
                </div>
                ${doc.koa_no ? `<span class="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-1 rounded border border-slate-200">${doc.koa_no}</span>` : ''}
            </div>
            
            <div class="space-y-1.5 mt-3">
                <div class="flex items-start gap-2 text-xs text-slate-600">
                    <i class="ph-fill ph-hospital mt-0.5 text-slate-400"></i>
                    <span class="line-clamp-2">${doc.hospitals_practice || doc.clinic_name || 'N/A'}</span>
                </div>
                ${doc.phone ? `
                <div class="flex items-center gap-2 text-xs text-slate-600">
                    <i class="ph-fill ph-phone text-slate-400"></i>
                    <a href="tel:${doc.phone}" class="text-blue-600 hover:underline" onclick="event.stopPropagation()">${doc.phone}</a>
                </div>` : ''}
                ${doc.rep_notes ? `
                <div class="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 p-2 rounded border border-amber-100 mt-2">
                    <i class="ph-fill ph-notebook mt-0.5"></i>
                    <span class="italic">"${doc.rep_notes}"</span>
                </div>` : ''}
            </div>

            <div class="mt-4 pt-3 border-t border-slate-100 flex gap-2">
                <button class="flex-1 bg-slate-100 text-slate-700 text-xs py-1.5 rounded font-medium hover:bg-slate-200 transition flex items-center justify-center gap-1" onclick="event.stopPropagation(); locateDoctor(${doc.id})">
                    <i class="ph ph-map-pin"></i> Show on Map
                </button>
                <button class="flex-1 bg-blue-50 text-blue-700 text-xs py-1.5 rounded font-medium hover:bg-blue-100 transition flex items-center justify-center gap-1" onclick="event.stopPropagation(); openEditModal(${doc.id})">
                    <i class="ph ph-pencil-simple"></i> Edit Notes
                </button>
            </div>
        `;

        card.onclick = () => locateDoctor(doc.id);
        list.appendChild(card);
    });

    map.addLayer(markerCluster);
}

function filterByZone(zoneId) {
    // Update active button
    document.querySelectorAll('.zone-filter').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.zone == zoneId);
    });

    let filtered = doctorsData;
    if (zoneId !== 'all') {
        filtered = doctorsData.filter(d => d.zone_id == zoneId);
        
        // Highlight Polygon
        polygonsMap.forEach((poly, id) => {
            poly.setStyle({ fillOpacity: id == zoneId ? 0.3 : 0.05 });
        });
    } else {
        polygonsMap.forEach(poly => poly.setStyle({ fillOpacity: 0.1 }));
        map.setView([12.9716, 77.5946], 11);
    }

    renderDoctors(filtered);
}

function locateDoctor(id) {
    highlightDoctorInList(id);
    const marker = markersMap.get(id);
    if (marker) {
        // Remove blink from previous
        if (activeDoctorId && markersMap.has(activeDoctorId)) {
            const prevMarker = markersMap.get(activeDoctorId);
            L.DomUtil.removeClass(prevMarker.getElement(), 'marker-blinking');
        }

        activeDoctorId = id;

        markerCluster.zoomToShowLayer(marker, () => {
            marker.openPopup();
            // Add CSS blink animation
            if (marker.getElement()) {
                L.DomUtil.addClass(marker.getElement(), 'marker-blinking');
            }
        });
    } else {
        alert("This doctor does not have a mapped location yet.");
    }
}

function highlightDoctorInList(id) {
    document.querySelectorAll('.doctor-card').forEach(c => c.classList.remove('active'));
    const card = document.getElementById(`doc-card-${id}`);
    if (card) {
        card.classList.add('active');
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// --- Edit Modal Logic ---
const modal = document.getElementById('editModal');
const modalContent = document.getElementById('editModalContent');

function openEditModal(id) {
    const doc = doctorsData.find(d => d.id === id);
    if (!doc) return;

    document.getElementById('editDocId').value = doc.id;
    document.getElementById('editPhone').value = doc.phone || '';
    document.getElementById('editTiming').value = doc.consultation_timing || '';
    document.getElementById('editNotes').value = doc.rep_notes || '';

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        modal.classList.add('modal-enter');
        modalContent.classList.add('modal-content-enter');
    }, 10);
}

function closeEditModal() {
    modal.classList.remove('modal-enter');
    modalContent.classList.remove('modal-content-enter');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 200);
}

async function saveEdit() {
    const id = document.getElementById('editDocId').value;
    const phone = document.getElementById('editPhone').value;
    const timing = document.getElementById('editTiming').value;
    const notes = document.getElementById('editNotes').value;
    const btnText = document.getElementById('saveText');

    btnText.textContent = 'Saving...';
    
    const { error } = await db
        .from('doctors')
        .update({ phone: phone, consultation_timing: timing, rep_notes: notes })
        .eq('id', id);

    if (error) {
        alert('Error saving: ' + error.message);
        btnText.textContent = 'Save Changes';
    } else {
        // Update local data
        const idx = doctorsData.findIndex(d => d.id == id);
        if (idx !== -1) {
            doctorsData[idx].phone = phone;
            doctorsData[idx].consultation_timing = timing;
            doctorsData[idx].rep_notes = notes;
        }
        
        btnText.textContent = 'Saved!';
        setTimeout(() => {
            closeEditModal();
            btnText.textContent = 'Save Changes';
            // Re-render currently visible docs
            const activeZone = document.querySelector('.zone-filter.active').dataset.zone;
            filterByZone(activeZone);
        }, 1000);
    }
}

function setupEventListeners() {
    document.getElementById('closeModalBtn').onclick = closeEditModal;
    document.getElementById('cancelEditBtn').onclick = closeEditModal;
    document.getElementById('saveEditBtn').onclick = saveEdit;
    
    document.getElementById('searchInput').addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const activeZone = document.querySelector('.zone-filter.active').dataset.zone;
        
        let filtered = doctorsData;
        if (activeZone !== 'all') {
            filtered = filtered.filter(d => d.zone_id == activeZone);
        }
        
        if (query) {
            filtered = filtered.filter(d => 
                (d.name && d.name.toLowerCase().includes(query)) ||
                (d.hospitals_practice && d.hospitals_practice.toLowerCase().includes(query)) ||
                (d.specialization && d.specialization.toLowerCase().includes(query)) ||
                (d.phone && d.phone.includes(query))
            );
        }
        renderDoctors(filtered);
    });

    document.getElementById('nearMeBtn').onclick = findNearMe;
}

// --- Near Me (Haversine) ---
function findNearMe() {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
    }

    const btn = document.getElementById('nearMeBtn');
    btn.innerHTML = '<i class="ph-fill ph-spinner-gap animate-spin text-2xl"></i>';

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const userLat = position.coords.latitude;
            const userLon = position.coords.longitude;

            // Sort doctors by distance
            const withDist = doctorsData.filter(d => d.lat && d.lon).map(doc => {
                const dist = haversineDistance(userLat, userLon, doc.lat, doc.lon);
                return { ...doc, distance: dist };
            });

            withDist.sort((a, b) => a.distance - b.distance);
            const nearest10 = withDist.slice(0, 10);

            // Add distance to names temporarily for display
            nearest10.forEach(d => {
                d.specialization = `${(d.distance).toFixed(1)} km away • ${d.specialization}`;
            });

            renderDoctors(nearest10);
            
            // Plot user location
            L.circleMarker([userLat, userLon], {
                radius: 8,
                fillColor: "#3b82f6",
                color: "#fff",
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            }).addTo(map).bindPopup("You are here").openPopup();

            map.setView([userLat, userLon], 13);
            
            btn.innerHTML = '<i class="ph-fill ph-navigation-arrow text-2xl"></i>';
            document.querySelectorAll('.zone-filter').forEach(b => b.classList.remove('active'));
        },
        (error) => {
            alert("Unable to retrieve your location.");
            btn.innerHTML = '<i class="ph-fill ph-navigation-arrow text-2xl"></i>';
        }
    );
}

function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// --- Realtime Sync ---
function setupRealtime() {
    db
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'doctors' },
        (payload) => {
            const updatedDoc = payload.new;
            const idx = doctorsData.findIndex(d => d.id === updatedDoc.id);
            if (idx !== -1) {
                // Update local memory silently
                doctorsData[idx] = updatedDoc;
                
                // If the card is currently rendered, update it visually
                const card = document.getElementById(`doc-card-${updatedDoc.id}`);
                if (card) {
                    const activeZone = document.querySelector('.zone-filter.active')?.dataset.zone || 'all';
                    // Re-render to reflect changes if it's not obtrusive, or just update the DOM node
                    // For simplicity, we just trigger a search input event to re-render current view
                    document.getElementById('searchInput').dispatchEvent(new Event('input'));
                }
            }
        }
      )
      .subscribe();
}
