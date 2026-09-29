const API_BASE_URL = `${CONFIG.API_BASE_URL}`;

let currentPage = 1;
let currentFilters = {};
let currentQuery = '';
let currentLocation = '';
let currentJobs = [];

// Phase 3: Batch selection state
let selectedJobs = new Set();
let batchModeActive = false;
let currentJobIdForCustomize = null;
let appliedJobIds = new Set();
let skipIpLocationRetry = false;

document.addEventListener('DOMContentLoaded', async () => {
    if (!CVision.Utils.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    initializeJobSearch();

    // Parse and populate from URL parameters
    populateFromURLParams();

    // Fetch applied jobs first to ensure filtering is immediate
    await fetchAppliedStatus();

    const filteredFromUrl = new URLSearchParams(window.location.search).get('location');
    if (!currentLocation && !filteredFromUrl) {
        const usedIpLocation = await applyDetectedLocationFilter();
        if (usedIpLocation) {
            await performSearch();
        } else {
            await loadJobsFromDB();
        }
    } else {
        await loadJobsFromDB();
    }

    // Check for job ID in URL after jobs are loaded
    const urlParams = new URLSearchParams(window.location.search);
    const jobIdParam = urlParams.get('job');
    if (jobIdParam) {
        // Wait a bit to ensure DOM updates
        setTimeout(() => {
            // If job not in current list (search results usually 20), we might need to fetch it individually
            // For now try to show from list, or fetch if missing
            const jobInList = currentJobs.find(j => (j._id || j.id) === jobIdParam);
            if (jobInList) {
                showJobDetails(jobIdParam);
            } else {
                // Fetch individual job if not in current list
                fetchJobAndShow(jobIdParam);
            }
        }, 500);
    }
    // Event listener for job updates from JobActions
    document.addEventListener('job:updated', (e) => {
        const { jobId, result } = e.detail;
        updateJobInList(jobId, {
            generated_cv_path: result.cv_pdf_url,
            generated_cover_letter_path: result.cover_letter_pdf_url
        });
    });

    // Listen for new applications to update buttons
    document.addEventListener('job:applied', () => {
        // Re-render current list to show "Applied" button
        if (currentJobs) displayJobs(currentJobs);
    });

});

async function applyDetectedLocationFilter() {
    const input = document.getElementById('searchLocation');
    if ((input && input.value.trim()) || currentLocation) return false;
    if (!window.CVision || !window.CVision.Geolocation) return false;

    try {
        const data = await CVision.Geolocation.detect();
        if (!data || !data.detected) return false;
        const loc = data.city || data.countryName;
        if (!loc) return false;
        if (input) {
            input.value = loc;
            input.dataset.ipFilled = loc;
        }
        currentLocation = loc;
        return true;
    } catch (error) {
        console.warn('Location filter unavailable:', error);
        return false;
    }
}

/**
 * Populate search and filters from URL parameters
 */
function populateFromURLParams() {
    const urlParams = new URLSearchParams(window.location.search);

    // Populate search query
    const search = urlParams.get('search');
    if (search) {
        document.getElementById('searchQuery').value = decodeURIComponent(search);
        currentQuery = decodeURIComponent(search);
    }

    // Populate location
    const location = urlParams.get('location');
    if (location) {
        document.getElementById('searchLocation').value = decodeURIComponent(location);
        currentLocation = decodeURIComponent(location);
    }

    // Populate employment type checkboxes
    const employmentType = urlParams.get('employment_type');
    if (employmentType) {
        const types = employmentType.split(',');
        types.forEach(type => {
            const checkbox = document.querySelector(`.employment-type[value="${type.trim()}"]`);
            if (checkbox) checkbox.checked = true;
        });
    }

    // Populate work arrangement checkboxes
    const workArrangement = urlParams.get('work_arrangement');
    if (workArrangement) {
        const arrangements = workArrangement.split(',');
        arrangements.forEach(arrangement => {
            const checkbox = document.querySelector(`.work-arrangement[value="${arrangement.trim()}"]`);
            if (checkbox) checkbox.checked = true;
        });
    }

    // Populate salary range
    const salaryMin = urlParams.get('salary_min');
    if (salaryMin) {
        document.getElementById('salaryMin').value = salaryMin;
    }

    const salaryMax = urlParams.get('salary_max');
    if (salaryMax) {
        document.getElementById('salaryMax').value = salaryMax;
    }

    // If search or filters are populated, trigger search automatically
    if (search || location || employmentType || workArrangement || salaryMin || salaryMax) {
        // Small delay to ensure DOM is ready
        setTimeout(() => {
            performSearch();
        }, 100);
    }
}

async function fetchJobAndShow(jobId) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/jobs/${jobId}`, {
            headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
        });
        if (response.ok) {
            const job = await response.json();

            // Check if job already exists in list
            const existingIndex = currentJobs.findIndex(j => (j._id || j.id) === (job._id || job.id));
            if (existingIndex !== -1) {
                currentJobs[existingIndex] = job;
            } else {
                currentJobs.push(job);
            }

            showJobDetails(jobId);
        }
    } catch (e) {
        console.error('Failed to load deep-linked job', e);
    }
}

function updateJobInList(jobId, updates) {
    const validJobId = String(jobId);
    if (!currentJobs) return;

    // Update in current list
    const jobIndex = currentJobs.findIndex(j => String(j._id || j.id) === validJobId);
    if (jobIndex !== -1) {
        // Merge updates
        currentJobs[jobIndex] = { ...currentJobs[jobIndex], ...updates };

        // Refresh display of this card if visible (or just all for simplicity)
        displayJobs(currentJobs);
        console.log(`Updated job ${validJobId} in list with`, updates);
    } else {
        console.warn(`Job ${validJobId} not found in current list to update`);
    }
}

function initializeJobSearch() {
    // Search form submission
    document.getElementById('jobSearchForm').addEventListener('submit', (e) => {
        e.preventDefault();
        performSearch();
    });

    // Apply filters
    document.getElementById('applyFilters').addEventListener('click', () => {
        applyFilters();
    });

    // Clear filters
    document.getElementById('clearFilters').addEventListener('click', () => {
        clearFilters();
    });

    // Sort change
    document.getElementById('sortBy').addEventListener('change', (e) => {
        if (currentQuery || currentLocation) {
            performSearch(1, e.target.value);
        } else {
            loadJobsFromDB(1);
        }
    });

    // Modal controls
    document.getElementById('closeModal').addEventListener('click', closeJobModal);
    document.getElementById('jobModal').addEventListener('click', (e) => {
        if (e.target.id === 'jobModal') closeJobModal();
    });

    // Phase 3: Batch mode toggle
    const batchModeCheckbox = document.getElementById('batchSelectMode');
    if (batchModeCheckbox) {
        batchModeCheckbox.addEventListener('change', (e) => {
            toggleBatchMode(e.target.checked);
        });
    }
}

/**
 * Fetch jobs data from API
 */
async function fetchJobsData(page = 1) {
    const response = await fetch(`${API_BASE_URL}/api/v1/jobs/search`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${CVision.Utils.getToken()}`
        },
        body: JSON.stringify({
            query: currentQuery || null,
            location: currentLocation || null,
            filters: buildFilters(),
            page: page,
            size: 20,
            sort_by: document.getElementById('sortBy')?.value || 'date',
            sort_order: 'desc'
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail || 'Failed to fetch jobs');
    }

    return await response.json();
}

