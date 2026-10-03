const API_BASE_URL = `${CONFIG.API_BASE_URL}`;
let currentTab = 'applications';
const loadedTabs = new Set();

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
window.escapeHtml = escapeHtml;

async function loadTabComponent(tabName) {
    if (loadedTabs.has(tabName)) return;

    const containerId = `content-${tabName}`;
    const container = document.getElementById(containerId);
    if (!container) return;

    try {
        // Load HTML
        const response = await fetch(`../components/applications/${tabName}-tab.html?v=${Date.now()}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const html = await response.text();
        container.innerHTML = html;

        // Load JS
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            const scriptUrl = `../assets/js/components/applications/${tabName}-tab.js?v=${Date.now()}`;
            console.log(`Loading component script: ${scriptUrl}`);
            script.src = scriptUrl;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load script for ${tabName} at ${scriptUrl}`));
            document.head.appendChild(script);
        });

        loadedTabs.add(tabName);
    } catch (error) {
        console.error(`Error loading tab component ${tabName}:`, error);
        container.innerHTML = `<div class="p-4 text-red-600">Failed to load content for ${tabName}. Please refresh.</div>`;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!CVision.Utils.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    loadStats();
    await loadTabComponent('applications');
    loadApplications();
});

// ==================== APPLICATION PAGE FUNCTIONS ====================
async function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('border-primary-600', 'text-primary-600');
        btn.classList.add('border-transparent', 'text-gray-500');
    });

    const tabElement = document.getElementById(`tab-${tab}`);
    if (tabElement) {
        tabElement.classList.remove('border-transparent', 'text-gray-500');
        tabElement.classList.add('border-primary-600', 'text-primary-600');
    }

    document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));

    await loadTabComponent(tab);

    const contentElement = document.getElementById(`content-${tab}`);
    if (contentElement) {
        contentElement.classList.remove('hidden');
    }

    if (tab === 'applications') loadApplications();
    else if (tab === 'responses') loadReceivedResponses();
    else if (tab === 'interviews') loadUpcomingInterviews();
    else if (tab === 'followups') loadFollowUps();
    else if (tab === 'saved') loadSavedJobs();
}

async function loadStats() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/applications/stats/overview`, {
            headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
        });
        if (!response.ok) throw new Error('Failed');
        const stats = await response.json();

        const statsContainer = document.getElementById('statsOverview');
        if (statsContainer) {
            statsContainer.innerHTML = `
                <div class="bg-white rounded-lg shadow-sm border p-6">
                    <div class="text-sm text-gray-600 mb-1">Total Applications</div>
                    <div class="text-3xl font-bold text-gray-900">${stats.total_applications || 0}</div>
                </div>
                <div class="bg-white rounded-lg shadow-sm border p-6">
                    <div class="text-sm text-gray-600 mb-1">Active</div>
                    <div class="text-3xl font-bold text-blue-600">${stats.active_applications || 0}</div>
                </div>
                <div class="bg-white rounded-lg shadow-sm border p-6">
                    <div class="text-sm text-gray-600 mb-1">Interviews</div>
                    <div class="text-3xl font-bold text-purple-600">${stats.pending_interviews || 0}</div>
                </div>
                <div class="bg-white rounded-lg shadow-sm border p-6">
                    <div class="text-sm text-gray-600 mb-1">Response Rate</div>
                    <div class="text-3xl font-bold text-green-600">${Math.round(stats.response_rate || 0)}%</div>
                </div>
            `;
        }
    } catch (error) {
        console.error('Stats error:', error);
    }
}

function getStatusBadge(status) {
    const colors = {
        draft: 'bg-gray-100 text-gray-700',
        pending: 'bg-yellow-100 text-yellow-800',
        failed: 'bg-red-100 text-red-800',
        processing: 'bg-blue-100 text-blue-700',
        submitted: 'bg-blue-100 text-blue-700',
        applied: 'bg-blue-100 text-blue-800',
        under_review: 'bg-indigo-100 text-indigo-800',
        interview_scheduled: 'bg-purple-100 text-purple-800',
        interview_completed: 'bg-purple-200 text-purple-900',
        second_round: 'bg-violet-100 text-violet-800',
        final_round: 'bg-violet-200 text-violet-900',
        offer_received: 'bg-green-100 text-green-800',
        offer_accepted: 'bg-green-600 text-white',
        offer_declined: 'bg-yellow-100 text-yellow-800',
        rejected: 'bg-red-100 text-red-800',
        withdrawn: 'bg-gray-200 text-gray-700',
        on_hold: 'bg-orange-100 text-orange-800',
        archived: 'bg-gray-300 text-gray-600'
    };
    return `<span class="status-badge ${colors[status] || colors.draft}">${formatEnumValue(status)}</span>`;
}

function getPriorityBadge(priority) {
    const colors = { high: 'bg-red-100 text-red-700', medium: 'bg-yellow-100 text-yellow-700', low: 'bg-green-100 text-green-700' };
    return `<span class="px-2 py-1 rounded text-xs font-medium ${colors[priority] || colors.medium}">${formatEnumValue(priority)} Priority</span>`;
}


function clearFilters() {
    const statusFilter = document.getElementById('filter-status');
    const priorityFilter = document.getElementById('filter-priority');
    const companyFilter = document.getElementById('filter-company');

    if (statusFilter) statusFilter.value = '';
    if (priorityFilter) priorityFilter.value = '';
    if (companyFilter) companyFilter.value = '';

    loadApplications();
}

function showStatusMenu(appId) {
    updateStatus(appId);
}

function formatEnumValue(value) {
    if (!value) return '';
    return value.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(dateString) {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}



// Event listener for job updates from JobActions
document.addEventListener('job:updated', (e) => {
    // If needed, refresh the list
    if (document.getElementById('content-saved') && !document.getElementById('content-saved').classList.contains('hidden')) {
        loadSavedJobs();
    }
});

// Alias for JobActions compatibility
window.applyToJob = (jobId) => window.JobApply.openApplyModal(jobId);

// Ensure JobActions is available
if (!window.JobActions) {
    console.error('JobActions component not loaded');
}

/**
 * Save or update a job with optional extra data (like generated document paths)
 * This is called by generation.js after successful document generation
 */
async function saveJob(jobId, silent = false, extraData = null) {
    try {
        const options = {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CVision.Utils.getToken()} `
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

        return response.json();
    } catch (error) {
        console.error('Error saving job:', error);
        if (!silent) {
            CVision.Utils.showAlert('Failed to save job', 'error');
        }
        throw error;
    }
}

// Make saveJob available globally for generation.js
window.saveJob = saveJob;
