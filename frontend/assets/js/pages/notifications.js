const API_BASE_URL = `${CONFIG.API_BASE_URL}`;
let allNotifications = [];
let filteredNotifications = [];
let currentFilter = 'all';
let currentPage = 1;
const itemsPerPage = 20;

// Load navbar
fetch('../components/navbar.html?v=1.4')
    .then(response => response.text())
    .then(html => {
        document.getElementById('navbar-container').innerHTML = html;
        CVisionNavbar.init('Notifications');
    });

document.addEventListener('DOMContentLoaded', () => {
    if (!CVision.Utils.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    loadNotifications();
});

async function loadNotifications() {
    showLoading();

    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/notifications/?limit=100&unread_only=false`, {
            headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
        });

        if (!response.ok) throw new Error('Failed to load notifications');

        allNotifications = await response.json();
        filteredNotifications = [...allNotifications];

        updateStats();
        displayNotifications();
        hideLoading();

    } catch (error) {
        console.error('Error loading notifications:', error);
        hideLoading();
        showError();
    }
}

function updateStats() {
    const total = allNotifications.length;
    const unread = allNotifications.filter(n => !n.is_read).length;
    const today = allNotifications.filter(n => {
        const notifDate = new Date(n.created_at);
        const now = new Date();
        return notifDate.toDateString() === now.toDateString();
    }).length;

    document.getElementById('totalCount').textContent = total;
    document.getElementById('unreadCount').textContent = unread;
    document.getElementById('todayCount').textContent = today;
}

function filterNotifications(filter) {
    currentFilter = filter;
    currentPage = 1;

    // Update active button
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active', 'bg-blue-600', 'text-white');
        btn.classList.add('text-gray-700', 'bg-white');
    });
    event.target.classList.add('active');
    event.target.classList.remove('text-gray-700', 'bg-white');
    event.target.classList.add('bg-blue-600', 'text-white');

    // Apply filter
    if (filter === 'all') {
        filteredNotifications = [...allNotifications];
    } else if (filter === 'unread') {
        filteredNotifications = allNotifications.filter(n => !n.is_read);
    } else {
        filteredNotifications = allNotifications.filter(n => n.type === filter);
    }

    displayNotifications();
}

function displayNotifications() {
    const container = document.getElementById('pageNotificationsList');
    const loadingState = document.getElementById('loadingState');
    const emptyState = document.getElementById('emptyState');
    const pagination = document.getElementById('pagination');

    if (filteredNotifications.length === 0) {
        container.classList.add('hidden');
        emptyState.classList.remove('hidden');
        pagination.classList.add('hidden');
        return;
    }

    emptyState.classList.add('hidden');
    container.classList.remove('hidden');

    // Calculate pagination
    const totalPages = Math.ceil(filteredNotifications.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageNotifications = filteredNotifications.slice(startIndex, endIndex);

    // Display notifications
    container.innerHTML = pageNotifications.map(notif => {
        const isUnread = !notif.is_read;
        const timeAgo = formatTimeAgo(notif.created_at);
        const icon = getNotificationIcon(notif.type);
        const iconColor = getIconColor(notif.type);

        return `
                    <div class="notification-card ${isUnread ? 'unread' : ''} bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
                        <div class="flex items-start gap-4">
                            <div class="flex-shrink-0 p-2 ${iconColor} rounded-lg">
                                ${icon}
                            </div>
                            <div class="flex-1 min-w-0">
                                <div class="flex items-start justify-between gap-2 mb-2">
                                    <h3 class="text-base sm:text-lg font-semibold text-gray-900 ${isUnread ? 'font-bold' : ''}">${notif.title}</h3>
                                    ${isUnread ? '<span class="flex-shrink-0 px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">New</span>' : ''}
                                </div>
                                <p class="text-sm sm:text-base text-gray-600 mb-3">${notif.message}</p>
                                <div class="flex items-center gap-4 text-xs sm:text-sm text-gray-500">
                                    <span class="flex items-center gap-1">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                                        </svg>
                                        ${timeAgo}
                                    </span>
                                    <span class="px-2 py-1 bg-gray-100 text-gray-600 rounded-full text-xs">${formatNotificationType(notif.type)}</span>
                                </div>
                            </div>
                            <div class="flex flex-col gap-2 flex-shrink-0">
                                ${isUnread ? `
                                    <button onclick="markAsRead('${notif.id}')" class="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Mark as read">
                                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                                        </svg>
                                    </button>
                                ` : ''}
                                <button onclick="deleteNotification('${notif.id}')" class="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
    }).join('');

    // Update pagination
    if (totalPages > 1) {
        pagination.classList.remove('hidden');
        document.getElementById('currentPage').textContent = currentPage;
        document.getElementById('totalPages').textContent = totalPages;
        document.getElementById('prevBtn').disabled = currentPage === 1;
        document.getElementById('nextBtn').disabled = currentPage === totalPages;
    } else {
        pagination.classList.add('hidden');
    }
}

