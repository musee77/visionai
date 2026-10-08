/**
 * JobApply.js
 * 
 * Reusable component for handling job applications.
 * Manages the "Apply" modal, CV/Cover Letter selection, and transition to Quick Apply.
 */

class JobApplyComponent {
    constructor() {
        this.currentJobId = null;
        this.currentJob = null;
        this.apiBaseUrl = '/api/v1'; // Adjust as needed based on config

        // Bind methods
        this.openApplyModal = this.openApplyModal.bind(this);
        this.closeApplyModal = this.closeApplyModal.bind(this);
        this.handleNextStep = this.handleNextStep.bind(this);
        this.loadDocuments = this.loadDocuments.bind(this);
    }

    /**
     * Initialize the component
     */
    init() {
        // Inject modal if not present
        if (!document.getElementById('applyModal')) {
            this.injectModal();
        }

        // Global aliases for HTML onclick handlers
        window.openApplyModal = (jobId) => this.openApplyModal(jobId);
        window.closeApplyModal = this.closeApplyModal;
        window.handleApplyNextStep = this.handleNextStep;
    }

    companyApplyUrl(job) {
        if (!job) return '';
        return job.application_url || job.external_url || job.apply_url || '';
    }

    openCompanyPage(url) {
        const target = typeof url === 'string' ? url : this.companyApplyUrl(url);
        if (!target) {
            alert('This job has no company application page.');
            return;
        }
        window.open(target, '_blank', 'noopener,noreferrer');
    }

    async applyByOpeningLink(jobId, url) {
        const target = typeof url === 'string' ? url : this.companyApplyUrl(url);
        if (window.PremiumGuard) {
            const canProceed = await window.PremiumGuard.enforceLimit('MANUAL_APPLICATION');
            if (!canProceed) return;
        }
        try {
            if (jobId && window.CVision && window.CVision.API) {
                await window.CVision.API.request('/email-applications/track', {
                    method: 'POST',
                    body: JSON.stringify({
                        job_id: String(jobId),
                        application_url: target || null,
                    }),
                });
                if (window.JobActions && window.JobActions.appliedJobIds) {
                    window.JobActions.appliedJobIds.add(String(jobId));
                }
            }
        } catch (error) {
            const message = (error && error.message) || 'Could not save this application.';
            if (window.CVision && window.CVision.Utils) {
                window.CVision.Utils.showAlert(message, 'error');
            } else {
                alert(message);
            }
            return;
        }
        this.openCompanyPage(target);
    }

