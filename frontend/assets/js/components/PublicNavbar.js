/**
 * PublicNavbar Component
 * Handles loading, toggling, and active state for the public-facing navbar.
 */
const PublicNavbar = (function () {
    let isInitialized = false;

    /**
     * Set up global event listeners for the navbar using delegation.
     */
    function setupEventListeners() {
        if (isInitialized) return;

        document.addEventListener('click', (e) => {
            // Mobile Menu Toggle
            const mobileBtn = e.target.closest('#mobile-menu-button');
            if (mobileBtn) {
                const mobileMenu = document.getElementById('mobile-menu');
                if (mobileMenu) {
                    mobileMenu.classList.toggle('hidden');
                }
            }
        });

        isInitialized = true;
    }

    /**
     * Highlights the active navigation link based on the current URL.
     */
    function setActiveLink() {
        // Get path and remove trailing slash if it exists
        let currentPage = window.location.pathname.replace(/\/$/, '');
        const navLinks = document.querySelectorAll('.nav-link');

        navLinks.forEach(link => {
            let linkHref = link.getAttribute('href');
            if (!linkHref) return;

            // Remove .html from link comparison if present
            let comparedHref = linkHref.replace(/\.html$/, '').replace(/\/$/, '');

            // Ensure absolute comparison
            if (!comparedHref.startsWith('/')) {
                comparedHref = '/' + comparedHref;
            }

            if (comparedHref === currentPage ||
                (currentPage === '' && comparedHref === '/') ||
                (currentPage === '/' && comparedHref === '/')) {
                link.classList.remove('text-gray-600');
                link.classList.add('text-primary-600', 'font-semibold');
            }
        });
    }

    /**
     * Loads the navbar HTML into a specified container.
     * @param {string} containerId - The ID of the container element.
     */
    async function load(containerId = 'public-navbar-container') {
        const container = document.getElementById(containerId);
        if (!container) return;

        try {
            const response = await fetch('/components/public-navbar.html');
            if (response.ok) {
                const html = await response.text();
                container.innerHTML = html;

                // Initialize functionality after loading
                setupEventListeners();
                setActiveLink();

                // The index is a job board. Product pages stay on Home.
                const path = window.location.pathname;
                if (path === '/' || path === '/index.html') {
                    const linksToHide = ['/features', '/how-it-works', '/pricing', '/info/help'];
                    linksToHide.forEach(href => {
                        const links = container.querySelectorAll(`a[href="${href}"]`);
                        links.forEach(link => link.classList.add('hidden'));
                    });
                }
            } else {
                console.error('PublicNavbar: Failed to fetch navbar HTML');
            }
        } catch (error) {
            console.error('PublicNavbar: Error loading navbar:', error);
        }
    }

    // Initialize listeners immediately if script is loaded
    // This allows delegation to work even if the navbar hasn't been injected yet
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupEventListeners);
    } else {
        setupEventListeners();
    }

    return {
        load,
        init: setupEventListeners,
        setActiveLink
    };
})();

// Expose to window
window.PublicNavbar = PublicNavbar;
