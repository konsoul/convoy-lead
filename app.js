/**
 * Convoy Lead - Core Logic, Weather Integration & State Management
 * Technology: Vanilla ES6+ Javascript
 */

// Register PWA Service Worker with active live update check
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            console.log('[SW] Registered for offline support:', reg.scope);
            // Proactively check for newer versions on every page load
            reg.update();
        }).catch(err => {
            console.log('[SW] Registration note:', err);
        });

        // If a new service worker takes over, reload to apply new assets
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                refreshing = true;
                window.location.reload();
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // --- Application State ---
    let itineraryData = [];
    let activeDayNumber = 1;
    
    // In-memory weather cache & geocoding cache
    const weatherCache = new Map();
    const geocodeCache = new Map();

    // Default Pre-Trip Morning Checklist Items
    const DEFAULT_CHECKLIST = [
        "Cold tire pressures & lug torque verified",
        "Engine oil, coolant & transmission fluid levels checked",
        "Cargo & trailer hitch / safety chains secure",
        "CB & GMRS radios tested (battery charged)",
        "Staging complete: navigation loaded, cooler iced, drinks stocked"
    ];

    // Address Edit Target Tracker
    let currentEditTarget = {
        legId: null,
        type: null, // 'start' or 'destination'
        originalAddress: ''
    };

    // --- DOM Elements ---
    const dayTabsContainer = document.getElementById('day-tabs');
    const activeDayBadge = document.getElementById('active-day-badge');
    const activeDayTitle = document.getElementById('active-day-title');
    const activeDayTarget = document.getElementById('active-day-target');
    const activeDayHotel = document.getElementById('active-day-hotel');
    const activeDayHotelDetails = document.getElementById('active-day-hotel-details');
    const activeDayOvernightContainer = document.getElementById('active-day-overnight-container');
    const legsContainer = document.getElementById('legs-container');
    const legsCarouselNav = document.getElementById('legs-carousel-nav');
    let activeLegIndex = 0;
    
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressText = document.getElementById('progress-text');
    const tripDateInput = document.getElementById('trip-start-date');

    // Checklist Elements
    const toggleChecklistBtn = document.getElementById('toggle-checklist-btn');
    const checklistDrawer = document.getElementById('checklist-drawer');
    const checklistItemsContainer = document.getElementById('checklist-items');
    const checklistProgressBadge = document.getElementById('checklist-progress-badge');
    const checklistChevron = document.getElementById('checklist-chevron');

    // Convoy Hub Modal elements
    const convoyHubBtn = document.getElementById('convoy-hub-btn');
    const convoyHubModal = document.getElementById('convoy-hub-modal');
    const closeConvoyHubBtn = document.getElementById('close-convoy-hub-btn');
    const closeConvoyHubFooterBtn = document.getElementById('close-convoy-hub-footer-btn');

    // PDF Modal elements
    const pdfModal = document.getElementById('pdf-modal');
    const viewPdfBtn = document.getElementById('view-pdf-btn');
    const closePdfBtn = document.getElementById('close-pdf-btn');
    const closePdfFooterBtn = document.getElementById('close-pdf-footer-btn');

    // Address Edit Modal elements
    const editModal = document.getElementById('edit-modal');
    const editModalTitle = document.getElementById('edit-modal-title');
    const addressTextarea = document.getElementById('address-textarea');
    const closeEditBtn = document.getElementById('close-edit-btn');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const saveAddressBtn = document.getElementById('save-address-btn');
    const resetAddressBtn = document.getElementById('reset-address-btn');

    // --- Bootstrapping & Initialization ---
    init();

    async function init() {
        try {
            // Initialize Trip Start Date
            initTripStartDate();

            const response = await fetch(`itinerary.json?t=${Date.now()}`, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error('Failed to load itinerary.json');
            }
            const data = await response.json();
            itineraryData = data.itinerary;
            
            // Set up initial active day (first uncompleted day or default to 1)
            activeDayNumber = getFirstUncompletedDay();
            
            renderTabs();
            renderActiveDay();
            updateOverallProgress();
            setupGlobalEventListeners();
            setupDragToScroll();
            
            // Initialize lucide icons for statically defined HTML
            lucide.createIcons();
        } catch (error) {
            console.error('Error initializing application:', error);
            legsContainer.innerHTML = `
                <div class="leg-card" style="text-align: center; padding: 32px;">
                    <i data-lucide="alert-triangle" style="width: 48px; height: 48px; color: var(--danger); margin: 0 auto 16px;"></i>
                    <h3>Failed to load Itinerary</h3>
                    <p class="notes-text" style="margin-top: 8px;">Please ensure itinerary.json is available in the root folder.</p>
                </div>
            `;
            lucide.createIcons();
        }
    }

    // --- Date & Time Helpers ---

    function getTodayDateString() {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function initTripStartDate() {
        let savedDate = localStorage.getItem('convoy_trip_start_date');
        if (!savedDate) {
            savedDate = getTodayDateString();
            localStorage.setItem('convoy_trip_start_date', savedDate);
        }
        if (tripDateInput) {
            tripDateInput.value = savedDate;
        }
    }

    function getTripStartDate() {
        return localStorage.getItem('convoy_trip_start_date') || getTodayDateString();
    }

    function getDateForDay(dayNumber) {
        const startDateStr = getTripStartDate();
        const [year, month, day] = startDateStr.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        date.setDate(date.getDate() + (dayNumber - 1));
        const resYear = date.getFullYear();
        const resMonth = String(date.getMonth() + 1).padStart(2, '0');
        const resDay = String(date.getDate()).padStart(2, '0');
        return `${resYear}-${resMonth}-${resDay}`;
    }

    function parseTimeToHour(timeStr) {
        if (!timeStr) return 8;
        const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (!match) return 8;
        let hour = parseInt(match[1], 10);
        const min = parseInt(match[2], 10);
        const period = match[3].toUpperCase();
        if (period === 'PM' && hour < 12) hour += 12;
        if (period === 'AM' && hour === 12) hour = 0;
        return min >= 35 ? (hour + 1) % 24 : hour;
    }

    function formatTimeFromISO(isoStr) {
        if (!isoStr) return '';
        try {
            const d = new Date(isoStr);
            if (!isNaN(d.getTime())) {
                return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
            }
        } catch (e) {}

        const parts = isoStr.split('T')[1]?.split(':');
        if (parts && parts.length >= 2) {
            let hour = parseInt(parts[0], 10);
            const min = parts[1];
            const ampm = hour >= 12 ? 'PM' : 'AM';
            hour = hour % 12 || 12;
            return `${hour}:${min} ${ampm}`;
        }
        return '';
    }

    function getShortLocationName(address) {
        if (!address) return '';
        const parts = address.split(',').map(s => s.trim());
        if (parts.length >= 3) {
            const city = parts[parts.length - 2];
            const stateZip = parts[parts.length - 1].split(' ')[0];
            return `${city}, ${stateZip}`;
        } else if (parts.length === 2) {
            return address;
        }
        return parts[0];
    }

    function getFacilityInfo(type) {
        switch (type) {
            case 'travel_stop':
                return { 
                    label: 'Travel Plaza Stop', 
                    badgeClass: 'badge-accent', 
                    icon: 'fuel', 
                    boxClass: 'stop-travel-plaza',
                    calloutPrefix: 'Fuel & Staging Stop'
                };
            case 'gas_station':
                return { 
                    label: 'Gas Station Stop', 
                    badgeClass: 'badge-green', 
                    icon: 'fuel', 
                    boxClass: 'stop-fuel',
                    calloutPrefix: 'Fuel & Rest Stop'
                };
            case 'hotel':
                return { 
                    label: 'Overnight Hotel', 
                    badgeClass: 'badge-primary', 
                    icon: 'bed', 
                    boxClass: 'stop-hotel',
                    calloutPrefix: 'Overnight Hotel'
                };
            case 'home':
                return { 
                    label: 'Final Terminus', 
                    badgeClass: 'badge-orange', 
                    icon: 'home', 
                    boxClass: 'stop-home',
                    calloutPrefix: 'Final Trip Destination'
                };
            default:
                return { 
                    label: 'Waypoint Stop', 
                    badgeClass: 'badge-primary', 
                    icon: 'map-pin', 
                    boxClass: 'stop-fuel',
                    calloutPrefix: 'Waypoint Destination'
                };
        }
    }

    function getDurationPillClass(transitStats) {
        if (!transitStats) return 'stats-pill-green';
        
        let totalMinutes = 0;
        const hoursMatch = transitStats.match(/(\d+)\s*(?:hr|hour)s?/i);
        const minsMatch = transitStats.match(/(\d+)\s*(?:min|minute)s?/i);
        
        if (hoursMatch) totalMinutes += parseInt(hoursMatch[1], 10) * 60;
        if (minsMatch) totalMinutes += parseInt(minsMatch[1], 10);
        
        if (totalMinutes > 210) {
            return 'stats-pill-red';
        } else if (totalMinutes > 150) {
            return 'stats-pill-orange';
        } else {
            return 'stats-pill-green';
        }
    }

    function formatCompactTransitStats(rawStats) {
        if (!rawStats) return '';
        const milesMatch = rawStats.match(/(\d+)\s*(?:miles?|mi)/i);
        const hoursMatch = rawStats.match(/(\d+)\s*(?:hrs?|hours?)/i);
        const minsMatch = rawStats.match(/(\d+)\s*(?:mins?|minutes?)/i);

        const miles = milesMatch ? `${milesMatch[1]} mi` : '';
        let timeStr = '';
        if (hoursMatch && minsMatch) {
            timeStr = `${hoursMatch[1]}h ${minsMatch[1]}m`;
        } else if (hoursMatch) {
            timeStr = `${hoursMatch[1]}h`;
        } else if (minsMatch) {
            timeStr = `${minsMatch[1]}m`;
        }

        if (miles && timeStr) {
            return `${miles} • ${timeStr}`;
        }
        return miles || timeStr || rawStats;
    }

    // --- Pre-Trip Morning Checklist Management ---

    function getChecklistState(dayNumber) {
        try {
            const raw = localStorage.getItem(`convoy_checklist_day_${dayNumber}`);
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return DEFAULT_CHECKLIST.map(() => false);
    }

    function saveChecklistState(dayNumber, state) {
        try {
            localStorage.setItem(`convoy_checklist_day_${dayNumber}`, JSON.stringify(state));
        } catch (e) {}
    }

    function renderChecklist(dayNumber) {
        if (!checklistItemsContainer || !checklistProgressBadge) return;
        
        const state = getChecklistState(dayNumber);
        const completedCount = state.filter(Boolean).length;
        const totalCount = DEFAULT_CHECKLIST.length;

        checklistProgressBadge.textContent = `${completedCount}/${totalCount} Done`;
        if (completedCount === totalCount) {
            checklistProgressBadge.className = 'checklist-badge checklist-badge-complete';
            checklistProgressBadge.textContent = `All ${totalCount} Checked ✓`;
        } else {
            checklistProgressBadge.className = 'checklist-badge';
        }

        checklistItemsContainer.innerHTML = '';
        DEFAULT_CHECKLIST.forEach((text, idx) => {
            const isChecked = !!state[idx];
            const itemRow = document.createElement('label');
            itemRow.className = `checklist-item ${isChecked ? 'checked' : ''}`;
            itemRow.innerHTML = `
                <input type="checkbox" class="checklist-checkbox" data-index="${idx}" ${isChecked ? 'checked' : ''}>
                <span class="checklist-text">${text}</span>
            `;

            const checkbox = itemRow.querySelector('input');
            checkbox.addEventListener('change', () => {
                state[idx] = checkbox.checked;
                saveChecklistState(dayNumber, state);
                renderChecklist(dayNumber);
            });

            checklistItemsContainer.appendChild(itemRow);
        });
    }

    // --- Air Quality & Sinus Relief Tracker ---
    const aqiCache = new Map();

    async function fetchAirQuality(lat, lon) {
        const cacheKey = `${lat.toFixed(2)}_${lon.toFixed(2)}`;
        const cached = aqiCache.get(cacheKey);
        const now = Date.now();
        if (cached && (now - cached.timestamp < 30 * 60 * 1000)) {
            return cached.data;
        }
        
        try {
            const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=us_aqi,pm2_5,ozone&timezone=auto&forecast_days=7`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                aqiCache.set(cacheKey, { data: data.hourly, timestamp: now });
                return data.hourly;
            }
        } catch (err) {
            console.warn('[Air Quality] Fetch error:', err);
        }
        return null;
    }

    function evaluateAirQuality(aqiHourly, destCoords, startCoords, dayNumber) {
        const lon = destCoords ? destCoords.lon : -95;
        const lat = destCoords ? destCoords.lat : 35;
        
        let aqiVal = null;
        if (aqiHourly && aqiHourly.us_aqi && aqiHourly.us_aqi.length > 0) {
            const valid = aqiHourly.us_aqi.filter(v => v !== null && !isNaN(v));
            if (valid.length > 0) {
                aqiVal = Math.round(valid.slice(0, 12).reduce((a, b) => a + b, 0) / Math.min(12, valid.length));
            }
        }

        let stage = 'warning';
        let statusText = 'Humid / High Mold & Pollen';
        let sinusScore = 40;
        let icon = 'alert-circle';
        let detail = 'High relative humidity and dense airborne allergens. Keep AC on recirculate.';

        if (dayNumber === 1) {
            stage = 'warning';
            sinusScore = 42;
            statusText = 'High Humidity & Forest Mold';
            icon = 'droplet';
            detail = 'Southeast summer moisture. Keep cabin air filtration on recirculate.';
        } else if (dayNumber === 2) {
            stage = 'transition';
            sinusScore = 65;
            statusText = 'Decreasing Humidity & Drying Air';
            icon = 'wind';
            detail = 'Entering the dry Plains corridor. Relative humidity drops sharply past OKC into NM.';
        } else if (dayNumber === 3) {
            stage = 'breakthrough';
            sinusScore = 88;
            statusText = 'Alpine Arid & High Desert Pine';
            icon = 'sparkles';
            detail = 'High plateau (6,900 ft). Crisp, low humidity and high pollen dispersion.';
        } else if (dayNumber === 4) {
            stage = 'breakthrough';
            sinusScore = 85;
            statusText = 'Dry Mojave Air & High Pass Clarity';
            icon = 'sparkles';
            detail = 'Very dry desert atmosphere. Minimal allergen triggers; keep hydrated.';
        } else if (dayNumber === 5) {
            stage = 'transition';
            sinusScore = 78;
            statusText = 'Sacramento Valley Agricultural Transit';
            icon = 'wind';
            detail = 'Warm Central Valley air; clears rapidly into Shasta Cascade pines.';
        } else if (dayNumber === 6) {
            stage = 'pristine';
            sinusScore = 98;
            statusText = 'Pristine Pacific Northwest Mountain Air';
            icon = 'sparkles';
            detail = 'Mountain pine air, cool ambient temps, and lowest particulate index.';
        }

        if (aqiVal !== null) {
            if (aqiVal <= 30) {
                statusText += ` (AQI ${aqiVal} • Clean)`;
            } else if (aqiVal <= 50) {
                statusText += ` (AQI ${aqiVal} • Good)`;
            } else {
                statusText += ` (AQI ${aqiVal} • Moderate)`;
            }
        }

        return { stage, statusText, sinusScore, icon, detail, aqiVal };
    }

    function renderSinusReliefBanner(dayNumber) {
        const bannerContainer = document.getElementById('day-sinus-relief-banner');
        if (!bannerContainer) return;

        const milestones = {
            1: {
                title: "Day 1 Stay: Little Rock, AR (Southeast Basin)",
                stage: "stage-warning",
                badge: "20% Overall Relief",
                badgeClass: "badge-orange",
                icon: "droplet",
                progress: 20
            },
            2: {
                title: "Day 2 Stay: Amarillo, TX (High Plains 3,600 ft)",
                stage: "stage-transition",
                badge: "40% Overall Relief",
                badgeClass: "badge-accent",
                icon: "wind",
                progress: 40
            },
            3: {
                title: "Day 3 Stay: Flagstaff, AZ (Alpine Plateau 6,900 ft)",
                stage: "stage-breakthrough",
                badge: "65% Overall Relief",
                badgeClass: "badge-green",
                icon: "sparkles",
                progress: 65
            },
            4: {
                title: "Day 4 Stay: Bakersfield, CA (Mojave & Tehachapi Pass)",
                stage: "stage-breakthrough",
                badge: "80% Overall Relief",
                badgeClass: "badge-green",
                icon: "sparkles",
                progress: 80
            },
            5: {
                title: "Day 5 Stay: Redding, CA (Shasta Cascade Foothills)",
                stage: "stage-breakthrough",
                badge: "90% Overall Relief",
                badgeClass: "badge-green",
                icon: "sparkles",
                progress: 90
            },
            6: {
                title: "Day 6 Destination: Canyonville, OR (PNW Evergreen)",
                stage: "stage-pristine",
                badge: "100% Full Relief",
                badgeClass: "badge-green",
                icon: "sparkles",
                progress: 100
            }
        };

        const milestone = milestones[dayNumber] || milestones[1];

        bannerContainer.innerHTML = `
            <div class="sinus-relief-banner ${milestone.stage}">
                <div class="sinus-banner-header">
                    <div class="sinus-banner-title-group">
                        <div class="sinus-banner-icon-badge">
                            <i data-lucide="${milestone.icon}"></i>
                        </div>
                        <span class="sinus-banner-title">Sinus Ease: ${milestone.title.replace('Allergy Milestone: ', '')}</span>
                    </div>
                    <span class="sinus-meter-pill">${milestone.badge}</span>
                </div>
                <div class="sinus-progress-container">
                    <div class="sinus-progress-labels">
                        <span>Clean-Air Progress</span>
                        <span>${milestone.progress}%</span>
                    </div>
                    <div class="sinus-progress-bar-bg">
                        <div class="sinus-progress-bar-fill" style="width: ${milestone.progress}%"></div>
                    </div>
                </div>
            </div>
        `;
        lucide.createIcons();
    }

    // --- Weather Mapping Helpers (with Semantic Colors) ---
    function getWeatherInfo(code) {
        if (code === 0) return { icon: 'sun', text: 'Clear Skies', color: '#ffd60a' }; // Sunny warm yellow
        if (code === 1) return { icon: 'sun-medium', text: 'Mainly Clear', color: '#ffd60a' }; // Sunny warm yellow
        if (code === 2) return { icon: 'cloud-sun', text: 'Partly Cloudy', color: '#ffb340' }; // Warm gold
        if (code === 3) return { icon: 'cloud', text: 'Overcast', color: '#98989d' }; // Slate grey
        if (code >= 45 && code <= 48) return { icon: 'cloud-fog', text: 'Fog / Low Vis', color: '#8e8e93' }; // Fog grey
        if (code >= 51 && code <= 55) return { icon: 'cloud-drizzle', text: 'Drizzle', color: '#64d2ff' }; // Sky blue
        if (code >= 61 && code <= 65) return { icon: 'cloud-rain', text: 'Rain Showers', color: '#0a84ff' }; // Rain blue
        if (code >= 71 && code <= 77) return { icon: 'cloud-snow', text: 'Snow / Flurries', color: '#a0e7ff' }; // Ice blue
        if (code >= 80 && code <= 82) return { icon: 'cloud-rain', text: 'Heavy Showers', color: '#0062cc' }; // Deep blue
        if (code >= 95) return { icon: 'cloud-lightning', text: 'Thunderstorms', color: '#ff9f0a' }; // Amber warning
        return { icon: 'sun', text: 'Clear', color: '#ffd60a' };
    }

    // --- Weather Fetching & Caching ---

    async function getCoordinates(address, fallbackAddress, defaultCoords) {
        const query = address || fallbackAddress;
        if (!query) return defaultCoords || { lat: 35.0, lon: -95.0 };

        const cached = geocodeCache.get(query);
        if (cached) return cached;

        try {
            const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                if (data.results && data.results.length > 0) {
                    const coords = {
                        lat: data.results[0].latitude,
                        lon: data.results[0].longitude
                    };
                    geocodeCache.set(query, coords);
                    return coords;
                }
            }
        } catch (e) {
            console.warn('[Geocoding] Fallback for:', address, e);
        }

        return defaultCoords || { lat: 35.0, lon: -95.0 };
    }

    async function fetchHourlyForecast(lat, lon) {
        const cacheKey = `${lat.toFixed(2)}_${lon.toFixed(2)}`;
        const cached = weatherCache.get(cacheKey);
        const now = Date.now();

        // 30 minute cache expiration
        if (cached && (now - cached.timestamp < 30 * 60 * 1000)) {
            return cached.data;
        }

        const url = `https://api.open-meteo.com/v1/gfs?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m,apparent_temperature&daily=sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=16`;
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Open-Meteo HTTP error ${res.status}`);
        }
        const data = await res.json();
        
        weatherCache.set(cacheKey, {
            data: { hourly: data.hourly, daily: data.daily },
            timestamp: now
        });

        return { hourly: data.hourly, daily: data.daily };
    }

    function extractTransitStats(hourly, dateStr, startHour, endHour) {
        if (!hourly || !hourly.time || hourly.time.length === 0) return null;

        let isLiveForecast = true;
        let indices = [];
        for (let i = 0; i < hourly.time.length; i++) {
            const timeEntry = hourly.time[i];
            if (timeEntry.startsWith(dateStr)) {
                const hour = parseInt(timeEntry.substring(11, 13), 10);
                if (hour >= startHour && hour <= Math.max(startHour, endHour)) {
                    indices.push(i);
                }
            }
        }

        if (indices.length === 0) {
            isLiveForecast = false;
            for (let i = 0; i < Math.min(24, hourly.time.length); i++) {
                const hour = parseInt(hourly.time[i].substring(11, 13), 10);
                if (hour >= startHour && hour <= Math.max(startHour, endHour)) {
                    indices.push(i);
                }
            }
        }

        if (indices.length === 0) {
            indices = [0];
        }

        const temps = indices.map(idx => Math.round(hourly.temperature_2m[idx]));
        const precips = indices.map(idx => hourly.precipitation_probability[idx] || 0);
        const winds = indices.map(idx => Math.round(hourly.wind_speed_10m[idx] || 0));
        const codes = indices.map(idx => hourly.weather_code[idx] || 0);

        const depCode = codes[0];
        const arrCode = codes[codes.length - 1];

        let dominantCode = codes[0];
        let hasHazard = false;
        for (const code of codes) {
            if (code >= 95) { dominantCode = code; hasHazard = true; break; }
            if (code >= 70 && dominantCode < 70) { dominantCode = code; hasHazard = true; }
            if (code >= 50 && dominantCode < 50) { dominantCode = code; hasHazard = true; }
            if (code >= 45 && dominantCode < 45) { dominantCode = code; hasHazard = true; }
        }

        if (!hasHazard) {
            const sortedCodes = [...codes].sort((a, b) => a - b);
            dominantCode = sortedCodes[Math.floor(sortedCodes.length / 2)];
        }

        return {
            depTemp: temps[0],
            arrTemp: temps[temps.length - 1],
            minTemp: Math.min(...temps),
            maxTemp: Math.max(...temps),
            avgTemp: Math.round(temps.reduce((a, b) => a + b, 0) / temps.length),
            maxPrecip: Math.max(...precips),
            maxWind: Math.max(...winds),
            dominantCode,
            depCode,
            arrCode,
            allTemps: temps,
            allCodes: codes,
            isLiveForecast
        };
    }

    async function loadWeatherForActiveDay(day) {
        const targetDate = getDateForDay(day.day_number);

        for (const leg of day.legs) {
            const legId = getLegId(leg);
            const container = document.getElementById(`weather-widget-${legId}`);
            if (!container) continue;

            const startHour = parseTimeToHour(leg.departs);
            const endHour = parseTimeToHour(leg.arrives);

            const customStart = getCustomAddress(legId, 'start');
            const customDest = getCustomAddress(legId, 'dest');

            const startAddress = customStart || leg.start_address || '';
            const destAddress = customDest || leg.destination_address || '';

            const startLocationName = getShortLocationName(startAddress);
            const destLocationName = getShortLocationName(destAddress);

            try {
                const [startCoords, destCoords] = await Promise.all([
                    getCoordinates(startAddress, leg.start_address, leg.start_coords),
                    getCoordinates(destAddress, leg.destination_address, leg.destination_coords)
                ]);

                const [startWeatherObj, destWeatherObj, aqiHourly] = await Promise.all([
                    fetchHourlyForecast(startCoords.lat, startCoords.lon),
                    fetchHourlyForecast(destCoords.lat, destCoords.lon),
                    fetchAirQuality(destCoords.lat, destCoords.lon)
                ]);

                const startHourly = startWeatherObj.hourly;
                const destHourly = destWeatherObj.hourly;

                const aqiInfo = evaluateAirQuality(aqiHourly, destCoords, startCoords, day.day_number);

                const startStats = extractTransitStats(startHourly, targetDate, startHour, endHour);
                const destStats = extractTransitStats(destHourly, targetDate, startHour, endHour);

                if (!startStats || !destStats) {
                    throw new Error('No weather data for window');
                }

                const depTemp = startStats.depTemp;
                const arrTemp = destStats.arrTemp;
                const depCode = startStats.depCode;
                const arrCode = destStats.arrCode;

                const minTemp = Math.min(startStats.minTemp, destStats.minTemp);
                const maxTemp = Math.max(startStats.maxTemp, destStats.maxTemp);
                const avgTemp = Math.round((startStats.avgTemp + destStats.avgTemp) / 2);
                const maxPrecip = Math.max(startStats.maxPrecip, destStats.maxPrecip);
                const maxWind = Math.max(startStats.maxWind, destStats.maxWind);
                const isLiveForecast = startStats.isLiveForecast && destStats.isLiveForecast;

                let dominantCode = startStats.dominantCode;
                const allCodes = [...startStats.allCodes, ...destStats.allCodes];
                let hasHazard = false;
                for (const code of allCodes) {
                    if (code >= 95) { dominantCode = code; hasHazard = true; break; }
                    if (code >= 70 && dominantCode < 70) { dominantCode = code; hasHazard = true; }
                    if (code >= 50 && dominantCode < 50) { dominantCode = code; hasHazard = true; }
                    if (code >= 45 && dominantCode < 45) { dominantCode = code; hasHazard = true; }
                }

                if (!hasHazard) {
                    dominantCode = destStats.dominantCode;
                }

                const cond = getWeatherInfo(dominantCode);
                const depCond = getWeatherInfo(depCode);
                const arrCond = getWeatherInfo(arrCode);

                const getPrecipBadgeClass = (p) => {
                    if (p > 50) return 'badge-danger';
                    if (p > 25) return 'badge-orange';
                    if (p > 10) return 'badge-accent';
                    return 'badge-secondary';
                };

                const getWindBadgeClass = (w) => {
                    if (w >= 30) return 'badge-danger';
                    if (w >= 20) return 'badge-orange';
                    if (w >= 14) return 'badge-accent';
                    return 'badge-secondary';
                };

                const getAQIBadgeClass = (stage) => {
                    if (stage === 'pristine') return 'badge-green';
                    if (stage === 'breakthrough') return 'badge-green';
                    if (stage === 'transition') return 'badge-accent';
                    return 'badge-orange';
                };

                container.innerHTML = `
                    <div class="weather-grid">
                        <div class="weather-endpoint-readout">
                            <div class="endpoint-node">
                                <span class="endpoint-node-label">Depart (${startLocationName}):</span>
                                <span class="endpoint-node-val">
                                    <i data-lucide="${depCond.icon}" style="color: ${depCond.color};"></i>
                                    <strong>${depTemp}°F</strong>
                                    <span class="node-cond-text">(${depCond.text})</span>
                                </span>
                            </div>
                            <div class="endpoint-node">
                                <span class="endpoint-node-label">Arrive (${destLocationName}):</span>
                                <span class="endpoint-node-val">
                                    <i data-lucide="${arrCond.icon}" style="color: ${arrCond.color};"></i>
                                    <strong>${arrTemp}°F</strong>
                                    <span class="node-cond-text">(${arrCond.text})</span>
                                </span>
                            </div>
                        </div>

                        <div class="weather-chips-row">
                            <span class="badge ${getWindBadgeClass(maxWind)}">
                                <i data-lucide="wind"></i>
                                <span>Max Wind ${maxWind} mph</span>
                            </span>
                            <span class="badge ${getPrecipBadgeClass(maxPrecip)}">
                                <i data-lucide="umbrella"></i>
                                <span>Precip ${maxPrecip}%</span>
                            </span>
                            <span class="badge ${getAQIBadgeClass(aqiInfo.stage)}">
                                <i data-lucide="sparkles"></i>
                                <span>Sinus Ease: ${aqiInfo.sinusScore}/100</span>
                            </span>
                            ${!isLiveForecast ? '<span class="badge badge-secondary" title="Simulated seasonal average baseline">Seasonal Baseline</span>' : ''}
                        </div>
                    </div>
                `;
                lucide.createIcons();
            } catch (err) {
                console.warn(`[Weather] Error loading leg ${legId}:`, err);
                container.innerHTML = `
                    <div class="weather-error-badge">
                        <i data-lucide="cloud-off"></i>
                        <span>Weather data temporarily unavailable</span>
                    </div>
                `;
                lucide.createIcons();
            }
        }
    }

    // --- Completion State Management ---

    function getLegId(leg) {
        return `${leg.name.toLowerCase().replace(/\s+/g, '-')}-${leg.departs.replace(/[:\s]/g, '')}`;
    }

    function isLegCompleted(legId) {
        return localStorage.getItem(`convoy_leg_completed_${legId}`) === 'true';
    }

    function toggleLegCompletion(legId) {
        const current = isLegCompleted(legId);
        localStorage.setItem(`convoy_leg_completed_${legId}`, (!current).toString());
        updateOverallProgress();
        renderTabs();
    }

    function isLastLegOfDay(legId) {
        const day = itineraryData.find(d => d.day_number === activeDayNumber);
        if (!day || !day.legs.length) return false;
        const lastLeg = day.legs[day.legs.length - 1];
        return getLegId(lastLeg) === legId;
    }

    function getFirstUncompletedDay() {
        for (const day of itineraryData) {
            const hasUncompleted = day.legs.some(leg => !isLegCompleted(getLegId(leg)));
            if (hasUncompleted) {
                return day.day_number;
            }
        }
        return 1;
    }

    function updateOverallProgress() {
        if (!itineraryData.length) return;

        let totalLegs = 0;
        let completedLegs = 0;

        itineraryData.forEach(day => {
            day.legs.forEach(leg => {
                totalLegs++;
                if (isLegCompleted(getLegId(leg))) {
                    completedLegs++;
                }
            });
        });

        const percentage = Math.round((completedLegs / totalLegs) * 100);
        
        if (progressBarFill) {
            progressBarFill.style.width = `${percentage}%`;
        }
        if (progressText) {
            progressText.textContent = `${percentage}%`;
        }
    }

    function triggerCelebration() {
        if (typeof confetti === 'function') {
            confetti({
                particleCount: 80,
                spread: 70,
                origin: { y: 0.6 }
            });
        }
    }

    // --- Custom Address Overrides ---

    function getCustomAddress(legId, type) {
        return localStorage.getItem(`convoy_custom_addr_${legId}_${type}`);
    }

    function setCustomAddress(legId, type, address) {
        if (!address || address.trim() === '') {
            clearCustomAddress(legId, type);
        } else {
            localStorage.setItem(`convoy_custom_addr_${legId}_${type}`, address.trim());
        }
    }

    function clearCustomAddress(legId, type) {
        localStorage.removeItem(`convoy_custom_addr_${legId}_${type}`);
    }

    // --- Rendering UI ---

    function renderTabs() {
        dayTabsContainer.innerHTML = '';

        itineraryData.forEach(day => {
            const tab = document.createElement('div');
            tab.className = 'day-tab';
            if (day.day_number === activeDayNumber) {
                tab.classList.add('active');
            }
            
            const allCompleted = day.legs.every(leg => isLegCompleted(getLegId(leg)));
            if (allCompleted) {
                tab.classList.add('day-tab-completed');
            }

            const isHome = day.hotel && day.hotel.toLowerCase() === 'home';
            const destinationLabel = isHome ? 'Canyonville (Home)' : (day.hotel || day.end_location);

            tab.innerHTML = `
                <span class="day-tab-num">Day ${day.day_number}</span>
                <span class="day-tab-dest">${destinationLabel}</span>
            `;

            tab.addEventListener('click', () => {
                activeDayNumber = day.day_number;
                activeLegIndex = 0;
                document.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                renderActiveDay();
            });

            dayTabsContainer.appendChild(tab);
        });
    }

    // --- Carousel Navigation & Gesture Management (1-Card Swipe View) ---

    function renderCarouselNav(day) {
        if (!legsCarouselNav) return;
        const totalLegs = day.legs.length;
        if (totalLegs <= 1) {
            legsCarouselNav.style.display = 'none';
            return;
        }
        legsCarouselNav.style.display = 'flex';

        if (activeLegIndex < 0 || activeLegIndex >= totalLegs) {
            activeLegIndex = 0;
        }

        const activeLeg = day.legs[activeLegIndex];

        legsCarouselNav.innerHTML = `
            <div class="carousel-nav-inner">
                <button class="carousel-nav-btn btn-carousel-prev" id="btn-carousel-prev" ${activeLegIndex === 0 ? 'disabled' : ''} title="Previous Stretch">
                    <i data-lucide="chevron-left"></i>
                </button>
                <div class="carousel-indicator-group">
                    <div class="carousel-status-pill">
                        <span class="carousel-stretch-count" id="carousel-stretch-count">Stretch ${activeLegIndex + 1} of ${totalLegs}</span>
                        <span class="carousel-stretch-title" id="carousel-stretch-title">${activeLeg.name}</span>
                    </div>
                    <div class="carousel-dots-wrap" id="carousel-dots-wrap">
                        ${day.legs.map((l, i) => `
                            <button class="carousel-dot ${i === activeLegIndex ? 'active' : ''} ${isLegCompleted(getLegId(l)) ? 'completed' : ''}" data-index="${i}" title="${l.name}"></button>
                        `).join('')}
                    </div>
                </div>
                <button class="carousel-nav-btn btn-carousel-next" id="btn-carousel-next" ${activeLegIndex === totalLegs - 1 ? 'disabled' : ''} title="Next Stretch">
                    <i data-lucide="chevron-right"></i>
                </button>
            </div>
        `;

        const prevBtn = document.getElementById('btn-carousel-prev');
        const nextBtn = document.getElementById('btn-carousel-next');

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                if (activeLegIndex > 0) {
                    scrollToLeg(activeLegIndex - 1, true);
                }
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                if (activeLegIndex < totalLegs - 1) {
                    scrollToLeg(activeLegIndex + 1, true);
                }
            });
        }

        document.querySelectorAll('.carousel-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                const targetIdx = parseInt(dot.getAttribute('data-index'), 10);
                if (!isNaN(targetIdx)) {
                    scrollToLeg(targetIdx, true);
                }
            });
        });
    }

    function updateCarouselIndicators(index, day) {
        if (!day || !day.legs) return;
        const totalLegs = day.legs.length;
        if (index < 0 || index >= totalLegs) return;

        activeLegIndex = index;
        const activeLeg = day.legs[index];

        const countElem = document.getElementById('carousel-stretch-count');
        const titleElem = document.getElementById('carousel-stretch-title');
        const prevBtn = document.getElementById('btn-carousel-prev');
        const nextBtn = document.getElementById('btn-carousel-next');

        if (countElem) countElem.textContent = `Stretch ${index + 1} of ${totalLegs}`;
        if (titleElem) titleElem.textContent = activeLeg.name;
        if (prevBtn) prevBtn.disabled = index === 0;
        if (nextBtn) nextBtn.disabled = index === totalLegs - 1;

        document.querySelectorAll('.carousel-dot').forEach((dot, i) => {
            if (i === index) {
                dot.classList.add('active');
            } else {
                dot.classList.remove('active');
            }
            if (isLegCompleted(getLegId(day.legs[i]))) {
                dot.classList.add('completed');
            } else {
                dot.classList.remove('completed');
            }
        });
    }

    function scrollToLeg(index, smooth = true) {
        const cards = legsContainer.querySelectorAll('.leg-card');
        if (cards[index]) {
            activeLegIndex = index;
            cards[index].scrollIntoView({
                behavior: smooth ? 'smooth' : 'auto',
                inline: 'start',
                block: 'nearest'
            });
            const currentDay = itineraryData.find(d => d.day_number === activeDayNumber);
            if (currentDay) {
                updateCarouselIndicators(index, currentDay);
            }
        }
    }

    function renderActiveDay() {
        const day = itineraryData.find(d => d.day_number === activeDayNumber);
        if (!day) return;

        const dayDateStr = getDateForDay(day.day_number);

        // Render Day Header Details
        activeDayBadge.textContent = `Day ${day.day_number} • ${dayDateStr}`;
        activeDayTitle.textContent = day.title;
        activeDayTarget.textContent = day.target;

        if (day.hotel) {
            activeDayOvernightContainer.style.display = 'block';
            activeDayHotel.textContent = day.hotel;
            
            if (activeDayHotelDetails) {
                if (day.hotel_info) {
                    activeDayHotelDetails.innerHTML = `
                        <div class="hotel-notes-line"><i data-lucide="truck"></i> <span>${day.hotel_info.parking_note}</span></div>
                        <div class="hotel-notes-line"><i data-lucide="coffee"></i> <span>${day.hotel_info.breakfast}</span></div>
                    `;
                } else {
                    activeDayHotelDetails.innerHTML = '';
                }
            }
        } else {
            activeDayOvernightContainer.style.display = 'none';
        }

        // Render Pre-Trip Checklist
        renderChecklist(day.day_number);

        // Render Sinus Relief & Clean Air Milestone Banner
        renderSinusReliefBanner(day.day_number);

        // Render Legs
        legsContainer.innerHTML = '';

        // Auto-select first uncompleted leg if available
        const uncompletedIdx = day.legs.findIndex(l => !isLegCompleted(getLegId(l)));
        if (uncompletedIdx !== -1) {
            activeLegIndex = uncompletedIdx;
        } else if (activeLegIndex >= day.legs.length) {
            activeLegIndex = 0;
        }
        
        day.legs.forEach((leg, index) => {
            const legId = getLegId(leg);
            const isCompleted = isLegCompleted(legId);
            const isLastLeg = index === day.legs.length - 1;
            
            const customStart = getCustomAddress(legId, 'start');
            const customDest = getCustomAddress(legId, 'dest');
            
            const activeStart = customStart || leg.start_address || '';
            const activeDest = customDest || leg.destination_address || '';

            // Parse Route Path and Transit Stats
            const openParenIndex = leg.route_details.lastIndexOf('(');
            let routePath = leg.route_details;
            let transitStats = null;
            
            if (openParenIndex !== -1) {
                routePath = leg.route_details.substring(0, openParenIndex).trim();
                const closeParenIndex = leg.route_details.lastIndexOf(')');
                if (closeParenIndex !== -1 && closeParenIndex > openParenIndex) {
                    transitStats = leg.route_details.substring(openParenIndex + 1, closeParenIndex).trim();
                }
            }

            // Create Leg Card wrapper
            const card = document.createElement('div');
            card.className = `leg-card ${isCompleted ? 'completed' : ''}`;
            card.id = `leg-card-${legId}`;

            // Build Top Stretch Name Header Banner (Above Start Directions)
            const isFinalStretch = isLastLeg && !isCompleted;
            const stretchHeaderHTML = `
                <div class="leg-stretch-banner ${isFinalStretch ? 'is-final-stretch' : ''}">
                    <i data-lucide="${isFinalStretch ? 'flag' : 'compass'}"></i>
                    <span>${leg.name}${isFinalStretch ? ' — Final Stretch to Hotel' : ''}</span>
                </div>
            `;

            // Resolve Facility Information
            const destFacility = getFacilityInfo(leg.destination_type);
            const destIcon = destFacility.icon;
            const destLabel = destFacility.label;

            let startAddressHTML = '';
            if (activeStart) {
                const startFacility = (index === 0) 
                    ? { icon: 'map-pin' } 
                    : (day.legs[index-1] ? getFacilityInfo(day.legs[index-1].destination_type) : { icon: 'map-pin' });
                
                startAddressHTML = `
                    <div class="waypoint-subcard waypoint-start">
                        <div class="waypoint-subcard-header">
                            <div class="waypoint-venue-name">
                                <i data-lucide="circle-dot" style="color: var(--primary);"></i>
                                <strong>${leg.start_name || 'Origin'}</strong>
                            </div>
                            <button class="btn-edit-address" data-leg-id="${legId}" data-type="start" data-original="${leg.start_address || ''}" title="Edit Origin Address">
                                <i data-lucide="pencil"></i>
                            </button>
                        </div>
                        <p class="waypoint-address-text">${activeStart}</p>
                    </div>
                `;
            }

            // Amenities HTML
            let amenitiesHTML = '';
            if (leg.amenities && leg.amenities.length > 0) {
                amenitiesHTML = `
                    <div class="waypoint-amenities-row">
                        ${leg.amenities.map(a => `<span class="amenity-badge">${a}</span>`).join('')}
                    </div>
                `;
            }

            let destAddressHTML = '';
            if (activeDest) {
                const destIconColor = (leg.destination_type === 'hotel') ? '#66d9ef' : ((leg.destination_type === 'home') ? '#ff9f0a' : 'var(--green)');
                destAddressHTML = `
                    <div class="waypoint-subcard waypoint-dest">
                        <div class="waypoint-subcard-header">
                            <div class="waypoint-venue-name waypoint-dest-name">
                                <i data-lucide="${destIcon}" style="color: ${destIconColor};"></i>
                                <strong>${leg.destination_name || 'Destination'}</strong>
                                ${customDest ? '<span class="badge badge-orange">Edited</span>' : ''}
                            </div>
                            <button class="btn-edit-address" data-leg-id="${legId}" data-type="dest" data-original="${leg.destination_address || ''}" title="Edit Destination Address">
                                <i data-lucide="pencil"></i>
                            </button>
                        </div>
                        <p class="waypoint-address-text">${activeDest}</p>
                        ${amenitiesHTML}
                    </div>
                `;
            }

            // Route Contextual Badges
            let contextualBadgesHTML = '';
            if (transitStats) {
                const durationColorClass = getDurationPillClass(transitStats);
                const compactStats = formatCompactTransitStats(transitStats);
                contextualBadgesHTML += `
                    <div class="stats-pill ${durationColorClass}">
                        <i data-lucide="car"></i>
                        <span>${compactStats}</span>
                    </div>
                `;
            }
            if (leg.fuel_stint_miles) {
                contextualBadgesHTML += `
                    <div class="stats-pill stats-pill-fuel" title="Planned Stint Mileage">
                        <i data-lucide="fuel"></i>
                        <span>${leg.fuel_stint_miles} mi Stint</span>
                    </div>
                `;
            }
            if (leg.timezone_change) {
                contextualBadgesHTML += `
                    <div class="stats-pill stats-pill-tz" title="Time Zone Shift">
                        <i data-lucide="clock"></i>
                        <span>${leg.timezone_change}</span>
                    </div>
                `;
            }
            if (leg.pass_name) {
                contextualBadgesHTML += `
                    <div class="stats-pill stats-pill-pass" title="Mountain Pass">
                        <i data-lucide="mountain"></i>
                        <span>${leg.pass_name}</span>
                    </div>
                `;
            }

            card.innerHTML = `
                <!-- 1. TOP STRETCH NAME HEADER BANNER -->
                ${stretchHeaderHTML}
                
                <!-- 2. TOP HERO NAVIGATION ACTION BUTTON -->
                ${activeDest ? `
                <div class="top-nav-action-bar">
                    <button class="btn btn-green btn-nav-directions btn-nav-primary" data-destination="${activeDest}">
                        <i data-lucide="navigation"></i>
                        <span>Start Directions</span>
                    </button>
                </div>
                ` : ''}

                <!-- 3. LEG METADATA HEADER (Order Badge & Time Window) -->
                <div class="leg-card-header">
                    <div class="leg-header-left">
                        <span class="leg-order-badge">Leg ${index + 1}</span>
                    </div>
                    <div class="leg-header-right">
                        <span class="leg-time-window">
                            <i data-lucide="clock"></i>
                            <span>${leg.departs} – ${leg.arrives}</span>
                        </span>
                    </div>
                </div>

                <!-- 4. SECTION: 📍 WAYPOINTS & ADDRESSES -->
                <div class="leg-section-box section-waypoints">
                    <div class="card-section-label">
                        <i data-lucide="map-pin"></i>
                        <span>Waypoints & Addresses</span>
                    </div>
                    <div class="waypoints-grid">
                        ${startAddressHTML}
                        ${destAddressHTML}
                    </div>
                </div>

                <!-- 5. SECTION: 🗺️ ROUTE DETAILS & STRATEGY -->
                <div class="leg-section-box section-route">
                    <div class="card-section-label">
                        <i data-lucide="compass"></i>
                        <span>Route Details & Strategy</span>
                    </div>
                    <div class="route-badges-wrap">
                        ${contextualBadgesHTML}
                    </div>
                    ${leg.operational_notes ? `
                    <div class="route-notes-box">
                        <p class="notes-text">${leg.operational_notes}</p>
                    </div>
                    ` : ''}
                </div>

                <!-- 6. SECTION: 🌤️ WEATHER & SINUS EASE -->
                <div class="leg-section-box section-weather">
                    <div class="card-section-label">
                        <i data-lucide="cloud-sun"></i>
                        <span>Weather & Sinus Ease</span>
                    </div>
                    <div class="weather-widget" id="weather-widget-${legId}">
                        <div class="weather-skeleton">
                            <div class="skeleton-line skeleton-short"></div>
                            <div class="skeleton-line skeleton-long"></div>
                        </div>
                    </div>
                </div>

                <!-- 7. CARD FOOTER -->
                <div class="leg-card-footer">
                    <button class="btn btn-completion btn-toggle-completion" data-leg-id="${legId}">
                        <i data-lucide="${isCompleted ? 'check-square' : 'square'}"></i>
                        <span>${isCompleted ? 'Completed' : 'Mark as Done'}</span>
                    </button>
                </div>
            `;

            // Append card
            legsContainer.appendChild(card);
        });

        // Render Carousel Navigation & Indicator Bar
        renderCarouselNav(day);

        // Add event listeners to newly created card elements
        setupCardEventListeners();

        // Refresh icons inside dynamically rendered legs & carousel nav
        lucide.createIcons();

        // Position Carousel at the active stretch card
        setTimeout(() => {
            scrollToLeg(activeLegIndex, false);
        }, 50);

        // Load dynamic road weather for the active day's legs
        loadWeatherForActiveDay(day);
    }

    // --- Event Listeners Setup ---

    function setupGlobalEventListeners() {
        // Horizontal Carousel Scroll Snap Tracking
        let carouselScrollTimer = null;
        if (legsContainer) {
            legsContainer.addEventListener('scroll', () => {
                if (carouselScrollTimer) clearTimeout(carouselScrollTimer);
                carouselScrollTimer = setTimeout(() => {
                    const cardWidth = legsContainer.offsetWidth;
                    if (cardWidth > 0) {
                        const scrollLeft = legsContainer.scrollLeft;
                        const newIndex = Math.round(scrollLeft / cardWidth);
                        const currentDay = itineraryData.find(d => d.day_number === activeDayNumber);
                        if (currentDay && newIndex >= 0 && newIndex < currentDay.legs.length && newIndex !== activeLegIndex) {
                            updateCarouselIndicators(newIndex, currentDay);
                        }
                    }
                }, 60);
            }, { passive: true });
        }

        // Trip Start Date Picker control
        const dateControl = document.getElementById('trip-date-control');
        if (dateControl && tripDateInput) {
            dateControl.addEventListener('click', (e) => {
                if (e.target !== tripDateInput) {
                    try {
                        if (typeof tripDateInput.showPicker === 'function') {
                            tripDateInput.showPicker();
                        } else {
                            tripDateInput.focus();
                        }
                    } catch (err) {
                        tripDateInput.focus();
                    }
                }
            });
        }

        if (tripDateInput) {
            tripDateInput.addEventListener('change', (e) => {
                if (e.target.value) {
                    localStorage.setItem('convoy_trip_start_date', e.target.value);
                    weatherCache.clear();
                    renderActiveDay();
                }
            });
        }

        // Pre-Trip Checklist Drawer Toggle
        if (toggleChecklistBtn && checklistDrawer && checklistChevron) {
            toggleChecklistBtn.addEventListener('click', () => {
                const isCollapsed = checklistDrawer.classList.toggle('collapsed');
                checklistChevron.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)';
            });
        }

        // Convoy Hub Modal triggers
        if (convoyHubBtn && convoyHubModal) {
            convoyHubBtn.addEventListener('click', () => convoyHubModal.classList.add('active'));
            if (closeConvoyHubBtn) closeConvoyHubBtn.addEventListener('click', () => convoyHubModal.classList.remove('active'));
            if (closeConvoyHubFooterBtn) closeConvoyHubFooterBtn.addEventListener('click', () => convoyHubModal.classList.remove('active'));
        }

        // PDF Modal triggers
        const pdfFrame = document.getElementById('pdf-frame');

        if (viewPdfBtn && pdfModal) {
            viewPdfBtn.addEventListener('click', () => {
                if (pdfFrame && (!pdfFrame.src || pdfFrame.src === 'about:blank' || pdfFrame.src.endsWith('about:blank'))) {
                    pdfFrame.src = pdfFrame.getAttribute('data-src') || 'itinerary.pdf';
                }
                pdfModal.classList.add('active');
            });
        }
        
        const closePDF = () => {
            if (pdfModal) {
                pdfModal.classList.remove('active');
                if (pdfFrame) {
                    pdfFrame.src = 'about:blank';
                }
            }
        };
        
        if (closePdfBtn) closePdfBtn.addEventListener('click', closePDF);
        if (closePdfFooterBtn) closePdfFooterBtn.addEventListener('click', closePDF);

        // Edit Modal triggers
        const closeEdit = () => {
            editModal.classList.remove('active');
            addressTextarea.value = '';
        };
        closeEditBtn.addEventListener('click', closeEdit);
        cancelEditBtn.addEventListener('click', closeEdit);

        // Save Custom Address
        saveAddressBtn.addEventListener('click', () => {
            const { legId, type } = currentEditTarget;
            const newValue = addressTextarea.value;
            setCustomAddress(legId, type, newValue);
            closeEdit();
            renderActiveDay();
        });

        // Reset Custom Address
        resetAddressBtn.addEventListener('click', () => {
            const { legId, type } = currentEditTarget;
            clearCustomAddress(legId, type);
            closeEdit();
            renderActiveDay();
        });

        // Close modal when clicking outside modal-card or pressing Escape
        window.addEventListener('click', (e) => {
            if (e.target === pdfModal) closePDF();
            if (e.target === editModal) closeEdit();
            if (e.target === convoyHubModal) convoyHubModal.classList.remove('active');
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (pdfModal && pdfModal.classList.contains('active')) closePDF();
                if (editModal && editModal.classList.contains('active')) closeEdit();
                if (convoyHubModal && convoyHubModal.classList.contains('active')) convoyHubModal.classList.remove('active');
            }
        });
    }

    function setupDragToScroll() {
        const slider = document.querySelector('.day-tabs-nav');
        if (!slider) return;

        let isDown = false;
        let startX = 0;
        let scrollLeft = 0;
        let isDragging = false;

        slider.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'mouse' || e.button !== 0) return;
            isDown = true;
            isDragging = false;
            startX = e.pageX - slider.offsetLeft;
            scrollLeft = slider.scrollLeft;
        });

        const endDrag = () => {
            if (!isDown) return;
            isDown = false;
            slider.style.cursor = '';
            setTimeout(() => { isDragging = false; }, 50);
        };

        window.addEventListener('pointerup', endDrag);
        window.addEventListener('pointercancel', endDrag);

        slider.addEventListener('pointermove', (e) => {
            if (!isDown || e.pointerType !== 'mouse') return;
            const x = e.pageX - slider.offsetLeft;
            const walk = (x - startX) * 1.5;
            if (Math.abs(walk) > 5) {
                isDragging = true;
                slider.style.cursor = 'grabbing';
                e.preventDefault();
                slider.scrollLeft = scrollLeft - walk;
            }
        });

        slider.addEventListener('click', (e) => {
            if (isDragging) {
                e.preventDefault();
                e.stopPropagation();
                isDragging = false;
            }
        }, true);
    }

    function setupCardEventListeners() {
        // Completion button toggle
        document.querySelectorAll('.btn-toggle-completion').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const legId = btn.getAttribute('data-leg-id');
                
                const card = document.getElementById(`leg-card-${legId}`);
                if (card) {
                    card.style.transform = 'scale(0.99)';
                    card.style.opacity = '0.7';
                }

                setTimeout(() => {
                    const wasCompleted = isLegCompleted(legId);
                    toggleLegCompletion(legId);
                    
                    const day = itineraryData.find(d => d.day_number === activeDayNumber);
                    if (!wasCompleted && isLastLegOfDay(legId)) {
                        triggerCelebration();
                    }

                    // Auto-advance to the next stretch if completing this one
                    if (!wasCompleted && day && activeLegIndex < day.legs.length - 1) {
                        activeLegIndex = activeLegIndex + 1;
                    }

                    renderActiveDay();
                }, 150);
            });
        });

        // Address Edit Modal launch
        document.querySelectorAll('.btn-edit-address').forEach(btn => {
            btn.addEventListener('click', () => {
                const legId = btn.getAttribute('data-leg-id');
                const type = btn.getAttribute('data-type');
                const original = btn.getAttribute('data-original');
                
                currentEditTarget = { legId, type, originalAddress: original };
                
                const currentValue = getCustomAddress(legId, type) || original;
                addressTextarea.value = currentValue;
                
                editModalTitle.textContent = `Edit ${type === 'start' ? 'Start' : 'Destination'} Address`;
                
                editModal.classList.add('active');
                addressTextarea.focus();
            });
        });

        // Navigate via Deep-Link Directions
        document.querySelectorAll('.btn-nav-directions').forEach(btn => {
            btn.addEventListener('click', () => {
                const destination = btn.getAttribute('data-destination');
                
                const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
                
                let mapsUrl = '';
                if (isApple) {
                    mapsUrl = `maps://?daddr=${encodeURIComponent(destination)}&dirflg=d`;
                } else {
                    mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
                }
                
                window.open(mapsUrl, '_blank');
            });
        });
    }
});
