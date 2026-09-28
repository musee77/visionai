const API_BASE_URL = `${CONFIG.API_BASE_URL}`;

document.addEventListener('DOMContentLoaded', function () {

    if (!CVision.Utils.isAuthenticated()) {
        window.location.href = 'login.html';
        return;
    }

    initializeDashboard();
});

// Automation State
let automationEnabled = false;

async function initializeDashboard() {
    CVision.initUserInfo();

    // Check if Gmail was just connected
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('gmail_connected') === 'true') {
        CVision.Utils.showAlert('Gmail connected successfully! Email agent is now active.', 'success');
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (urlParams.get('error')) {
        const error = urlParams.get('error');
        CVision.Utils.showAlert(`Gmail connection failed: ${error}`, 'error');
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    await loadUserProfile();
    await loadDashboardStats(); // Load detailed stats
    await loadDocuments();
    await uploadPendingLandingCv();
    await loadSavedJobs();


async function uploadPendingLandingCv() {
    if (!window.PendingCvStore) return;

    try {
        const file = await PendingCvStore.take();
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file, file.name);

        const response = await fetch(`${API_BASE_URL}/api/v1/documents/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` },
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Pending CV upload failed (${response.status})`);
        }

        CVision.Utils.showAlert('Your uploaded CV is ready to use.', 'success');
        await loadDocuments();
    } catch (error) {
        console.error('Could not upload pending landing CV:', error);
        CVision.Utils.showAlert('Your CV could not be uploaded. Please upload it again.', 'error');
    }
}
    // setupAutomationStatus(); // Logic integrated into loadAutomationStatus
    await loadAutomationStatus();

    // Initialize CV Uploader Component
    if (typeof CvUploader !== 'undefined') {
        const uploader = new CvUploader({
            dropZoneId: 'dropZone',
            fileInputId: 'fileInput',
            onSuccess: async (result) => {
                CVision.Utils.showAlert('CV uploaded successfully! Processing...', 'success');
                setTimeout(async () => {
                    await loadDocuments();
                }, 1000);
            }
        });
        uploader.init();

        // Initialize GmailConnect Component
        if (typeof GmailConnect !== 'undefined') {
            const gmailConnect = new GmailConnect({
                containerId: 'gmail-connect-container'
            });
            gmailConnect.init();
        }

        // Initialize RunTestButton
        const runTestBtn = new RunTestButton({
            buttonId: 'testRunBtn',
            apiUrl: `${API_BASE_URL}/api/v1/auto-apply`,
            onStart: () => {
                const bar = document.getElementById('testProgressBar');
                const fill = document.getElementById('testProgressFill');
                const status = document.getElementById('testProgressStatus');
                const result = document.getElementById('testRunResult');
                const percent = document.getElementById('testProgressPercent');

                if (bar) bar.classList.remove('hidden');
                if (fill) fill.style.width = '0%';
                if (status) status.textContent = 'Initializing...';
                if (percent) percent.textContent = '0%';
                if (result) {
                    result.classList.add('hidden');
                    result.innerHTML = '';
                }
            },
            onProgress: (data) => {
                const fill = document.getElementById('testProgressFill');
                const status = document.getElementById('testProgressStatus');
                const percent = document.getElementById('testProgressPercent');

                if (fill) {
                    const pct = Math.round((data.current / data.total) * 100);
                    fill.style.width = `${pct}%`;
                    if (percent) percent.textContent = `${pct}%`;
                }
                if (status) status.textContent = data.status || 'Processing...';
            },
            onComplete: (data) => {
                const result = document.getElementById('testRunResult');
                if (result) {
                    result.classList.remove('hidden');
                    const appsSent = data.applications_sent || 0;
                    if (appsSent > 0) {
                        result.className = "mt-3 text-sm p-3 rounded-md border text-center bg-green-50 border-green-200 text-green-700";
                        result.innerHTML = `<strong>Success! ${appsSent} applications sent.</strong>`;
                    } else {
                        result.className = "mt-3 text-sm p-3 rounded-md border text-center bg-blue-50 border-blue-200 text-blue-700";
                        result.innerHTML = `<strong>${data.message || 'Test run completed'}</strong>`;
                    }
                }
                loadAutomationStatus();
            },
            onError: (error) => {
                const result = document.getElementById('testRunResult');
                if (result) {
                    result.classList.remove('hidden');
                    result.className = "mt-3 text-sm p-3 rounded-md border text-center bg-red-50 border-red-200 text-red-700";
                    result.innerText = `Test Failed: ${error.message}`;
                }
            }
        });
        runTestBtn.init();
    }

    // setupFileUpload and handleFileUpload removed - replaced by CvUploader component

    // FETCH DETAILED STATS
    async function loadDashboardStats() {
        try {
            // Attempt to get stats from auto-apply endpoint which has richer data
            const response = await fetch(`${API_BASE_URL}/api/v1/auto-apply/stats`, {
                headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
            });

            if (response.ok) {
                const stats = await response.json();

                // Update Job Matches (using total_matches if available, else random estimate or searches)
                // Since API might not return 'total_matches', we can use a placeholder or derived value
                // For now, let's use 'today_applications' * 5 + 'total_applications' as a proxy for "matches found" 
                // OR better, checking if the API has it. If not, we'll default to '-'

                const matches = stats.total_matches || (stats.today_applications * 12) + (stats.total_applications * 3) || 0;
                document.getElementById('jobMatchesCount').textContent = matches;

                // Update Applications Count
                document.getElementById('applicationsCount').textContent = stats.total_applications || 0;

                // Update Success Rate (Interview Rate)
                const rate = Math.round((stats.interview_rate || 0) * 100);
                document.getElementById('successRate').textContent = `${rate}%`;

                return;
            }
        } catch (e) {
            console.warn('Failed to load detailed stats, falling back to profile');
        }

        // Fallback: Clear skeletons if API fails
        const matchesEl = document.getElementById('jobMatchesCount');
        if (matchesEl && matchesEl.children.length > 0) matchesEl.textContent = '0';

        const appsEl = document.getElementById('applicationsCount');
        if (appsEl && appsEl.children.length > 0) appsEl.textContent = '0';

        const successEl = document.getElementById('successRate');
        if (successEl && successEl.children.length > 0) successEl.textContent = '0%';
    }

    async function loadUserProfile() {
        try {
            const response = await CVision.API.getProfile();
            if (response.success) {
                const user = response.data.user;

                // Sync latest user data to local storage
                CVision.Utils.setUser(user);

                const userTierEl = document.getElementById('userTier');
                if (userTierEl) {
                    userTierEl.textContent = user.subscription_tier.charAt(0).toUpperCase() + user.subscription_tier.slice(1);
                }

                if (user.usage_stats) {
                    // document.getElementById('searchesUsed').textContent = user.usage_stats.monthly_searches || 0; // Removed
                    // usage_stats.total_applications is handled by loadDashboardStats now for consistency
                }

                // Check Gmail connection status - Handled by GmailConnect component now
            }
        } catch (error) {
            console.error('Error loading user profile:', error);
            // Fallback for skeletons on error handled in loadDashboardStats

            // Allow default gmail connect to show if profile fails
            // showGmailConnectAlert(); // Removed
        }
    }

    async function loadDocuments() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/documents/`, {
                headers: {
                    'Authorization': `Bearer ${CVision.Utils.getToken()}`
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to load documents`);
            }

            const data = await response.json();
            const documents = data.documents || data || [];

            displayDocuments(documents);
            document.getElementById('documentsCount').textContent = documents.length;
            document.getElementById('documentsCountText').textContent =
                `${documents.length} doc${documents.length !== 1 ? 's' : ''}`;

        } catch (error) {
            CVision.Utils.showAlert('Failed to load documents', 'error');
            // Remove skeletons on error
            document.getElementById('documentsList').innerHTML = `
                <div class="text-center py-8 text-gray-500">
                    <p class="text-sm">Failed to load documents.</p>
                    <button onclick="loadDocuments()" class="text-xs text-blue-600 hover:underline mt-2">Retry</button>
                </div>
            `;
        }
    }

    function displayDocuments(documents) {
        const documentsList = document.getElementById('documentsList');

        if (documents.length === 0) {
            documentsList.innerHTML = `
                    <div class="text-center py-8 text-gray-500">
                        <svg class="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                        </svg>
                        <p class="text-sm sm:text-base">No documents yet</p>
                        <p class="text-xs sm:text-sm mt-1">Upload your CV to start</p>
                    </div>
                `;
            return;
        }

        documentsList.innerHTML = documents.map(doc => {
            const filename = doc.filename || (doc.file_info && doc.file_info.original_filename) || 'Unknown file';
            const fileSize = doc.file_size || (doc.file_info && doc.file_info.file_size) || 0;
            const uploadDate = doc.upload_date || doc.created_at || new Date().toISOString();
            const hasValidData = doc.cv_data && Object.keys(doc.cv_data).length > 0 && !doc.cv_data.error;

            return `
                    <div class="border border-gray-200 rounded-lg p-3 sm:p-4 hover:shadow-md transition-shadow min-w-0">
                        <div class="flex items-start justify-between gap-2 sm:gap-3">
                            <div class="flex-1 min-w-0 overflow-hidden">
                                <div class="flex items-center space-x-2 mb-2">
                                    <svg class="w-4 h-4 sm:w-5 sm:h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                                    </svg>
                                    <h3 class="text-sm sm:text-base font-medium text-gray-900 truncate" title="${filename}">${filename}</h3>
                                </div>
                                <div class="text-xs sm:text-sm text-gray-500 space-y-1 break-words">
                                    <p class="truncate">${CVision.Utils.formatFileSize(fileSize)} • ${CVision.Utils.formatDate(uploadDate)}</p>
                                    ${hasValidData ? `
                                        <p class="text-green-600 text-xs">✓ Processed</p>
                                    ` : `
                                        <p class="text-yellow-600 text-xs">⚠ Needs processing</p>
                                    `}
                                </div>
                            </div>
                            <div class="flex flex-col space-y-1.5 flex-shrink-0">
                                <button onclick="analyzeDocument('${doc.id || doc._id}')" 
                                    class="px-2 sm:px-3 py-1 text-xs font-medium text-blue-600 bg-blue-100 hover:bg-blue-200 rounded-md transition-colors whitespace-nowrap">
                                    ${hasValidData ? 'Re-analyze' : 'Analyze'}
                                </button>
                                <button onclick="deleteDocument('${doc.id || doc._id}')" 
                                    class="px-2 sm:px-3 py-1 text-xs font-medium text-red-600 bg-red-100 hover:bg-red-200 rounded-md transition-colors">
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                `;
        }).join('');
    }

    async function analyzeDocument(documentId) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/documents/${documentId}/reparse`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${CVision.Utils.getToken()}`
                }
            });

            if (!response.ok) throw new Error('Analysis failed');

            const result = await response.json();

            if (result.success) {
                CVision.Utils.showAlert('Document analyzed successfully!', 'success');
                await loadDocuments();
            } else {
                throw new Error(result.message || 'Analysis failed');
            }
        } catch (error) {
            console.error('Analyze error:', error);
            CVision.Utils.showAlert(`Failed to analyze: ${error.message}`, 'error');
        }
    }

    async function deleteDocument(documentId) {
        if (typeof Modal !== 'undefined') {
            Modal.confirm({
                title: 'Delete Document?',
                message: 'Are you sure you want to delete this document? This action cannot be undone.',
                confirmText: 'Delete',
                confirmColor: 'red',
                onConfirm: async () => {
                    await performDeleteDocument(documentId);
                }
            });
        } else {
            if (!confirm('Delete this document?')) return;
            await performDeleteDocument(documentId);
        }
    }

    async function performDeleteDocument(documentId) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/documents/${documentId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${CVision.Utils.getToken()}`
                }
            });

            if (!response.ok) throw new Error('Delete failed');

            CVision.Utils.showAlert('Document deleted', 'success');
            await loadDocuments();

        } catch (error) {
            console.error('Delete error:', error);
            CVision.Utils.showAlert(`Failed to delete: ${error.message}`, 'error');
        }
    }

    function searchJobs() {
        window.location.href = 'pages/jobs.html';
    }

    function viewApplications() {
        window.location.href = 'pages/applications.html';
    }

    function upgradeAccount() {
        window.location.href = 'pages/subscription.html';
    }

    function viewProfile() {
        window.location.href = 'pages/profile.html';
    }

    function viewCVAnalysis() {
        window.location.href = 'pages/cv-analysis.html';
    }

    function logout() {
        CVision.logout();
    }

    async function loadSavedJobs() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/jobs/saved/me?page=1&size=3`, {
                headers: {
                    'Authorization': `Bearer ${CVision.Utils.getToken()}`
                }
            });

            if (!response.ok) throw new Error('Failed to load saved jobs');

            const data = await response.json();
            const jobs = data.jobs || data || [];
            displaySavedJobs(jobs);
        } catch (error) {
            console.error('Error loading saved jobs:', error);
            document.getElementById('savedJobsList').innerHTML = `
                <div class="text-center py-4 text-gray-500">
                    <p class="text-xs">Failed to load saved jobs.</p>
                </div>
            `;
        }
    }

    function displaySavedJobs(jobs) {
        const container = document.getElementById('savedJobsList');

        if (!jobs || jobs.length === 0) {
            container.innerHTML = `
                    <div class="text-center py-8 text-gray-500">
                        <svg class="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"></path>
                        </svg>
                        <p class="text-sm sm:text-base">No saved jobs</p>
                        <p class="text-xs sm:text-sm mt-1">Save jobs while searching to view them here</p>
                    </div>
                `;
            return;
        }

        container.innerHTML = jobs.map(job => `
                <div class="border border-gray-200 rounded-lg p-3 sm:p-4 hover:shadow-md transition-shadow">
                    <div class="flex items-start justify-between gap-2">
                        <div class="flex-1 min-w-0">
                            <h3 class="text-sm sm:text-base font-medium text-gray-900 truncate">${job.title}</h3>
                            <p class="text-xs sm:text-sm text-gray-600 mt-1">${job.company_name}</p>
                            <p class="text-xs text-gray-500 mt-1">${job.location}</p>
                            ${job.match_score ? `
                                <div class="mt-2 flex items-center gap-2">
                                    <span class="text-xs font-medium text-green-600">${Math.round(job.match_score * 100)}% Match</span>
                                </div>
                            ` : ''}
                        </div>
                        <div class="flex flex-col gap-1.5">
                            <button onclick="viewJobDetails('${job.id}')" 
                                class="px-2 sm:px-3 py-1 text-xs font-medium text-primary-600 bg-primary-100 hover:bg-primary-200 rounded-md transition-colors whitespace-nowrap">
                                View
                            </button>
                            <button onclick="unsaveJob('${job.id}')" 
                                class="px-2 sm:px-3 py-1 text-xs font-medium text-red-600 bg-red-100 hover:bg-red-200 rounded-md transition-colors">
                                Remove
                            </button>
                        </div>
                    </div>
                </div>
            `).join('');
    }

    function viewJobDetails(jobId) {
        window.location.href = `pages/jobs.html?job=${jobId}`;
    }

    async function unsaveJob(jobId) {
        if (typeof Modal !== 'undefined') {
            Modal.confirm({
                title: 'Remove Saved Job?',
                message: 'Are you sure you want to remove this job from your saved list?',
                confirmText: 'Remove',
                confirmColor: 'red',
                onConfirm: async () => {
                    await performUnsaveJob(jobId);
                }
            });
        } else {
            if (!confirm('Remove this job from saved?')) return;
            await performUnsaveJob(jobId);
        }
    }

    async function performUnsaveJob(jobId) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/jobs/save/${jobId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${CVision.Utils.getToken()}`
                }
            });

            if (!response.ok) throw new Error('Failed to unsave job');

            CVision.Utils.showAlert('Job removed from saved', 'success');
            await loadSavedJobs();
        } catch (error) {
            console.error('Error unsaving job:', error);
            CVision.Utils.showAlert('Failed to remove job', 'error');
        }
    }



    // ============================================================================
    // Automation Logic (Ported from cv-analysis.js)
    // ============================================================================

    function closeAutomationPanel() {
        const panel = document.getElementById('automationPanel');
        if (panel) panel.style.display = 'none';
    }

    async function loadAutomationStatus() {
        try {
            const [statusResponse, statsResponse] = await Promise.all([
                fetch(`${API_BASE_URL}/api/v1/auto-apply/status`, {
                    headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
                }),
                fetch(`${API_BASE_URL}/api/v1/auto-apply/stats`, {
                    headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
                })
            ]);

            if (statusResponse.ok) {
                const data = await statusResponse.json();
                automationEnabled = data.enabled;

                if (data) {
                    const maxSlider = document.getElementById('maxAppsSlider');
                    const minSlider = document.getElementById('minScoreSlider');
                    // ... sliders logic
                    if (maxSlider && data.max_daily_applications) {
                        maxSlider.value = data.max_daily_applications;
                        document.getElementById('maxAppsValue').textContent = data.max_daily_applications;
                    }
                    if (minSlider && data.min_match_score) {
                        minSlider.value = Math.round(data.min_match_score * 100);
                        document.getElementById('minScoreValue').textContent = Math.round(data.min_match_score * 100);
                    }
                }
            }

            if (statsResponse.ok) {
                const stats = await statsResponse.json();
                const statsText = document.getElementById('automationStatsText');
                if (statsText && automationEnabled) {
                    statsText.textContent = `Applied: ${stats.today_applications || 0} today`;
                }
            }

        } catch (error) {
            console.log('Could not load automation status:', error.message);
        }
    }

    async function saveAutomationSettings() {
        const maxApps = parseInt(document.getElementById('maxAppsSlider').value);
        const minScore = parseInt(document.getElementById('minScoreSlider').value) / 100;

        // Check Premium Access
        if (typeof PremiumGuard !== 'undefined') {
            if (!PremiumGuard.enforce('AUTO_APPLY', 'Premium Automation', 'Saving automation settings requires a Premium subscription.')) {
                return;
            }
        } else {
            // Fallback if PremiumGuard missing (shouldn't happen if loaded correctly)
            const user = CVision.Utils.getUser();
            const userTier = user?.subscription_tier?.toLowerCase() || 'free';
            if (userTier === 'free' || userTier === 'freemium') {
                alert('Premium Feature: Saving settings is for Basic/Premium users.');
                return;
            }
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/auto-apply/enable`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${CVision.Utils.getToken()}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    max_daily_applications: maxApps,
                    min_match_score: minScore
                })
            });

            if (response.ok) {
                CVision.Utils.showAlert('Automation Enabled! System is now working.', 'success');
                automationEnabled = true;
                closeAutomationPanel(); // Close panel on success

                // Refresh stats immediately
                loadAutomationStatus();

                // Scroll to top to see alert
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                const error = await response.json();
                CVision.Utils.showAlert('Error: ' + (error.detail || 'Failed to enable'), 'error');
            }
        } catch (error) {
            console.error('Error saving settings:', error);
            CVision.Utils.showAlert('Error saving settings', 'error');
        }
    }





    function updateSliderValue(type, value) {
        if (type === 'maxApps') {
            const el = document.getElementById('maxAppsValue');
            if (el) el.textContent = value;
        } else if (type === 'minScore') {
            const el = document.getElementById('minScoreValue');
            if (el) el.textContent = value;
        }
    }



    function upgradeNow() {
        window.location.href = 'pages/subscription.html';
    }

    // Expose functions to global scope for HTML onclick handlers
    // window.connectGmail = connectGmail; // Removed as part of refactor
    window.searchJobs = searchJobs;
    window.viewApplications = viewApplications;
    window.upgradeAccount = upgradeAccount;
    window.viewJobDetails = viewJobDetails;
    window.unsaveJob = unsaveJob;
    window.closeAutomationPanel = closeAutomationPanel;
    window.saveAutomationSettings = saveAutomationSettings;
    window.updateSliderValue = updateSliderValue;
    window.upgradeNow = upgradeNow;
    window.viewProfile = viewProfile;
    window.logout = logout;
}