/**
 * Handle rendered jobs data (from cache or fresh)
 */
async function handleJobsResponse(data, isCached = false) {
    console.log(`[handleJobsResponse] data received (cached: ${isCached}):`, { page: data.page, jobCount: (data.jobs || []).length });

    let fetchedJobs = data.jobs || [];

    // Filter out applied jobs
    currentJobs = fetchedJobs.filter(job => !appliedJobIds.has(String(job._id || job.id)));
    window.currentJobs = currentJobs;

    // AUTO-FETCH: If all jobs on this page were filtered out but more pages exist, fetch next page
    // This now works for both cached and fresh data to ensure we skip applied jobs quickly
    if (currentJobs.length === 0 && fetchedJobs.length > 0 && data.page < data.pages) {
        console.log(`All ${fetchedJobs.length} jobs on page ${data.page} filtered. Auto-fetching next page...`);
        return loadJobsFromDB(data.page + 1);
    }

    // Sync with JobCard component
    if (window.JobCard) window.JobCard.setJobs(currentJobs);

    if (currentJobs.length > 0) {
        document.getElementById('loadingState').classList.add('hidden');
        displayJobs(currentJobs);
        updateResultsCount(data.total || currentJobs.length, currentJobs.length);
        if (data.pages > 1) {
            updatePagination(data.page || 1, data.pages);
        } else {
            document.getElementById('pagination')?.classList.add('hidden');
        }
        await syncSavedJobStatus();
    } else {
        // Only show empty state if we are NOT using a cached result (i.e. this is fresh empty data)
        // or if we have no cache at all. This prevents flashing "No jobs" during SWR revalidation.
        if (!isCached) {
            document.getElementById('loadingState').classList.add('hidden');
            document.getElementById('resultsCount').textContent = fetchedJobs.length > 0 ? 'No new jobs found (filtered).' : 'No jobs in database yet.';
            showEmptyStateWithSearchPrompt();
        } else {
            // If cached but empty, we just wait for revalidation to finish without hiding skeletons/showing empty state
            console.log('Cached data is empty after filtering, waiting for revalidation...');
        }
    }
}

