/**
 * DocumentViewer Component
 * Reusable component for viewing generated documents (CVs, Cover Letters)
 * Handles modal injection and preview logic.
 */
class DocumentViewerComponent {
    constructor() {
        this.modalId = 'docPreviewModal';
        this.frameId = 'docPreviewFrame';
        this.initialized = false;

        // Bind methods
        this.openPreview = this.openPreview.bind(this);
        this.closePreview = this.closePreview.bind(this);
    }

    init() {
        if (this.initialized) return;
        this.injectModal();
        this.initialized = true;
    }

    injectModal() {
        if (document.getElementById(this.modalId)) return;

        const modalHTML = `
            <div id="${this.modalId}" class="hidden fixed inset-0 bg-black bg-opacity-75 z-[130] flex items-center justify-center p-4">
                <div class="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col">
                    <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                        <h3 class="text-xl font-bold text-gray-900" id="docPreviewTitle">Document Preview</h3>
                        <button onclick="DocumentViewer.closePreview()" class="text-gray-400 hover:text-gray-600 p-2 rounded-full hover:bg-gray-100 transition-colors">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                    <div class="flex-1 bg-gray-100 relative">
                        <iframe id="${this.frameId}" class="w-full h-full border-none" src=""></iframe>
                        <div id="docPreviewLoader" class="absolute inset-0 flex items-center justify-center bg-white z-10 hidden">
                            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
                        </div>
                    </div>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    _resolveUrl(path) {
        if (!path) return '';

        // Handle case where backend saved localhost URL but we are in production
        if (path.includes('localhost') &&
            window.location.hostname !== 'localhost' &&
            window.location.hostname !== '127.0.0.1') {

            // Strip the localhost origin part and resolve relative cleanliness
            // Assuming path is like http://localhost:8000/media/...
            try {
                const urlObj = new URL(path);
                path = urlObj.pathname + urlObj.search;
            } catch (e) {
            }
        }

        if (path.startsWith('http')) return path;

        let baseUrl = window.location.origin;
        if (typeof CONFIG !== 'undefined' && CONFIG.API_BASE_URL) {
            baseUrl = CONFIG.API_BASE_URL;
        } else if (window.CVision && window.CVision.config && window.CVision.config.API_BASE_URL) {
            baseUrl = window.CVision.config.API_BASE_URL;
        } else if (window.CONFIG && window.CONFIG.API_BASE_URL) {
            baseUrl = window.CONFIG.API_BASE_URL;
        }

        const cleanPath = path.startsWith('/') ? path : `/${path}`;
        return `${baseUrl.replace(/\/+$/, '')}/${cleanPath.replace(/^\/+/, '')}`;
    }

    _filename(path, fallback) {
        const clean = String(path || '').split('?')[0].split('/').pop();
        if (clean && clean.includes('.')) return clean;
        return fallback || 'document.pdf';
    }

    async downloadDocument(path, filename) {
        const fullUrl = this._resolveUrl(path);
        const saveAs = filename || this._filename(path, 'document.pdf');
        if (!fullUrl) return;
        try {
            const response = await fetch(fullUrl);
            if (!response.ok) throw new Error('The document could not be downloaded.');
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = saveAs;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        } catch (error) {
            window.open(fullUrl, '_blank', 'noopener,noreferrer');
        }
    }

    openPreview(url, title = 'Document Preview') {
        const fullUrl = this._resolveUrl(url);
        const modal = document.getElementById(this.modalId);
        const frame = document.getElementById(this.frameId);
        const titleEl = document.getElementById('docPreviewTitle');
        const loader = document.getElementById('docPreviewLoader');

        // Find or create external link button container
        let actionContainer = document.getElementById('docPreviewActions');
        if (!actionContainer) {
            const header = modal.querySelector('.flex.justify-between.items-center');
            if (header) {
                // Insert before the close button
                const closeBtn = header.querySelector('button');
                actionContainer = document.createElement('div');
                actionContainer.id = 'docPreviewActions';
                actionContainer.className = 'flex items-center gap-2 mr-2';
                header.insertBefore(actionContainer, closeBtn);
            }
        }

        if (!modal || !frame) return;

        document.body.appendChild(modal);
        modal.style.zIndex = '130';

        if (titleEl) titleEl.textContent = title;
        if (loader) loader.classList.remove('hidden');

        // Determine viewer type based on extension
        const extension = fullUrl.split('.').pop().toLowerCase().split('?')[0]; // Handle query params
        const isOfficeDoc = ['docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls'].includes(extension);

        let displayUrl = fullUrl;

        // Update external link button
        if (actionContainer) {
            const downloadName = this._filename(fullUrl, 'document.pdf').replace(/'/g, '');
            actionContainer.innerHTML = `
                <button type="button" onclick="DocumentViewer.downloadDocument('${fullUrl.replace(/'/g, '')}', '${downloadName}')"
                   class="text-primary-600 hover:text-primary-800 text-sm font-medium flex items-center gap-1 hover:underline">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    Download
                </button>
                <a href="${fullUrl}" target="_blank" rel="noopener noreferrer" 
                   class="text-primary-600 hover:text-primary-800 text-sm font-medium flex items-center gap-1 hover:underline">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                    Open in New Tab
                </a>
            `;
        }

        if (isOfficeDoc) {
            // Use Google Docs Viewer for Office files
            // NOTE: Google Docs Viewer only works if the URL is publicly accessible. 
            // If strictly local/private, this will fail, but "Open in New Tab" provides download fallback.
            displayUrl = `https://docs.google.com/gview?url=${encodeURIComponent(fullUrl)}&embedded=true`;
        }

