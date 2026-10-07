// frontend/assets/js/quick-apply.js
/**
 * Quick Apply Form - Email Agent Integration
 * Handles form prefilling, validation, and submission via email
 */

class QuickApplyManager {
    constructor() {
        this.API_BASE_URL = window.location.origin;
        this.currentJobId = null;
        this.currentJobData = null;
    }

    /**
     * Open quick apply form for a job
     */
    async openQuickApplyForm(jobId, preSelectedCvId = null, preSelectedClId = null) {
        try {
            this.currentJobId = jobId;

            // Show modal
            const modal = document.getElementById('quickApplyModal');
            if (!modal) {
                throw new Error('Quick apply form not loaded. Please refresh the page.');
            }
            modal.classList.remove('hidden');

            // Load prefill data
            await this.loadPrefillData(jobId);

            // Load user documents
            await this.loadUserDocuments(preSelectedCvId, preSelectedClId);

        } catch (error) {
            console.error('Error opening quick apply form:', error);
            this.showError('Failed to load application form. Please try again.');
            this.closeQuickApplyForm();
        }
    }

    /**
     * Load and prefill form data from backend
     */
    async loadPrefillData(jobId) {
        try {
            const token = localStorage.getItem('access_token');

            const response = await fetch(
                `${this.API_BASE_URL}/api/v1/browser-automation/quick-apply/prefill?job_id=${jobId}`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to load form data');
            }

            const data = await response.json();
            this.currentJobData = data;

            // Update job title in modal
            document.getElementById('quickApplyJobTitle').textContent =
                `${data.job_title} at ${data.company_name}`;

            // Set job ID
            document.getElementById('quickApplyJobId').value = jobId;

            // Prefill form fields
            const form = document.getElementById('quickApplyForm');
            const formData = data.form_data;

            Object.keys(formData).forEach(key => {
                const input = form.querySelector(`[name="${key}"]`);
                if (input && formData[key]) {
                    input.value = formData[key];
                }
            });

            // Set recipient email if available
            if (data.recipient_email) {
                form.querySelector('[name="recipient_email"]').value = data.recipient_email;
            }

        } catch (error) {
            console.error('Error loading prefill data:', error);
            throw error;
        }
    }

    /**
     * Load user's documents for selection
     */
    async loadUserDocuments(preSelectedCvId = null, preSelectedClId = null) {
        try {
            const token = localStorage.getItem('access_token');

            const response = await fetch(
                `${this.API_BASE_URL}/api/v1/documents/`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            if (!response.ok) {
                throw new Error('Failed to load documents');
            }

            const responseData = await response.json();
            const documents = Array.isArray(responseData) ? responseData : (responseData.documents || []);

            // Populate CV dropdown
            const cvSelect = document.querySelector('[name="cv_document_id"]');
            const clSelect = document.querySelector('[name="cover_letter_document_id"]');

            // --- CV Selection Logic ---
            let cvOptions = '<option value="">Select your CV...</option>';
            let generatedCvAdded = false;

            // 1. Explicitly check for generated CV for THIS job
            if (preSelectedCvId) {
                // We trust the ID from the previous step implies a generated CV exists
                cvOptions += `<option value="${preSelectedCvId}">Job CV/Resume</option>`;
                generatedCvAdded = true;
            }

            // 2. Add other stats
            const otherCVs = documents.filter(doc => doc.document_type === 'cv' && doc._id !== preSelectedCvId && doc.id !== preSelectedCvId);
            cvOptions += otherCVs.map(doc => `<option value="${doc._id || doc.id}">${doc.filename || doc.original_filename}</option>`).join('');

            cvSelect.innerHTML = cvOptions;

            if (generatedCvAdded) {
                cvSelect.value = preSelectedCvId;
            } else if (cvSelect.options.length > 1) {
                // Auto-select first CV if available and no pre-selection
                cvSelect.selectedIndex = 1;
            }

            /* 
            // Cover Letter dropdown removed as text is prefilled directly
            // --- Cover Letter Selection Logic ---
            let clOptions = '<option value="">None</option>';
            let generatedClAdded = false;

            if (preSelectedClId) {
                clOptions += `<option value="${preSelectedClId}">Generated Cover Letter for this Job</option>`;
                generatedClAdded = true;
            }

            const otherCLs = documents.filter(doc => doc.document_type === 'cover_letter' && doc._id !== preSelectedClId && doc.id !== preSelectedClId);
            clOptions += otherCLs.map(doc => `<option value="${doc._id || doc.id}">${doc.filename || doc.original_filename}</option>`).join('');

            if (clSelect) clSelect.innerHTML = clOptions;

            if (generatedClAdded && clSelect) {
                clSelect.value = preSelectedClId;
            }
            */

        } catch (error) {
            console.error('Error loading documents:', error);
        }
    }

    /**
     * Submit quick apply form
     */
    async submitApplication(event) {
        event.preventDefault();

        try {
            const form = event.target;
            const submitBtn = document.getElementById('quickApplySubmitBtn');
            const loading = document.getElementById('quickApplyLoading');

            // Validate form
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            // Show loading state
            submitBtn.disabled = true;
            loading.classList.remove('hidden');

            // Collect form data
            const formData = new FormData(form);
            const submission = {
                job_id: formData.get('job_id'),
                recipient_email: formData.get('recipient_email'),
                cv_document_id: formData.get('cv_document_id'),
                cover_letter_document_id: formData.get('cover_letter_document_id') || null,
                additional_message: formData.get('cover_letter') || null,
                form_data: {
                    first_name: formData.get('first_name'),
                    last_name: formData.get('last_name'),
                    email: formData.get('email'),
                    phone: formData.get('phone') || null,
                    address: formData.get('address') || null,
                    city: formData.get('city') || null,
                    state: formData.get('state') || null,
                    postal_code: formData.get('postal_code') || null,
                    linkedin_url: formData.get('linkedin_url') || null,
                    portfolio_url: formData.get('portfolio_url') || null,
                    github_url: formData.get('github_url') || null,
                    cover_letter: formData.get('cover_letter') || null
                }
            };

            // Submit to backend
            const token = localStorage.getItem('access_token');

            const response = await fetch(
                `${this.API_BASE_URL}/api/v1/browser-automation/quick-apply/submit`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(submission)
                }
            );

            if (response.status === 409) {
                // Already applied - update UI and show info
                if (window.JobActions) {
                    window.JobActions.markAsApplied(this.currentJobId);
                    document.dispatchEvent(new CustomEvent('job:applied', { detail: { jobId: this.currentJobId } }));
                }

                this.injectSuccessModal(
                    'You have already applied to this position.',
                    'Application Exists',
                    'text-blue-600',
                    'bg-blue-100',
                    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>'
                );
                this.closeQuickApplyForm();
                return;
            }

            const result = await response.json();

            if (result.success) {
                this.showSuccess(result.message || 'Application is ready for review. Open Applications and choose In Review to send it.');

                if (window.JobActions) {
                    window.JobActions.markAsApplied(this.currentJobId);
                    document.dispatchEvent(new CustomEvent('job:applied', { detail: { jobId: this.currentJobId } }));
                }

                this.closeQuickApplyForm();

                // Refresh applications list if on applications page
                if (typeof loadApplications === 'function') {
                    setTimeout(() => loadApplications(), 1000);
                }
            } else {
                throw new Error(result.error || result.message || 'Failed to send application');
            }

        } catch (error) {
            console.error('Error submitting application:', error);
            this.showError(error.message || 'Failed to send application. Please try again.');
        } finally {
            const submitBtn = document.getElementById('quickApplySubmitBtn');
            const loading = document.getElementById('quickApplyLoading');
            submitBtn.disabled = false;
            loading.classList.add('hidden');
        }
    }

