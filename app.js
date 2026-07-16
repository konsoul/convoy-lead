/**
 * Convoy Lead - Core Logic & State Management
 * Technology: Vanilla ES6+ Javascript
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Application State ---
    let itineraryData = [];
    let activeDayNumber = 1;
    
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
            const response = await fetch('itinerary.json');
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
                    colors: ['#66d9ef', '#a6e22e', '#fd971f', '#f92672', '#ae81ff'], // Monokai colors
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

        // Render Day Header Details
        activeDayBadge.textContent = `Day ${day.day_number}`;
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

            // Parse Route Path and Transit Stats (identical to Swift)
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

            let startAddressHTML = '';
            if (activeStart) {
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
                                ${customDest ? '<span class="badge badge-orange">Edited</span>' : ''}
                            </div>
                            <button class="btn-edit-address" data-leg-id="${legId}" data-type="dest" data-original="${leg.destination_address || ''}">
                                <i data-lucide="pencil"></i>
                            </button>
                        </div>
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
                statsPillHTML = `
                    <div class="stats-pill">
                        <i data-lucide="car"></i>
                        <span>${transitStats}</span>
                    </div>
                `;
            }

            card.innerHTML = `
                ${bannerHTML}
                
                <div class="leg-card-header">
                    <div class="leg-title-area">
                        <h3>${leg.name}</h3>
                    </div>
                    <span class="leg-time-window">
                        <i data-lucide="clock"></i>
                        <span>${leg.departs} – ${leg.arrives}</span>
                    </span>
                </div>

                <hr class="card-divider" style="margin-bottom: var(--space-lg);">

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
    }

    // --- Event Listeners Setup ---

    function setupGlobalEventListeners() {
        // PDF Modal triggers
        viewPdfBtn.addEventListener('click', () => {
            pdfModal.classList.add('active');
        });
        
        const closePDF = () => pdfModal.classList.remove('active');
        closePdfBtn.addEventListener('click', closePDF);
        closePdfFooterBtn.addEventListener('click', closePDF);

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
        let startX;
        let scrollLeft;
        let isDragging = false;

        // Use pointer events to distinguish between mouse and touch
        slider.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'mouse') return; // Let mobile devices use native CSS touch scrolling
            isDown = true;
            isDragging = false;
            slider.style.cursor = 'grabbing';
            startX = e.pageX - slider.offsetLeft;
            scrollLeft = slider.scrollLeft;
        });

        slider.addEventListener('pointerleave', (e) => {
            if (e.pointerType !== 'mouse') return;
            isDown = false;
            slider.style.cursor = 'auto';
        });

        slider.addEventListener('pointerup', (e) => {
            if (e.pointerType !== 'mouse') return;
            isDown = false;
            slider.style.cursor = 'auto';
            setTimeout(() => { isDragging = false; }, 0);
        });

        slider.addEventListener('pointermove', (e) => {
            if (!isDown || e.pointerType !== 'mouse') return;
            e.preventDefault();
            const x = e.pageX - slider.offsetLeft;
            const walk = (x - startX) * 1.5; // Scroll speed multiplier
            if (Math.abs(walk) > 3) {
                isDragging = true;
            }
            slider.scrollLeft = scrollLeft - walk;
        });

        slider.addEventListener('click', (e) => {
            if (isDragging) {
                e.preventDefault();
                e.stopPropagation();
                isDragging = false;
            }
        }, true); // Capture phase to prevent tab click
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
