/**
 * JobActions Component
 * Handles the logic for:
 * - Opening customization modal
 * - Generating CVs/Cover Letters (via GenerationModule)
 * - Viewing generated documents
 * - Tracking generation progress
 * - Rendering action buttons for cards
 */
class JobActionComponent {
    constructor() {
        this.currentJobId = null;
        this.initialized = false;

        // Bind methods
        this.handleGenerate = this.handleGenerate.bind(this);
        this.closeModal = this.closeModal.bind(this);

        // Track applied jobs
        this.appliedJobIds = new Set();
    }

    init() {
        if (this.initialized) return;
        this.injectModals();
        this.attachGlobalListeners();
        this.initialized = true;
    }

    escapeAttr(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;');
    }

    attachGlobalListeners() {
        // Expose global functions for backward compatibility or inline onclicks if needed
        window.JobActions = this;
    }

    /**
     * Injects the required modals into the DOM if they don't exist
     */
    injectModals() {
        if (!document.getElementById('customizeModal')) {
            const customizeModalHTML = `
                <div id="customizeModal" class="fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center z-50 p-4">
                    <div class="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div class="p-6">
                            <div class="flex justify-between items-start mb-6">
                                <h2 class="text-2xl font-bold text-gray-900">Customize Documents</h2>
                                <button onclick="JobActions.closeModal()" class="text-gray-400 hover:text-gray-600 transition-colors">
                                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            <!-- Progress Bar -->
                            <div id="generationProgress" class="hidden mb-6">
                                <div class="flex items-center justify-between mb-2">
                                    <div class="flex-1 flex items-center">
                                        ${this._getStepHTML(1)}
                                        ${this._getStepLine()}
                                        ${this._getStepHTML(2)}
                                        ${this._getStepLine()}
                                        ${this._getStepHTML(3)}
                                        ${this._getStepLine()}
                                        ${this._getStepHTML(4)}
                                    </div>
                                </div>
                                <p id="progressText" class="text-sm text-gray-600 text-center">Preparing...</p>
                            </div>

                            <!-- Form -->
                            <div id="customizeForm" class="space-y-6">
                                <div>
                                    <label for="cvSelect" class="block text-sm font-medium text-gray-700 mb-2">Select Your CV</label>
                                    <select id="cvSelect" class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500">
                                        <option value="">Loading your CVs...</option>
                                    </select>
                                </div>

                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-3">Choose Template</label>
                                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        ${this._getTemplateOption('professional', 'Professional', 'gray', true)}
                                        ${this._getTemplateOption('modern', 'Modern', 'blue')}
                                        ${this._getTemplateOption('minimal', 'Minimal', 'green')}
                                        ${this._getTemplateOption('creative', 'Creative', 'purple')}
                                    </div>
                                </div>

                                <div>
                                    <label class="flex items-center mb-3 cursor-pointer">
                                        <input type="checkbox" id="includeCoverLetter" checked class="rounded text-primary-600 focus:ring-primary-500">
                                        <span class="ml-2 text-sm font-medium text-gray-700">Generate Cover Letter</span>
                                    </label>
                                    <div id="coverLetterOptions">
                                        <label for="toneSelect" class="block text-sm font-medium text-gray-700 mb-2">Cover Letter Tone</label>
                                        <select id="toneSelect" class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500">
                                            <option value="professional">Professional</option>
                                            <option value="enthusiastic">Enthusiastic</option>
                                            <option value="conversational">Conversational</option>
                                            <option value="formal">Formal</option>
                                        </select>
                                    </div>
                                </div>

                                <div id="usageWarning" class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 hidden">
                                    <div class="flex items-start">
                                        <svg class="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                            <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" />
                                        </svg>
                                        <div class="ml-3">
                                            <p class="text-sm font-medium text-yellow-800">
                                                You have <strong id="remainingGenerations">0</strong> generations remaining.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="flex flex-col sm:flex-row gap-4 mt-8">
                                <button onclick="JobActions.closeModal()" class="flex-1 border border-gray-300 text-gray-700 rounded-lg px-6 py-2 font-medium hover:bg-gray-50 transition-colors">Cancel</button>
                                <button onclick="JobActions.handleGenerate()" class="flex-1 btn-gradient text-white rounded-lg px-6 py-2 font-medium hover:shadow-lg transition-all">Generate Documents</button>
                            </div>
                        </div>
                    </div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', customizeModalHTML);
            this._setupTemplateSelectors();
        }


    }

    _getStepHTML(num) {
        return `
            <div class="flex items-center">
                <div id="step${num}" class="step-indicator w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold transition-all duration-300">
                    <span class="step-number">${num}</span>
                    <svg class="step-check hidden w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                    </svg>
                </div>
            </div>`;
    }

    _getStepLine() {
        return `<div class="step-line w-full h-1 bg-gray-200 mx-1 transition-all duration-300"></div>`;
    }

    _getTemplateOption(id, name, color, active = false) {
        return `
            <div class="template-option ${active ? 'active border-primary-500' : 'border-gray-200'} cursor-pointer border-2 rounded-lg p-3 text-center hover:border-primary-300 hover:shadow-md transition-all" data-template="${id}">
                <div class="bg-gradient-to-br from-${color}-200 to-${color}-300 h-20 rounded mb-2"></div>
                <span class="text-sm font-medium">${name}</span>
            </div>`;
    }

    _setupTemplateSelectors() {
        const options = document.querySelectorAll('.template-option');
        options.forEach(option => {
            option.addEventListener('click', function () {
                options.forEach(o => {
                    o.classList.remove('active', 'border-primary-500');
                    o.classList.add('border-gray-200');
                });
                this.classList.add('active', 'border-primary-500');
                this.classList.remove('border-gray-200');
            });
        });

        const clCheckbox = document.getElementById('includeCoverLetter');
        if (clCheckbox) {
            clCheckbox.addEventListener('change', (e) => {
                const opts = document.getElementById('coverLetterOptions');
                if (opts) opts.style.display = e.target.checked ? 'block' : 'none';
            });
        }
    }

    /**
     * Opens the customization modal for a specific job
     */
    async openCustomizeModal(jobId) {
        this.currentJobId = jobId;
        const modal = document.getElementById('customizeModal');
        if (!modal) return;

        // 1. Check Tier Access using PremiumGuard
        if (typeof PremiumGuard !== 'undefined') {
            // "CV_CUSTOMIZATION" requires at least 'basic'
            if (!PremiumGuard.enforce('CV_CUSTOMIZATION', 'Included on Basic', 'Customizing a CV and choosing a cover letter are included on Basic and Premium.')) {
                return;
            }
        }

        // 2. Check Usage Limits (if any for paid tiers)
        // Currently Basic/Premium are unlimited (9999), but we keep this check for future proofing
        // or if we switch back to credit based.
        const canGenerate = await this.checkGenerationLimits();
        if (!canGenerate) {
            // If they passed PremiumGuard but failed this, it means they hit a hard cap (unlikely for now)
            if (typeof UpgradeModal !== 'undefined') {
                UpgradeModal.show('Limit Reached', 'You have reached your generation limit for this month.');
            } else {
                alert('Limit Reached');
            }
            return;
        }

        // Reset state
        if (window.resetProgressBar) window.resetProgressBar();
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        await this.loadCVs();
    }

    async checkGenerationLimits() {
        try {
            // We already checked tier access via PremiumGuard.
            // Here we just check if they are over the limit for their tier.
            const response = await fetch(`${CONFIG.API_BASE_URL}/api/v1/applications/stats/overview`, {
                headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
            });

            if (response.ok) {
                const stats = await response.json();
                const generationsUsed = stats.cv_generations_this_month || 0;

                // Fetch user to confirm tier logic if needed, or rely on what PremiumGuard assumes
                // Ideally this logic should be unified in backend or PremiumGuard, 
                // but for now we mirror the logic: 
                // Basic/Premium = 9999 (Unlimited).
                // If we are here, we are at least Basic.

                return generationsUsed < 9999;
            }
            return true; // Fail open if stat check fails
        } catch (error) {
            console.error('Failed to check limits:', error);
            return true;
        }
    }

    showUpgradePrompt() {
        // Deprecated - Replaced by UpgradeModal.show() via PremiumGuard
        if (typeof UpgradeModal !== 'undefined') {
            UpgradeModal.show('Premium Feature', 'Please upgrade to access this feature.');
        }
    }

    closeModal() {
        const modal = document.getElementById('customizeModal');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
        this.currentJobId = null;
    }

    async loadCVs() {
        try {
            const response = await fetch(`${CONFIG.API_BASE_URL}/api/v1/documents/?document_type=cv`, {
                headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
            });

            const select = document.getElementById('cvSelect');
            if (response.ok && select) {
                const data = await response.json();
                const cvs = data.documents || [];

                if (cvs.length > 0) {
                    select.innerHTML = cvs.map(doc =>
                        `<option value="${doc.id}">${doc.filename}</option>`
                    ).join('');
                } else {
                    select.innerHTML = '<option value="">No CVs found - Upload a CV first</option>';
                }
            }
        } catch (e) {
            console.error('Failed to load CVs', e);
        }
    }

    async checkLimits() {
        // Reusing existing logic pattern
        try {
            // Basic limit check visualization
            const response = await fetch(`${CONFIG.API_BASE_URL}/api/v1/applications/stats/overview`, {
                headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
            });
            // Implementation can be refined based on strict backend limit endpoints
        } catch (e) { }
    }

    async handleGenerate() {
        if (!this.currentJobId) {
            CVision.Utils.showAlert('No job selected', 'error');
            return;
        }

        const cvId = document.getElementById('cvSelect').value;
        if (!cvId) {
            const cvSelect = document.getElementById('cvSelect');
            const hasNoDocs = cvSelect && cvSelect.options.length <= 1;

            const helpMsg = hasNoDocs
                ? 'No CV found. Please upload your Resume/CV to the Documents page first so we can customize it for this job!'
                : 'Please select a CV to customize.';

            CVision.Utils.showAlert(helpMsg, 'error');
            return;
        }

        const template = document.querySelector('.template-option.active')?.dataset.template || 'professional';
        const includeCoverLetter = document.getElementById('includeCoverLetter').checked;
        const tone = document.getElementById('toneSelect').value;

        // Disable the generate button to prevent multiple clicks
        const generateBtn = event?.target || document.querySelector('button[onclick*="handleGenerate"]');
        const originalBtnText = generateBtn?.innerHTML;
        if (generateBtn) {
            generateBtn.disabled = true;
            generateBtn.innerHTML = `
                <svg class="animate-spin h-5 w-5 mr-2 inline" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Generating...
            `;
            generateBtn.classList.add('opacity-75', 'cursor-not-allowed');
        }

        if (window.showProgressBar) window.showProgressBar();

        try {
            // Simulated steps for UI feedback if exact progress not available
            if (window.updateProgress) window.updateProgress(1, 'Analyzing CV...');
            await new Promise(r => setTimeout(r, 800));

            if (window.updateProgress) window.updateProgress(2, 'Generating content...');

            // Call Generation Module
            if (window.GenerationModule) {
                const result = await GenerationModule.customizeForJob(cvId, this.currentJobId, {
                    template,
                    includeCoverLetter,
                    tone
                });

                if (window.updateProgress) window.updateProgress(4, 'Finalizing...');
                await new Promise(r => setTimeout(r, 800));

                this.closeModal();

                // Show success modal with download links
                if (result && window.GenerationModule && window.GenerationModule.showGenerationModal) {
                    window.GenerationModule.showGenerationModal(result);
                }

                // If on jobs page or applications page, we might want to refresh the item.
                // We can dispatch a custom event that pages can listen to
                document.dispatchEvent(new CustomEvent('job:updated', {
                    detail: { jobId: this.currentJobId, result }
                }));

                // Fallback direct update if functions exist globally
                if (window.updateJobInList) {
                    window.updateJobInList(this.currentJobId, {
                        generated_cv_path: result.cv_pdf_url,
                        generated_cover_letter_path: result.cover_letter_pdf_url
                    });
                }
            } else {
                throw new Error('GenerationModule not found');
            }

        } catch (error) {
            console.error('Generation failed', error);
            if (window.showProgressError) window.showProgressError(error.message);
            else CVision.Utils.showAlert(error.message, 'error');
        } finally {
            // Re-enable the button
            if (generateBtn) {
                generateBtn.disabled = false;
                generateBtn.innerHTML = originalBtnText || 'Generate Documents';
                generateBtn.classList.remove('opacity-75', 'cursor-not-allowed');
            }
        }
    }

    // Preview methods removed - delegated to DocumentViewer


    /**
     * Returns HTML for Action Buttons based on job state
     * @param {Object} job - The job object
     * @param {boolean} includeActions - Whether to include Apply/Customize buttons (default: true)
     * @returns {string} HTML string
     */
    /**
     * Set the list of applied jobs
     * @param {Array} applications 
     */
    setAppliedJobs(applications) {
        this.appliedJobIds = new Set(applications.map(app => String(app.job_id || app._id)));
    }

    /**
     * Mark a single job as applied
     * @param {string} jobId 
     */
    markAsApplied(jobId) {
        this.appliedJobIds.add(String(jobId));
    }



    getButtonsHTML(job, includeActions = true) {
        const jobId = String(job._id || job.id);
        const isApplied = this.appliedJobIds.has(jobId);
        const hasCV = !!job.generated_cv_path;
        const hasCL = !!job.generated_cover_letter_path;
        const needsUpgrade = window.PremiumGuard && !PremiumGuard.hasAccess('CV_CUSTOMIZATION');
        const customizeLabel = needsUpgrade ? 'Upgrade to Customize' : 'Customize';



        let html = '';

        // Row 1: Document View Buttons (delegated to DocumentViewer)
        if (hasCV || hasCL) {
            if (window.DocumentViewer) {
                html += window.DocumentViewer.renderButtons({
                    cvPath: job.generated_cv_path,
                    clPath: job.generated_cover_letter_path
                });
            }
        }

        // Row 2: Action Buttons
        if (includeActions) {
            html += `
            <div class="flex gap-3">
                ${!isApplied ? `
                <button onclick="JobActions.openCustomizeModal('${jobId}')" 
                    class="flex-1 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 hover:border-gray-400 rounded-lg px-4 py-2 text-sm font-semibold transition-all shadow-sm flex items-center justify-center gap-2">
                    <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                    ${customizeLabel}
                </button>
                ` : ''}
                ${isApplied ? `
                    <button disabled
                        class="flex-1 bg-green-50 text-green-700 border border-green-200 rounded-lg px-4 py-2 text-sm font-semibold opacity-80 cursor-not-allowed flex items-center justify-center gap-2">
                         <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                         Applied
                    </button>
                ` : `
                    <button type="button" data-job-id="${this.escapeAttr(jobId)}" data-apply-url="${this.escapeAttr(job.application_url || job.external_url || job.apply_url || '')}" onclick="event.stopPropagation(); window.JobApply.applyByOpeningLink(this.dataset.jobId, this.dataset.applyUrl)"
                        class="flex-1 btn-gradient text-white rounded-lg px-4 py-2 text-sm font-semibold hover:shadow-lg transition-all shadow-md flex items-center justify-center gap-2">
                         Apply
                    </button>
                `}
            </div>`;
        };

        return html;
    }
}

// Initialize
// Initialize and expose globally
window.JobActions = new JobActionComponent();

// Auto-init on load
document.addEventListener('DOMContentLoaded', () => {
    window.JobActions.init();
});