    /**
     * Inject the Apply Modal into the DOM
     */
    injectModal() {
        const modalHTML = `
            <div id="applyModal" class="fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center z-50 p-4">
                <div class="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 transform transition-all">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-xl font-bold text-gray-900">Quick Apply</h3>
                        <button onclick="JobApply.closeApplyModal()" class="text-gray-400 hover:text-gray-600 transition-colors">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <div class="mb-4">
                        <p class="text-gray-600 mb-2">Applying to:</p>
                        <p class="font-semibold text-gray-900" id="applyModalJobTitle">Job Title</p>
                        <p class="text-sm text-gray-500" id="applyModalCompanyName">Company Name</p>
                    </div>

                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Select CV *</label>
                            <select id="applyModalCvSelect" class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors">
                                <option value="">Loading CVs...</option>
                            </select>
                        </div>

                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Select Cover Letter (Optional)</label>
                            <select id="applyModalCoverLetterSelect" class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors">
                                <option value="">Loading cover letters...</option>
                            </select>
                        </div>
                    </div>

                    <div class="flex gap-3 mt-6">
                        <button onclick="JobApply.closeApplyModal()" class="flex-1 border border-gray-300 text-gray-700 rounded-lg px-4 py-2 font-medium hover:bg-gray-50 transition-colors">
                            Cancel
                        </button>
                        <button onclick="JobApply.handleNextStep()" class="flex-1 btn-gradient text-white rounded-lg px-4 py-2 font-medium hover:shadow-lg transition-all shadow-md">
                            Proceed 
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    /**
     * Open the apply modal for a specific job
     * @param {string} jobId 
     * @param {Object} [jobObject] - Optional job object if available
     */
    async openApplyModal(jobId, jobObject = null) {
        console.log('JobApply: Opening Apply Modal', { jobId, jobObject });
        this.currentJobId = jobId;
        this.currentJob = jobObject;

        // Use passed object if available, otherwise try to find it
        let job = jobObject;

        if (!job && window.currentJobs && Array.isArray(window.currentJobs)) {
            job = window.currentJobs.find(j => (j._id || j.id) === jobId);
        }

        // Fallback for different page structures
        if (!job && window.allApplications) {
            const app = window.allApplications.find(a => (a.job_id === jobId || a._id === jobId));
            job = app ? app.job : null;
        }

        if (!job && window.currentSavedJobs) {
            job = window.currentSavedJobs.find(j => (j._id || j.id) === jobId);
        }

        console.log('JobApply: Resolved job object:', job);
        this.currentJob = job;

        let modal = document.getElementById('applyModal');
        const titleEl = document.getElementById('applyModalJobTitle');
        const companyEl = document.getElementById('applyModalCompanyName');
        const cvSelect = document.getElementById('applyModalCvSelect');

        console.log('JobApply: DOM Elements:', {
            modal: !!modal,
            titleEl: !!titleEl,
            companyEl: !!companyEl,
            cvSelect: !!cvSelect
        });

        if (modal) {
            if (job) {
                // Handle both Job objects (title) and Application objects (job_title)
                const title = job.title || job.job_title || 'No Title';
                const company = job.company_name || job.company || 'No Company';

                if (titleEl) titleEl.textContent = title;
                if (companyEl) companyEl.textContent = company;
            } else {
                if (titleEl) titleEl.textContent = 'Unknown Position';
                console.warn('JobApply: Job details not found for ID:', jobId);
            }

            modal.classList.remove('hidden');
            modal.classList.add('flex');

            // Load docs with pre-selections from saved job data
            await this.loadDocuments({
                cvId: job.generated_cv_id,
                clId: job.generated_cover_letter_id
            });
        } else {
            console.warn('JobApply: Apply modal element not found in DOM, attempting to re-inject...');
            this.injectModal();
            modal = document.getElementById('applyModal');
            if (modal) {
                // Retry opening
                return this.openApplyModal(jobId, jobObject);
            } else {
                console.error('JobApply: Failed to inject modal.');
                alert('Application form could not be loaded. Please refresh.');
                return;
            }
        }

        // Auto-save the job if not already saved
        this._handleAutoSave(jobId);
    }

    /**
     * Check if job is saved and save it if not
     * @param {string} jobId 
     */
    async _handleAutoSave(jobId) {
        // If job is from currentSavedJobs, it's already saved - skip
        if (window.currentSavedJobs && Array.isArray(window.currentSavedJobs)) {
            const isSaved = window.currentSavedJobs.some(j => (j._id || j.id) == jobId);
            if (isSaved) {
                console.log('JobApply: Job is from saved jobs, skipping auto-save');
                return;
            }
        }

        // Check if we are on a page with save buttons (jobs.js context)
        // Saved buttons usually have 'text-primary-600' class when saved
        let isAlreadySaved = false;

        const saveBtns = document.querySelectorAll(`[onclick*="saveJob('${jobId}')"]`);
        if (saveBtns.length > 0) {
            // If any button has the primary color, it's saved
            saveBtns.forEach(btn => {
                if (btn.classList.contains('text-primary-600')) {
                    isAlreadySaved = true;
                }
            });
        }

        if (isAlreadySaved) {
            console.log('JobApply: Job already saved, skipping auto-save');
            return;
        }

        console.log('JobApply: Auto-saving job...');

        if (typeof window.saveJob === 'function') {
            // Use existing global function with silent=true
            await window.saveJob(jobId, true);
        } else {
            // Fallback API call
            try {
                const token = CVision.Utils.getToken();
                await fetch(`/api/v1/jobs/save/${jobId}`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            } catch (e) {
                console.warn('JobApply: Auto-save failed', e);
            }
        }
    }

    /**
     * Close the apply modal
     */
    closeApplyModal() {
        const modal = document.getElementById('applyModal');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
        // Don't clear currentJobId immediately if we are proceeding to next step
    }

    /**
     * Load CVs and Cover Letters
     * @param {Object} [preSelections] - Optional pre-defined selections { cvId, clId }
     */
    async loadDocuments(preSelections = {}) {
        console.log('JobApply: Loading documents...', preSelections);
        try {
            // Load CVs
            const cvResponse = await fetch('/api/v1/documents/?document_type=cv', {
                headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
            });

            console.log('JobApply: CV Response status:', cvResponse.status);

            const cvSelect = document.getElementById('applyModalCvSelect');
            if (cvResponse.ok && cvSelect) {
                const data = await cvResponse.json();
                console.log('JobApply: CV Data:', data);

                const docs = data.documents || [];
                let options = '<option value="">Select a CV...</option>';

                // 1. Explicitly check for generated CV for THIS job
                let generatedCvAdded = false;
                if (preSelections.cvId) {
                    // We trust the ID from the saved job data implies a generated CV exists
                    // We add it to the top of the list as "Generated CV for this Job"
                    options += `<option value="${preSelections.cvId}">Job CV/Resume</option>`;
                    generatedCvAdded = true;
                }

                // 2. Add other stats
                // Filter out the generated one if it happens to be in the list to avoid duplicates
                const otherDocs = docs.filter(doc => doc.id !== preSelections.cvId);
                options += otherDocs.map(doc => `<option value="${doc.id}">${doc.filename}</option>`).join('');

                cvSelect.innerHTML = options;

                // Selection Logic:
                if (generatedCvAdded) {
                    cvSelect.value = preSelections.cvId;
                } else if (docs.length >= 1) {
                    // Fallback to default user CV (first in list)
                    cvSelect.selectedIndex = preSelections.cvId ? 0 : 2; // If preSelections was passed but not added (invalid?), or just pick first real doc
                    // Actually simpler: if we didn't add the generated one, pick the first available real doc if exists
                    if (cvSelect.options.length > 1) {
                        cvSelect.selectedIndex = 1;
                    }
                }
            } else {
                if (cvSelect) cvSelect.innerHTML = '<option value="">No CVs found</option>';
            }

            // Load Cover Letters
            const clResponse = await fetch('/api/v1/documents/?document_type=cover_letter', {
                headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
            });

            const clSelect = document.getElementById('applyModalCoverLetterSelect');
            const canSelectCoverLetter = !window.PremiumGuard || PremiumGuard.hasAccess('COVER_LETTER');
            if (clSelect && !canSelectCoverLetter) {
                clSelect.classList.add('hidden');
                clSelect.disabled = true;
                clSelect.innerHTML = '<option value=""></option>';
                let upgradeBtn = document.getElementById('applyModalCoverLetterUpgrade');
                if (!upgradeBtn) {
                    upgradeBtn = document.createElement('button');
                    upgradeBtn.type = 'button';
                    upgradeBtn.id = 'applyModalCoverLetterUpgrade';
                    upgradeBtn.className = 'w-full border border-primary-200 bg-primary-50 text-primary-700 rounded-lg px-3 py-2 font-semibold';
                    upgradeBtn.textContent = 'Upgrade to select a cover letter';
                    upgradeBtn.addEventListener('click', () => {
                        if (window.PremiumGuard) {
                            PremiumGuard.enforce('COVER_LETTER', 'Upgrade', 'Selecting a cover letter is included on Basic and Premium.');
                        }
                    });
                    clSelect.insertAdjacentElement('afterend', upgradeBtn);
                }
                upgradeBtn.classList.remove('hidden');
            } else if (clResponse.ok && clSelect) {
                document.getElementById('applyModalCoverLetterUpgrade')?.classList.add('hidden');
                clSelect.classList.remove('hidden');
                clSelect.disabled = false;
                const data = await clResponse.json();
                const docs = data.documents || [];

                let options = '<option value="">No CL Found</option>';

                let generatedClAdded = false;
                if (preSelections.clId) {
                    options += `<option value="${preSelections.clId}">Job Cover Letter </option>`;
                    generatedClAdded = true;
                }

                const otherDocs = docs.filter(doc => doc.id !== preSelections.clId);
                options += otherDocs.map(doc => `<option value="${doc.id}">${doc.filename}</option>`).join('');

                clSelect.innerHTML = options;

                if (generatedClAdded) {
                    clSelect.value = preSelections.clId;
                }
            } else {
                if (clSelect) clSelect.innerHTML = '<option value="">No CL found</option>';
            }

        } catch (error) {
            console.error('Failed to load documents', error);
        }
    }

    /**
     * Handle "Next" button click - transition to Quick Apply Form
     */
    async handleNextStep() {
        const cvId = document.getElementById('applyModalCvSelect')?.value;
        const coverLetterId = document.getElementById('applyModalCoverLetterSelect')?.value;

        const jobForLink = this.currentJob || {};
        const jobHasEmail = !!(
            jobForLink.application_email ||
            jobForLink.contact_email ||
            jobForLink.email ||
            (jobForLink.company_info && jobForLink.company_info.contact && jobForLink.company_info.contact.email)
        );
        if (!jobHasEmail) {
            this.closeApplyModal();
            if (typeof window.openQuickApplyForm === 'function') {
                window.openQuickApplyForm(this.currentJobId, cvId, coverLetterId, {
                    linkOnly: true,
                    companyUrl: this.companyApplyUrl(jobForLink)
                });
            }
            return;
        }

        if (!cvId) {
            // Check if user has no CVs at all (dropdown would usually have "Select a CV..." or "No CVs found")
            const cvSelect = document.getElementById('applyModalCvSelect');
            const hasNoDocs = cvSelect && cvSelect.options.length <= 1;

            const helpMsg = hasNoDocs
                ? 'You haven\'t uploaded any CVs yet. Please go to the Documents page and upload your resume first!'
                : 'Please select a CV to proceed with the application.';

            if (window.CVision && window.CVision.Utils) {
                CVision.Utils.showAlert(helpMsg, 'warning');
            } else {
                alert(helpMsg);
            }
            return;
        }

        this.closeApplyModal();

        const job = this.currentJob || {};
        const hasEmail = !!(
            job.application_email ||
            job.contact_email ||
            job.email ||
            (job.company_info?.contact?.email)
        );
        const companyUrl = this.companyApplyUrl(job);

        if (!hasEmail) {
            if (typeof window.openQuickApplyForm === 'function') {
                window.openQuickApplyForm(this.currentJobId, cvId, coverLetterId, {
                    linkOnly: true,
                    companyUrl
                });
            }
            return;
        }

        if (window.PremiumGuard) {
            const canProceed = await window.PremiumGuard.enforceLimit('MANUAL_APPLICATION');
            if (!canProceed) return;
        }

        if (typeof window.openQuickApplyForm === 'function') {
            window.openQuickApplyForm(this.currentJobId, cvId, coverLetterId);
        } else {
            alert('Navigation failed: Quick Apply form missing.');
        }
    }
}

// Initialize and expose globally as JobApply
window.JobApply = new JobApplyComponent();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.JobApply.init());
} else {
    window.JobApply.init();
}