        frame.src = displayUrl;

        frame.onload = () => {
            if (loader) loader.classList.add('hidden');
        };

        // Handle error/timeout for iframe (approximate)
        setTimeout(() => {
            if (loader && !loader.classList.contains('hidden')) {
                // If still loading after 5s, assume mostly done or allow user to see it
                loader.classList.add('hidden');
            }
        }, 5000);

        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    closePreview() {
        const modal = document.getElementById(this.modalId);
        const frame = document.getElementById(this.frameId);
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
        if (frame) {
            frame.src = '';
        }
    }

    /**
     * Generates HTML for View CV / View Cover Letter buttons
     * @param {Object} paths - Object containing { cvPath, clPath }
     * @param {Object} styles - Optional style overrides
     */
    renderButtons({ cvPath, clPath }) {
        if (!cvPath && !clPath) return '';

        // Fix for undefined/null paths that might be passed as strings "null" or "undefined"
        if (cvPath === 'null' || cvPath === 'undefined') cvPath = null;
        if (clPath === 'null' || clPath === 'undefined') clPath = null;

        if (!cvPath && !clPath) return '';

        const quote = (value) => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        let html = '<div class="flex flex-wrap gap-2 mb-2">';

        if (cvPath) {
            html += `
                <button type="button" onclick="event.stopPropagation(); DocumentViewer.openPreview('${quote(cvPath)}', 'CV Preview')" 
                    class="flex-1 bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                    View CV
                </button>
                <button type="button" onclick="event.stopPropagation(); DocumentViewer.downloadDocument('${quote(cvPath)}', 'Customized-CV.pdf')"
                    class="flex-1 bg-white text-blue-700 border border-blue-200 hover:bg-blue-50 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                    Download CV
                </button>`;
        }

        if (clPath) {
            html += `
                <button type="button" onclick="event.stopPropagation(); DocumentViewer.openPreview('${quote(clPath)}', 'Cover Letter Preview')" 
                    class="flex-1 bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                    View CL
                </button>
                <button type="button" onclick="event.stopPropagation(); DocumentViewer.downloadDocument('${quote(clPath)}', 'Cover-Letter.pdf')"
                    class="flex-1 bg-white text-purple-700 border border-purple-200 hover:bg-purple-50 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                    Download CL
                </button>`;
        }

        html += '</div>';
        return html;
    }
}

// Global instance
window.DocumentViewer = new DocumentViewerComponent();

// Auto-init
document.addEventListener('DOMContentLoaded', () => {
    window.DocumentViewer.init();
});