/**
 * Sync saved job status for current jobs
 */
async function syncSavedJobStatus() {
    try {
        const savedResponse = await fetch(`${API_BASE_URL}/api/v1/jobs/saved/me?size=100`, {
            headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
        });
        if (savedResponse.ok) {
            const savedData = await savedResponse.json();
            const savedJobs = savedData.jobs || [];

            let needsUpdate = false;
            savedJobs.forEach(savedJob => {
                const jobIndex = currentJobs.findIndex(j => (j._id || j.id) === (savedJob._id || savedJob.id));
                if (jobIndex !== -1) {
                    currentJobs[jobIndex].is_saved = true;
                    needsUpdate = true;

                    // Merge generated paths
                    if (savedJob.generated_cv_path) currentJobs[jobIndex].generated_cv_path = savedJob.generated_cv_path;
                    if (savedJob.generated_cover_letter_path) currentJobs[jobIndex].generated_cover_letter_path = savedJob.generated_cover_letter_path;
                }
            });

            if (needsUpdate) {
                if (window.JobCard) window.JobCard.setJobs(currentJobs);
                displayJobs(currentJobs);
            }
        }
    } catch (e) {
        console.warn('Failed to sync saved job status:', e);
    }
}

/**
 * Load jobs from DB with pagination support (using Cache)
 * @param {number} page - Page number to fetch
 */
async function loadJobsFromDB(page = 1) {
    try {
        const sortBy = document.getElementById('sortBy')?.value || 'date';
        const cacheKey = `jobs_${currentQuery || ''}_${currentLocation || ''}_${JSON.stringify(buildFilters())}_${sortBy}_p${page}`;

        if (!CVision.Cache?.get(cacheKey)) {
            showLoading();
        }

        if (window.CVision?.Cache) {
            await CVision.Cache.swr(
                cacheKey,
                () => fetchJobsData(page),
                (data, isCached) => handleJobsResponse(data, isCached),
                300000 // 5 min TTL
            );
        } else {
            const data = await fetchJobsData(page);
            await handleJobsResponse(data, false);
        }
    } catch (error) {
        console.error('Error loading jobs:', error);
        document.getElementById('loadingState').classList.add('hidden');
        showEmptyStateWithSearchPrompt();
    }
}

/**
 * Show empty state with search prompt
 */
