// ── Supabase ──────────────────────────────────────────────────────────────────
const supabaseUrl = 'https://jrvghcxtrpdmyhgjypms.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpydmdoY3h0cnBkbXloZ2p5cG1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDA4ODIsImV4cCI6MjA5MjY3Njg4Mn0.UVlzfHUnkpWQPt-RAmK9m2cpoX20GQNsEPs9m1w8bto';
const db = window.supabase.createClient(supabaseUrl, supabaseKey);

// ── State ─────────────────────────────────────────────────────────────────────
let map, markerCluster;
let doctorsData = [];
let zonesData = [];
let markersMap = new Map();   // id → leaflet marker
let polygonsMap = new Map();   // zone_id → leaflet polygon
let activeDoctorId = null;
let activeZone = 'all';
let activeSpec = 'all';
let currentUserProfile = null;
let pendingEditsData = [];
let currentEditId = null;
let focusModeActive = false;

const ZONE_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
    '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7'];

// ── Boot & Auth ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    setupLoginListeners();
    await checkSession();
});

async function checkSession() {
    const { data: { session }, error } = await db.auth.getSession();
    if (session) {
        showApp();
    } else {
        showLogin();
    }
}

function showLogin() {
    document.getElementById('login-container').classList.remove('hidden', 'opacity-0', 'pointer-events-none');
    document.getElementById('login-container').classList.add('flex');
    document.getElementById('app-container').classList.add('hidden');
}

async function showApp() {
    // Fade out login UI
    const loginContainer = document.getElementById('login-container');
    loginContainer.classList.add('opacity-0', 'pointer-events-none');
    setTimeout(() => {
        loginContainer.classList.add('hidden');
        loginContainer.classList.remove('flex');
    }, 300); // Wait for transition

    document.getElementById('app-container').classList.remove('hidden');

    initMap();
    setupBottomSheet();
    setupEventListeners();

    // Fetch user profile
    const { data: { user } } = await db.auth.getUser();
    if (!user) {
        showLogin();
        return;
    }

    const { data: profile, error } = await db.from('profiles').select('id, role, assigned_zone_id').eq('id', user.id).single();
    if (error || !profile) {
        console.error("Profile error:", error);
        showError('Failed to load user profile. Please contact Admin.');
        return;
    }

    currentUserProfile = profile;
    
    if (profile.role === 'admin') {
        document.getElementById('adminToolbar').classList.remove('hidden');
        fetchPendingEdits();
    }

    // Show 'Add Doctor' FAB for reps
    if (profile.role === 'rep') {
        document.getElementById('addDoctorFab').classList.remove('hidden');
    }

    // Zone Isolation: Fetch and draw zones first, independently.
    try {
        await fetchZones();
    } catch (e) {
        console.error("Error fetching zones:", e);
    }

    try {
        await fetchDoctors();
    } catch (e) {
        console.error("Error fetching doctors:", e);
        showError('Failed to load directory.');
    }

    try {
        setupRealtime();
    } catch (e) {
        console.warn("Realtime setup failed (expected on file:// origins):", e);
    }

    setDbStatus(true);
}

function setupLoginListeners() {
    const loginForm = document.getElementById('loginForm');
    if (!loginForm) return;

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('emailInput').value;
        const password = document.getElementById('passwordInput').value;
        const btnText = document.getElementById('loginBtnText');
        const btnIcon = document.getElementById('loginBtnIcon');
        const errorDiv = document.getElementById('loginError');
        const errorText = document.getElementById('loginErrorText');

        // Reset state
        errorDiv.classList.add('hidden');
        errorDiv.classList.remove('flex');
        btnText.textContent = 'Signing in...';
        btnIcon.className = 'ph-bold ph-spinner-gap animate-spin';

        const { data, error } = await db.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (error) {
            errorText.textContent = error.message;
            errorDiv.classList.remove('hidden');
            errorDiv.classList.add('flex');
            btnText.textContent = 'Sign In';
            btnIcon.className = 'ph-bold ph-arrow-right';
        } else {
            // Success
            showApp();
        }
    });

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await db.auth.signOut();
            window.location.reload();
        });
    }
}

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
    // Paginate to get ALL records (Supabase default limit is 1000)
    let allData = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
        try {
            const { data, error } = await db.from('doctors').select('*, locations(*), activity_logs(*)').eq('is_active', true).range(from, from + pageSize - 1);
            if (error) {
                console.error("Supabase fetch error:", error);
                showError('Failed to load directory. See console for details.');
                return;
            }


            if (!data || data.length === 0) break;
            allData = allData.concat(data);
            if (data.length < pageSize) break;  // last page
            from += pageSize;
        } catch (err) {
            console.error("Network/JS error in fetchDoctors:", err);
            showError('Network error while loading directory.');
            return;
        }
    }

    // Deduplicate doctors by name to fix flat excel inserts
    const mapObj = new Map();
    allData.forEach(d => {
        if (!d || !d.name) return;
        const key = d.name.trim().toLowerCase();
        if (!mapObj.has(key)) {
            d.locations = (d.locations || []).filter(l => l.is_active !== false);
            d.activity_logs = d.activity_logs || [];
            mapObj.set(key, d);
        } else {
            const existing = mapObj.get(key);
            if (d.locations && d.locations.length > 0) {
                const activeLocs = d.locations.filter(l => l.is_active !== false);
                existing.locations.push(...activeLocs);
            }
            if (d.activity_logs && d.activity_logs.length > 0) {
                existing.activity_logs = existing.activity_logs || [];
                existing.activity_logs.push(...d.activity_logs);
            }
        }
    });
    const uniqueData = Array.from(mapObj.values());

    // Filter out "Exclude" specialization entirely
    doctorsData = uniqueData.filter(d => (d.specialization || '').trim().toLowerCase() !== 'exclude');
    renderDoctors(getFilteredDoctors());
}

// ── Filtering helpers ─────────────────────────────────────────────────────────
function getFilteredDoctors() {
    let list = doctorsData;
    if (activeZone !== 'all') list = list.filter(d => d.locations && d.locations.some(l => l.zone_id == activeZone));
    if (activeSpec !== 'all') list = list.filter(d => (d.spec_category || 'General') === activeSpec);
    return list;
}

function toggleFocusMode() {
    focusModeActive = document.getElementById('focusModeToggle').checked;
    renderDoctors(getFilteredDoctors());
}

function downloadZoneReport() {
    const list = getFilteredDoctors();
    if (list.length === 0) {
        alert("No records to export.");
        return;
    }

    const headers = [
        "Doctor ID", "Name", "Specialization", "Abone Usage %", "Rep Notes",
        "Locations (Names)", "Total Logs", "Last Visit Date"
    ];

    const rows = list.map(doc => {
        let locNames = "";
        if (doc.locations && doc.locations.length > 0) {
            locNames = doc.locations.map(l => l.hospital_name || '').join("; ");
        }

        let totalLogs = 0;
        let lastVisit = "";
        if (doc.activity_logs && doc.activity_logs.length > 0) {
            totalLogs = doc.activity_logs.length;
            const sortedLogs = [...doc.activity_logs].sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date));
            lastVisit = sortedLogs[0].visit_date.split('T')[0];
        }

        return [
            doc.id,
            `"${(doc.name || '').replace(/"/g, '""')}"`,
            `"${(doc.specialization || '').replace(/"/g, '""')}"`,
            doc.abone_usage_percentage || '',
            `"${(doc.rep_notes || '').replace(/"/g, '""')}"`,
            `"${locNames.replace(/"/g, '""')}"`,
            totalLogs,
            lastVisit
        ].join(",");
    });

    const csvContent = "data:text/csv;charset=utf-8," + encodeURIComponent([headers.join(","), ...rows].join("\n"));
    const link = document.createElement("a");
    const dateStr = new Date().toISOString().split('T')[0];
    
    link.setAttribute("href", csvContent);
    link.setAttribute("download", `Abone_Sales_Report_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
    if (cat === 'spine') return 'spec-spine';
    if (cat === 'trauma') return 'spec-trauma';
    if (cat === 'both') return 'spec-both';
    return 'spec-general';
}

// ── Navigation URL (3-tier priority) ─────────────────────────────────────────
function getNavUrl(doc) {
    const primaryLoc = doc.locations && doc.locations.find(l => l.is_primary) || (doc.locations && doc.locations[0]);
    if (!primaryLoc) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(doc.name)}+Bangalore`;

    // Priority 1: explicit Google Maps link
    if (primaryLoc.map_link && primaryLoc.map_link.startsWith('http')) {
        return primaryLoc.map_link;
    }
    // Priority 2: precise coordinates (Blue Pin)
    if (!doc.is_approximate && primaryLoc.lat && primaryLoc.lon) {
        return `https://www.google.com/maps/search/?api=1&query=${primaryLoc.lat},${primaryLoc.lon}`;
    }
    // Priority 3: approximate (Grey Circle) — search by name + area
    const clinicPart = encodeURIComponent((primaryLoc.hospital_name || doc.name || '').trim());
    return `https://www.google.com/maps/search/?api=1&query=${clinicPart}+Bangalore`;
}

