/**
 * Auth Guard - Protects pages that require authentication.
 * A stored token is not enough. The profile request must succeed.
 */

(function () {
    const publicPages = [
        '/',
        'login.html',
        'register.html',
        'auth-callback.html',
        'unsubscribe',
        'preferences'
    ];

    let currentPage = window.location.pathname.split('/').pop() || 'index.html';
    if (window.location.pathname === '/') currentPage = '/';

    const isPublicPage = publicPages.some(page => {
        if (page === '/' || page === '') {
            return window.location.pathname === '/' || window.location.pathname === '';
        }
        return currentPage === page;
    });

    if (!isPublicPage) {
        const token = localStorage.getItem('access_token') || localStorage.getItem('token');
        if (!token) {
            window.location.replace('/login.html');
        } else {
            verifySession(token);
        }
    }

    function apiBase() {
        const host = window.location.hostname;
        if ((host === 'localhost' || host === '127.0.0.1') && window.location.port !== '8000') {
            return `http://${host}:8000`;
        }
        if (window.CONFIG && window.CONFIG.API_BASE_URL) {
            return window.CONFIG.API_BASE_URL;
        }
        return window.location.origin;
    }

    function forceLogout() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('cvision_user');
        localStorage.removeItem('user');
        if (!window.location.pathname.endsWith('/login.html') && !window.location.pathname.endsWith('login.html')) {
            window.location.replace('/login.html');
        }
    }

    async function verifySession(token) {
        try {
            const activeToken = await ensureFreshToken(token);
            if (!activeToken) {
                forceLogout();
                return;
            }

            const response = await fetch(`${apiBase()}/api/v1/users/me`, {
                headers: { 'Authorization': `Bearer ${activeToken}` }
            });

            if (!response.ok) {
                forceLogout();
                return;
            }

            const data = await response.json();
            const user = data.user || data;
            if (!user || !user.email) {
                forceLogout();
                return;
            }

            localStorage.setItem('cvision_user', JSON.stringify(user));
        } catch (error) {
            console.error('Session check failed:', error);
            forceLogout();
        }
    }

    async function ensureFreshToken(token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const now = Date.now() / 1000;
            if (!payload.exp || payload.exp >= now) {
                return token;
            }

            const refreshToken = localStorage.getItem('refresh_token');
            if (!refreshToken) return null;

            const response = await fetch(`${apiBase()}/api/v1/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: refreshToken })
            });
            const data = await response.json();
            if (data.success && data.data && data.data.access_token) {
                localStorage.setItem('access_token', data.data.access_token);
                return data.data.access_token;
            }
            return null;
        } catch (error) {
            return null;
        }
    }
})();
