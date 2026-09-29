
// Token refresh timer
let tokenRefreshInterval = null;

function startTokenRefreshTimer() {
    // Clear any existing interval
    if (tokenRefreshInterval) {
        clearInterval(tokenRefreshInterval);
    }

    // Check token every minute
    tokenRefreshInterval = setInterval(async () => {
        const token = CVision.Utils.getToken();
        const refreshToken = CVision.Utils.getRefreshToken();

        if (!token || !refreshToken) {
            clearInterval(tokenRefreshInterval);
            return;
        }

        // If token is expiring soon, refresh it
        if (CVision.Utils.isTokenExpiringSoon(token)) {
            console.log('Token expiring soon, refreshing...');
            const refreshed = await CVision.API.refreshAccessToken();
            if (!refreshed) {
                console.log('Token refresh failed, redirecting to login');
                clearInterval(tokenRefreshInterval);
                window.location.href = 'login.html';
            } else {
                console.log('Token refreshed successfully');
            }
        }
    }, 60000); // Check every minute
}

// Add to CVision global
if (window.CVision) {
    window.CVision.startTokenRefreshTimer = startTokenRefreshTimer;
    window.CVision.setRefreshToken = (token) => CVision.Utils.setRefreshToken(token);

    // Start token refresh timer on page load if authenticated
    if (CVision.Utils.isAuthenticated()) {
        startTokenRefreshTimer();
    }
}