// ── Render Doctors ────────────────────────────────────────────────────────────
function renderDoctors(docs) {
    const list = document.getElementById('doctorList');
    list.innerHTML = '';
    markerCluster.clearLayers();
    markersMap.clear();

    document.getElementById('doctorCount').textContent = `${docs.length} doctors`;

    if (!docs.length) {
        if (currentUserProfile && currentUserProfile.role === 'rep' && !currentUserProfile.assigned_zone_id) {
            list.innerHTML = `
                <div class="flex flex-col items-center justify-center py-12 px-6 text-center mt-10">
                    <div class="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4">
                        <i class="ph-fill ph-warning-circle text-red-500 text-3xl"></i>
                    </div>
                    <h3 class="text-lg font-bold text-slate-800 mb-1">No Territory Assigned</h3>
                    <p class="text-sm text-slate-500 leading-relaxed">Your account has not been assigned a zone. Please contact your administrator to get access to your territory.</p>
                </div>
            `;
        } else {
            list.innerHTML = '<div class="text-slate-400 text-center py-10 text-sm">No doctors found.</div>';
        }
        return;
    }

    const frag = document.createDocumentFragment();

    // If "All Zones" is active, we group the list by zone for better organization
    if (activeZone === 'all' && activeSpec === 'all' && !document.getElementById('searchInput').value) {
        const grouped = {};
        docs.forEach(doc => {
            const primaryLoc = doc.locations && (doc.locations.find(l => l.is_primary) || doc.locations[0]);
            const zId = primaryLoc ? primaryLoc.zone_id : 'unknown';
            if (!grouped[zId]) grouped[zId] = [];
            grouped[zId].push(doc);
        });

        Object.keys(grouped).sort((a, b) => (parseInt(a) || 99) - (parseInt(b) || 99)).forEach(zId => {
            const zone = zonesData.find(z => z.id == zId);
            const zoneName = zone ? zone.name : 'Unassigned / Other';

            const header = document.createElement('div');
            header.className = 'px-5 py-3 bg-slate-50 border-y border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-widest sticky top-0 z-10';
            header.textContent = zoneName;
            frag.appendChild(header);

            grouped[zId].forEach(doc => {
                frag.appendChild(createDoctorCard(doc));
                addMarker(doc);
            });
        });
    } else {
        docs.forEach(doc => {
            frag.appendChild(createDoctorCard(doc));
            addMarker(doc);
        });
    }

    list.appendChild(frag);

    // Step 4: Map Bounds Handling - Automatically center and zoom to the loaded pins
    if (markerCluster.getLayers().length > 0) {
        // Use a small delay to ensure layers are fully added to the map visually
        setTimeout(() => {
            map.fitBounds(markerCluster.getBounds(), { 
                padding: [40, 40], 
                maxZoom: 15,
                animate: true,
                duration: 1
            });
        }, 100);
    }
}

function addMarker(doc) {
    let lat = null;
    let lon = null;
    let primaryLoc = null;
    let isApproximate = false;

    if (doc.locations && doc.locations.length > 0) {
        primaryLoc = doc.locations.find(l => l.is_primary) || doc.locations[0];
        if (primaryLoc) {
            lat = parseFloat(primaryLoc.lat);
            lon = parseFloat(primaryLoc.lon);
        }
    }

    if (isNaN(lat)) lat = null;
    if (isNaN(lon)) lon = null;

    // Validate coordinates are within Bangalore bounds
    if (lat !== null && lon !== null) {
        if (lat < 12.7 || lat > 13.25 || lon < 77.3 || lon > 77.85) {
            lat = null;
            lon = null;
        }
    }

    // ── FALLBACK: Use zone center if no valid coordinates ──
    if (lat === null || lon === null) {
        const zoneId = primaryLoc ? primaryLoc.zone_id : null;
        if (zoneId) {
            const zone = zonesData.find(z => z.id == zoneId);
            if (zone) {
                let cLat = null, cLng = null;

                // Priority 1: Use DB-stored center if available
                if (zone.center_lat && zone.center_lng) {
                    cLat = parseFloat(zone.center_lat);
                    cLng = parseFloat(zone.center_lng);
                }
                // Priority 2: Compute centroid from polygon_coords
                else if (zone.polygon_coords && zone.polygon_coords.length > 0) {
                    let sumLat = 0, sumLng = 0;
                    zone.polygon_coords.forEach(coord => {
                        sumLat += coord[0];
                        sumLng += coord[1];
                    });
                    cLat = sumLat / zone.polygon_coords.length;
                    cLng = sumLng / zone.polygon_coords.length;
                }

                if (cLat && cLng) {
                    lat = cLat;
                    lon = cLng;
                    isApproximate = true;

                    // Step 4: Jitter — offset by ±0.001 to prevent pin stacking
                    lat += (Math.random() - 0.5) * 0.002;
                    lon += (Math.random() - 0.5) * 0.002;
                }
            }
        }
    }

    // Tag the doc object so detail view & navigate can check it
    doc._isApproximate = isApproximate;

    if (lat !== null && lon !== null) {
        const specClass = isApproximate ? 'spec-approximate' : getSpecClass(doc);
        
        let extraClass = '';
        if (focusModeActive) {
            let lastVisit = null;
            if (doc.activity_logs && doc.activity_logs.length > 0) {
                const sortedLogs = [...doc.activity_logs].sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date));
                lastVisit = new Date(sortedLogs[0].visit_date);
            }
            
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            
            if (!lastVisit || lastVisit < thirtyDaysAgo) {
                extraClass = 'focus-red marker-blinking';
            } else {
                extraClass = 'focus-faded';
            }
        }

        const icon = L.divIcon({
            className: `custom-marker ${specClass} ${extraClass}`,
            iconSize: isApproximate ? [20, 20] : [30, 42],
            iconAnchor: isApproximate ? [10, 10] : [15, 42],
            html: `<div class="marker-pin"></div>`
        });
        const marker = L.marker([lat, lon], { icon });
        const tooltipText = isApproximate 
            ? `<b>${doc.name}</b><br><span style="color:#ea580c;font-size:10px;">⚠ Approximate Location</span><br><span style="font-size:9px;color:#64748b;">Double-tap → Google Maps</span>`
            : `<b>${doc.name}</b><br><span style="font-size:9px;color:#64748b;">Double-tap → Google Maps</span>`;
        marker.bindTooltip(tooltipText);
        marker.on('click', () => showDetail(doc.id));
        marker.on('dblclick', () => {
            const navUrl = getNavUrl(doc);
            window.open(navUrl, '_blank');
        });
        markerCluster.addLayer(marker);
        markersMap.set(doc.id, marker);
    }
}