function getNotificationIcon(type) {
    const icons = {
        'job_match': '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>',
        'application_update': '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
        'document_processed': '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>',
        'test': '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
    };
    return icons[type] || icons['test'];
}

function getIconColor(type) {
    const colors = {
        'job_match': 'bg-blue-100 text-blue-600',
        'application_update': 'bg-green-100 text-green-600',
        'document_processed': 'bg-purple-100 text-purple-600',
        'test': 'bg-gray-100 text-gray-600'
    };
    return colors[type] || colors['test'];
}

function formatNotificationType(type) {
    const types = {
        'job_match': 'Job Match',
        'application_update': 'Application',
        'document_processed': 'Document',
        'test': 'System'
    };
    return types[type] || type;
}

function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function markAsRead(notificationId) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/notifications/${notificationId}/read`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
        });

        if (!response.ok) throw new Error('Failed to mark as read');

        // Update local state
        const notif = allNotifications.find(n => n.id === notificationId);
        if (notif) notif.is_read = true;

        updateStats();
        displayNotifications();
        CVisionNavbar.refresh();

    } catch (error) {
        console.error('Error marking as read:', error);
        CVision.Utils.showAlert('Failed to mark as read', 'error');
    }
}

async function markAllAsRead() {
    if (!confirm('Mark all notifications as read?')) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/notifications/mark-all-read`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
        });

        if (!response.ok) throw new Error('Failed to mark all as read');

        allNotifications.forEach(n => n.is_read = true);
        updateStats();
        displayNotifications();
        CVisionNavbar.refresh();
        CVision.Utils.showAlert('All notifications marked as read', 'success');

    } catch (error) {
        console.error('Error marking all as read:', error);
        CVision.Utils.showAlert('Failed to mark all as read', 'error');
    }
}

async function deleteNotification(notificationId) {
    if (!confirm('Delete this notification?')) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/notifications/${notificationId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
        });

        if (!response.ok) throw new Error('Failed to delete');

        allNotifications = allNotifications.filter(n => n.id !== notificationId);
        filteredNotifications = filteredNotifications.filter(n => n.id !== notificationId);

        updateStats();
        displayNotifications();
        CVisionNavbar.refresh();
        CVision.Utils.showAlert('Notification deleted', 'success');

    } catch (error) {
        console.error('Error deleting notification:', error);
        CVision.Utils.showAlert('Failed to delete notification', 'error');
    }
}

async function deleteAllRead() {
    const readNotifications = allNotifications.filter(n => n.is_read);

    if (readNotifications.length === 0) {
        CVision.Utils.showAlert('No read notifications to delete', 'info');
        return;
    }

    if (!confirm(`Delete ${readNotifications.length} read notification(s)?`)) return;

    try {
        // Delete each read notification
        await Promise.all(
            readNotifications.map(n =>
                fetch(`${API_BASE_URL}/api/v1/notifications/${n.id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
                })
            )
        );

        allNotifications = allNotifications.filter(n => !n.is_read);
        filteredNotifications = filteredNotifications.filter(n => !n.is_read);

        updateStats();
        displayNotifications();
        CVisionNavbar.refresh();
        CVision.Utils.showAlert('Read notifications deleted', 'success');

    } catch (error) {
        console.error('Error deleting read notifications:', error);
        CVision.Utils.showAlert('Failed to delete read notifications', 'error');
    }
}

function previousPage() {
    if (currentPage > 1) {
        currentPage--;
        displayNotifications();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function nextPage() {
    const totalPages = Math.ceil(filteredNotifications.length / itemsPerPage);
    if (currentPage < totalPages) {
        currentPage++;
        displayNotifications();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function showLoading() {
    document.getElementById('loadingState').classList.remove('hidden');
    document.getElementById('pageNotificationsList').classList.add('hidden');
    document.getElementById('emptyState').classList.add('hidden');
}

function hideLoading() {
    document.getElementById('loadingState').classList.add('hidden');
}

function showError() {
    const emptyState = document.getElementById('emptyState');
    emptyState.classList.remove('hidden');
    emptyState.innerHTML = `
                <svg class="w-16 h-16 mx-auto mb-4 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <h3 class="text-lg font-medium text-gray-900 mb-2">Failed to load notifications</h3>
                <p class="text-gray-600 mb-4">There was an error loading your notifications.</p>
                <button onclick="loadNotifications()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    Try Again
                </button>
            `;
}