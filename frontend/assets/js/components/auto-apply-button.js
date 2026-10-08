/**
 * AutoApplyButton Component
 * Encapsulates the auto-apply toggle switch and its logic.
 */
class AutoApplyButton {
    constructor(config) {
        this.containerId = config.containerId;
        this.onToggle = config.onToggle || (() => { }); // Callback for external side effects
        this.isEnabled = false;
        this.isProcessing = false;
        this.textColor = config.textColor || 'text-gray-900';
        this.label = config.label || 'Auto-Apply';
    }

    async init() {
        await this.fetchState();
        this.render();
        this.attachEvents();
        // Initial callback with loaded state
        this.onToggle(this.isEnabled, this.settings);
    }

    render() {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        // Determine initial classes based on state
        const switchBg = this.isEnabled ? 'bg-green-500' : 'bg-gray-200';
        const sliderTransform = this.isEnabled ? 'translate-x-[30px]' : 'translate-x-[0]';

        const locked = window.PremiumGuard && !PremiumGuard.hasAccess('AUTO_APPLY');
        const label = locked ? 'Upgrade to Auto-Apply' : (this.label || '');

        container.innerHTML = `
            <div class="flex flex-col items-end gap-2">
                <div class="flex items-center gap-3">
                    ${label ? `<span class="${this.textColor} font-medium whitespace-nowrap">${label}</span>` : ''}
                    <div class="aa-toggle-component relative w-[60px] h-[30px] ${switchBg} rounded-full cursor-pointer transition-all duration-300" id="${this.containerId}-switch" role="switch" aria-checked="${this.isEnabled ? 'true' : 'false'}" aria-label="${label || 'Automated applications'}">
                        <div class="aa-toggle-slider absolute top-[3px] left-[3px] w-[24px] h-[24px] bg-white rounded-full transition-all duration-300 shadow-sm" style="transform: ${this.isEnabled ? 'translateX(30px)' : 'translateX(0)'}" id="${this.containerId}-slider"></div>
                    </div>
                </div>
                ${this.profileNotice()}
            </div>
        `;
    }

    profileNotice() {
        if (!this.settings || this.settings.profile_complete !== false) return '';
        const missing = (this.settings.missing_fields || []).join(', ');
        const onProfile = window.location.pathname.includes('profile');
        const href = onProfile ? '#personal' : '/pages/profile.html#personal';
        const needed = missing ? ` Still needed: ${missing}.` : '';
        return `<p class="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 max-w-xs text-left">Complete your profile before turning on auto-apply.${needed} <a href="${href}" class="font-semibold underline">Complete profile</a></p>`;
    }

    async fetchState() {
        try {
            const response = await fetch('/api/v1/auto-apply/status', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('access_token')}`
                }
            });

            if (response.ok) {
                const settings = await response.json();
                this.isEnabled = settings.enabled || false;
                this.settings = settings; // Store for callback
            }
        } catch (error) {
            console.error('Failed to load auto-apply state:', error);
        }
    }

    attachEvents() {
        const switchEl = document.getElementById(`${this.containerId}-switch`);
        if (switchEl) {
            switchEl.addEventListener('click', () => this.toggle());
        }
    }

    async toggle() {
        if (this.isProcessing) return;

        // Check Premium Access before enabling
        if (!this.isEnabled) {
            if (typeof PremiumGuard !== 'undefined') {
                if (!PremiumGuard.enforce('AUTO_APPLY', 'Premium Automation', 'Auto-applying to jobs requires a Premium subscription.')) {
                    return;
                }
            }
            const missing = (this.settings && this.settings.missing_fields) || [];
            if (this.settings && this.settings.profile_complete === false) {
                const needed = missing.length ? missing.join(', ') : 'the remaining profile fields';
                const message = `Complete your profile before turning on auto-apply. Still needed: ${needed}.`;
                if (window.CVision && window.CVision.Utils) {
                    CVision.Utils.showAlert(message, 'warning');
                } else {
                    alert(message);
                }
                return;
            }
        }

        this.isProcessing = true;

        const newState = !this.isEnabled;

        // Optimistic UI update
        this.isEnabled = newState;
        this.updateUI();
        this.onToggle(this.isEnabled);

        try {
            const endpoint = newState ? '/api/v1/auto-apply/enable' : '/api/v1/auto-apply/disable';
            const body = newState ? {
                // Default values if enabling without specific settings form
                max_daily_applications: 5,
                min_match_score: 0.7
            } : {};

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                const detail = data.detail;
                const message = typeof detail === 'string' ? detail : 'Failed to update status';
                throw new Error(message);
            }

            // CVision.Utils.showAlert(newState ? 'Auto-apply enabled!' : 'Auto-apply disabled', 'success');

        } catch (error) {
            console.error('Error toggling auto-apply:', error);
            const message = error.message || 'Error updating auto-apply status';
            if (window.CVision && window.CVision.Utils) {
                CVision.Utils.showAlert(message, 'error');
            } else {
                alert(message);
            }

            // Revert state on error
            this.isEnabled = !newState;
            this.updateUI();
            this.onToggle(this.isEnabled);
        } finally {
            this.isProcessing = false;
        }
    }

    updateUI() {
        const switchEl = document.getElementById(`${this.containerId}-switch`);
        const sliderEl = document.getElementById(`${this.containerId}-slider`);

        if (this.isEnabled) {
            switchEl.classList.add('bg-green-500', 'active'); // Add active for legacy CSS compatibility if needed
            switchEl.classList.remove('bg-gray-200');
            sliderEl.style.transform = 'translateX(30px)';
        } else {
            switchEl.classList.remove('bg-green-500', 'active');
            switchEl.classList.add('bg-gray-200');
            sliderEl.style.transform = 'translateX(0)';
        }
    }
}

// Expose globally
window.AutoApplyButton = AutoApplyButton;
