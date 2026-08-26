/**
 * Convoy Lead - Core Logic, Weather Integration & State Management
 * Technology: Vanilla ES6+ Javascript
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Application State ---
    let itineraryData = [];
    let activeDayNumber = 1;
    
    // In-memory weather cache & geocoding cache
    const weatherCache = new Map();
    const geocodeCache = new Map();

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
    const activeDayOvernightContainer = document.getElementById('active-day-overnight-container');
    const legsContainer = document.getElementById('legs-container');
    
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressText = document.getElementById('progress-text');
    const tripDateInput = document.getElementById('trip-start-date');

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

    function getShortLocationName(address) {
        if (!address) return '';
        const parts = address.split(',').map(s => s.trim());
        if (parts.length >= 3) {
            // e.g. "1855 US Highway 72 E", "Huntsville", "AL 35811" -> "Huntsville, AL"
            const city = parts[parts.length - 2];
            const stateZip = parts[parts.length - 1].split(' ')[0];
            return `${city}, ${stateZip}`;
        } else if (parts.length === 2) {
            // e.g. "Canton, GA" -> "Canton, GA"
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
        
        // Duration criteria:
        // Pushing past 3.5 hrs (> 210 mins): Red
        // More than 2 hours (> 120 mins): Orange
        // Between 1 and 2 hours (<= 120 mins): Green
        if (totalMinutes > 210) {
            return 'stats-pill-red';
        } else if (totalMinutes > 120) {
            return 'stats-pill-orange';
        } else {
            return 'stats-pill-green';
        }
    }

    // --- Weather Mapping & Blurb Generator ---

    function getWeatherInfo(code) {
        switch (code) {
            case 0:
                return { text: 'Clear Sky', icon: 'sun' };
            case 1:
                return { text: 'Mainly Clear', icon: 'sun' };
            case 2:
                return { text: 'Partly Cloudy', icon: 'cloud-sun' };
            case 3:
                return { text: 'Overcast', icon: 'cloud' };
            case 45:
            case 48:
                return { text: 'Foggy', icon: 'cloud-fog' };
            case 51:
            case 53:
            case 55:
                return { text: 'Drizzle', icon: 'cloud-drizzle' };
            case 56:
            case 57:
                return { text: 'Freezing Drizzle', icon: 'cloud-snow' };
            case 61:
                return { text: 'Light Rain', icon: 'cloud-rain' };
            case 63:
                return { text: 'Moderate Rain', icon: 'cloud-rain' };
            case 65:
                return { text: 'Heavy Rain', icon: 'cloud-rain' };
            case 66:
            case 67:
                return { text: 'Freezing Rain', icon: 'cloud-rain' };
            case 71:
            case 73:
            case 75:
            case 77:
                return { text: 'Snow', icon: 'snowflake' };
            case 80:
            case 81:
            case 82:
                return { text: 'Rain Showers', icon: 'cloud-rain' };
            case 85:
            case 86:
                return { text: 'Snow Showers', icon: 'snowflake' };
            case 95:
                return { text: 'Thunderstorm', icon: 'cloud-lightning' };
            case 96:
            case 99:
                return { text: 'Thunderstorm w/ Hail', icon: 'cloud-lightning' };
            default:
                return { text: 'Clear', icon: 'sun' };
        }
    }

    function generateConditionBlurb(stats, leg, startCoords, destCoords, startLoc, destLoc) {
        const { minTemp, maxTemp, avgTemp, maxPrecip, maxWind, dominantCode, depTemp, arrTemp, depCode, arrCode } = stats;
        const weather = getWeatherInfo(dominantCode);
        const depWeather = getWeatherInfo(depCode);
        const arrWeather = getWeatherInfo(arrCode);

        // Check mountain pass conditions (Flagstaff / Siskiyous / Tehachapi)
        const isMountainPass = (startCoords && (startCoords.lat >= 35 && startCoords.lon <= -111)) ||
                              (destCoords && (destCoords.lat >= 35 && destCoords.lon <= -111));

        // 1. Severe / Thunderstorms
        if (dominantCode >= 95) {
            return `Thunderstorm activity expected along the ${startLoc} \u2192 ${destLoc} transit corridor (precip probability up to ${maxPrecip}% and gusts near ${maxWind} mph). Increase caravan following distance, reduce cruising speed, and monitor radar check-ins.`;
        }

        // 2. Snow / Freezing / Winter Conditions
        if ((dominantCode >= 71 && dominantCode <= 86) || (dominantCode >= 56 && dominantCode <= 57) || minTemp <= 32) {
            const passNote = isMountainPass ? 'pass traction advisories' : 'traction conditions';
            return `Freezing road conditions possible between ${startLoc} and ${destLoc} with temperatures down to ${minTemp}°F. Check mountain ${passNote}, maintain steady headway, and watch for black ice on elevated overpasses.`;
        }

        // 3. Rain / Showers
        if (dominantCode >= 61 || dominantCode === 80 || dominantCode === 81 || dominantCode === 82 || maxPrecip >= 40) {
            return `Wet pavement anticipated during transit with ${weather.text.toLowerCase()} (${maxPrecip}% chance) and temperatures shifting from ${depTemp}°F at ${startLoc} to ${arrTemp}°F at ${destLoc}. Ensure wipers and low-beams are active with extra stopping distance.`;
        }

        // 4. Fog / Low Visibility
        if (dominantCode === 45 || dominantCode === 48) {
            return `Morning fog and reduced visibility expected along this stretch (${startLoc} to ${destLoc}). Temps hovering around ${avgTemp}°F with gentle winds (${maxWind} mph). Use low-beam lighting and announce waypoint maneuvers over radio.`;
        }

        // 5. High Heat (Geographically Context-Aware)
        if (maxTemp >= 90) {
            const windNote = maxWind >= 15 ? ` along with ${maxWind} mph crosswinds` : '';
            
            // Determine geographic heat context
            let heatType = 'High afternoon heat';
            const avgLon = destCoords ? (startCoords ? (startCoords.lon + destCoords.lon) / 2 : destCoords.lon) : -95;
            const avgLat = destCoords ? (startCoords ? (startCoords.lat + destCoords.lat) / 2 : destCoords.lat) : 35;

            if (avgLon > -95) {
                heatType = 'Hot and humid summer conditions';
            } else if (avgLon <= -95 && avgLon >= -118.5 && avgLat <= 36.5) {
                heatType = 'High desert heat';
            } else if (avgLat >= 36.5 && avgLon <= -119) {
                heatType = 'Warm Central Valley heat';
            }

            return `${heatType} reaching ${maxTemp}°F${windNote} between ${startLoc} (${depTemp}°F) and ${destLoc} (${arrTemp}°F). Keep vehicle engine temperatures and tire pressures monitored, ensure AC systems are functioning, and keep caravan hydration ready.`;
        }

        // 6. High Wind / Mountain Crosswinds
        if (maxWind >= 18) {
            return `Breezy open corridor from ${startLoc} to ${destLoc} with steady crosswinds reaching ${maxWind} mph. Temperatures shifting from ${depTemp}°F to ${arrTemp}°F. High-profile vehicles and campers should maintain firm two-handed steering.`;
        }

        // 7. Transitioning Skies (e.g. Clear to Overcast or Partly Cloudy)
        if (depCode !== arrCode && (depCode <= 3 && arrCode <= 3)) {
            return `Departing under ${depWeather.text.toLowerCase()} skies in ${startLoc} (${depTemp}°F) transitioning to ${arrWeather.text.toLowerCase()} upon arrival in ${destLoc} (${arrTemp}°F). Calm cruising winds (${maxWind} mph) with dry pavement across this stretch.`;
        }

        // 8. Overcast / Cool
        if (dominantCode === 3) {
            return `Overcast skies with mild cruising temperatures between ${minTemp}°F and ${maxTemp}°F (${depTemp}°F at departure \u2192 ${arrTemp}°F upon arrival). Wind speeds at a calm ${maxWind} mph with dry pavement for standard highway pace.`;
        }

        // 9. Partly Cloudy / Fair
        if (dominantCode === 1 || dominantCode === 2) {
            return `Partly cloudy with pleasant cruising conditions from ${depTemp}°F at ${startLoc} to ${arrTemp}°F at ${destLoc}. Wind speeds around ${maxWind} mph. Favorable driving conditions across this leg.`;
        }

        // 10. Clear / Sunny
        return `Clear skies and high line-of-sight visibility from ${startLoc} (${depTemp}°F) to ${destLoc} (${arrTemp}°F). Light winds (${maxWind} mph)—ideal convoy cruising weather.`;
    }

    // --- Geocoding & Open-Meteo API Fetchers ---

    async function getCoordinates(address, originalAddress, defaultCoords) {
        if (!address) return defaultCoords || { lat: 35.0, lon: -95.0 };
        const trimmed = address.trim();

        // If address matches original unedited address, use pre-calculated defaultCoords
        if (originalAddress && trimmed.toLowerCase() === originalAddress.trim().toLowerCase() && defaultCoords && defaultCoords.lat && defaultCoords.lon) {
            return defaultCoords;
        }

        if (geocodeCache.has(trimmed)) {
            return geocodeCache.get(trimmed);
        }

        try {
            const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmed)}&count=1&language=en&format=json`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                if (data.results && data.results.length > 0) {
                    const coords = {
                        lat: data.results[0].latitude,
                        lon: data.results[0].longitude
                    };
                    geocodeCache.set(trimmed, coords);
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

        const url = `https://api.open-meteo.com/v1/gfs?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m,apparent_temperature&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=16`;
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Open-Meteo HTTP error ${res.status}`);
        }
        const data = await res.json();
        
        weatherCache.set(cacheKey, {
            data: data.hourly,
            timestamp: now
        });

        return data.hourly;
    }

    function extractTransitStats(hourly, dateStr, startHour, endHour) {
        if (!hourly || !hourly.time || hourly.time.length === 0) return null;

        let isLiveForecast = true;
        // Find indices for the specific date
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

        // If target date is out of range or not found, fallback to the first available day's hours
        if (indices.length === 0) {
            isLiveForecast = false;
            for (let i = 0; i < Math.min(24, hourly.time.length); i++) {
                const hour = parseInt(hourly.time[i].substring(11, 13), 10);
                if (hour >= startHour && hour <= Math.max(startHour, endHour)) {
                    indices.push(i);
                }
            }
        }

        // Fallback to first element if still empty
        if (indices.length === 0) {
            indices = [0];
        }

        const temps = indices.map(idx => Math.round(hourly.temperature_2m[idx]));
        const precips = indices.map(idx => hourly.precipitation_probability[idx] || 0);
        const winds = indices.map(idx => Math.round(hourly.wind_speed_10m[idx] || 0));
        const codes = indices.map(idx => hourly.weather_code[idx] || 0);

        const depCode = codes[0];
        const arrCode = codes[codes.length - 1];

        // Find dominant code (prioritize severe/rain/fog codes over clear)
        let dominantCode = codes[0];
        let hasHazard = false;
        for (const code of codes) {
            if (code >= 95) { dominantCode = code; hasHazard = true; break; }
            if (code >= 70 && dominantCode < 70) { dominantCode = code; hasHazard = true; }
            if (code >= 50 && dominantCode < 50) { dominantCode = code; hasHazard = true; }
            if (code >= 45 && dominantCode < 45) { dominantCode = code; hasHazard = true; }
        }

        // If no hazard (thunderstorm/snow/rain/fog), use the median sky condition
        if (!hasHazard) {
            const sortedCodes = [...codes].sort((a, b) => a - b);
            dominantCode = sortedCodes[Math.floor(sortedCodes.length / 2)];
        }

        const minTemp = Math.min(...temps);
        const maxTemp = Math.max(...temps);
        const avgTemp = Math.round(temps.reduce((a, b) => a + b, 0) / temps.length);
        const maxPrecip = Math.max(...precips);
        const maxWind = Math.max(...winds);
        const depTemp = temps[0];
        const arrTemp = temps[temps.length - 1];

        return {
            minTemp,
            maxTemp,
            avgTemp,
            maxPrecip,
            maxWind,
            dominantCode,
            depCode,
            arrCode,
            depTemp,
            arrTemp,
            allTemps: temps,
            allCodes: codes,
            isLiveForecast
        };
    }

    async function loadWeatherForActiveDay(day) {
        const targetDate = getDateForDay(day.day_number);

        // Update Daily Full 24-Hour Weather Summary in the Day Header Card
        try {
            if (day.legs && day.legs.length > 0) {
                const firstLeg = day.legs[0];
                const firstStart = getCustomAddress(getLegId(firstLeg), 'start') || firstLeg.start_address || '';
                const originCoords = await getCoordinates(firstStart, firstLeg.start_address, firstLeg.start_coords);
                const dayHourly = await fetchHourlyForecast(originCoords.lat, originCoords.lon);
                
                let day24hTemps = [];
                let day24hCodes = [];
                for (let i = 0; i < dayHourly.time.length; i++) {
                    if (dayHourly.time[i].startsWith(targetDate)) {
                        day24hTemps.push(Math.round(dayHourly.temperature_2m[i]));
                        day24hCodes.push(dayHourly.weather_code[i] || 0);
                    }
                }

                if (day24hTemps.length > 0) {
                    const dailyLow = Math.min(...day24hTemps);
                    const dailyHigh = Math.max(...day24hTemps);
                    // Afternoon peak condition
                    const peakCode = day24hCodes[Math.min(14, day24hCodes.length - 1)] || day24hCodes[0];
                    const dayMeta = getWeatherInfo(peakCode);

                    const dayPill = document.getElementById('day-weather-summary-pill');
                    if (dayPill) {
                        dayPill.style.display = 'inline-flex';
                        dayPill.innerHTML = `
                            <i data-lucide="${dayMeta.icon}"></i>
                            <span>Daily: High ${dailyHigh}°F • Low ${dailyLow}°F (${dayMeta.text})</span>
                        `;
                        lucide.createIcons();
                    }
                }
            }
        } catch (dayErr) {
            console.warn('[Day Weather] Summary Error:', dayErr);
        }

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
                // Resolve coordinates for BOTH Start and Destination points
                const [startCoords, destCoords] = await Promise.all([
                    getCoordinates(startAddress, leg.start_address, leg.start_coords),
                    getCoordinates(destAddress, leg.destination_address, leg.destination_coords)
                ]);

                // Fetch hourly forecasts for BOTH endpoints concurrently
                const [startHourly, destHourly] = await Promise.all([
                    fetchHourlyForecast(startCoords.lat, startCoords.lon),
                    fetchHourlyForecast(destCoords.lat, destCoords.lon)
                ]);

                const startStats = extractTransitStats(startHourly, targetDate, startHour, endHour);
                const destStats = extractTransitStats(destHourly, targetDate, startHour, endHour);

                if (!startStats || !destStats) {
                    throw new Error('No weather data for window');
                }

                // Combine stats across the corridor
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

                // Pick dominant weather code across both endpoints
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
                    // Blend start & dest codes
                    if (depCode === 0 && arrCode === 0) dominantCode = 0;
                    else if (depCode <= 1 && arrCode <= 1) dominantCode = 1;
                    else if (depCode <= 2 && arrCode <= 2) dominantCode = 2;
                    else dominantCode = (Math.max(depCode, arrCode) >= 3 && Math.min(depCode, arrCode) <= 1) ? 2 : Math.max(depCode, arrCode);
                }

                const combinedStats = {
                    minTemp,
                    maxTemp,
                    avgTemp,
                    maxPrecip,
                    maxWind,
                    dominantCode,
                    depTemp,
                    arrTemp,
                    depCode,
                    arrCode,
                    isLiveForecast
                };

                const weatherMeta = getWeatherInfo(combinedStats.dominantCode);
                const depWeatherMeta = getWeatherInfo(depCode);
                const arrWeatherMeta = getWeatherInfo(arrCode);
                
                const conditionLabel = (depWeatherMeta.text === arrWeatherMeta.text) 
                    ? depWeatherMeta.text 
                    : `${depWeatherMeta.text} \u2192 ${arrWeatherMeta.text}`;

                const blurb = generateConditionBlurb(combinedStats, leg, startCoords, destCoords, startLocationName, destLocationName);

                const precipClass = combinedStats.maxPrecip >= 35 ? 'precip-alert' : '';
                const windClass = combinedStats.maxWind >= 18 ? 'wind-alert' : '';

                const outlookBadgeHTML = !isLiveForecast ? `
                    <span class="weather-pill" title="Target date is outside standard 16-day window; displaying closest available outlook">
                        <i data-lucide="info"></i>
                        <span>16-Day Outlook</span>
                    </span>
                ` : '';

                container.innerHTML = `
                    <div class="weather-widget-header">
                        <div class="weather-main-info">
                            <div class="weather-icon-badge">
                                <i data-lucide="${weatherMeta.icon}"></i>
                            </div>
                            <div class="weather-headline">
                                <span class="weather-temp-range">${combinedStats.minTemp}°F – ${combinedStats.maxTemp}°F</span>
                                <span class="weather-condition-tag">${conditionLabel} • ${leg.departs} (${startLocationName}) \u2192 ${leg.arrives} (${destLocationName})</span>
                            </div>
                        </div>
                        <div class="weather-metrics-pills">
                            <span class="weather-pill ${precipClass}">
                                <i data-lucide="droplet"></i>
                                <span>${combinedStats.maxPrecip}% Precip</span>
                            </span>
                            <span class="weather-pill ${windClass}">
                                <i data-lucide="wind"></i>
                                <span>${combinedStats.maxWind} mph Wind</span>
                            </span>
                            <span class="weather-pill" title="Departure (${startLocationName} at ${leg.departs}) \u2192 Arrival (${destLocationName} at ${leg.arrives})">
                                <i data-lucide="thermometer"></i>
                                <span>${combinedStats.depTemp}°F \u2192 ${combinedStats.arrTemp}°F</span>
                            </span>
                            ${outlookBadgeHTML}
                        </div>
                    </div>
                    <div class="weather-blurb-box">
                        <i data-lucide="info" class="weather-blurb-icon"></i>
                        <span class="weather-blurb-text">${blurb}</span>
                    </div>
                `;
                lucide.createIcons();
            } catch (err) {
                console.warn(`[Weather] Error for leg ${legId}:`, err);
                container.innerHTML = `
                    <div class="weather-widget-header">
                        <div class="weather-main-info">
                            <div class="weather-icon-badge" style="background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.4); border-color: var(--border-color);">
                                <i data-lucide="cloud-off"></i>
                            </div>
                            <div class="weather-headline">
                                <span class="weather-temp-range" style="font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.6);">Road Weather Unavailable</span>
                                <span class="weather-condition-tag">Transit window: ${leg.departs} – ${leg.arrives}</span>
                            </div>
                        </div>
                    </div>
                `;
                lucide.createIcons();
            }
        }
    }

    // --- State & Storage Helpers ---
    function getLegId(leg) {
        return (leg.name + leg.departs + leg.route_details).replace(/[^a-zA-Z0-9]/g, '');
    }

    function isLegCompleted(legId) {
        return localStorage.getItem(`completed_${legId}`) === 'true';
    }

    function toggleLegCompletion(legId) {
        const current = isLegCompleted(legId);
        localStorage.setItem(`completed_${legId}`, (!current).toString());
        updateOverallProgress();
        renderTabs(); // Re-render tabs to update checkmarks
    }

    function getCustomAddress(legId, type) {
        return localStorage.getItem(`custom_${type}_${legId}`) || '';
    }

    function setCustomAddress(legId, type, value) {
        if (value.trim() === '') {
            localStorage.removeItem(`custom_${type}_${legId}`);
        } else {
            localStorage.setItem(`custom_${type}_${legId}`, value.trim());
        }
    }

    function clearCustomAddress(legId, type) {
        localStorage.removeItem(`custom_${type}_${legId}`);
    }

    function getFirstUncompletedDay() {
        for (const day of itineraryData) {
            const allCompleted = day.legs.every(leg => isLegCompleted(getLegId(leg)));
            if (!allCompleted) {
                return day.day_number;
            }
        }
        return 1;
    }

    function isLastLegOfDay(legId) {
        const day = itineraryData.find(d => d.day_number === activeDayNumber);
        if (!day || !day.legs || day.legs.length === 0) return false;
        const lastLeg = day.legs[day.legs.length - 1];
        return getLegId(lastLeg) === legId;
    }

    function triggerCelebration() {
        if (typeof confetti === 'function') {
            const duration = 3000;
            const end = Date.now() + duration;

            (function frame() {
                confetti({
                    particleCount: 5,
                    angle: 60,
                    spread: 55,
                    origin: { x: 0 },
                    colors: ['#66d9ef', '#a6e22e', '#fd971f', '#f92672', '#ae81ff'],
                    zIndex: 9999
                });
                confetti({
                    particleCount: 5,
                    angle: 120,
                    spread: 55,
                    origin: { x: 1 },
                    colors: ['#66d9ef', '#a6e22e', '#fd971f', '#f92672', '#ae81ff'],
                    zIndex: 9999
                });

                if (Date.now() < end) {
                    requestAnimationFrame(frame);
                }
            }());
        }
    }

    // --- Progress Calculation ---
    function updateOverallProgress() {
        if (itineraryData.length === 0) return;
        
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

        const percentage = totalLegs > 0 ? Math.round((completedLegs / totalLegs) * 100) : 0;
        progressBarFill.style.width = `${percentage}%`;
        progressText.textContent = `${percentage}% (${completedLegs}/${totalLegs} legs)`;
    }

    // --- Rendering Functions ---

    function renderTabs() {
        dayTabsContainer.innerHTML = '';
        
        itineraryData.forEach(day => {
            const tab = document.createElement('div');
            tab.className = 'day-tab';
            if (day.day_number === activeDayNumber) {
                tab.classList.add('active');
            }
            
            // Check if all legs in this day are completed
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
                // Update active class on tabs
                document.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                renderActiveDay();
            });

            dayTabsContainer.appendChild(tab);
        });
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
        } else {
            activeDayOvernightContainer.style.display = 'none';
        }

        // Render Legs
        legsContainer.innerHTML = '';
        
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

            // Build inner HTML
            let bannerHTML = '';
            if (isLastLeg && !isCompleted) {
                bannerHTML = `
                    <div class="final-stretch-banner">
                        <i data-lucide="flag"></i>
                        <span>Final Stretch — Hotel Ahead</span>
                    </div>
                `;
            }

            // Resolve Facility Information
            const destFacility = getFacilityInfo(leg.destination_type);
            const destIcon = destFacility.icon;
            const destBadgeClass = destFacility.badgeClass;
            const destLabel = destFacility.label;

            let startAddressHTML = '';
            if (activeStart) {
                const startFacility = (index === 0) 
                    ? { icon: 'map-pin' } 
                    : (day.legs[index-1] ? getFacilityInfo(day.legs[index-1].destination_type) : { icon: 'map-pin' });
                
                startAddressHTML = `
                    <div class="address-block address-block-start">
                        <div class="address-block-header">
                            <div class="address-title-row">
                                <span class="section-eyebrow">Starting From</span>
                                ${customStart ? '<span class="badge badge-orange">Edited</span>' : ''}
                            </div>
                            <button class="btn-edit-address" data-leg-id="${legId}" data-type="start" data-original="${leg.start_address || ''}">
                                <i data-lucide="pencil"></i>
                            </button>
                        </div>
                        ${leg.start_name ? `
                        <div class="venue-start-row">
                            <i data-lucide="${startFacility.icon}" class="venue-start-icon"></i>
                            <span class="venue-start-text">${leg.start_name}</span>
                        </div>
                        ` : ''}
                        <p class="address-text">${activeStart}</p>
                    </div>
                `;
            }

            let destAddressHTML = '';
            if (activeDest) {
                destAddressHTML = `
                    <div class="address-block address-block-destination">
                        <div class="address-block-header">
                            <div class="address-title-row">
                                <span class="section-eyebrow">Navigate To</span>
                                <span class="badge ${destBadgeClass}">${destLabel}</span>
                                ${customDest ? '<span class="badge badge-orange">Edited</span>' : ''}
                            </div>
                            <button class="btn-edit-address" data-leg-id="${legId}" data-type="dest" data-original="${leg.destination_address || ''}">
                                <i data-lucide="pencil"></i>
                            </button>
                        </div>
                        ${leg.destination_name ? `
                        <div class="venue-highlight-row">
                            <i data-lucide="${destIcon}" class="venue-icon"></i>
                            <span class="venue-name-text">${leg.destination_name}</span>
                        </div>
                        ` : ''}
                        <p class="address-text">${activeDest}</p>
                    </div>
                `;
            }

            let navigationActionsHTML = '';
            if (activeDest) {
                navigationActionsHTML = `
                    <div class="leg-actions">
                        <button class="btn btn-green btn-nav-directions" data-destination="${activeDest}">
                            <i data-lucide="navigation"></i>
                            <span>Start Directions</span>
                        </button>
                        <button class="btn btn-secondary btn-icon-only btn-copy-address" data-address="${activeDest}" title="Copy Address">
                            <i data-lucide="copy"></i>
                        </button>
                    </div>
                `;
            }

            let statsPillHTML = '';
            if (transitStats) {
                const durationColorClass = getDurationPillClass(transitStats);
                statsPillHTML = `
                    <div class="stats-pill ${durationColorClass}">
                        <i data-lucide="car"></i>
                        <span>${transitStats}</span>
                    </div>
                `;
            }

            card.innerHTML = `
                ${bannerHTML}
                
                <div class="leg-card-header">
                    <div class="leg-title-area">
                        <div class="leg-title-row">
                            <h3>${leg.name}</h3>
                            ${leg.destination_name ? `
                            <span class="leg-title-separator">•</span>
                            <span class="leg-title-destination">${leg.destination_name}</span>
                            ` : ''}
                        </div>
                    </div>
                    <span class="leg-time-window">
                        <i data-lucide="clock"></i>
                        <span>${leg.departs} – ${leg.arrives}</span>
                    </span>
                </div>

                ${leg.destination_name ? `
                <div class="stop-callout-box ${destFacility.boxClass}">
                    <div class="stop-callout-icon-badge">
                        <i data-lucide="${destIcon}"></i>
                    </div>
                    <div class="stop-callout-content">
                        <span class="stop-callout-label">${destFacility.calloutPrefix}</span>
                        <strong class="stop-callout-name">${leg.destination_name}</strong>
                    </div>
                </div>
                ` : ''}

                <hr class="card-divider" style="margin-bottom: var(--space-lg);">

                <!-- Dynamic Road Weather Widget Container -->
                <div class="weather-widget" id="weather-widget-${legId}">
                    <div class="weather-skeleton">
                        <div class="skeleton-line skeleton-short"></div>
                        <div class="skeleton-line skeleton-long"></div>
                    </div>
                </div>

                <div class="leg-addresses-container">
                    ${startAddressHTML}
                    ${destAddressHTML}
                </div>

                ${navigationActionsHTML}

                <div class="leg-details-info">
                    <div class="route-details-box">
                        <span class="section-eyebrow">Route Details</span>
                        <p class="route-desc-text">${routePath}</p>
                        ${statsPillHTML}
                    </div>
                    
                    <div class="operational-notes-box">
                        <span class="section-eyebrow">Operational Notes</span>
                        <p class="notes-text">${leg.operational_notes}</p>
                    </div>
                </div>

                <hr class="card-divider" style="margin-bottom: var(--space-lg);">

                <button class="btn btn-completion btn-toggle-completion" data-leg-id="${legId}">
                    <i data-lucide="${isCompleted ? 'check-square' : 'square'}"></i>
                    <span>${isCompleted ? 'Completed' : 'Mark as Done'}</span>
                </button>
            `;

            // Append card
            legsContainer.appendChild(card);
        });

        // Add event listeners to newly created card elements
        setupCardEventListeners();

        // Refresh icons inside dynamically rendered legs
        lucide.createIcons();

        // Load dynamic road weather for the active day's legs
        loadWeatherForActiveDay(day);
    }

    // --- Event Listeners Setup ---

    function setupGlobalEventListeners() {
        // Trip Start Date change handler
        if (tripDateInput) {
            tripDateInput.addEventListener('change', (e) => {
                if (e.target.value) {
                    localStorage.setItem('convoy_trip_start_date', e.target.value);
                    weatherCache.clear(); // Clear cached weather on date change to refresh forecast
                    renderActiveDay();
                }
            });
        }

        // PDF Modal triggers (safeguarded)
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

        // Close modal when clicking outside modal-card
        window.addEventListener('click', (e) => {
            if (e.target === pdfModal) closePDF();
            if (e.target === editModal) closeEdit();
        });
    }

    function setupDragToScroll() {
        const slider = document.querySelector('.day-tabs-nav');
        if (!slider) return;

        let isDown = false;
        let startX = 0;
        let scrollLeft = 0;
        let isDragging = false;

        // Pointer down on tab bar (only primary left click)
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
                
                // Animate card before refreshing
                const card = document.getElementById(`leg-card-${legId}`);
                if (card) {
                    card.style.transform = 'scale(0.99)';
                    card.style.opacity = '0.7';
                }

                setTimeout(() => {
                    const wasCompleted = isLegCompleted(legId);
                    toggleLegCompletion(legId);
                    renderActiveDay();
                    
                    if (!wasCompleted && isLastLegOfDay(legId)) {
                        triggerCelebration();
                    }
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

        // Copy address to clipboard
        document.querySelectorAll('.btn-copy-address').forEach(btn => {
            btn.addEventListener('click', () => {
                const address = btn.getAttribute('data-address');
                navigator.clipboard.writeText(address).then(() => {
                    // Quick feedback transition
                    const icon = btn.querySelector('i');
                    btn.classList.add('btn-green');
                    btn.classList.remove('btn-secondary');
                    
                    if (icon) {
                        icon.setAttribute('data-lucide', 'check');
                        lucide.createIcons();
                    }

                    setTimeout(() => {
                        btn.classList.remove('btn-green');
                        btn.classList.add('btn-secondary');
                        if (icon) {
                            icon.setAttribute('data-lucide', 'copy');
                            lucide.createIcons();
                        }
                    }, 1800);
                }).catch(err => {
                    console.error('Could not copy text: ', err);
                });
            });
        });

        // Navigate via Deep-Link Directions
        document.querySelectorAll('.btn-nav-directions').forEach(btn => {
            btn.addEventListener('click', () => {
                const destination = btn.getAttribute('data-destination');
                
                // Device detection to open Apple Maps on Apple devices and Google Maps elsewhere
                const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
                
                let mapsUrl = '';
                if (isApple) {
                    // Apple Maps format: maps://?daddr=URL_ENCODED_DEST&dirflg=d (drive)
                    mapsUrl = `maps://?daddr=${encodeURIComponent(destination)}&dirflg=d`;
                } else {
                    // Google Maps format
                    mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
                }

                console.log(`[Nav] Destination: ${destination}`);
                console.log(`[Nav] Opening URL: ${mapsUrl}`);
                
                // Open link
                window.open(mapsUrl, '_blank');
            });
        });
    }
});
