const API_BASE_URL = `${CONFIG.API_BASE_URL}`;
let currentTab = 'applications';
let notificationPollingInterval = null;
const loadedTabs = new Set();

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

    initNavbar();
    loadStats();
    await loadTabComponent('applications');
    loadApplications();
});

// ==================== NAVBAR FUNCTIONS ====================
async function initNavbar() {
    setupNavbarEventListeners();
    await loadNavbarUserInfo();
    await loadNavbarNotifications();
    startNotificationPolling();
}

function setupNavbarEventListeners() {
    const notificationBtn = document.getElementById('notificationBtn');
    const notificationDropdown = document.getElementById('notificationDropdown');

    if (notificationBtn) {
        notificationBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            notificationDropdown?.classList.toggle('show');
            document.getElementById('userDropdown')?.classList.remove('show');
            document.getElementById('mobileMenu')?.classList.remove('show');
        });
    }

    const userMenuBtn = document.getElementById('userMenuBtn');
    const userDropdown = document.getElementById('userDropdown');

    if (userMenuBtn) {
        userMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            userDropdown?.classList.toggle('show');
            notificationDropdown?.classList.remove('show');
            document.getElementById('mobileMenu')?.classList.remove('show');
        });
    }

    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('mobileMenu')?.classList.toggle('show');
            notificationDropdown?.classList.remove('show');
            userDropdown?.classList.remove('show');
        });
    }

    document.getElementById('markAllReadBtn')?.addEventListener('click', markAllNotificationsAsRead);

    document.addEventListener('click', () => {
        notificationDropdown?.classList.remove('show');
        userDropdown?.classList.remove('show');
    });
}

async function loadNavbarUserInfo() {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/users/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            const data = await response.json();
            const user = data.user || data;

            const fullName = user.full_name || user.email || 'User';
            document.getElementById('userFullName').textContent = fullName;
            document.getElementById('userEmail').textContent = user.email;

            const initials = fullName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
            document.getElementById('userInitials').textContent = initials;

            const tier = user.subscription_tier || 'free';
            document.getElementById('navUserTier').textContent = tier.charAt(0).toUpperCase() + tier.slice(1);
        }
    } catch (error) {
        console.error('Error loading user info:', error);
    }
}

async function loadNavbarNotifications() {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/notifications/?limit=10&unread_only=false`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            const notifications = await response.json();
            displayNavbarNotifications(notifications);
            updateNotificationBadge(notifications);
        }
    } catch (error) {
        console.error('Error loading notifications:', error);
    }
}

function displayNavbarNotifications(notifications) {
    const container = document.getElementById('notificationsList');
    if (!container) return;

    if (!notifications || notifications.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 text-gray-500">
                <svg class="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path>
                </svg>
                <p class="text-sm">No notifications yet</p>
            </div>
        `;
        return;
    }

    container.innerHTML = notifications.map(notif => {
        const isUnread = !notif.is_read;
        const timeAgo = formatNotificationTime(notif.created_at);
        const icon = getNotificationIcon(notif.type);

        return `
            <div class="notification-item ${isUnread ? 'unread' : ''} px-4 py-3 cursor-pointer" 
                 onclick="markNotificationAsRead('${notif.id}')">
                <div class="flex items-start space-x-3">
                    <div class="flex-shrink-0 mt-1">${icon}</div>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-medium text-gray-900 ${isUnread ? 'font-semibold' : ''}">${notif.title}</p>
                        <p class="text-sm text-gray-600 mt-1">${notif.message}</p>
                        <p class="text-xs text-gray-500 mt-1">${timeAgo}</p>
                    </div>
                    ${isUnread ? '<div class="flex-shrink-0"><div class="w-2 h-2 bg-blue-600 rounded-full"></div></div>' : ''}
                </div>
            </div>
        `;
    }).join('');
}

function updateNotificationBadge(notifications) {
    const unreadCount = notifications.filter(n => !n.is_read).length;
    const badge = document.getElementById('notificationBadge');

    if (badge) {
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
}

function getNotificationIcon(type) {
    const icons = {
        'job_match': '<svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>',
        'application_update': '<svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
        'document_processed': '<svg class="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>',
        'test': '<svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
    };
    return icons[type] || icons['test'];
}

function formatNotificationTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return date.toLocaleDateString();
}

async function markNotificationAsRead(notificationId) {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
        await fetch(`${API_BASE_URL}/api/v1/notifications/${notificationId}/read`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        await loadNavbarNotifications();
    } catch (error) {
        console.error('Error marking notification as read:', error);
    }
}

async function markAllNotificationsAsRead() {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
        await fetch(`${API_BASE_URL}/api/v1/notifications/mark-all-read`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        await loadNavbarNotifications();
    } catch (error) {
        console.error('Error marking all as read:', error);
    }
}

function startNotificationPolling() {
    notificationPollingInterval = setInterval(loadNavbarNotifications, 30000);
}

function stopNotificationPolling() {
    if (notificationPollingInterval) {
        clearInterval(notificationPollingInterval);
    }
}

function logoutUser() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    stopNotificationPolling();
    window.location.href = '../login.html';
}

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