function showEmptyStateWithSearchPrompt() {
    const emptyState = document.getElementById('emptyState');
    emptyState.innerHTML = `
        <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <h3 class="mt-4 text-lg font-medium text-gray-900">Start Your Job Search</h3>
        <p class="mt-2 text-gray-500">Enter job title and location above to find opportunities</p>
        <p class="mt-1 text-sm text-gray-400">Your saved jobs will appear here</p>
    `;
    emptyState.classList.remove('hidden');
}

/**
 * Fetch search results from API
 */
async function fetchSearchData(searchData) {
    const response = await fetch(`${API_BASE_URL}/api/v1/jobs/search`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${CVision.Utils.getToken()}`
        },
        body: JSON.stringify(searchData)
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail || 'Search failed');
    }

    return await response.json();
}

/**
 * Handle search results (from cache or fresh)
 */
async function handleSearchResponse(data, sortBy, isCached = false) {
    console.log(`[handleSearchResponse] data received (cached: ${isCached}):`, { page: data.page, jobCount: (data.jobs || []).length });

    let fetchedJobs = data.jobs || [];

    // Filter results immediately
    currentJobs = fetchedJobs.filter(job => !appliedJobIds.has(String(job._id || job.id)));
    window.currentJobs = currentJobs;

    // AUTO-FETCH: If all jobs on this page were filtered out but more pages exist, fetch next page
    if (currentJobs.length === 0 && fetchedJobs.length > 0 && data.page < data.pages) {
        console.log(`All ${fetchedJobs.length} jobs on search page ${data.page} filtered. Auto-fetching page ${data.page + 1}...`);
        return performSearch(data.page + 1, sortBy);
    }

    // Sync with JobCard component
    if (window.JobCard) window.JobCard.setJobs(currentJobs);

    if (currentJobs.length > 0) {
        document.getElementById('loadingState').classList.add('hidden');
        displayJobs(currentJobs);
        updateResultsCount(data.total || currentJobs.length, currentJobs.length);
        if (data.pages > 1) {
            updatePagination(data.page || 1, data.pages);
        } else {
            document.getElementById('pagination').classList.add('hidden');
        }
        await syncSavedJobStatus();
    } else {
        // Only show empty state if we are NOT using a cached result
        if (!isCached) {
            const locationInput = document.getElementById('searchLocation');
            if (!skipIpLocationRetry && locationInput && locationInput.dataset.ipFilled && locationInput.value.trim() === locationInput.dataset.ipFilled) {
                skipIpLocationRetry = true;
                locationInput.value = '';
                delete locationInput.dataset.ipFilled;
                currentLocation = '';
                await loadJobsFromDB(1);
                return;
            }
            document.getElementById('loadingState').classList.add('hidden');
            showEmptyState();
            if (fetchedJobs.length > 0) {
                document.getElementById('resultsCount').textContent = 'All search results were jobs you already applied to.';
            } else {
                document.getElementById('resultsCount').textContent = 'No jobs found matching your criteria.';
            }
        } else {
            console.log('Cached search data is empty after filtering, waiting for revalidation...');
        }
    }
}

/**
 * Perform job search (using Cache)
 * @param {number} page 
 * @param {string} sortBy 
 */
async function performSearch(page = 1, sortBy = 'relevance') {
    currentQuery = document.getElementById('searchQuery').value;
    currentLocation = document.getElementById('searchLocation').value;
    currentPage = page;

    if (!currentQuery && !currentLocation) {
        CVision.Utils.showAlert('Please enter a job title or location', 'warning');
        return;
    }

    const filters = buildFilters();
    const searchData = {
        query: currentQuery || null,
        location: currentLocation || null,
        filters: filters,
        page: currentPage,
        size: 20,
        sort_by: sortBy,
        sort_order: 'desc'
    };

    try {
        // Create a unique cache key based on search parameters
        const cacheKey = `search_${currentQuery}_${currentLocation}_${JSON.stringify(filters)}_p${currentPage}_${sortBy}`;

        if (!CVision.Cache?.get(cacheKey)) {
            showLoading();
        }

        if (window.CVision?.Cache) {
            await CVision.Cache.swr(
                cacheKey,
                () => fetchSearchData(searchData),
                (data, isCached) => handleSearchResponse(data, sortBy, isCached),
                300000 // 5 min TTL
            );
        } else {
            const data = await fetchSearchData(searchData);
            await handleSearchResponse(data, sortBy, false);
        }
    } catch (error) {
        console.error('Search error:', error);
        document.getElementById('loadingState').classList.add('hidden');
        CVision.Utils.showAlert(error.message, 'error');
    }
}

function buildFilters() {
    const employmentTypes = Array.from(
        document.querySelectorAll('.employment-type:checked')
    ).map(cb => cb.value);

    const workArrangements = Array.from(
        document.querySelectorAll('.work-arrangement:checked')
    ).map(cb => cb.value);

    const salaryMin = document.getElementById('salaryMin')?.value;
    const salaryMax = document.getElementById('salaryMax')?.value;

    // FIXED: Return null if no filters are applied, otherwise return filters object
    const hasFilters = employmentTypes.length > 0 ||
        workArrangements.length > 0 ||
        salaryMin ||
        salaryMax;

    if (!hasFilters) {
        currentFilters = null;
        return null;
    }

    const filters = {};

    if (employmentTypes.length > 0) {
        filters.employment_types = employmentTypes;
    }

    if (workArrangements.length > 0) {
        filters.work_arrangements = workArrangements;
    }

    if (salaryMin) filters.salary_min = parseFloat(salaryMin);
    if (salaryMax) filters.salary_max = parseFloat(salaryMax);

    currentFilters = filters;
    return filters;
}

function applyFilters() {
    if (currentQuery || currentLocation) {
        performSearch(1);
    } else {
        loadJobsFromDB();
    }
}

function clearFilters() {
    document.querySelectorAll('.employment-type, .work-arrangement').forEach(cb => {
        cb.checked = false;
    });
    const salaryMinEl = document.getElementById('salaryMin');
    const salaryMaxEl = document.getElementById('salaryMax');
    if (salaryMinEl) salaryMinEl.value = '';
    if (salaryMaxEl) salaryMaxEl.value = '';
    currentFilters = null;

    if (currentQuery || currentLocation) {
        performSearch(1);
    } else {
        loadJobsFromDB();
    }
}

function displayJobs(jobs, retryCount = 0) {
    const container = document.getElementById('jobsContainer');
    container.innerHTML = '';
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('loadingState').classList.add('hidden');

    if (!window.JobCard) {
        // Retry a few times if JobCard isn't initialized yet
        if (retryCount < 5) {
            console.warn(`JobCard not ready, retrying in 100ms (attempt ${retryCount + 1})`);
            setTimeout(() => displayJobs(jobs, retryCount + 1), 100);
            return;
        }
        console.error('JobCard component not found after retries');
        return;
    }

    jobs.forEach(job => {
        const jobCard = window.JobCard.render(job, false);
        container.appendChild(jobCard);
    });
}

function closeJobModal() {
    if (window.JobModal) window.JobModal.hide();
}

async function saveJob(jobId, silent = false, extraData = null) {
    try {
        const options = {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CVision.Utils.getToken()}`
            }
        };

        if (extraData) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(extraData);
        }

        const response = await fetch(`${API_BASE_URL}/api/v1/jobs/save/${jobId}`, options);

        if (!response.ok) throw new Error('Failed to save job');

        if (!silent) {
            CVision.Utils.showAlert('Job saved successfully!', 'success');
        }

        // Update list button(s)
        const listSaveBtns = document.querySelectorAll(`[onclick *= "saveJob('${jobId}')"]`);
        listSaveBtns.forEach(btn => {
            btn.innerHTML = `
    <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
        <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
    </svg>
    `;
            btn.classList.add('text-primary-600');
        });

        // Update modal button if it matches the current job
        const modalSaveBtn = document.getElementById('modalSaveJob');
        if (modalSaveBtn && modalSaveBtn.dataset.jobId === jobId) {
            modalSaveBtn.innerHTML = `
    <svg class="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
        <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
    </svg>
    Saved
        `;
            modalSaveBtn.classList.remove('text-gray-700');
            modalSaveBtn.classList.add('text-primary-600');
        }
    } catch (error) {
        console.error('Error saving job:', error);
        if (!silent) {
            CVision.Utils.showAlert('Failed to save job', 'error');
        }
    }
}

