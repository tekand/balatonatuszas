// Constants for locations and mapping
const REVFULOP_COORDS = [46.8265, 17.631028];
const BALATONBOGLAR_COORDS = [46.782083, 17.650111];
const bounds = L.latLngBounds([REVFULOP_COORDS, BALATONBOGLAR_COORDS]);

// Swimmer marker color mapping
const SWIMMER_COLORS = {
    "Zoli": "#0d9488",  // Teal
    "Dávid": "#3b82f6", // Blue
    "Evi": "#ec4899"    // Pink
};

// State variables
let map;
let markers = {};
let connectionLines = {};
let decryptedTokens = null;
let trackingInterval = null;

// Initialize application on load
document.addEventListener("DOMContentLoaded", () => {
    initMap();
    setupEventListeners();
    authenticate();
});

// Initialize Leaflet Map
function initMap() {
    map = L.map('map', {
        zoomControl: true
    });

    // Add Tile Layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Draw the swim course (dashed line between Révfülöp and Balatonboglár)
    L.polyline([REVFULOP_COORDS, BALATONBOGLAR_COORDS], {
        color: '#0284c7', // Sky blue
        weight: 3,
        dashArray: '5, 8',
        opacity: 0.4
    }).addTo(map);

    // Add landmark markers for Start and Finish
    L.marker(REVFULOP_COORDS, { icon: createLandmarkIcon('R', true) })
        .addTo(map)
        .bindPopup('<b>Rajt: Révfülöp</b><br>Balaton-átúszás rajtállomás.');
        
    L.marker(BALATONBOGLAR_COORDS, { icon: createLandmarkIcon('C', false) })
        .addTo(map)
        .bindPopup('<b>Cél: Balatonboglár</b><br>Balaton-átúszás célállomás.');

    // Load saved view from localStorage if available, otherwise fit swim course bounds
    const savedCenter = localStorage.getItem('map_center');
    const savedZoom = localStorage.getItem('map_zoom');

    if (savedCenter && savedZoom) {
        try {
            const center = JSON.parse(savedCenter);
            const zoom = parseInt(savedZoom, 10);
            map.setView(center, zoom);
        } catch (e) {
            console.error("Error loading saved map view:", e);
            resetView();
        }
    } else {
        resetView();
    }
}

// Reset view to the swim course bounds
function resetView() {
    map.fitBounds(bounds, { padding: [100, 100] });
    saveMapView();
}

// Save map center and zoom level to localStorage
function saveMapView() {
    if (!map) return;
    const center = map.getCenter();
    localStorage.setItem('map_center', JSON.stringify([center.lat, center.lng]));
    localStorage.setItem('map_zoom', map.getZoom());
}

// Setup map interaction event listeners
function setupEventListeners() {
    map.on('moveend', saveMapView);
    map.on('zoomend', saveMapView);

    document.getElementById('reset-view-btn').addEventListener('click', resetView);

    // Modal submit handler
    const authForm = document.getElementById('auth-form');
    if (authForm) {
        authForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const password = document.getElementById('password-input').value;
            tryUnlock(password);
        });
    }
}

