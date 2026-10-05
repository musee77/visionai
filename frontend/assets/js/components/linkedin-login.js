/**
 * LinkedIn Login Component Manager
 * Encapsulates LinkedIn OAuth logic into a reusable class.
 */
class LinkedInLoginManager {
    constructor(buttonId = null) {
        this.buttonId = buttonId || (document.getElementById('linkedinLogin') ? 'linkedinLogin' : 'linkedinSignup');
        this.button = document.getElementById(this.buttonId);

        this.init();
    }

    /**
     * Initialize the component by binding event listeners
     */
    init() {
        if (this.button) {
            this.button.addEventListener('click', () => this.handleLogin());
            console.log(`LinkedInLoginManager initialized for button: ${this.buttonId}`);
        } else {
            console.warn('LinkedIn login button not found in DOM');
        }
    }

    /**
     * Main handler for LinkedIn Login process
     */
    async handleLogin() {
        try {
            this.setLoading(true);

            // LinkedIn login doesn't typically require location data in the initial hit 
            // but we use the same API structure as Google
            const apiBase = window.CONFIG ? CONFIG.API_BASE_URL : 'http://localhost:8000';
            const apiPrefix = window.CONFIG ? CONFIG.API_PREFIX : '/api/v1';
            const referralCode = window.pendingReferralCode ? window.pendingReferralCode() : '';
            const url = `${apiBase}${apiPrefix}/auth/linkedin/login${referralCode ? `?ref=${encodeURIComponent(referralCode)}` : ''}`;

            console.log('Initiating LinkedIn Login fetch to:', url);

            // Fetch Auth URL from backend (with minimum perceived delay for smoothness)
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
                throw new Error(data.message || 'Failed to initiate LinkedIn login');
            }

        } catch (error) {
            console.error('LinkedIn Login Error:', error);
            this.handleError(error);
        } finally {
            // Re-enable if it fails or before redirect completes
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
        let message = 'LinkedIn login failed. Please try again.';

        // Handle specific fetch errors
        if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
            message = 'Unable to connect to LinkedIn login server. Please check your internet or if the server is running.';
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
window.LinkedInLoginManager = LinkedInLoginManager;