function updateResultsCount(total, showing) {
    document.getElementById('resultsCount').textContent = `Showing ${showing} of ${total} jobs`;
}

function updatePagination(currentPage, totalPages) {
    const container = document.getElementById('pagination');

    if (totalPages <= 1) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    container.innerHTML = '';

    if (currentPage > 1) {
        const prevBtn = createPageButton('Previous', currentPage - 1);
        container.appendChild(prevBtn);
    }

    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);

    for (let i = startPage; i <= endPage; i++) {
        const pageBtn = createPageButton(i, i, i === currentPage);
        container.appendChild(pageBtn);
    }

    if (currentPage < totalPages) {
        const nextBtn = createPageButton('Next', currentPage + 1);
        container.appendChild(nextBtn);
    }
}

function createPageButton(text, page, isActive = false) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.onclick = () => {
        if (currentQuery || currentLocation) performSearch(page);
        else loadJobsFromDB(page);
    };
    btn.className = isActive
        ? 'px-4 py-2 bg-primary-600 text-white rounded-lg'
        : 'px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50';
    return btn;
}

function showLoading() {
    document.getElementById('loadingState').classList.remove('hidden');
    document.getElementById('jobsContainer').innerHTML = '';
    document.getElementById('emptyState').classList.add('hidden');
}

