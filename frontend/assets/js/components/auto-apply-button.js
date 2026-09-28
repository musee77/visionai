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

        container.innerHTML = `
            <div class="flex items-center gap-3">
                <span class="${this.textColor} font-medium whitespace-nowrap">${this.label}</span>
                <div class="aa-toggle-component relative w-[60px] h-[30px] ${switchBg} rounded-full cursor-pointer transition-all duration-300" id="${this.containerId}-switch">
                    <div class="aa-toggle-slider absolute top-[3px] left-[3px] w-[24px] h-[24px] bg-white rounded-full transition-all duration-300 shadow-sm" style="transform: ${this.isEnabled ? 'translateX(30px)' : 'translateX(0)'}" id="${this.containerId}-slider"></div>
                </div>
            </div>
        `;
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

            if (!response.ok) throw new Error('Failed to update status');

            // CVision.Utils.showAlert(newState ? 'Auto-apply enabled!' : 'Auto-apply disabled', 'success');

        } catch (error) {
            console.error('Error toggling auto-apply:', error);
            CVision.Utils.showAlert('Error updating auto-apply status', 'error');

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
