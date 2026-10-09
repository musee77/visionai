// Global configuration
// Helper to determine API URL
const getApiBaseUrl = () => {
    // If we are strictly in a development environment (localhost)
    // and not on the backend port (assuming 8000), point to backend directly
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        if (window.location.port !== '8000') {
            return `http://${window.location.hostname}:8000`;
        }
    }
    return window.location.origin;
};

// Global configuration
const CONFIG = {
    BASE_URL: window.location.origin,
    API_BASE_URL: getApiBaseUrl(),
    API_PREFIX: '/api/v1',
    TOKEN_KEY: 'access_token',
    REFRESH_TOKEN_KEY: 'refresh_token',
    USER_KEY: 'cvision_user'
};

// Make CONFIG globally accessible for other scripts
window.CONFIG = CONFIG;

// Utility functions
const Utils = {
    // Local storage management
    setToken(token) {
        localStorage.setItem(CONFIG.TOKEN_KEY, token);
    },

    getToken() {
        return localStorage.getItem(CONFIG.TOKEN_KEY);
    },

    removeToken() {
        localStorage.removeItem(CONFIG.TOKEN_KEY);
        localStorage.removeItem(CONFIG.REFRESH_TOKEN_KEY);
        localStorage.removeItem(CONFIG.USER_KEY);
    },

    setRefreshToken(token) {
        localStorage.setItem(CONFIG.REFRESH_TOKEN_KEY, token);
    },

    getRefreshToken() {
        return localStorage.getItem(CONFIG.REFRESH_TOKEN_KEY);
    },

    setUser(user) {
        localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(user));
    },

    getUser() {
        const user = localStorage.getItem(CONFIG.USER_KEY);
        return user ? JSON.parse(user) : null;
    },

    // Check if user is authenticated
    isAuthenticated() {
        return !!this.getToken();
    },

    // Decode JWT token
    decodeToken(token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            return payload;
        } catch (e) {
            console.error('Failed to decode token:', e);
            return null;
        }
    },

    // Check if token is expiring soon (within 5 minutes)
    isTokenExpiringSoon(token) {
        const payload = this.decodeToken(token);
        if (!payload || !payload.exp) return true;

        const now = Date.now() / 1000;
        const timeUntilExpiry = payload.exp - now;
        return timeUntilExpiry < 300; // 5 minutes
    },

    // Check if token is expired
    isTokenExpired(token) {
        const payload = this.decodeToken(token);
        if (!payload || !payload.exp) return true;

        const now = Date.now() / 1000;
        return payload.exp < now;
    },

    // Format date
    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    },

    // Format file size
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    // Show alert message (Uses Toast if available, falls back to DOM)
    showAlert(message, type = 'info') {
        if (window.Toast) {
            window.Toast.show(message, type);
            return;
        }

        // Fallback for when Toast isn't loaded
        const alert = document.createElement('div');
        alert.className = `alert alert-${type}`;
        alert.textContent = message;

        // Insert at top of main content area
        const main = document.querySelector('main') || document.body;
        main.insertBefore(alert, main.firstChild);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (alert.parentNode) {
                alert.parentNode.removeChild(alert);
            }
        }, 5000);
    },

    // Show loading state
    showLoading(element, text = 'Loading...') {
        const loading = document.createElement('div');
        loading.className = 'loading-overlay';
        loading.innerHTML = `
            <div class="loading"></div>
            <span>${text}</span>
        `;
        element.appendChild(loading);
    },

    hideLoading(element) {
        const loading = element.querySelector('.loading-overlay');
        if (loading) {
            loading.remove();
        }
    },

    // Get appropriate login URL based on current context
    getLoginUrl() {
        return window.location.pathname.includes('/admin/') ? '/admin/login' : '/login';
    },

    // Clean URL by removing .html extension
    cleanUrl(url) {
        if (!url) return url;
        // Remove .html extension
        return url.replace(/\.html$/, '');
    },

    // Global HTML entity decoder (handles multi-encoding & mojibake)
    decodeHtmlEntities(text) {
        if (!text) return '';
        let cleaned = text
            .replace(/â€™/g, "'")
            .replace(/â€˜/g, "'")
            .replace(/â€œ/g, '"')
            .replace(/â€ /g, '"')
            .replace(/â€“/g, "–")
            .replace(/â€”/g, "—")
            .replace(/â€¢/g, "•")
            .replace(/â€¦/g, "...")
            .replace(/Â/g, "")
            .replace(/Ã©/g, "é")
            .replace(/Ã/g, "à")
            .replace(/Ã¢â‚¬â„¢/g, "'")
            .replace(/Ã¢â‚¬Å“/g, '"')
            .replace(/Ã¢â‚¬Â/g, '"')
            .replace(/Ã¢â‚¬â€/g, "—")
            .replace(/Ã¢â‚¬â€œ/g, "–")
            .replace(/ÃÂ/g, "")
            .replace(/&nbsp;/g, ' ')
            .replace(/\r/g, '');

        const textArea = document.createElement('textarea');
        let decoded = cleaned;
        let lastDecoded;
        let passes = 0;
        do {
            lastDecoded = decoded;
            textArea.innerHTML = decoded;
            decoded = textArea.value;
            passes++;
        } while (decoded !== lastDecoded && passes < 3);

        return decoded.trim();
    },

    // Format snake_case enums to Title Case
    formatEnumValue(value) {
        if (!value) return '';
        return value.split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }
};