function showEmptyState() {
    document.getElementById('emptyState').classList.remove('hidden');
    document.getElementById('jobsContainer').innerHTML = '';
    document.getElementById('loadingState').classList.add('hidden');
}

/**
 * Fetch user's applied job IDs to enable immediate filtering
 */
async function fetchAppliedStatus() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/applications/?page=1&size=1000`, {
            headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
        });
        if (response.ok) {
            const data = await response.json();
            const applications = data.applications || [];
            appliedJobIds = new Set(applications.map(app => String(app.job_id)));

            if (window.JobActions) {
                window.JobActions.appliedJobIds = appliedJobIds;
            }
        }
    } catch (e) {
        console.error('Failed to fetch application status:', e);
    }
}



// Phase 3: Batch selection functions
function toggleBatchMode(enabled) {
    batchModeActive = enabled;

    if (!enabled) {
        clearBatchSelection();
    }

    // Re-render jobs to show/hide checkboxes
    displayJobs(currentJobs);
}

function toggleJobSelection(jobId, checkbox) {
    if (checkbox.checked) {
        selectedJobs.add(jobId);
    } else {
        selectedJobs.delete(jobId);
    }
    updateBatchSelectionBar();
}

function updateBatchSelectionBar() {
    const bar = document.getElementById('batchSelectionBar');
    const count = document.getElementById('selectedCount');

    if (bar && count) {
        count.textContent = selectedJobs.size;
        bar.style.display = selectedJobs.size > 0 ? 'block' : 'none';
    }
}

function clearBatchSelection() {
    selectedJobs.clear();
    updateBatchSelectionBar();
    document.querySelectorAll('.job-select-checkbox').forEach(cb => {
        cb.checked = false;
    });
}

async function batchCustomize() {
    if (selectedJobs.size === 0) {
        CVision.Utils.showAlert('No jobs selected', 'error');
        return;
    }

    if (selectedJobs.size > 10) {
        CVision.Utils.showAlert('Maximum 10 jobs allowed for batch generation', 'error');
        return;
    }

    // Get user's CVs
    const cvs = await loadUserCVsForBatch();
    if (!cvs || cvs.length === 0) {
        CVision.Utils.showAlert('Please upload a CV first', 'error');
        return;
    }

    // Use first CV for batch
    const cvId = cvs[0].id;

    try {
        if (typeof GenerationModule !== 'undefined') {
            await GenerationModule.batchCustomize(cvId, Array.from(selectedJobs));
            clearBatchSelection();
        } else {
            CVision.Utils.showAlert('Generation module not loaded', 'error');
        }
    } catch (error) {
        console.error('Batch customization failed:', error);
    }
}

async function loadUserCVsForBatch() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/documents/?document_type=cv`, {
            headers: {
                'Authorization': `Bearer ${CVision.Utils.getToken()}`
            }
        });

        if (!response.ok) throw new Error('Failed to load CVs');

        const data = await response.json();
        return data.documents || [];
    } catch (error) {
        console.error('Failed to load CVs:', error);
        return [];
    }
}

