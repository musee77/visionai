// Admin Sidebar Loader
(function () {
    'use strict';

    // Load admin sidebar
    async function loadAdminSidebar() {
        const sidebarContainer = document.getElementById('admin-sidebar');
        if (sidebarContainer) {
            try {
                const response = await fetch('../components/sidebar.html');
                if (response.ok) {
                    const html = await response.text();
                    sidebarContainer.innerHTML = html;

                    // Highlight active page
                    highlightActivePage();
                }
            } catch (error) {
                console.error('Failed to load admin sidebar:', error);
            }
        }
    }

    // Highlight the current active page in sidebar
    function highlightActivePage() {
        const currentPage = window.location.pathname.split('/').pop().replace('.html', '');
        const links = document.querySelectorAll('#admin-sidebar nav a[data-page]');

        links.forEach(link => {
            const page = link.getAttribute('data-page');
            if (page === currentPage) {
                link.classList.add('is-active');
            }
        });
    }

    // Load sidebar on page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadAdminSidebar);
    } else {
        loadAdminSidebar();
    }

    // Expose globally
    window.AdminSidebar = {
        load: loadAdminSidebar,
        highlightActive: highlightActivePage
    };
})();