function createDoctorCard(doc) {
    const primaryLoc = doc.locations && (doc.locations.find(l => l.is_primary) || doc.locations[0]);
    const zone = zonesData.find(z => z.id == (primaryLoc ? primaryLoc.zone_id : null));
    const zoneBadge = zone ? `<span class="ml-auto text-[9px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase tracking-tighter">${zone.name.split(' / ')[0]}</span>` : '';

    const card = document.createElement('div');
    card.className = 'doctor-card p-4 border-b border-slate-50 cursor-pointer hover:bg-slate-50 transition-colors';
    card.dataset.id = doc.id;
    card.innerHTML = `
        <div class="flex justify-between items-start mb-1">
            <h3 class="text-sm font-bold text-slate-800">${doc.name}</h3>
            ${zoneBadge}
        </div>
        <div class="flex items-center gap-1.5 text-xs text-slate-500">
            <i class="ph ph-stethoscope"></i>
            <span>${doc.specialization || 'Orthopedic Surgeon'}</span>
        </div>
        ${primaryLoc ? `
        <div class="mt-2 flex items-center gap-1.5 text-[11px] text-slate-600 font-medium">
            <i class="ph ph-hospital text-blue-500"></i>
            <span class="truncate">${primaryLoc.hospital_name}</span>
        </div>` : ''}
        
        ${(() => {
            const myLogs = (doc.activity_logs || []).filter(l => currentUserProfile && l.rep_id === currentUserProfile.id).sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date));
            if (myLogs.length > 0) {
                return `<div class="mt-2 text-[10px] font-bold text-green-600 bg-green-50 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-green-100"><i class="ph-bold ph-check-circle"></i> Visited: ${new Date(myLogs[0].visit_date).toLocaleDateString()}</div>`;
            }
            return '';
        })()}
        
        <div class="mt-3 flex gap-2">
            ${doc.phone ? `
            <a href="tel:${doc.phone}" onclick="event.stopPropagation()"
               class="flex-1 bg-green-50 text-green-700 text-xs py-2 rounded-xl font-semibold flex items-center justify-center gap-1 active:scale-95 transition-transform">
                <i class="ph ph-phone"></i> Call
            </a>
            <button onclick="event.stopPropagation(); showDetail('${doc.id}')"
               class="flex-1 bg-slate-100 text-slate-700 text-xs py-2 rounded-xl font-semibold flex items-center justify-center gap-1 active:scale-95 transition-transform">
                <i class="ph ph-info"></i> Details
            </button>` : `
            <button onclick="event.stopPropagation(); showDetail('${doc.id}')"
               class="w-full bg-slate-100 text-slate-700 text-xs py-2 rounded-xl font-semibold flex items-center justify-center gap-1 active:scale-95 transition-transform">
                <i class="ph ph-info"></i> View Details
            </button>`}
        </div>
    `;
    card.onclick = () => showDetail(doc.id);
    return card;
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

    const isApprox = doc.is_approximate || doc._isApproximate;
    const approxWarning = isApprox ? `
        <div class="flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-xl p-3 mb-4">
            <span class="text-lg">📍</span>
            <p class="text-xs text-orange-700 font-medium">Approximate Location — Check Address Details. Navigation will search by name instead of coordinates.</p>
        </div>` : '';

    const navUrl = getNavUrl(doc);

    document.getElementById('detailContent').innerHTML = `
        <div class="p-5 pb-2">
            ${approxWarning}
            <h2 class="text-xl font-bold text-slate-800 leading-tight">${doc.name}</h2>
            <p class="text-sm text-slate-500 mt-1">${doc.specialization || 'General Ortho'}</p>
            
            ${(() => {
                const myLogs = (doc.activity_logs || []).filter(l => currentUserProfile && l.rep_id === currentUserProfile.id).sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date));
                if (myLogs.length > 0) {
                    const lastVisit = new Date(myLogs[0].visit_date).toLocaleDateString();
                    return `
                        <div class="flex items-center gap-2 mt-2 mb-3">
                            <div class="bg-emerald-50 text-emerald-700 text-[11px] font-bold px-2 py-1 rounded-md flex items-center gap-1 border border-emerald-100 shadow-sm">
                                <i class="ph-bold ph-check-circle text-emerald-500 text-sm"></i> Visited: ${lastVisit}
                            </div>
                            <button onclick="unmarkVisited('${doc.id}')" class="text-[10px] text-red-500 hover:text-red-700 underline font-semibold transition-colors ml-1"><i class="ph-bold ph-x"></i> Remove</button>
                        </div>
                    `;
                } else {
                    return `
                        <div class="mt-2 mb-3">
                            <button onclick="quickMarkVisited('${doc.id}')" class="flex items-center gap-1.5 text-xs font-bold text-slate-500 bg-slate-50 hover:bg-slate-100 hover:text-slate-800 px-3 py-1.5 rounded-lg transition-all border border-slate-200 active:scale-95 shadow-sm">
                                <div class="w-3.5 h-3.5 rounded border-2 border-slate-400 bg-white flex items-center justify-center pointer-events-none transition-colors"></div>
                                Mark as Visited
                            </button>
                        </div>
                    `;
                }
            })()}
            
            ${(doc.abone_usage_percentage !== null && doc.abone_usage_percentage !== undefined && doc.abone_usage_percentage !== '') ? `
            <div class="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg p-2.5 mb-4">
                <i class="ph-fill ph-chart-pie-slice text-blue-500 text-lg"></i>
                <span class="text-xs font-bold text-blue-800">Abone Usage: <span class="text-sm">${doc.abone_usage_percentage}%</span></span>
            </div>` : ''}

            ${doc.rep_notes ? `
            <div class="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-4">
                <div class="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                    <i class="ph-fill ph-notebook text-sm"></i> Rep Notes
                </div>
                <p class="text-sm text-amber-900 italic leading-relaxed">${doc.rep_notes}</p>
            </div>` : ''}


            <div class="space-y-3">
                ${(doc.locations && doc.locations.length > 0) ? doc.locations.map((loc, idx) => {
        const clinicPart = encodeURIComponent((loc.hospital_name || doc.name || '').trim());
        const locNavUrl = (loc.map_link && loc.map_link.startsWith('http'))
            ? loc.map_link
            : (loc.lat && loc.lon && !doc.is_approximate && !doc._isApproximate)
                ? `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lon}`
                : `https://www.google.com/maps/search/?api=1&query=${clinicPart}+Bangalore`;

        const zone = zonesData.find(z => z.id == loc.zone_id);
        const zoneName = zone ? zone.name : null;

        // Build location stars HTML
        const locRating = parseFloat(loc.hospital_rating) || 0;
        let locStarsHtml = '';
        if (locRating > 0) {
            for (let i = 1; i <= 5; i++) {
                if (i <= locRating) locStarsHtml += '<i class="ph-fill ph-star text-yellow-400 text-[10px]"></i>';
                else if (i - 0.5 <= locRating) locStarsHtml += '<i class="ph-fill ph-star-half text-yellow-400 text-[10px]"></i>';
                else locStarsHtml += '<i class="ph ph-star text-slate-300 text-[10px]"></i>';
            }
        }

        return `
                    <div class="bg-slate-50 rounded-xl p-3.5 border border-slate-100 ${idx > 0 ? 'mt-3' : ''}">
                        <div class="flex justify-between items-start mb-1.5">
                            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                                ${loc.is_primary ? '⭐ Primary Clinic / Hospital' : 'Clinic / Hospital'}
                            </div>
                            <div class="flex gap-1">
                                ${zoneName ? `<span class="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">${zoneName}</span>` : ''}
                                ${loc.category ? `<span class="text-[10px] font-bold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">${loc.category}</span>` : ''}
                            </div>
                        </div>
                        <div class="text-sm font-medium text-slate-700 leading-relaxed">${loc.hospital_name || '—'}</div>
                        ${locStarsHtml ? `<div class="mt-0.5 flex items-center">${locStarsHtml} <span class="text-[10px] text-slate-500 ml-1">${locRating}</span></div>` : ''}
                        
                        <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-2 mb-1">Consultation Timing</div>
                        <div class="text-sm text-slate-700 leading-relaxed">${loc.consultation_timing || 'Not available'}</div>
                        
                        <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-2 mb-1.5">Address</div>
                        <div class="text-sm text-slate-700 leading-relaxed">${loc.hospital_address || 'Not available'}</div>
                        
                        <a href="${locNavUrl}" target="_blank"
                           class="mt-2 inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline">
                            <i class="ph ph-navigation-arrow"></i> Open in Google Maps
                        </a>
                    </div>
                    `;
    }).join('') : '<div class="text-sm text-slate-500 p-3">No locations listed.</div>'}

                ${(() => {
                    const nearest = getNearestDoctors(doc, 3);
                    if (nearest.length > 0) {
                        return `
                            <div class="mt-6 mb-2 border-t border-slate-100 pt-5">
                                <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                    <i class="ph-bold ph-map-pin text-sm"></i> Nearest Doctors
                                </div>
                                <div class="space-y-2">
                                    ${nearest.map(n => `
                                        <div onclick="showDetail('${n.doc.id}')" class="flex justify-between items-center bg-white border border-slate-200 rounded-xl p-3 cursor-pointer hover:border-[var(--primary-blue)] hover:shadow-md transition-all active:scale-[0.98]">
                                            <div class="overflow-hidden pr-2">
                                                <h4 class="text-sm font-bold text-slate-700 leading-tight mb-0.5 truncate">${n.doc.name}</h4>
                                                <div class="text-[10px] text-slate-500 font-medium truncate"><i class="ph-fill ph-stethoscope"></i> ${n.doc.specialization || 'General'}</div>
                                            </div>
                                            <div class="text-[10px] font-black text-blue-700 bg-blue-50 px-2.5 py-1.5 rounded-lg shrink-0 text-center border border-blue-100 shadow-sm min-w-[50px]">
                                                ${n.distance < 1 ? Math.round(n.distance * 1000) + ' m' : n.distance.toFixed(1) + ' km'}
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        `;
                    }
                    return '';
                })()}

                ${doc.phone ? `
                <a href="tel:${doc.phone}"
                   class="flex items-center justify-center gap-2 w-full bg-green-600 text-white py-4 rounded-2xl font-bold text-base shadow-md active:scale-95 transition-transform mt-4">
                    <i class="ph-fill ph-phone text-xl"></i> Call Doctor
                </a>` : `
                <button disabled class="w-full bg-slate-200 text-slate-400 py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 cursor-not-allowed mt-4">
                    <i class="ph-fill ph-phone-slash text-xl"></i> No Phone Listed
                </button>`}

                ${(currentUserProfile && currentUserProfile.role === 'rep') ? `
                <div class="flex gap-2 mt-3">
                    <button onclick="openLogVisitModal('${doc.id}')"
                       class="flex-[2] bg-[var(--primary-blue)] text-white py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform shadow-[0_4px_6px_rgba(0,0,0,0.1)]">
                        <i class="ph-bold ph-calendar-check text-lg"></i> Log Visit
                    </button>
                    <button onclick="openSuggestEditModal('${doc.id}')"
                       class="flex-[1] bg-orange-50 text-orange-700 border border-orange-200 py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform">
                        <i class="ph-bold ph-lightbulb"></i> Suggest Edit
                    </button>
                </div>` : `
                <div class="flex gap-2 mt-3">
                    <button onclick="openSuggestEditModal('${doc.id}')"
                       class="flex-[2] bg-blue-50 text-blue-700 border border-blue-200 py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform">
                        <i class="ph-fill ph-pencil-simple"></i> Edit Details
                    </button>
                    <button onclick="archiveDoctor('${doc.id}')"
                       class="flex-[1] bg-red-50 text-red-700 border border-red-200 py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform">
                        <i class="ph-bold ph-archive"></i> Archive
                    </button>
                </div>`}
            </div>
        </div>
    `;

    // Fly map to marker, set permanent tooltip, and blink
    const marker = markersMap.get(id);
    if (marker) {
        if (activeDoctorId && markersMap.has(activeDoctorId)) {
            const prev = markersMap.get(activeDoctorId);
            if (prev.getElement()) L.DomUtil.removeClass(prev.getElement(), 'marker-blinking');
            const prevDoc = doctorsData.find(d => d.id === activeDoctorId);
            if (prevDoc) {
                prev.unbindTooltip();
                prev.bindTooltip(`<b>${prevDoc.name}</b>`);
            }
        }
        activeDoctorId = id;
        map.flyTo(marker.getLatLng(), 16, { animate: true, duration: 1 });
        marker.unbindTooltip();
        marker.bindTooltip(`<span class="font-bold whitespace-nowrap">${doc.name}</span>`, { permanent: true, direction: 'top', offset: [0, -40] }).openTooltip();

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
        const prevDoc = doctorsData.find(d => d.id === activeDoctorId);
        if (prevDoc) {
            m.unbindTooltip();
            m.bindTooltip(`<b>${prevDoc.name}</b>`);
        }
    }
    activeDoctorId = null;
    if (isMobile()) setSheetState('half');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isMobile() { return window.innerWidth < 768; }

// ── Bottom Sheet (3 snap points — mobile only) ────────────────────────────────
let setSheetState;
function setupBottomSheet() {
    const sheet = document.getElementById('bottomSheet');
    const handle = document.getElementById('dragHandle');
    const sheetH = () => sheet.offsetHeight;

    // SNAP POSITIONS (translateY values, sheet height = 92vh)
    // peek = only handle visible (92vh - 56px)
    // half = half screen
    // full = fully open (10% from top)
    const snapY = () => ({
        peek: sheetH() - 56,
        half: window.innerHeight * 0.5,
        full: window.innerHeight * 0.08,
    });

    setSheetState = function (state) {
        if (!isMobile()) {
            // Desktop: sidebar is always visible, no transforms
            sheet.style.transition = 'none';
            sheet.style.transform = 'none';
            return;
        }
        const y = snapY();
        const val = state === 'full' ? y.full : state === 'half' ? y.half : y.peek;
        sheet.style.transition = 'transform 0.32s cubic-bezier(0.25, 0.8, 0.25, 1)';
        sheet.style.transform = `translateY(${val}px)`;
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
        if (curY < (full + half) / 2) setSheetState('full');
        else if (curY < (half + peek) / 2) setSheetState('half');
        else setSheetState('peek');
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
            (d.phone || '').includes(q) ||
            (d.locations && d.locations.some(loc => 
                (loc.hospital_name || '').toLowerCase().includes(q) ||
                (loc.hospital_address || '').toLowerCase().includes(q)
            ))
        );
        renderDoctors(list);
    });

    // Spec filters
    document.querySelectorAll('.spec-filter').forEach(btn => {
        btn.onclick = () => setSpecFilter(btn.dataset.spec);
    });

    // Near Me FAB
    document.getElementById('nearMeBtn').onclick = findNearMe;

    // Suggest/Direct Edit Modal
    const closeSuggestBtn = document.getElementById('closeSuggestModalBtn');
    if (closeSuggestBtn) closeSuggestBtn.onclick = closeSuggestModal;
    const cancelSuggestBtn = document.getElementById('cancelSuggestBtn');
    if (cancelSuggestBtn) cancelSuggestBtn.onclick = closeSuggestModal;
    const submitSuggestBtn = document.getElementById('submitSuggestBtn');
    if (submitSuggestBtn) submitSuggestBtn.onclick = submitSuggestion;

    // Admin Approvals View Toggle
    const toggleApprovalsBtn = document.getElementById('toggleApprovalsBtn');
    if (toggleApprovalsBtn) toggleApprovalsBtn.onclick = () => toggleApprovalsView(true);
    
    const closeApprovalsBtn = document.getElementById('closeApprovalsBtn');
    if (closeApprovalsBtn) closeApprovalsBtn.onclick = () => toggleApprovalsView(false);

    // Admin Diff Modal
    const closeDiffModalBtn = document.getElementById('closeDiffModalBtn');
    if (closeDiffModalBtn) closeDiffModalBtn.onclick = closeDiffModal;
    const approveEditBtn = document.getElementById('approveEditBtn');
    if (approveEditBtn) approveEditBtn.onclick = approveEdit;
    const rejectEditBtn = document.getElementById('rejectEditBtn');
    if (rejectEditBtn) rejectEditBtn.onclick = rejectEdit;
}

function toggleApprovalsView(show) {
    const docList = document.getElementById('doctorList');
    const detail = document.getElementById('detail-card');
    const approvals = document.getElementById('admin-approvals-view');

    if (show) {
        docList.classList.add('hidden');
        detail.classList.add('hidden');
        detail.classList.remove('flex');
        approvals.classList.remove('hidden');
        approvals.classList.add('flex');
        fetchPendingEdits(); // Refresh data when opening
    } else {
        approvals.classList.add('hidden');
        approvals.classList.remove('flex');
        docList.classList.remove('hidden');
    }
}

// ── Near Me ───────────────────────────────────────────────────────────────────
function findNearMe() {
    if (!navigator.geolocation) { alert('Geolocation not supported.'); return; }
    const btn = document.getElementById('nearMeBtn');
    btn.innerHTML = '<i class="ph-fill ph-spinner-gap animate-spin text-2xl"></i>';
    navigator.geolocation.getCurrentPosition(pos => {
        const { latitude: uLat, longitude: uLon } = pos.coords;
        const withDist = doctorsData
            .filter(d => d.locations && d.locations.some(l => l.is_primary && l.lat && l.lon))
            .map(d => {
                const primary = d.locations.find(l => l.is_primary);
                return { ...d, _dist: haversine(uLat, uLon, primary.lat, primary.lon) };
            })
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
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getNearestDoctors(targetDoc, limit = 3) {
    let targetLat = null;
    let targetLon = null;
    
    // Find target's valid coordinates (prioritizing primary)
    let targetLoc = null;
    if (targetDoc.locations && targetDoc.locations.length > 0) {
        targetLoc = targetDoc.locations.find(l => l.is_primary && l.lat && l.lon) || targetDoc.locations.find(l => l.lat && l.lon);
    }
    
    if (targetLoc && !targetDoc.is_approximate && !targetDoc._isApproximate) {
        targetLat = parseFloat(targetLoc.lat);
        targetLon = parseFloat(targetLoc.lon);
    }
    
    if (isNaN(targetLat) || isNaN(targetLon) || targetLat === null) return [];
    
    let distances = [];
    doctorsData.forEach(d => {
        if (d.id === targetDoc.id) return;
        if (d.is_approximate || d._isApproximate) return; // Only use exact locations to prevent clustering at center
        
        let loc = null;
        if (d.locations && d.locations.length > 0) {
            loc = d.locations.find(l => l.is_primary && l.lat && l.lon) || d.locations.find(l => l.lat && l.lon);
        }
        
        if (loc && loc.lat && loc.lon) {
            const lat = parseFloat(loc.lat);
            const lon = parseFloat(loc.lon);
            if (!isNaN(lat) && !isNaN(lon)) {
                const dist = haversine(targetLat, targetLon, lat, lon);
                distances.push({ doc: d, distance: dist });
            }
        }
    });
    
    distances.sort((a, b) => a.distance - b.distance);
    return distances.slice(0, limit);
}

// ── Edit Modal Deprecated ───────────────────────────────────────────────────

async function archiveDoctor(id) {
    if (!confirm('Are you sure you want to archive this lead? It will be removed from the active directory.')) return;

    try {
        const { error } = await db.from('doctors').update({ is_active: false }).eq('id', id);
        if (error) throw error;
        
        // Remove from local state
        doctorsData = doctorsData.filter(d => d.id !== id);
        
        const marker = markersMap.get(id);
        if (marker) {
            markerCluster.removeLayer(marker);
            markersMap.delete(id);
        }
        
        // Refresh UI
        closeDetail();
        renderDoctors(getFilteredDoctors());
    } catch (e) {
        console.error("Error archiving:", e);
        showToast('Failed to archive lead: ' + (e.message || JSON.stringify(e)), 'error');
    }
}


// ── Suggest/Direct Edit Modal ─────────────────────────────────────────────────
function openSuggestEditModal(id) {
    const doc = doctorsData.find(d => d.id === id);
    if (!doc) return;
    document.getElementById('suggestDocId').value = doc.id;
    document.getElementById('suggestAboneUsage').value = (doc.abone_usage_percentage !== null && doc.abone_usage_percentage !== undefined) ? doc.abone_usage_percentage : '';
    document.getElementById('suggestPhone').value = doc.phone || '';
    document.getElementById('suggestEmail').value = doc.email || '';
    document.getElementById('suggestNotes').value = ''; // clear previous notes
    
    const isRep = currentUserProfile && currentUserProfile.role === 'rep';
    const btnText = document.getElementById('submitSuggestText');
    const btnIcon = document.getElementById('submitSuggestIcon');
    if (btnText && btnIcon) {
        btnText.textContent = isRep ? 'Submit for Approval' : 'Save Changes directly';
        btnIcon.className = isRep ? 'ph-bold ph-paper-plane-right' : 'ph-bold ph-floppy-disk';
    }
    
    const container = document.getElementById('suggestLocationsContainer');
    if (container) {
        container.innerHTML = '';
        if (doc.locations && doc.locations.length > 0) {
            doc.locations.forEach((loc, idx) => {
                const block = document.createElement('div');
                block.className = 'bg-slate-50 border border-slate-200 rounded-xl p-3 mb-3';
                const curCat = loc.category || '';
                block.innerHTML = `
                    <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Location ${idx + 1} ${loc.is_primary ? '(Primary)' : ''}</div>
                    <input type="hidden" class="loc-id" value="${loc.id}">
                    <div class="mb-2">
                        <label class="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Hospital/Clinic Name</label>
                        <input type="text" class="loc-name w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:ring-1 focus:ring-orange-500 outline-none text-xs" value="${loc.hospital_name || ''}">
                    </div>
                    <div class="mb-2">
                        <label class="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Address</label>
                        <input type="text" class="loc-address w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:ring-1 focus:ring-orange-500 outline-none text-xs" value="${loc.hospital_address || ''}">
                    </div>
                    <div class="grid grid-cols-2 gap-2 mb-2">
                        <div>
                            <label class="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Google Maps Link</label>
                            <input type="url" class="loc-map w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:ring-1 focus:ring-orange-500 outline-none text-xs text-blue-600" value="${loc.map_link || ''}" placeholder="https://maps.google.com/...">
                        </div>
                        <div>
                            <label class="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Hospital Type</label>
                            <select class="loc-category w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:ring-1 focus:ring-orange-500 outline-none text-xs bg-white">
                                <option value="" ${curCat === '' ? 'selected' : ''}>Select Type</option>
                                <option value="Private" ${curCat === 'Private' ? 'selected' : ''}>Private</option>
                                <option value="Corporate" ${curCat === 'Corporate' ? 'selected' : ''}>Corporate</option>
                                <option value="Owned/Clinic" ${curCat === 'Owned/Clinic' ? 'selected' : ''}>Owned/Clinic</option>
                            </select>
                        </div>
                    </div>
                `;
                container.appendChild(block);
            });
        } else {
            container.innerHTML = '<div class="text-xs text-slate-500 italic">No locations available to edit.</div>';
        }
    }
    
    const modal = document.getElementById('suggestEditModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeSuggestModal() {
    const modal = document.getElementById('suggestEditModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function submitSuggestion() {
    if (!currentUserProfile) return;
    
    const id = document.getElementById('suggestDocId').value;
    const doc = doctorsData.find(d => d.id === id);
    if (!doc) return;

    const usage = document.getElementById('suggestAboneUsage').value;
    const phone = document.getElementById('suggestPhone') ? document.getElementById('suggestPhone').value : '';
    const email = document.getElementById('suggestEmail') ? document.getElementById('suggestEmail').value : '';
    const notes = document.getElementById('suggestNotes').value;
    
    const btnText = document.getElementById('submitSuggestText');
    const btnIcon = document.getElementById('submitSuggestIcon');
    
    btnText.textContent = 'Submitting...';
    btnIcon.className = 'ph-bold ph-spinner-gap animate-spin';

    const newData = {};
    if (usage !== null && usage !== undefined && usage !== '') newData.abone_usage_percentage = parseInt(usage);
    if (phone !== (doc.phone || '')) newData.phone = phone;
    if (email !== (doc.email || '')) newData.email = email;
    if (notes !== null && notes !== undefined && notes !== '') newData.rep_notes = notes;

    // Process locations
    const locations = [];
    const container = document.getElementById('suggestLocationsContainer');
    if (container) {
        const blocks = container.querySelectorAll('.bg-slate-50');
        blocks.forEach(block => {
            const locId = block.querySelector('.loc-id').value;
            const name = block.querySelector('.loc-name').value;
            const address = block.querySelector('.loc-address').value;
            const mapLink = block.querySelector('.loc-map').value;
            const category = block.querySelector('.loc-category') ? block.querySelector('.loc-category').value : '';
            
            const originalLoc = doc.locations.find(l => l.id == locId);
            if (originalLoc) {
                if (name !== (originalLoc.hospital_name || '') ||
                    address !== (originalLoc.hospital_address || '') ||
                    mapLink !== (originalLoc.map_link || '') ||
                    category !== (originalLoc.category || '')) {
                    locations.push({
                        id: locId,
                        hospital_name: name,
                        hospital_address: address,
                        map_link: mapLink,
                        category: category || null
                    });
                }
            }
        });
        
        if (locations.length > 0) {
            newData.locations = locations;
        }
    }

    const isRep = currentUserProfile && currentUserProfile.role === 'rep';

    if (isRep) {
        const { error } = await db.from('pending_edits').insert({
            doctor_id: id,
            suggested_by: currentUserProfile.id,
            new_data: newData,
            status: 'pending'
        });

        if (error) {
            showToast('Submission failed: ' + error.message, 'error');
            btnText.textContent = 'Submit for Approval';
            btnIcon.className = 'ph-bold ph-paper-plane-right';
            return;
        }
        
        // Show success state
        btnText.textContent = 'Sent for Approval!';
        btnIcon.className = 'ph-bold ph-check text-white';
        
        setTimeout(() => { 
            closeSuggestModal(); 
            // Reset button for next time
            btnText.textContent = 'Submit for Approval';
            btnIcon.className = 'ph-bold ph-paper-plane-right';
        }, 1500);
    } else {
        // Admin Direct Update
        const { locations, ...docData } = newData;
        if (Object.keys(docData).length > 0) {
            const { error } = await db.from('doctors').update(docData).eq('id', id);
            if (error) {
                showToast('Update failed: ' + error.message, 'error');
                btnText.textContent = 'Save Changes directly';
                btnIcon.className = 'ph-bold ph-floppy-disk';
                return;
            }
        }
        if (locations && locations.length > 0) {
            for (const loc of locations) {
                const { id: locId, ...locDataToUpdate } = loc;
                const { error: lErr } = await db.from('locations').update(locDataToUpdate).eq('id', locId);
                if (lErr) {
                    showToast('Failed to save location details: ' + lErr.message, 'error');
                    console.error("Location update error:", lErr);
                    return; // Stop on error
                }
            }
        }
        
        btnText.textContent = 'Saved!';
        btnIcon.className = 'ph-bold ph-check text-white';
        showToast('Changes saved instantly.', 'success');
        
        // Refresh
        await fetchDoctors();
        
        setTimeout(() => { 
            closeSuggestModal(); 
            btnText.textContent = 'Save Changes directly';
            btnIcon.className = 'ph-bold ph-floppy-disk';
        }, 1000);
    }
}

// ── Log Visit (Rep) ───────────────────────────────────────────────────────────

async function quickMarkVisited(id) {
    if (!currentUserProfile) {
        showToast('You must be logged in to log a visit.', 'error');
        return;
    }
    
    // Immediately update UI optimistically
    const doc = doctorsData.find(d => d.id === id);
    if (!doc) return;
    
    const logData = {
        doctor_id: id,
        rep_id: currentUserProfile.id,
        outcome: 'Visited',
        notes: 'Quick logged via checklist',
        visit_date: new Date().toISOString()
    };
    
    doc.activity_logs = doc.activity_logs || [];
    doc.activity_logs.push(logData);
    
    // Re-render UI to show the green checkmark
    showDetail(id);
    renderDoctors(getFilteredDoctors());
    
    // Background sync
    const { error } = await db.from('activity_logs').insert(logData);
    if (error) {
        showToast('Failed to sync visit log: ' + error.message, 'error');
        console.error("Activity log error:", error);
    } else {
        // We really should fetch again to get the real UUID for future deletions,
        // but for now, rely on fallback deletion or hard refresh if needed.
    }
}

async function unmarkVisited(id) {
    if (!currentUserProfile) return;
    if (!confirm('Remove this visit log?')) return;
    
    const doc = doctorsData.find(d => d.id === id);
    if (!doc || !doc.activity_logs) return;
    
    const myLogs = doc.activity_logs.filter(l => l.rep_id === currentUserProfile.id).sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date));
    if (myLogs.length === 0) return;
    
    const logToDelete = myLogs[0]; // remove the most recent one
    
    // Optimistic UI update
    doc.activity_logs = doc.activity_logs.filter(l => l !== logToDelete && l.id !== logToDelete.id);
    showDetail(id);
    renderDoctors(getFilteredDoctors());
    
    // Background sync
    let query = db.from('activity_logs').delete();
    
    // If it was just created optimistically, it might not have an 'id' yet,
    // so we delete based on matching the doctor_id and rep_id and timestamp if possible.
    if (logToDelete.id) {
        query = query.eq('id', logToDelete.id);
    } else {
        query = query.eq('doctor_id', id).eq('rep_id', currentUserProfile.id).eq('visit_date', logToDelete.visit_date);
    }
    
    const { error } = await query;
    if (error) {
        showToast('Failed to remove visit: ' + error.message, 'error');
        console.error("Unvisit error:", error);
    } else {
        showToast('Visit removed.', 'success');
    }
}

function openLogVisitModal(id) {
    const doc = doctorsData.find(d => d.id === id);
    if (!doc) return;
    
    document.getElementById('logVisitDocId').value = doc.id;
    document.getElementById('logVisitDate').value = new Date().toISOString().split('T')[0]; // Default to today
    document.getElementById('logVisitOutcome').value = 'Samples Provided';
    document.getElementById('logVisitNotes').value = '';
    
    const modal = document.getElementById('logVisitModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeLogVisitModal() {
    const modal = document.getElementById('logVisitModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function submitLogVisit() {
    if (!currentUserProfile) return;
    
    const docId = document.getElementById('logVisitDocId').value;
    const visitDate = document.getElementById('logVisitDate').value;
    const outcome = document.getElementById('logVisitOutcome').value;
    const notes = document.getElementById('logVisitNotes').value;
    
    const btnText = document.getElementById('submitLogVisitText');
    const btnIcon = document.getElementById('submitLogVisitIcon');
    
    btnText.textContent = 'Saving...';
    btnIcon.className = 'ph-bold ph-spinner-gap animate-spin';

    const { error } = await db.from('activity_logs').insert({
        doctor_id: docId,
        rep_id: currentUserProfile.id,
        visit_date: visitDate,
        outcome: outcome,
        notes: notes
    });

    if (error) {
        showToast('Failed to log visit: ' + error.message, 'error');
        btnText.textContent = 'Save Log';
        btnIcon.className = 'ph-bold ph-check';
        return;
    }
    
    // Show success state
    btnText.textContent = 'Visit Logged!';
    btnIcon.className = 'ph-bold ph-check-circle text-white';
    
    setTimeout(() => { 
        closeLogVisitModal(); 
        btnText.textContent = 'Save Log';
        btnIcon.className = 'ph-bold ph-check';
    }, 1500);
}

// ── Add Doctor (Rep) ──────────────────────────────────────────────────────────
function openAddDoctorModal() {
    // Clear all fields
    document.getElementById('addDocName').value = '';
    document.getElementById('addDocSpec').value = 'Orthopaedic Surgeon';
    document.getElementById('addDocSpecCat').value = 'General';
    document.getElementById('addDocPhone').value = '';
    document.getElementById('addDocHospital').value = '';
    document.getElementById('addDocAddress').value = '';
    document.getElementById('addDocTiming').value = '';
    document.getElementById('addDocMapLink').value = '';
    document.getElementById('addDocNotes').value = '';
    
    // Populate zone dropdown
    const zoneSelect = document.getElementById('addDocZone');
    zoneSelect.innerHTML = '';
    zonesData.forEach(z => {
        const opt = document.createElement('option');
        opt.value = z.id;
        opt.textContent = z.name;
        // Pre-select rep's assigned zone
        if (currentUserProfile && currentUserProfile.assigned_zone_id == z.id) {
            opt.selected = true;
        }
        zoneSelect.appendChild(opt);
    });
    
    const modal = document.getElementById('addDoctorModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeAddDoctorModal() {
    const modal = document.getElementById('addDoctorModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function submitAddDoctor() {
    if (!currentUserProfile) return;
    
    const name = document.getElementById('addDocName').value.trim();
    const hospital = document.getElementById('addDocHospital').value.trim();
    const email = document.getElementById('addDocEmail') ? document.getElementById('addDocEmail').value.trim() : null;
    
    if (!name) { showToast('Doctor name is required.', 'error'); return; }
    if (!hospital) { showToast('Hospital/Clinic name is required.', 'error'); return; }
    
    const btnText = document.getElementById('submitAddDocText');
    const btnIcon = document.getElementById('submitAddDocIcon');
    btnText.textContent = 'Submitting...';
    btnIcon.className = 'ph-bold ph-spinner-gap animate-spin';

    const newData = {
        name: name,
        specialization: document.getElementById('addDocSpec').value,
        spec_category: document.getElementById('addDocSpecCat').value,
        phone: document.getElementById('addDocPhone').value.trim() || null,
        email: email || null,
        rep_notes: document.getElementById('addDocNotes').value.trim() || null,
        location: {
            hospital_name: hospital,
            hospital_address: document.getElementById('addDocAddress').value.trim() || null,
            consultation_timing: document.getElementById('addDocTiming').value.trim() || null,
            zone_id: document.getElementById('addDocZone').value,
            category: document.getElementById('addDocCategory').value || null,
            map_link: document.getElementById('addDocMapLink').value.trim() || null,
            is_primary: true
        }
    };

    const { error } = await db.from('pending_edits').insert({
        doctor_id: null,
        suggested_by: currentUserProfile.id,
        new_data: newData,
        action: 'add_doctor',
        status: 'pending'
    });

    if (error) {
        showToast('Submission failed: ' + error.message, 'error');
        btnText.textContent = 'Submit for Approval';
        btnIcon.className = 'ph-bold ph-paper-plane-right';
        return;
    }
    
    btnText.textContent = 'Sent for Approval!';
    btnIcon.className = 'ph-bold ph-check-circle text-white';
    showToast('New doctor submitted for admin approval!', 'success');
    
    setTimeout(() => { 
        closeAddDoctorModal(); 
        btnText.textContent = 'Submit for Approval';
        btnIcon.className = 'ph-bold ph-paper-plane-right';
    }, 1500);
}

// ── Admin Pending Edits ───────────────────────────────────────────────────────
async function fetchPendingEdits() {
    const { data, error } = await db.from('pending_edits')
        .select('*, doctors(name), profiles(first_name, last_name)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error fetching pending edits:", error);
        return;
    }

    pendingEditsData = data;
    
    // Update badge
    const badge = document.getElementById('pendingBadge');
    if (badge) {
        if (data.length > 0) {
            badge.textContent = data.length;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    renderPendingEdits();
}

function renderPendingEdits() {
    const list = document.getElementById('admin-approvals-list');
    if (!list) return;

    list.innerHTML = '';

    if (!pendingEditsData || pendingEditsData.length === 0) {
        list.innerHTML = '<div class="text-slate-400 text-center py-10 text-sm">No pending edits to review.</div>';
        return;
    }

    const frag = document.createDocumentFragment();

    pendingEditsData.forEach(edit => {
        const isAddDoctor = edit.action === 'add_doctor';
        const docName = isAddDoctor ? (edit.new_data?.name || 'New Doctor') : (edit.doctors ? edit.doctors.name : 'Unknown Doctor');
        const repName = edit.profiles ? `${edit.profiles.first_name || ''} ${edit.profiles.last_name || ''}`.trim() : 'Unknown Rep';
        const dateStr = new Date(edit.created_at).toLocaleDateString();

        const card = document.createElement('div');
        card.className = 'bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-3';
        card.innerHTML = `
            <div class="flex justify-between items-start">
                <div>
                    <div class="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-0.5">Suggested by ${repName} • ${dateStr}</div>
                    <h3 class="text-sm font-bold text-slate-800">${docName}</h3>
                </div>
            </div>
            <button onclick="viewDiff('${edit.id}')"
                class="w-full bg-indigo-50 text-indigo-700 border border-indigo-200 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-transform hover:bg-indigo-100 mt-1">
                <i class="ph-bold ph-git-diff"></i> View Diff
            </button>
        `;
        frag.appendChild(card);
    });

    list.appendChild(frag);
}

function viewDiff(editId) {
    const edit = pendingEditsData.find(e => e.id === editId);
    if (!edit) return;
    
    currentEditId = editId;
    const isAddDoctor = edit.action === 'add_doctor';
    const doc = isAddDoctor ? null : doctorsData.find(d => d.id === edit.doctor_id);
    
    let contentHtml = '';
    
    if (isAddDoctor && edit.new_data) {
        // Show all the new doctor details in a clean format
        contentHtml = `
            <div class="text-sm font-bold text-green-700 mb-3 flex items-center gap-2">
                <i class="ph-fill ph-user-plus"></i> New Doctor Request
            </div>
            <div class="space-y-2">
                <div class="bg-green-50 p-3 rounded-lg border border-green-100">
                    <div class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Doctor Name</div>
                    <div class="text-sm font-bold text-slate-800">${edit.new_data.name || '—'}</div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                    <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                        <div class="text-[10px] font-bold text-slate-400 uppercase">Specialization</div>
                        <div class="text-xs text-slate-700">${edit.new_data.specialization || '—'}</div>
                    </div>
                    <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                        <div class="text-[10px] font-bold text-slate-400 uppercase">Category</div>
                        <div class="text-xs text-slate-700">${edit.new_data.spec_category || '—'}</div>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                    ${edit.new_data.phone ? `<div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                        <div class="text-[10px] font-bold text-slate-400 uppercase">Phone</div>
                        <div class="text-xs text-slate-700">${edit.new_data.phone}</div>
                    </div>` : ''}
                    ${edit.new_data.email ? `<div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100 overflow-hidden">
                        <div class="text-[10px] font-bold text-slate-400 uppercase">Email</div>
                        <div class="text-xs text-slate-700 truncate" title="${edit.new_data.email}">${edit.new_data.email}</div>
                    </div>` : ''}
                </div>
                ${edit.new_data.location ? `
                <hr class="border-slate-100">
                <div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Primary Location</div>
                <div class="bg-blue-50 p-3 rounded-lg border border-blue-100 space-y-1">
                    <div class="text-sm font-bold text-slate-800">${edit.new_data.location.hospital_name || '—'}</div>
                    ${edit.new_data.location.hospital_address ? `<div class="text-xs text-slate-600">${edit.new_data.location.hospital_address}</div>` : ''}
                    ${edit.new_data.location.consultation_timing ? `<div class="text-xs text-slate-500">🕒 ${edit.new_data.location.consultation_timing}</div>` : ''}
                    ${edit.new_data.location.zone_id ? `<div class="text-xs text-blue-600 font-bold">Zone: ${zonesData.find(z => z.id == edit.new_data.location.zone_id)?.name || edit.new_data.location.zone_id}</div>` : ''}
                    ${edit.new_data.location.map_link ? `<div class="text-xs text-blue-600 font-bold truncate">📍 <a href="${edit.new_data.location.map_link}" target="_blank" class="underline hover:text-blue-800" title="${edit.new_data.location.map_link}">View on Maps</a></div>` : ''}
                </div>` : ''}
                ${edit.new_data.rep_notes ? `<div class="bg-amber-50 p-2.5 rounded-lg border border-amber-100">
                    <div class="text-[10px] font-bold text-amber-600 uppercase">Rep Notes</div>
                    <div class="text-xs text-amber-900 italic">${edit.new_data.rep_notes}</div>
                </div>` : ''}
            </div>
        `;
    } else {
        contentHtml = `<div class="text-sm font-bold text-slate-800 mb-2">Doctor: ${doc ? doc.name : 'Unknown'}</div>`;
    
        // Compare new_data with existing doc
        if (edit.new_data) {
            if (edit.new_data.abone_usage_percentage !== undefined) {
                const oldVal = doc ? (doc.abone_usage_percentage || '0') : 'N/A';
                const newVal = edit.new_data.abone_usage_percentage;
                contentHtml += `
                    <div class="mb-3">
                        <div class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">% Abone Usage</div>
                        <div class="flex items-center gap-3 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                            <span class="text-red-500 font-bold line-through">${oldVal}%</span>
                            <i class="ph-bold ph-arrow-right text-slate-400"></i>
                            <span class="text-green-600 font-bold text-lg">${newVal}%</span>
                        </div>
                    </div>
                `;
            }
            if (edit.new_data.phone !== undefined) {
                const oldVal = doc ? (doc.phone || 'None') : 'N/A';
                const newVal = edit.new_data.phone;
                contentHtml += `
                    <div class="mb-3">
                        <div class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Phone</div>
                        <div class="flex items-center gap-3 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                            <span class="text-red-500 font-bold line-through">${oldVal}</span>
                            <i class="ph-bold ph-arrow-right text-slate-400"></i>
                            <span class="text-green-600 font-bold">${newVal}</span>
                        </div>
                    </div>
                `;
            }
            if (edit.new_data.email !== undefined) {
                const oldVal = doc ? (doc.email || 'None') : 'N/A';
                const newVal = edit.new_data.email;
                contentHtml += `
                    <div class="mb-3">
                        <div class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Email</div>
                        <div class="flex items-center gap-3 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                            <span class="text-red-500 font-bold line-through">${oldVal}</span>
                            <i class="ph-bold ph-arrow-right text-slate-400"></i>
                            <span class="text-green-600 font-bold">${newVal}</span>
                        </div>
                    </div>
                `;
            }
            if (edit.new_data.rep_notes !== undefined) {
                const oldVal = doc ? (doc.rep_notes || 'None') : 'N/A';
                const newVal = edit.new_data.rep_notes;
                contentHtml += `
                    <div>
                        <div class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Rep Notes</div>
                        <div class="bg-red-50 text-red-800 p-2.5 rounded-t-lg border border-red-100 text-sm italic">
                            - ${oldVal}
                        </div>
                        <div class="bg-green-50 text-green-800 p-2.5 rounded-b-lg border border-green-100 border-t-0 text-sm">
                            + ${newVal}
                        </div>
                    </div>
                `;
            }
            if (edit.new_data.locations && edit.new_data.locations.length > 0) {
                contentHtml += `<div class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 mt-3">Location Edits</div>`;
                edit.new_data.locations.forEach(locEdit => {
                    const originalLoc = doc.locations.find(l => l.id === locEdit.id);
                    if (originalLoc) {
                        contentHtml += `<div class="bg-slate-50 border border-slate-200 rounded-lg p-2.5 mb-2 text-sm">
                            <div class="font-bold text-slate-700 border-b border-slate-200 pb-1 mb-2">${originalLoc.hospital_name || 'Location'}</div>
                            ${locEdit.hospital_name !== originalLoc.hospital_name ? `<div class="flex gap-2 mb-1"><span class="text-slate-400 w-16 flex-shrink-0">Name:</span> <span class="text-red-500 line-through truncate w-24">${originalLoc.hospital_name || ''}</span> <i class="ph-bold ph-arrow-right text-slate-400"></i> <span class="text-green-600 truncate w-24">${locEdit.hospital_name}</span></div>` : ''}
                            ${locEdit.hospital_address !== originalLoc.hospital_address ? `<div class="flex gap-2 mb-1"><span class="text-slate-400 w-16 flex-shrink-0">Address:</span> <span class="text-red-500 line-through truncate w-24">${originalLoc.hospital_address || ''}</span> <i class="ph-bold ph-arrow-right text-slate-400"></i> <span class="text-green-600 truncate w-24">${locEdit.hospital_address}</span></div>` : ''}
                            ${locEdit.map_link !== originalLoc.map_link ? `<div class="flex gap-2"><span class="text-slate-400 w-16 flex-shrink-0">Map Link:</span> <span class="text-red-500 line-through truncate w-24" title="${originalLoc.map_link || ''}">${originalLoc.map_link || 'None'}</span> <i class="ph-bold ph-arrow-right text-slate-400"></i> <span class="text-green-600 truncate w-24" title="${locEdit.map_link}">${locEdit.map_link}</span></div>` : ''}
                        </div>`;
                    }
                });
            }
        }
    }

    document.getElementById('diffContent').innerHTML = contentHtml;
    
    const modal = document.getElementById('diffModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeDiffModal() {
    const modal = document.getElementById('diffModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    currentEditId = null;
}

async function approveEdit() {
    if (!currentEditId) return;
    const editId = currentEditId;
    const edit = pendingEditsData.find(e => e.id === editId);
    if (!edit || !edit.new_data) return;

    const btn = document.getElementById('approveEditBtn');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="ph-bold ph-spinner-gap animate-spin"></i> Approving...';
    btn.disabled = true;

    if (edit.action === 'add_doctor') {
        // ── INSERT new doctor + location ──
        const docData = {
            name: edit.new_data.name,
            specialization: edit.new_data.specialization || null,
            spec_category: edit.new_data.spec_category || null,
            phone: edit.new_data.phone || null,
            rep_notes: edit.new_data.rep_notes || null,
            is_approximate: true
        };

        const { data: newDoc, error: docError } = await db.from('doctors')
            .insert(docData)
            .select()
            .single();

        if (docError) {
            showToast('Failed to create doctor: ' + docError.message, 'error');
            btn.innerHTML = originalHtml;
            btn.disabled = false;
            return;
        }

        // Insert location if provided
        if (edit.new_data.location) {
            const locData = {
                doctor_id: newDoc.id,
                hospital_name: edit.new_data.location.hospital_name,
                hospital_address: edit.new_data.location.hospital_address || null,
                consultation_timing: edit.new_data.location.consultation_timing || null,
                zone_id: edit.new_data.location.zone_id || null,
                category: edit.new_data.location.category || null,
                map_link: edit.new_data.location.map_link || null,
                is_primary: true
            };

            const { error: locError } = await db.from('locations').insert(locData);
            if (locError) {
                console.error('Failed to create location:', locError);
                showToast('Doctor created but location failed: ' + locError.message, 'error');
            }
        }
    } else {
        // ── Existing edit flow: UPDATE doctor & locations ──
        const { locations, ...docData } = edit.new_data;

        if (Object.keys(docData).length > 0) {
            const { error: updateError } = await db.from('doctors')
                .update(docData)
                .eq('id', edit.doctor_id);

            if (updateError) {
                showToast('Failed to update doctor: ' + updateError.message, 'error');
                btn.innerHTML = originalHtml;
                btn.disabled = false;
                return;
            }
        }

        if (locations && locations.length > 0) {
            for (const loc of locations) {
                const { id: locId, ...locDataToUpdate } = loc;
                const { error: locError } = await db.from('locations')
                    .update(locDataToUpdate)
                    .eq('id', locId);
                
                if (locError) {
                    console.error('Failed to update location:', locError);
                    showToast('Doctor updated but location failed: ' + locError.message, 'error');
                }
            }
        }
    }

    // Mark as approved
    const { error: statusError } = await db.from('pending_edits')
        .update({ status: 'approved' })
        .eq('id', editId);

    if (statusError) {
        console.error('Failed to update edit status:', statusError);
    }

    // Refresh
    await fetchDoctors();
    await fetchPendingEdits();
    
    closeDiffModal();
    btn.innerHTML = originalHtml;
    btn.disabled = false;
    showToast(edit.action === 'add_doctor' ? 'New doctor approved & added!' : 'Edit approved & merged!', 'success');
}

async function rejectEdit() {
    if (!currentEditId) return;
    const editId = currentEditId;

    const btn = document.getElementById('rejectEditBtn');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="ph-bold ph-spinner-gap animate-spin"></i> Rejecting...';
    btn.disabled = true;

    const { error } = await db.from('pending_edits')
        .update({ status: 'rejected' })
        .eq('id', editId);

    if (error) {
        showToast("Failed to reject edit: " + error.message, 'error');
    } else {
        await fetchPendingEdits();
        closeDiffModal();
    }
    
    btn.innerHTML = originalHtml;
    btn.disabled = false;
}

// ── Realtime Sync ─────────────────────────────────────────────────────────────
function setupRealtime() {
    db.channel('schema-db-changes')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'doctors' }, payload => {
            const idx = doctorsData.findIndex(d => d.id === payload.new.id);
            if (idx !== -1) {
                // Merge to preserve nested relations like locations
                doctorsData[idx] = { ...doctorsData[idx], ...payload.new };
                
                // If this is the currently active doctor in the detail view, refresh the view
                if (activeDoctorId === payload.new.id) {
                    showDetail(activeDoctorId);
                }
            }
        }).subscribe();
}

// ── DB Status Indicator ───────────────────────────────────────────────────────
function setDbStatus(ok) {
    document.getElementById('db-dot').className = `w-2 h-2 rounded-full ${ok ? 'bg-green-500' : 'bg-red-400'}`;
    document.getElementById('db-label').textContent = ok ? 'Live' : 'Offline';
}

function showError(msg) {
    document.getElementById('doctorList').innerHTML = `<div class="text-red-500 text-center p-6 text-sm">${msg}</div>`;
}

// ── Global Error Handling & Toasts ────────────────────────────────────────────
function showToast(message, type = 'error') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    const isError = type === 'error';
    
    toast.className = `px-4 py-3 rounded-xl shadow-lg text-sm font-bold flex items-center gap-2 transform transition-all duration-300 translate-y-[-100%] opacity-0 pointer-events-auto ${isError ? 'bg-red-500 text-white shadow-red-500/30' : 'bg-emerald-500 text-white shadow-emerald-500/30'}`;
    
    toast.innerHTML = `
        <i class="ph-bold ${isError ? 'ph-warning-circle' : 'ph-check-circle'} text-lg"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.remove('translate-y-[-100%]', 'opacity-0');
    }, 10);

    setTimeout(() => {
        toast.classList.add('translate-y-[-100%]', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