// API client
const API = {
    // Make authenticated request
    async request(endpoint, options = {}) {
        const url = `${CONFIG.API_BASE_URL}${CONFIG.API_PREFIX}${endpoint}`;
        const token = Utils.getToken();
        const isLoginRequest = endpoint === '/auth/login' || endpoint === '/admin/login';

        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        };

        // Add authorization header if token exists
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }

        try {
            let response;
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    response = await fetch(url, config);
                    if (![502, 503, 504].includes(response.status) || attempt === 1) break;
                } catch (networkError) {
                    if (attempt === 1) throw networkError;
                }
                await new Promise(resolve => setTimeout(resolve, 400));
            }

            // Handle backend errors (502/503) - redirect to login
            if ([502, 503, 504].includes(response.status)) {
                console.error('Backend is temporarily unavailable.');
                if (isLoginRequest) {
                    throw new Error('The server is temporarily unavailable. Please try again.');
                }
                Utils.removeToken();
                window.location.href = Utils.getLoginUrl();
                return;
            }

            // Handle 204 No Content (successful DELETE, etc.) - no body to parse
            if (response.status === 204) {
                return null; // Success, no content
            }

            // Try to parse JSON response
            let data;
            try {
                const text = await response.text();
                // Only parse if there's actual content
                if (text) {
                    data = JSON.parse(text);
                } else {
                    data = null;
                }
            } catch (jsonError) {
                // If JSON parse fails AND it's an error status, backend might be returning HTML
                if (!response.ok) {
                    console.error('Backend returned invalid JSON for error response');
                    throw new Error(`Request failed with status ${response.status}`);
                }
                // For successful responses with no/invalid JSON, just return null
                data = null;
            }

            // If unauthorized and we have a refresh token, try to refresh
            if (response.status === 401 && !isLoginRequest && Utils.getRefreshToken()) {
                const refreshed = await this.refreshAccessToken();
                if (refreshed) {
                    // Retry the original request with new token
                    config.headers.Authorization = `Bearer ${Utils.getToken()}`;
                    const retryResponse = await fetch(url, config);

                    // Handle 204 No Content in retry as well
                    if (retryResponse.status === 204) {
                        return null;
                    }

                    const retryText = await retryResponse.text();
                    return retryText ? JSON.parse(retryText) : null;
                } else {
                    // Refresh failed, redirect to login
                    console.error('Token refresh failed, redirecting to login...');
                    Utils.removeToken();
                    Utils.removeToken();
                    window.location.href = Utils.getLoginUrl();
                    return;
                }
            }

            // If still unauthorized after refresh attempt, redirect to login
            if (response.status === 401 && !isLoginRequest) {
                console.error('Unauthorized, redirecting to login...');
                Utils.removeToken();
                window.location.href = Utils.getLoginUrl();
                return;
            }

            if (!response.ok) {
                throw new Error(data.detail || data.message || 'Request failed');
            }

            return data;
        } catch (error) {
            console.error('API Error:', error);

            // Only redirect to login if it's a genuine network error (backend down)
            // NOT for application errors like 404, 500, etc.
            if (error.name === 'TypeError' && error.message.includes('Failed to fetch') && !isLoginRequest) {
                console.error('Network error, backend may be down. Redirecting to login...');
                Utils.removeToken();
                window.location.href = Utils.getLoginUrl();
                return;
            }

            // For all other errors, just throw them so the calling code can handle them
            throw error;
        }
    },

    // Auth endpoints - FROM ORIGINAL (WORKING)
    async register(userData) {
        return this.request('/auth/register', {
            method: 'POST',
            body: JSON.stringify(userData)
        });
    },

    async login(credentials) {
        return this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify(credentials)
        });
    },

    async logout() {
        return this.request('/auth/logout', {
            method: 'POST'
        });
    },

    async getProfile() {
        return this.request('/auth/me');
    },

    // Refresh access token
    async refreshAccessToken() {
        try {
            const refreshToken = Utils.getRefreshToken();
            if (!refreshToken) {
                return false;
            }

            const response = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.API_PREFIX}/auth/refresh`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ refresh_token: refreshToken })
            });

            const data = await response.json();

            if (data.success && data.data.access_token) {
                Utils.setToken(data.data.access_token);
                return true;
            }

            // Refresh failed, clear tokens
            Utils.removeToken();
            return false;
        } catch (error) {
            console.error('Token refresh failed:', error);
            Utils.removeToken();
            return false;
        }
    },

    // Document endpoints
    async uploadDocument(file) {
        const formData = new FormData();
        formData.append('file', file);

        return this.request('/documents/upload', {
            method: 'POST',
            body: formData,
            headers: {} // Remove Content-Type to let browser set it for FormData
        });
    },

    async getDocuments() {
        return this.request('/documents/');
    },

    async getDocument(documentId) {
        return this.request(`/documents/${documentId}`);
    },

    async deleteDocument(documentId) {
        return this.request(`/documents/${documentId}`, {
            method: 'DELETE'
        });
    },

    async analyzeDocument(documentId) {
        return this.request(`/documents/${documentId}/analyze`, {
            method: 'POST'
        });
    }
};

// FileUpload class removed - use CvUploader component (/assets/js/components/cv-uploader.js) instead

// Auth guard for protected pages
function requireAuth() {
    if (!Utils.isAuthenticated()) {
        window.location.href = '/login';
        return false;
    }
    return true;
}

// Initialize user info display
function initUserInfo() {
    const user = Utils.getUser();
    if (user) {
        const userElements = document.querySelectorAll('.user-name');
        userElements.forEach(el => {
            el.textContent = user.full_name || user.email;
        });
    }
}

// Logout functionality
function logout() {
    Utils.removeToken();
    window.location.href = Utils.getLoginUrl();
}

// Redirect authenticated users away from public pages
function redirectIfAuthenticated() {
    const publicPages = ['login', 'register'];
    const path = window.location.pathname;
    const currentPage = path === '/' ? '/' : path.replace(/^\/+|\/+$/g, '').split('/').pop().replace(/\.html$/, '');

    if (publicPages.includes(currentPage) && Utils.isAuthenticated()) {
        window.location.href = '/dashboard';
    }
}

// Auto-redirect on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', redirectIfAuthenticated);
} else {
    redirectIfAuthenticated();
}

// Global error handler
window.addEventListener('error', (e) => {
    console.error('Global error:', e.error);
});

// Global unhandled promise rejection handler
window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection:', e.reason);
});

// Load public navbar component
async function loadPublicNavbar() {
    if (window.PublicNavbar) {
        await PublicNavbar.load('public-navbar-container');
    } else {
    }
}

// Load footer component
async function loadFooter() {
    const footerContainer = document.getElementById('footer-container');
    if (footerContainer) {
        try {
            const response = await fetch('/components/footer.html?v=2');
            if (response.ok) {
                const html = await response.text();
                footerContainer.innerHTML = html;
            }
        } catch (error) {
            console.error('Failed to load footer:', error);
        }
    }
}

// Load components on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        loadPublicNavbar();
        loadFooter();
    });
} else {
    loadPublicNavbar();
    loadFooter();
}

// Expose globals
const APPLY_JOB_KEY = 'cvision_apply_job';

function rememberApplyJob() {
    const jobId = new URLSearchParams(window.location.search).get('apply_job');
    if (jobId && /^[a-f0-9]{24}$/i.test(jobId)) {
        sessionStorage.setItem(APPLY_JOB_KEY, jobId);
    }
}

async function openPendingApplication() {
    rememberApplyJob();
    const jobId = sessionStorage.getItem(APPLY_JOB_KEY);
    if (!jobId) return false;
    sessionStorage.removeItem(APPLY_JOB_KEY);
    window.location.href = `/pages/jobs.html?job=${encodeURIComponent(jobId)}`;
    return true;
}

window.CVision = window.CVision || {};
Object.assign(window.CVision, {
    Utils,
    API,
    requireAuth,
    initUserInfo,
    logout,
    isAuthenticated: () => Utils.isAuthenticated(),
    getToken: () => Utils.getToken(),
    getUser: () => Utils.getUser(),
    setUser: (user) => Utils.setUser(user),
    setToken: (token) => Utils.setToken(token),
    showAlert: (message, type) => Utils.showAlert(message, type),
    showMessage: (message, type) => Utils.showAlert(message, type), // Alias for showAlert
    formatDate: (date) => Utils.formatDate(date),
    formatFileSize: (size) => Utils.formatFileSize(size),
    rememberApplyJob,
    openPendingApplication
});