// Helper functions for Cookie management
function setCookie(name, value, days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${value};expires=${date.toUTCString()};path=/;SameSite=Strict;Secure`;
}

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

// Create custom circular first-letter icon for swimmers with a single distance bubble
function createSwimmerIcon(name, color, startKm = '', finishKm = '') {
    const firstLetter = name.charAt(0).toUpperCase();
    const showLabels = startKm && finishKm;
    const iconHtml = `
        <div class="swimmer-marker-group">
            ${showLabels ? `<div class="distance-bubble" style="--swimmer-color: ${color};">R: ${startKm} • C: ${finishKm}</div>` : ''}
            <div class="letter-marker" style="--marker-color: ${color}; background-color: ${color};">${firstLetter}</div>
        </div>
    `;
    return L.divIcon({
        html: iconHtml,
        className: 'custom-div-icon',
        iconSize: [160, 64],
        iconAnchor: [80, 64],
        popupAnchor: [0, -64]
    });
}

// Create custom circular R/C icon for landmarks
function createLandmarkIcon(letter, isStart) {
    const color = isStart ? '#10b981' : '#ef4444'; // Emerald for start, Rose for finish
    const iconHtml = `<div class="landmark-marker" style="--marker-color: ${color}; background-color: ${color};">${letter}</div>`;
    return L.divIcon({
        html: iconHtml,
        className: 'custom-div-icon',
        iconSize: [30, 36],
        iconAnchor: [15, 36],
        popupAnchor: [0, -36]
    });
}

// Initialize authentication flow
function authenticate() {
    const savedPassword = getCookie("tracker_key");

    if (savedPassword) {
        // Automatically attempt to unlock using cookie password
        if (tryUnlock(savedPassword, true)) {
            return;
        }
    }

    // If no password or saved password failed, show the modal
    showAuthModal();
}

// Show the custom glassmorphic authentication modal
function showAuthModal() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) {
        overlay.classList.remove('fade-out');
        document.getElementById('password-input').focus();
    }
}

// Hide the authentication modal
function hideAuthModal() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) {
        overlay.classList.add('fade-out');
    }
}

// Attempt to decrypt the tokens with the provided password
function tryUnlock(password, isAutoAttempt = false) {
    const errorEl = document.getElementById('auth-error');
    
    if (errorEl) {
        errorEl.classList.remove('visible');
    }

    try {
        if (typeof ENCRYPTED_TOKENS === 'undefined') {
            throw new Error("Encrypted tokens configuration is missing.");
        }

        const decryptedBytes = CryptoJS.AES.decrypt(atob(ENCRYPTED_TOKENS), password);
        const decryptedText = decryptedBytes.toString(CryptoJS.enc.Utf8);
        
        if (!decryptedText) {
            throw new Error("Invalid password");
        }

        decryptedTokens = JSON.parse(decryptedText);

        // Save valid password for 365 days
        setCookie("tracker_key", password, 365);

        // Dismiss modal
        hideAuthModal();

        // Spin up live data tracking loops
        updateLiveLocations();
        if (trackingInterval) clearInterval(trackingInterval);
        trackingInterval = setInterval(updateLiveLocations, 30000);

        return true;
    } catch (error) {
        console.error("Unlock attempt failed:", error);
        
        if (isAutoAttempt) {
            // Saved cookie was invalid/expired, clear it and show modal
            setCookie("tracker_key", "", -1);
            showAuthModal();
        } else {
            // Display error in modal UI
            if (errorEl) {
                errorEl.textContent = "Helytelen jelszó. Hozzáférés megtagadva.";
                errorEl.classList.add('visible');
            }
        }
        return false;
    }
}

// Fetch and update location data for tracked individuals
async function updateLiveLocations() {
    if (!decryptedTokens) return;

    const targets = [
        { name: "Zoli", token: decryptedTokens.token1 },
        { name: "Dávid", token: decryptedTokens.token2 },
        { name: "Evi", token: decryptedTokens.token3 }
    ];

    for (let person of targets) {
        if (!person.token || person.token.includes("TOKEN")) continue;

        try {
            const targetUrl = `https://graph.tractive.com/3/public_share/${person.token}/position`;
            const response = await fetch(`https://corsproxy.io/?${encodeURIComponent(targetUrl)}`);
            const data = await response.json();
            
            if (data.lat && data.lon) {
                const pos = [data.lat, data.lon];
                const color = SWIMMER_COLORS[person.name] || "#6366f1";

                if (markers[person.name]) {
                    markers[person.name].setLatLng(pos);
                } else {
                    markers[person.name] = L.marker(pos, { 
                        icon: createSwimmerIcon(person.name, color) 
                    }).addTo(map).bindPopup(`<b>${person.name}</b><br>Élő követés aktív`);
                }

                // Update thin dotted connection lines and distance labels
                updateSwimmerConnections(person.name, pos, color);
            }
        } catch (error) {
            console.error(`Error updating tracking stream for ${person.name}:`, error);
        }
    }

    // Update last refresh time indicator
    const now = new Date();
    const timeString = now.toTimeString().split(' ')[0];
    const refreshStatusEl = document.getElementById('refresh-status');
    if (refreshStatusEl) {
        refreshStatusEl.textContent = `Legutóbbi frissítés: ${timeString}`;
        refreshStatusEl.style.display = 'block';
    }
    
    // Note: We deliberately DO NOT reset or set the view here,
    // which allows the user to pan/zoom freely and preserves the viewport state.
}

// Update thin dotted connection lines and distance labels to start and end
function updateSwimmerConnections(name, pos, color) {
    // 1. Calculate distances
    const distStart = L.latLng(pos).distanceTo(L.latLng(REVFULOP_COORDS));
    const distFinish = L.latLng(pos).distanceTo(L.latLng(BALATONBOGLAR_COORDS));
    const startKm = (distStart / 1000).toFixed(2) + ' km';
    const finishKm = (distFinish / 1000).toFixed(2) + ' km';

    // 2. Create or update Polylines
    if (!connectionLines[name]) {
        connectionLines[name] = {};
    }

    const lineOpts = {
        color: color,
        weight: 1,
        dashArray: '2, 4',
        opacity: 0.7
    };

    if (connectionLines[name].start) {
        connectionLines[name].start.setLatLngs([REVFULOP_COORDS, pos]);
    } else {
        connectionLines[name].start = L.polyline([REVFULOP_COORDS, pos], lineOpts).addTo(map);
    }

    if (connectionLines[name].end) {
        connectionLines[name].end.setLatLngs([pos, BALATONBOGLAR_COORDS]);
    } else {
        connectionLines[name].end = L.polyline([pos, BALATONBOGLAR_COORDS], lineOpts).addTo(map);
    }

    // 3. Update the swimmer marker icon to include current distances
    if (markers[name]) {
        markers[name].setIcon(createSwimmerIcon(name, color, startKm, finishKm));
    }
}