// ============================================================================
// Phase 6: Browser Automation Apply Functions
// ============================================================================

// ============================================================================
// Application Limits Logic
// ============================================================================

async function checkApplicationLimit() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/subscriptions/usage`, {
            headers: {
                'Authorization': `Bearer ${CVision.Utils.getToken()}`
            }
        });

        if (!response.ok) throw new Error('Failed to fetch plan usage');

        const stats = await response.json();
        const used = Number(stats.current_usage?.manual_applications) || 0;
        const limit = Number(stats.limits?.manual_applications);

        if (!Number.isFinite(limit) || limit >= 9999) return true;

        if (used >= limit) {
            const message = limit === 0
                ? 'Manual applications are not included on this plan.'
                : `You have used ${used} of ${limit} manual applications this period.`;
            if (typeof UpgradeModal !== 'undefined') {
                UpgradeModal.show('Application limit reached', message);
            } else {
                alert(message);
            }
            return false;
        }

        return true;
    } catch (error) {
        console.error('Error checking limits:', error);
        if (typeof CVision !== 'undefined') {
            CVision.Utils.showAlert('Could not confirm your application allowance. Try again.', 'error');
        }
        return false;
    }
}

// Legacy increment removed as backend handles it automatically
function incrementApplicationCount() {
    // No-op for backward compatibility if called
}

/**
 * Phase 6: Apply to job with browser automation
 * Opens modal for CV/cover letter selection, then starts browser autofill
 */
// Quick Apply logic moved to quick-apply.js component

/**
 * Track application in database (Legacy - now handled by backend)
 */
async function trackApplication(jobId, cvId, coverLetterId) {
    // This is now handled automatically by the backend email-applications endpoint
    console.log('Application tracking handled by backend');
}

/**
 * Show apply modal for job application
 */
/**
 * Show apply modal for job application
 */




/**
 * Close apply modal
 */


// ============================================================================
// Phase 3: Customization Modal Functions
// ============================================================================

// Legacy customization logic removed. Handled by JobActions.js

// Customization logic moved to JobActions.js

// ============================================================================
// Make functions available globally for onclick handlers
// ============================================================================
window.saveJob = saveJob;

window.toggleJobSelection = toggleJobSelection;
window.clearBatchSelection = clearBatchSelection;
window.batchCustomize = batchCustomize;
window.toggleBatchMode = toggleBatchMode;
// window.showCustomizeModal = showCustomizeModal;
// window.closeCustomizeModal = closeCustomizeModal;
// window.startCustomization = startCustomization;
// window.startBrowserAutofill = startBrowserAutofill; // Deprecated - using openQuickApplyForm instead


// Logic moved to JobApply.js

// Logic moved to JobApply.js

/**
 * Generate email preview
 */
// Email application logic moved to JobApply.js

/**
 * Connect Gmail account
 */
function connectGmail() {
    window.location.href = `${CONFIG.API_BASE_URL}${CONFIG.API_PREFIX} /auth/gmail / connect`;
}

// Logic migrated to JobApply.js component