    /**
     * Close quick apply form
     */
    closeQuickApplyForm() {
        const modal = document.getElementById('quickApplyModal');
        modal.classList.add('hidden');

        // Reset form
        document.getElementById('quickApplyForm').reset();
        this.currentJobId = null;
        this.currentJobData = null;
    }

    /**
     * Show success message
     */
    /**
     * Show success message with custom modal
     */
    showSuccess(message) {
        this.injectSuccessModal(message);
    }

    injectSuccessModal(
        message,
        title = 'Application Sent!',
        textColor = 'text-green-600',
        bgColor = 'bg-green-100',
        iconPath = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>'
    ) {
        const modalId = 'quickApplySuccessModal';
        let modal = document.getElementById(modalId);

        // Always remove existing to re-render with correct colors/icon if needed
        if (modal) {
            modal.remove();
        }

        const modalHTML = `
            <div id="${modalId}" class="fixed inset-0 bg-black bg-opacity-60 hidden items-center justify-center z-[60] backdrop-blur-sm transition-opacity duration-300">
                <div class="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-8 transform transition-all scale-100 flex flex-col items-center text-center">
                    <div class="w-16 h-16 ${bgColor} rounded-full flex items-center justify-center mb-4 shadow-inner">
                        <svg class="w-8 h-8 ${textColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                           ${iconPath}
                        </svg>
                    </div>
                    <h3 class="text-2xl font-bold text-gray-900 mb-2">${title}</h3>
                    <p class="text-gray-600 mb-6" id="${modalId}Message">${message || 'The email agent has successfully processed your application.'}</p>
                    
                    <div class="space-y-3 w-full">
                        <button onclick="window.location.href='applications.html'" class="w-full btn-gradient text-white rounded-xl px-4 py-3 font-semibold hover:shadow-lg transition-all shadow-md">
                            View Applications
                        </button>
                        <button onclick="document.getElementById('${modalId}').remove()" class="w-full bg-gray-50 text-gray-700 rounded-xl px-4 py-3 font-semibold hover:bg-gray-100 transition-colors">
                            Close
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        modal = document.getElementById(modalId);

        // Small timeout to allow transition
        setTimeout(() => {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }, 10);
    }

    /**
     * Show error message
     */
    showError(message) {
        // Use existing notification system if available
        if (typeof showNotification === 'function') {
            showNotification(message, 'error');
        } else {
            alert(message);
        }
    }
}

// Initialize manager
const quickApplyManager = new QuickApplyManager();

// Global functions for HTML onclick handlers
function openQuickApplyForm(jobId, cvId = null, clId = null) {
    quickApplyManager.openQuickApplyForm(jobId, cvId, clId);
}

function closeQuickApplyForm() {
    quickApplyManager.closeQuickApplyForm();
}

// Form submission handler using event delegation (since form is loaded dynamically)
document.addEventListener('submit', (e) => {
    if (e.target && e.target.id === 'quickApplyForm') {
        quickApplyManager.submitApplication(e);
    }
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = QuickApplyManager;
}