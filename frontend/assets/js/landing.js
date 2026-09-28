/**
 * Landing Page Configuration & Logic
 */

const LandingConfig = {
    stats: [
        { value: '10K+', label: 'Jobs Matched' },
        { value: '85%', label: 'Success Rate' },
        { value: '2Min', label: 'Setup Time' }
    ],
    features: [
        {
            icon: '🤖',
            title: 'AI CV Analysis',
            description: 'Upload your CV and get instant AI-powered analysis with suggestions for improvement and optimization'
        },
        {
            icon: '🎯',
            title: 'Smart Job Matching',
            description: 'Find perfect job matches based on your skills, experience, and preferences using advanced algorithms'
        },
        {
            icon: '📝',
            title: 'Custom CV Generation',
            description: 'Generate tailored CVs for each application, optimized for ATS systems and specific job requirements'
        },
        {
            icon: '✉️',
            title: 'AI Cover Letters',
            description: 'Create personalized cover letters that highlight your relevant experience for each position'
        },
        {
            icon: '🚀',
            title: 'One-Click Apply',
            description: 'Apply to jobs instantly with browser automation and intelligent form filling technology'
        },
        {
            icon: '📊',
            title: 'Application Tracking',
            description: 'Monitor all applications, interviews, and responses in one comprehensive dashboard'
        }
    ],
    pricing: [
        {
            name: 'Free',
            priceInCents: 0,
            features: [
                { text: '3 manual applications per month', included: true },
                { text: 'Basic job search', included: true },
                { text: 'CV upload & analysis', included: true },
                { text: 'Auto-apply is on Premium', included: false }
            ],
            buttonText: 'Get Started Free',
            buttonLink: '/register',
            highlight: false,
            period: ''
        },
        {
            name: 'Basic',
            priceInCents: 299,
            features: [
                { text: 'Manual applications with no monthly cap', included: true },
                { text: 'Billed monthly', included: true },
                { text: 'Auto-apply is on Premium', included: false }
            ],
            buttonText: 'Get Basic',
            buttonLink: '/register',
            highlight: false,
            period: '/month'
        },
        {
            name: 'Premium',
            priceInCents: 2999,
            features: [
                { text: 'Auto-apply included', included: true },
                { text: 'Manual applications with no monthly cap', included: true },
                { text: 'Billed monthly', included: true }
            ],
            buttonText: 'Get Premium',
            buttonLink: '/register',
            highlight: true,
            highlightText: 'Monthly',
            period: '/month'
        }
    ]
};

