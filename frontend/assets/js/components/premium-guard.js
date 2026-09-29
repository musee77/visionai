/**
 * PremiumGuard Utility
 * Centralizes logic for checking user subscription tiers and restricting access to features.
 * Dependencies: CVision.Utils (for user data), UpgradeModal (for UI)
 */
const PremiumGuard = {
    // Feature Definitions and their minimum required tiers
    FEATURES: {
        AUTO_APPLY: 'premium',      // Premium only
        UNLIMITED_MSGS: 'premium',  // Premium only
        CV_CUSTOMIZATION: 'basic',  // Basic or Premium
        COVER_LETTER: 'basic',      // Select or generate a cover letter
        ADVANCED_ANALYTICS: 'premium',
        RUN_TEST: 'basic',          // Basic or Premium (with 1 free trial)
        GMAIL_CONNECT: 'premium'    // Premium only
    },

    /**
     * Checks if the current user has access to a specific feature.
     * @param {string} feature - The feature key from PremiumGuard.FEATURES
     * @returns {boolean} - True if allowed, false otherwise
     */
    hasAccess: function (feature) {
        const user = CVision.Utils.getUser();
        const userTier = (user?.subscription_tier || 'free').toLowerCase();

        // Define tier levels for comparison
        const tierLevels = {
            'free': 0,
            'basic': 1,
            'premium': 2
        };

        if (feature === 'AUTO_APPLY' && Number(user?.referral_bonus_auto_applications || 0) > 0) {
            return true;
        }

        const requiredTier = this.FEATURES[feature] || 'premium'; // Default to highest if unknown

        return tierLevels[userTier] >= tierLevels[requiredTier];
    },

    /**
     * Checks usage-based limits for a feature.
     * @param {string} feature - The feature key (e.g., 'MANUAL_APPLICATION')
     * @returns {Promise<Object>} - { allowed: boolean, current: number, limit: number }
     */
    checkLimit: async function (feature) {
        try {
            const user = CVision.Utils.getUser();
            const userTier = (user?.subscription_tier || 'free').toLowerCase();

            // Default limits if not fetched from backend
            const DEFAULT_LIMITS = {
                'free': 5,
                'basic': 9999,
                'premium': 9999
            };

            const response = await fetch('/api/v1/subscriptions/usage', {
                headers: {
                    'Authorization': `Bearer ${CVision.Utils.getToken()}`
                }
            });

            if (!response.ok) throw new Error('Failed to fetch usage');

            const data = await response.json();
            const usage = data.current_usage || {};

            let current = 0;
            let limit = DEFAULT_LIMITS[userTier] || 5;

            if (feature === 'MANUAL_APPLICATION') {
                current = usage.manual_applications || 0;
                // If backend provided limits, use them
                if (data.limits && data.limits.manual_applications) {
                    limit = data.limits.manual_applications;
                }
            } else if (feature === 'AUTO_APPLY') {
                current = usage.auto_applications || 0;
                const planLimit = Number(data.limits && data.limits.auto_applications) || 0;
                const bonus = Number(data.limits && data.limits.referral_bonus_auto_applications) || 0;
                const remaining = Math.max(0, planLimit - current) + bonus;
                return {
                    allowed: remaining > 0,
                    current: current,
                    limit: planLimit + bonus
                };
            }

            return {
                allowed: current < limit,
                current: current,
                limit: limit
            };
        } catch (error) {
            console.error('PremiumGuard: Error checking limit:', error);
            // Fallback: allow if unknown but log error
            return { allowed: true, current: 0, limit: 1 };
        }
    },

    /**
     * Enforces usage-based limits.
     * @param {string} feature - The feature key
     * @returns {Promise<boolean>} - True if allowed, False if blocked
     */
    enforceLimit: async function (feature) {
        const { allowed, current, limit } = await this.checkLimit(feature);

        if (allowed) return true;

        // Show Upgrade Modal
        if (typeof UpgradeModal !== 'undefined') {
            const title = 'Limit Reached';
            const message = `You have reached your limit of ${limit} applications on the Free plan. Upgrade now to get unlimited applications and faster results!`;
            UpgradeModal.show(title, message);
        } else {
            alert(`Application limit reached (${limit}). Please upgrade your plan.`);
        }

        return false;
    },

    /**
     * Enforces premium access. If user has access, returns true.
     * If not, shows the UpgradeModal and returns false.
     * @param {string} feature - The feature key from PremiumGuard.FEATURES
     * @param {string} [customTitle] - Optional title for the modal
     * @param {string} [customMessage] - Optional message for the modal
     * @returns {boolean} - True if proceeded (access granted), False if blocked (modal shown)
     */
    enforce: function (feature, customTitle, customMessage) {
        if (this.hasAccess(feature)) {
            return true;
        }

        // Access denied - Show Modal
        if (typeof UpgradeModal !== 'undefined') {
            const requiredTier = this.FEATURES[feature] || 'premium';
            const title = customTitle || 'Premium Feature';
            const message = customMessage || `This feature requires a ${requiredTier.charAt(0).toUpperCase() + requiredTier.slice(1)} subscription. Upgrade now to unlock it!`;

            UpgradeModal.show(title, message);
        } else {
            console.warn('UpgradeModal not loaded, using fallback alert');
            alert('This feature requires a premium subscription.');
        }

        return false;
    }
};

// Expose globally
window.PremiumGuard = PremiumGuard;
