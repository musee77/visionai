const UpgradeModal = {
    init: async function (containerId = 'upgrade-modal-container') {
        const container = document.getElementById(containerId);
        if (!container) return; // Silent fail if container not found

        try {
            // Determine path based on current location (root or /pages/)
            const isPagesDir = window.location.pathname.includes('/pages/');
            const basePath = isPagesDir ? '../' : './';

            const response = await fetch(`${basePath}components/upgrade-modal.html`);
            if (response.ok) {
                const html = await response.text();
                container.innerHTML = html;
            }
        } catch (error) {
            console.error('Failed to load Upgrade Modal:', error);
        }
    },

    show: function (title, message) {
        const modal = document.getElementById('premiumModal');

        // If modal doesn't exist yet, try to find it again (maybe loaded late)
        if (!modal) {
            console.warn('Upgrade Modal DOM element not found. Ensure init() has completed or container exists.');
            // Fallback: redirects to subscription page if modal really fails? 
            // Better to just alert for now so user isn't stuck.
            if (confirm(`${title}\n\n${message}\n\nClick OK to Upgrade.`)) {
                window.location.href = window.location.pathname.includes('/pages/') ? 'subscription.html' : 'pages/subscription.html';
            }
            return;
        }

        if (title) {
            const titleEl = document.getElementById('premiumModalTitle');
            if (titleEl) titleEl.textContent = title;
        }
        if (message) {
            const msgEl = document.getElementById('premiumModalDescription');
            if (msgEl) msgEl.textContent = message;
        }

        document.body.appendChild(modal);
        modal.style.zIndex = '120';
        modal.style.display = 'flex';
        modal.classList.remove('hidden');
        modal.style.pointerEvents = 'auto';
    },

    close: function () {
        const modal = document.getElementById('premiumModal');
        if (modal) {
            modal.style.display = 'none';
            modal.style.pointerEvents = 'none';
        }
    }
};

// Auto-init if container exists on load
document.addEventListener('DOMContentLoaded', () => {
    UpgradeModal.init();
});