const Landing = {
    // Format price based on user's currency
    formatPrice(amountInCents) {
        if (window.CVision && window.CVision.Currency) {
            return CVision.Currency.format(amountInCents, 'USD');
        }
        // Fallback to USD
        return `$${(amountInCents / 100).toFixed(2)}`;
    },

    async init() {
        // Render visible page content before optional geolocation work.
        this.renderStats();
        this.renderFeatures();
        this.renderPricing();

        this.initMobileMenu();
        this.initUpload();
        this.initSmoothScroll();
        this.initSearch();

        // Detect currency from geolocation first
        if (window.CVision && window.CVision.Currency) {
            try {
                await CVision.Currency.initFromGeolocation();
            } catch (error) {
                console.warn('Currency detection unavailable:', error);
            }
        }

        this.loadJobs();
    },

    /**
     * Calculates how many jobs to show based on 5 rows for current screen size
     */
    getDisplayLimit() {
        const width = window.innerWidth;
        let cols = 1;
        if (width >= 1280) cols = 4;
        else if (width >= 1024) cols = 3;
        else if (width >= 768) cols = 2;

        return cols * 4;
    },

    initSmoothScroll() {
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const targetId = this.getAttribute('href');
                if (targetId === '#') return;

                const target = document.querySelector(targetId);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth' });
                }
            });
        });
    },

    initUpload() {
        // CV Upload functionality
        const uploadZone = document.getElementById('cv-upload-zone');
        const fileInput = document.getElementById('cv-file-input');
        const getStartedBtn = document.getElementById('get-started-btn');
        const preferencesContainer = document.getElementById('preferences-container');

        // Modal Elements
        const modal = document.getElementById('cv-upload-modal');
        const closeModalBtn = document.getElementById('close-modal-btn');
        const modalBackdrop = document.getElementById('modal-backdrop');

        let uploadedFile = null;

        if (!uploadZone || !fileInput) return;

        // --- Modal Logic ---
        const openModal = () => {
            if (modal) modal.classList.remove('hidden');
        };

        const closeModal = () => {
            if (modal) modal.classList.add('hidden');
        };

        // Navbar Upload CV scrolls to the form, or opens the modal when one exists.
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('#nav-upload-btn');
            if (!btn) return;
            if (modal) {
                openModal();
                return;
            }
            const zone = document.getElementById('cv-upload-zone');
            if (zone) zone.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });

        // Close handlers
        if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
        if (modalBackdrop) modalBackdrop.addEventListener('click', closeModal);

        // File upload handlers
        uploadZone.addEventListener('click', () => fileInput.click());

        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('border-white/60', 'bg-white/10');
        });

        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('border-white/60', 'bg-white/10');
        });

        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('border-white/60', 'bg-white/10');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleFileUpload(files[0]);
            }
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFileUpload(e.target.files[0]);
            }
        });

        async function handleFileUpload(file) {
            // Validate file
            const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
            if (!allowedTypes.includes(file.type)) {
                CVision.Utils.showAlert('Please upload a PDF, DOCX, or TXT file', 'error');
                return;
            }

            if (file.size > 10 * 1024 * 1024) {
                CVision.Utils.showAlert('File size must be less than 10MB', 'error');
                return;
            }

            if (window.PendingCvStore) {
                try {
                    await PendingCvStore.save(file);
                } catch (error) {
                    console.error('Could not preserve CV for sign-in:', error);
                    CVision.Utils.showAlert('Could not preserve your CV. Please try again.', 'error');
                    return;
                }
            }

            uploadedFile = file;
            uploadZone.innerHTML = `
                <div class="text-4xl mb-4">✅</div>
                <div class="text-gray-900 font-bold mb-2">${file.name}</div>
                <div class="text-gray-500 text-sm">Matching jobs below • Click to change</div>
            `;

            // Reveal preferences with animation
            preferencesContainer.classList.remove('hidden');
            // Small delay to allow display:block to apply before adding opacity
            setTimeout(() => {
                preferencesContainer.classList.remove('opacity-0', 'translate-y-4');
            }, 10);

            getStartedBtn.disabled = false;
            getStartedBtn.innerHTML = '<span class="button-text">Update job matches</span>';
            Landing.matchJobsFromCv(file);
        }

        // Get started button handler
        if (getStartedBtn) {
            getStartedBtn.addEventListener('click', function () {
                if (uploadedFile) {
                    const jobTitleEl = document.getElementById('job-title');
                    const locationEl = document.getElementById('location');
                    const salaryRangeEl = document.getElementById('salary-range');

                    localStorage.setItem('landing_preferences', JSON.stringify({
                        jobTitle: jobTitleEl ? jobTitleEl.value : '',
                        location: locationEl ? locationEl.value : '',
                        salaryRange: salaryRangeEl ? salaryRangeEl.value : '',
                        fileName: uploadedFile.name
                    }));

                    Landing.matchJobsFromCv(uploadedFile);
                } else {
                    CVision.Utils.showAlert('Please upload your CV first', 'warning');
                }
            });
        }
    },

    async matchJobsFromCv(file) {
        const grid = document.getElementById('jobs-grid');
        const heading = document.getElementById('jobs-heading');
        const note = document.getElementById('jobs-source-note');
        if (!grid || !file) return;

        const form = new FormData();
        form.append('file', file);
        const jobTitle = document.getElementById('job-title')?.value?.trim();
        const location = document.getElementById('location')?.value?.trim();
        if (jobTitle) form.append('job_title', jobTitle);
        if (location) form.append('location', location);

        if (heading) heading.textContent = 'Finding jobs from your CV';
        if (note) note.textContent = 'Reading the file and matching open roles.';
        grid.style.opacity = '0.5';
        document.getElementById('jobs-wrapper')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

        try {
            const response = await fetch(`${window.CONFIG.API_BASE_URL}${window.CONFIG.API_PREFIX}/jobs/match-cv`, {
                method: 'POST',
                body: form
            });
            if (!response.ok) {
                let message = 'Could not match jobs to that CV.';
                try {
                    const error = await response.json();
                    if (error.detail) message = error.detail;
                } catch (parseError) {
                    /* keep the fallback message */
                }
                throw new Error(message);
            }

            const data = await response.json();
            const jobs = data.jobs || [];
            if (heading) heading.textContent = 'Jobs for your CV';
            if (note) {
                if (!jobs.length) {
                    note.textContent = 'No open roles matched this CV yet.';
                } else if (!data.matched) {
                    note.textContent = 'No role stood out in this CV, so these are the latest openings.';
                } else if (data.relaxed) {
                    note.textContent = data.query
                        ? `Closest open roles for ${data.query}. Location was widened so results are not empty.`
                        : 'Closest open roles from your CV. Location was widened so results are not empty.';
                } else {
                    note.textContent = data.query
                        ? `Open roles matched to ${data.query}.`
                        : 'Open roles matched to your CV.';
                }
            }
            await this.displayJobsGrid(jobs);
            grid.style.opacity = '1';
        } catch (error) {
            console.error('CV job match failed:', error);
            grid.style.opacity = '1';
            if (heading) heading.textContent = 'Jobs';
            if (note) note.textContent = 'Could not match this CV. Showing the latest openings instead.';
            if (window.CVision && CVision.Utils) {
                CVision.Utils.showAlert(error.message || 'Could not match jobs to that CV.', 'error');
            }
        }
    },

    renderStats() {
        const container = document.getElementById('stats-container');
        if (!container) return;

        container.innerHTML = LandingConfig.stats.map(stat => `
            <div class="stat-tile">
                <div class="stat-value whitespace-nowrap">${stat.value}</div>
                <div class="stat-label whitespace-nowrap">${stat.label}</div>
            </div>
        `).join('');
    },

    renderFeatures() {
        const container = document.getElementById('features-container');
        if (!container) return;

        container.innerHTML = LandingConfig.features.map(feature => `
            <article class="feature-card p-7">
                <div class="feature-icon" aria-hidden="true">${feature.icon}</div>
                <h3 class="text-xl font-semibold text-stone-900 mb-2">${feature.title}</h3>
                <p class="text-stone-600 leading-7">${feature.description}</p>
            </article>
        `).join('');
    },

    renderPricing() {
        const container = document.getElementById('pricing-container');
        if (!container) return;

        container.innerHTML = LandingConfig.pricing.map(plan => {
            const formattedPrice = this.formatPrice(plan.priceInCents);

            return `
            <div class="bg-white rounded-2xl p-8 relative ${plan.highlight ? 'border-2 border-primary-500 shadow-xl scale-105 z-10' : 'border border-gray-200 shadow-md hover:shadow-lg transition-all'}">
                ${plan.highlight ? `
                <div class="absolute -top-4 left-1/2 transform -translate-x-1/2 bg-gradient-to-r from-primary-600 to-primary-500 text-white px-4 py-1 rounded-full text-sm font-bold shadow-md">
                    ${plan.highlightText}
                </div>
                ` : ''}
                
                <div class="text-center mb-8">
                    <h3 class="text-2xl font-bold text-gray-900 mb-4">${plan.name}</h3>
                    <div class="flex justify-center items-baseline mb-2">
                        <span class="text-4xl font-extrabold text-gray-900">${formattedPrice}</span>
                        <span class="text-gray-500 ml-1">${plan.period || ''}</span>
                    </div>
                </div>
                
                <ul class="space-y-4 mb-8">
                    ${plan.features.map(feature => `
                        <li class="flex items-start space-x-3">
                            <span class="${feature.included ? 'text-green-500' : 'text-gray-300'} mt-1 text-lg">
                                ${feature.included ? '✓' : '✗'}
                            </span>
                            <span class="${feature.included ? 'text-gray-700' : 'text-gray-400'}">
                                ${feature.text}
                            </span>
                        </li>
                    `).join('')}
                </ul>
                
                <a href="${plan.buttonLink}" class="block w-full py-4 px-6 ${plan.highlight ? 'btn-gradient text-white shadow-lg hover:shadow-xl' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'} rounded-xl font-bold text-center transition-all">
                    ${plan.buttonText}
                </a>
            </div>
        `}).join('');
    },

    initMobileMenu() {
        const btn = document.getElementById('mobile-menu-button');
        const menu = document.getElementById('mobile-menu');

        if (btn && menu) {
            btn.addEventListener('click', () => {
                menu.classList.toggle('hidden');
            });
        }
    },

    initSearch() {
        const searchBtn = document.getElementById('landing-search-btn');
        const queryInput = document.getElementById('landing-search-query');
        const locationInput = document.getElementById('landing-search-location');

        if (!searchBtn) return;

        const handleSearch = () => {
            const query = queryInput.value.trim();
            const location = locationInput.value.trim();
            this.loadJobs(query, location);
        };

        searchBtn.addEventListener('click', handleSearch);

        // Enter key support
        [queryInput, locationInput].forEach(input => {
            if (input) {
                input.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') handleSearch();
                });
            }
        });

        // "Jobs Near Me" Button Logic
        const nearMeBtn = document.getElementById('btn-jobs-near-me');
        if (nearMeBtn && window.CVision && window.CVision.Geolocation) {
            nearMeBtn.addEventListener('click', async () => {
                const originalHtml = nearMeBtn.innerHTML;
                nearMeBtn.innerHTML = `
                    <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-primary-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Locating...
                `;
                nearMeBtn.disabled = true;

                try {
                    const data = await CVision.Geolocation.detect();
                    if (data.detected) {
                        const loc = data.city || data.countryName;
                        if (locationInput) locationInput.value = loc;
                        this.loadJobs(queryInput ? queryInput.value : '', loc);
                    }
                } catch (e) {
                    console.error('Near Me failed', e);
                } finally {
                    nearMeBtn.innerHTML = originalHtml;
                    nearMeBtn.disabled = false;
                }
            });
        }
    },

    async loadJobs(searchQuery = '', searchLocation = '') {
        const grid = document.getElementById('jobs-grid');
        if (!grid) return;

        const query = searchQuery || '';
        const location = searchLocation || '';
        const cacheKey = `landing_jobs_${query}_${location}`;

        const fetchFreshJobs = async () => {
            const response = await fetch(`${window.CONFIG.API_BASE_URL}${window.CONFIG.API_PREFIX}/jobs/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: query || null,
                    location: location || null,
                    size: 40
                })
            });

            if (!response.ok) throw new Error('Failed to fetch jobs');
            const data = await response.json();
            return data.jobs || [];
        };

        const onUpdate = async (jobs, isFromCache) => {
            if (jobs && jobs.length > 0) {
                await this.displayJobsGrid(jobs);
                grid.style.opacity = '1';
            } else if (!isFromCache) {
                grid.innerHTML = `
                    <div class="col-span-full text-center py-12">
                        <div class="text-4xl mb-4">🔍</div>
                        <p class="text-gray-500 text-lg">No jobs found matching your criteria.</p>
                        <button onclick="document.getElementById('landing-search-location').value=''; Landing.loadJobs('${query}', '')" class="text-primary-600 font-bold hover:underline mt-2">
                            Try clearing location filter
                        </button>
                    </div>
                `;
                grid.style.opacity = '1';
            }
        };

        // 1. Set loading state if no cached data exists
        if (!CVision.Cache.get(cacheKey)) {
            grid.style.opacity = '0.5';
        }

        // 2. Use centralized SWR caching
        try {
            await CVision.Cache.swr(cacheKey, fetchFreshJobs, onUpdate);
        } catch (error) {
            console.error('Job explorer error:', error);
            if (grid.children.length === 0) {
                grid.innerHTML = `
                    <div class="col-span-full text-center py-12 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                        <p class="text-gray-500">Could not load jobs at this time. Please try refreshing.</p>
                    </div>
                `;
                grid.style.opacity = '1';
            }
        }
    },

    /**
     * Renders job cards into the grid with current display limits
     */
    async displayJobsGrid(jobs) {
        const grid = document.getElementById('jobs-grid');
        if (!grid || !jobs) return;

        grid.innerHTML = '';
        const limit = this.getDisplayLimit();
        const jobsToShow = jobs.slice(0, limit);

        console.log(`Landing: Found ${jobs.length} jobs, rendering top ${jobsToShow.length} (Limit for 5 rows: ${limit})`);

        // Check if JobCard is ready
        if (!window.JobCard && document.querySelector('script[src*="JobCard.js"]')) {
            for (let i = 0; i < 10; i++) {
                if (window.JobCard) break;
                await new Promise(r => setTimeout(r, 50));
            }
        }

        if (!window.JobCard) {
            console.warn('JobCard component not found, falling back to simple template');
            const jobCardHtml = job => {
                const id = job._id || job.id;
                return `
                    <div class="job-explorer-card shadow-sm hover:shadow-xl transition-all duration-300 h-full flex flex-col bg-white rounded-xl border border-gray-100 p-5">
                        <div class="flex justify-between items-start mb-4">
                            <span class="location-badge inline-flex items-center px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-md font-medium">
                                <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                                </svg>
                                ${job.location || 'Remote'}
                            </span>
                        </div>
                        <h3 class="job-title-teaser font-bold text-gray-900 mb-1 line-clamp-1">${job.title}</h3>
                        <p class="company-teaser text-primary-600 text-sm font-medium mb-3">${job.company_name}</p>
                        <a href="/login.html?job_id=${id}" class="block text-center py-2 px-4 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 transition-colors text-sm">
                            Apply
                        </a>
                    </div>
                `;
            };
            grid.innerHTML = jobsToShow.map(jobCardHtml).join('');
        } else {
            jobsToShow.forEach(job => {
                try {
                    const card = window.JobCard.render(job, true);
                    grid.appendChild(card);
                } catch (renderError) {
                    console.error('Error rendering job card:', renderError, job);
                }
            });
        }
    }

};

document.addEventListener('DOMContentLoaded', () => {
    Landing.init();
});
