// Self-contained Navbar Module - FIXED to use access_token
const CVisionNavbar = (function () {
    const API_BASE_URL = `${CONFIG.API_BASE_URL}`;
    const TOKEN_KEY = 'access_token'; // FIXED: Use correct token key
    let pollingInterval = null;
    let userInfo = null;

    // Get authentication token from localStorage
    function getToken() {
        return localStorage.getItem(TOKEN_KEY) || localStorage.getItem('token'); // Fallback for backwards compatibility
    }

    let isInitialized = false;

    // Initialize navbar
    async function init(pageTitle = '') {

        // Check if navbar HTML elements exist
        const navbarExists = document.getElementById('notificationBtn') !== null;

        if (!navbarExists) {
            return;
        }

        // Prevent duplicate initialization
        if (isInitialized) {
            return;
        }

        // Check if token exists
        const token = getToken();
        if (!token) {
            showLoggedOutState();
            return;
        }

        await loadUserInfo();
        await loadNotifications();
        startPolling();
        setActiveLink();

        isInitialized = true;
    }

    // Show logged out state
    function showLoggedOutState() {
        const userFullName = document.getElementById('userFullName');
        const userEmail = document.getElementById('userEmail');
        const userInitials = document.getElementById('userInitials');

        if (userFullName) userFullName.textContent = 'Not logged in';
        if (userEmail) userEmail.textContent = 'Please log in';
        if (userInitials) userInitials.textContent = '?';
    }

    // Set active navigation link based on current page
    function setActiveLink() {
        const currentPath = window.location.pathname;
        document.querySelectorAll('.nav-link').forEach(link => {
            const linkPath = new URL(link.href).pathname;
            if (currentPath === linkPath || currentPath.includes(linkPath.split('/').pop())) {
                link.classList.remove('text-gray-600');
                link.classList.add('text-blue-600', 'font-semibold');
            }
        });
    }

    // Setup all event listeners using delegation
    function setupEventListeners() {
        // Remove existing listener to be safe (though init guard prevents this)
        // We use a single document listener for all navbar interactions
        document.addEventListener('click', (e) => {
            const target = e.target;
            const notificationDropdown = document.getElementById('notificationDropdown');
            const userDropdown = document.getElementById('userDropdown');
            const mobileMenu = document.getElementById('mobileMenu');

            // Notification Button
            const notifBtn = target.closest('#notificationBtn');
            if (notifBtn) {
                e.preventDefault();
                e.stopPropagation();
                userDropdown?.classList.remove('show');
                mobileMenu?.classList.remove('show');
                notificationDropdown?.classList.toggle('show');
                return;
            }

            // User Menu Button
            const userBtn = target.closest('#userMenuBtn');
            if (userBtn) {
                e.preventDefault();
                e.stopPropagation();
                notificationDropdown?.classList.remove('show');
                mobileMenu?.classList.remove('show');
                userDropdown?.classList.toggle('show');
                return;
            }

            // Mobile Menu Button
            const mobileBtn = target.closest('#mobileMenuBtn');
            if (mobileBtn) {
                e.preventDefault();
                e.stopPropagation();
                notificationDropdown?.classList.remove('show');
                userDropdown?.classList.remove('show');
                mobileMenu?.classList.toggle('show');
                return;
            }

            // Mark All Read Button
            const markReadBtn = target.closest('#markAllReadBtn');
            if (markReadBtn) {
                e.preventDefault();
                e.stopPropagation();
                markAllAsRead();
                return;
            }

            // Click outside - close dropdowns
            // Don't close if clicking inside the dropdown itself (unless it's a link/button that should close it)
            const insideNotif = target.closest('#notificationDropdown');
            const insideUser = target.closest('#userDropdown');
            const insideMobile = target.closest('#mobileMenu');

            if (!insideNotif) notificationDropdown?.classList.remove('show');
            if (!insideUser) userDropdown?.classList.remove('show');
            // Mobile menu usually stays open until clicked outside or link clicked
            if (!insideMobile && !mobileBtn) mobileMenu?.classList.remove('show');
        });
    }

    // Load user information
    async function loadUserInfo() {
        const token = getToken();
        if (!token) {
            return;
        }



        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/users/me`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });



            if (!response.ok) {
                logout();
                return;
            }

            const data = await response.json();

            // Handle both direct response and nested user object
            const user = data.user || data;
            if (!user || !user.email) {
                logout();
                return;
            }
            userInfo = user;

            // Update UI with user information
            updateUserDisplay(user);

            // Store user info for other components
            localStorage.setItem('cvision_user', JSON.stringify(user));


        } catch (error) {
            console.error('CVisionNavbar: Error loading user:', error);
            logout();
        }
    }

    // Update user display in navbar
    function updateUserDisplay(user) {
        if (!user) {
            return;
        }

        // Update full name
        const fullNameEl = document.getElementById('userFullName');
        if (fullNameEl) {
            const fullName = user.full_name ||
                `${user.first_name || ''} ${user.last_name || ''}`.trim() ||
                user.email ||
                'User';
            fullNameEl.textContent = fullName;
            fullNameEl.style.color = ''; // Reset color
        }

        // Update email
        const emailEl = document.getElementById('userEmail');
        if (emailEl) {
            emailEl.textContent = user.email || 'No email';
        }

        // Update initials
        const initialsEl = document.getElementById('userInitials');
        if (initialsEl) {
            const fullName = user.full_name ||
                `${user.first_name || ''} ${user.last_name || ''}`.trim() ||
                user.email ||
                'User';
            const initials = fullName
                .split(' ')
                .filter(n => n.length > 0)
                .map(n => n[0])
                .join('')
                .toUpperCase()
                .substring(0, 2) || 'U';
            initialsEl.textContent = initials;
        }

        // Update subscription tier
        const tierEl = document.getElementById('navUserTier');
        if (tierEl) {
            const tier = String(user.subscription_tier || 'free');
            tierEl.textContent = tier.charAt(0).toUpperCase() + tier.slice(1);

            // Update tier badge color based on tier
            tierEl.className = 'hidden sm:inline-block px-3 py-1 text-xs font-medium rounded-full';
            switch (tier.toLowerCase()) {
                case 'premium':
                    tierEl.classList.add('bg-purple-100', 'text-purple-700');
                    break;
                case 'pro':
                    tierEl.classList.add('bg-green-100', 'text-green-700');
                    break;
                case 'basic':
                    tierEl.classList.add('bg-blue-100', 'text-blue-700');
                    break;
                default:
                    tierEl.classList.add('bg-gray-100', 'text-gray-700');
            }
        }

        labelLockedActions();

        window.dispatchEvent(new CustomEvent('userInfoLoaded', { detail: user }));
    }

    function labelLockedActions() {
        document.querySelectorAll('.js-auto-apply-link, a[href="/pages/auto-apply"], a[href="/pages/auto-apply.html"]').forEach((link) => {
            link.remove();
        });
    }

    // Get current user info
    function getUserInfo() {
        return userInfo;
    }

    // Refresh user info
    async function refreshUserInfo() {
        await loadUserInfo();
    }

    // Load notifications
    async function loadNotifications() {
        const token = getToken();
        if (!token) return;

        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/notifications/?limit=10&unread_only=false`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const notifications = await response.json();
                displayNotifications(notifications);
                updateBadge(notifications);
            } else {
                console.warn('CVisionNavbar: Failed to load notifications:', response.status);
            }
        } catch (error) {
            console.error('CVisionNavbar: Error loading notifications:', error);
        }
    }

    // Display notifications
    function displayNotifications(notifications) {
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
            const timeAgo = formatTime(notif.created_at);
            const icon = getIcon(notif.type);

            return `
                <div class="notification-item ${isUnread ? 'unread' : ''} px-4 py-3 cursor-pointer" 
                     onclick="CVisionNavbar.markAsRead('${notif.id}')">
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

    // Update notification badge
    function updateBadge(notifications) {
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

    // Get notification icon
    function getIcon(type) {
        const icons = {
            'job_match': '<svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>',
            'application_update': '<svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
            'document_processed': '<svg class="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>',
            'test': '<svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
        };
        return icons[type] || icons['test'];
    }

    // Format time ago
    function formatTime(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const seconds = Math.floor((now - date) / 1000);

        if (seconds < 60) return 'Just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
        return date.toLocaleDateString();
    }

    // Mark single notification as read
    async function markAsRead(notificationId) {
        const token = getToken();
        if (!token) return;

        try {
            await fetch(`${API_BASE_URL}/api/v1/notifications/${notificationId}/read`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            await loadNotifications();
        } catch (error) {
            console.error('CVisionNavbar: Error marking as read:', error);
        }
    }

    // Mark all as read
    async function markAllAsRead() {
        const token = getToken();
        if (!token) return;

        try {
            await fetch(`${API_BASE_URL}/api/v1/notifications/mark-all-read`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            await loadNotifications();
        } catch (error) {
            console.error('CVisionNavbar: Error marking all as read:', error);
        }
    }

    // Start polling
    function startPolling() {
        pollingInterval = setInterval(loadNotifications, 30000);
    }

    // Stop polling
    function stopPolling() {
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
    }

    // Logout
    function logout() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem('token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('cvision_user');
        localStorage.removeItem('user');
        stopPolling();
        if (!window.location.pathname.endsWith('login.html')) {
            window.location.replace('/login.html');
        }
    }

    // Initialize event listeners immediately (delegation doesn't require elements to exist)
    setupEventListeners();

    // Public API
    return {
        init,
        markAsRead,
        logout,
        refresh: loadNotifications,
        refreshUserInfo,
        getUserInfo,
        updateUserDisplay
    };
})();

// Expose to window immediately
window.CVisionNavbar = CVisionNavbar;


// Smart auto-initialization: only proceed if navbar HTML is loaded
function autoInit() {
    const navbarExists = document.getElementById('notificationBtn') !== null;
    if (navbarExists) {
        CVisionNavbar.init();
    } else {
        // Retry after a short delay
        setTimeout(autoInit, 100);
    }
}

// Start auto-initialization when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
} else {
    autoInit();
}