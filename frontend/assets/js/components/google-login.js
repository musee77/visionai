/**
 * Google Login Component Manager
 * Encapsulates Google OAuth logic into a reusable class to fix scoping issues
 * and provide robust error handling.
 */
class GoogleLoginManager {
    constructor(buttonId = null) {
        this.buttonId = buttonId || (document.getElementById('googleLogin') ? 'googleLogin' : 'googleSignup');
        this.button = document.getElementById(this.buttonId);

        this.init();
    }

    /**
     * Initialize the component by binding event listeners
     */
    init() {
        if (this.button) {
            this.button.addEventListener('click', () => this.handleLogin());
            console.log(`GoogleLoginManager initialized for button: ${this.buttonId}`);
        } else {
            console.warn('Google login button not found in DOM');
        }
    }

    /**
     * Main handler for Google Login process
     */
    async handleLogin() {
        try {
            this.setLoading(true);

            // 1. Detect location (reusing CVision.Geolocation if available)
            let locationParam = '';
            try {
                if (window.CVision && CVision.Geolocation) {
                    const geoData = await CVision.Geolocation.detect();
                    if (geoData && geoData.detected) {
                        const locationData = {
                            code: geoData.countryCode,
                            name: geoData.countryName,
                            currency: geoData.currency
                        };
                        locationParam = `?location=${encodeURIComponent(JSON.stringify(locationData))}`;
                    }
                }
            } catch (err) {
                console.warn('Geolocation detection failed for Google login:', err);
            }

            // 2. Prepare API URL
            const apiBase = window.CONFIG ? CONFIG.API_BASE_URL : 'http://localhost:8000';
            const apiPrefix = window.CONFIG ? CONFIG.API_PREFIX : '/api/v1';
            const referralCode = window.pendingReferralCode ? window.pendingReferralCode() : '';
            const params = new URLSearchParams();
            if (locationParam.startsWith('?location=')) {
                params.set('location', decodeURIComponent(locationParam.slice('?location='.length)));
            }
            if (referralCode) params.set('ref', referralCode);
            const query = params.toString();
            const url = `${apiBase}${apiPrefix}/auth/google/login${query ? `?${query}` : ''}`;

            console.log('Initiating Google Login fetch to:', url);

            // 3. Fetch Auth URL from backend (with minimum perceived delay for smoothness)
            const [response] = await Promise.all([
                fetch(url),
                new Promise(resolve => setTimeout(resolve, 800))
            ]);

            if (!response.ok) {
                throw new Error(`Server returned error: ${response.status}`);
            }

            const data = await response.json();

            if (data.success && data.auth_url) {
                window.location.href = data.auth_url;
            } else {
                throw new Error(data.message || 'Failed to initiate Google login');
            }

        } catch (error) {
            console.error('Google Login Error:', error);
            this.handleError(error);
        } finally {
            // Note: We don't always want to setLoading(false) here 
            // if we've already redirected, but if it fails we definitely do.
            this.setLoading(false);
        }
    }

    /**
     * Sets/resets loading state on the button
     */
    setLoading(isLoading) {
        if (!this.button) return;

        if (isLoading) {
            this.button.disabled = true;
            this.button.classList.add('loading');
        } else {
            this.button.disabled = false;
            this.button.classList.remove('loading');
        }
    }

    /**
     * Handles and displays errors to the user
     */
    handleError(error) {
        let message = 'Google login failed. Please try again.';

        // Handle specific fetch errors
        if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
            message = 'Unable to connect to login server. Please check your internet or if the server is running.';
            console.error('Possible ERR_EMPTY_RESPONSE or network block');
        }

        if (window.GenericModal && window.GenericModal.instance) {
            window.GenericModal.instance.show({
                title: 'Login Error',
                message: message,
                type: 'error'
            });
        } else if (window.InlineMessage) {
            InlineMessage.error(message, { autoHide: true, autoHideDelay: 5000 });
        } else {
            alert(message);
        }
    }
}

// Export for use in auth.js
window.GoogleLoginManager = GoogleLoginManager;
