/**
 * CvUploader Component
 * Reusable component for handling CV file uploads with drag & drop support.
 * 
 * Usage:
 * const uploader = new CvUploader({
 *     dropZoneId: 'dropZone',
 *     fileInputId: 'fileInput',
 *     onSuccess: (result) => console.log('Upload success', result),
 *     onError: (error) => console.error('Upload error', error)
 * });
 * uploader.init();
 */

class CvUploader {
    constructor(config) {
        this.config = Object.assign({
            dropZoneId: 'dropZone',
            fileInputId: 'fileInput',
            coverDropZoneId: 'coverLetterDropZone',
            coverFileInputId: 'coverLetterFileInput',
            loadingId: 'uploadLoading',
            apiPath: '/api/v1/documents/upload',
            maxSize: 10 * 1024 * 1024, // 10MB
            allowedTypes: [
                'application/pdf',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/msword',
                'text/plain'
            ],
            singleCvOnly: true, // Only allow one CV per user
            onSuccess: null,
            onError: null
        }, config);

        this.dropZone = document.getElementById(this.config.dropZoneId);
        this.fileInput = document.getElementById(this.config.fileInputId);
        this.coverDropZone = document.getElementById(this.config.coverDropZoneId);
        this.coverFileInput = document.getElementById(this.config.coverFileInputId);
        this.documentType = 'cv';
        this.loadingEl = document.getElementById(this.config.loadingId);

        // Upload state management
        this.isUploading = false;
        this.modal = null;
        this.currentStep = 0;

        // Ensure API base URL is available
        this.apiBaseUrl = (window.CONFIG && window.CONFIG.API_BASE_URL) || '';
    }

    init() {
        if (!this.dropZone || !this.fileInput || !this.coverDropZone || !this.coverFileInput) {
            console.error('CvUploader: Drop zone or file input not found');
            return;
        }

        this.createModal();
        this.setupEventListeners();
        console.log('✅ CvUploader initialized');
    }

    createModal() {
        // Remove existing modal if present
        const existingModal = document.getElementById('cv-upload-modal');
        if (existingModal) existingModal.remove();

        const modalHTML = `
        <div id="cv-upload-modal" class="fixed inset-0 z-50 hidden items-center justify-center" style="background: rgba(0,0,0,0.5);">
            <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
                <!-- Header -->
                <div class="bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-4">
                    <h3 class="text-white text-lg font-bold" id="cv-modal-title">Uploading CV</h3>
                </div>
                
                <!-- Progress Steps -->
                <div class="px-6 py-6">
                    <div class="flex items-center justify-between mb-6">
                        <div class="flex flex-col items-center" id="step-upload">
                            <div class="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-lg font-bold mb-1 transition-all" id="step-upload-icon">📤</div>
                            <span class="text-xs text-gray-500">Upload</span>
                        </div>
                        <div class="flex-1 h-1 bg-gray-200 mx-2" id="progress-bar-1"><div class="h-full bg-blue-500 transition-all duration-500" style="width: 0%"></div></div>
                        <div class="flex flex-col items-center" id="step-parse">
                            <div class="w-10 h-10 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center text-lg font-bold mb-1 transition-all" id="step-parse-icon">📝</div>
                            <span class="text-xs text-gray-500">Parse</span>
                        </div>
                        <div class="flex-1 h-1 bg-gray-200 mx-2" id="progress-bar-2"><div class="h-full bg-blue-500 transition-all duration-500" style="width: 0%"></div></div>
                        <div class="flex flex-col items-center" id="step-done">
                            <div class="w-10 h-10 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center text-lg font-bold mb-1 transition-all" id="step-done-icon">✅</div>
                            <span class="text-xs text-gray-500">Done</span>
                        </div>
                    </div>
                    
                    <!-- Status Message -->
                    <div class="text-center mb-4">
                        <p class="text-gray-600" id="cv-modal-status">Preparing upload...</p>
                    </div>
                    
                    <!-- Results Section (Hidden initially) -->
                    <div id="cv-modal-results" class="hidden">
                        <div class="bg-gray-50 rounded-xl p-4 border border-gray-100">
                            <h4 class="font-bold text-gray-800 mb-3 flex items-center gap-2">
                                <span>📊</span> Analysis Results
                            </h4>
                            <div class="grid grid-cols-2 gap-3" id="cv-results-grid">
                                <!-- Results injected here -->
                            </div>
                        </div>
                    </div>
                    
                    <!-- Error Section (Hidden initially) -->
                    <div id="cv-modal-error" class="hidden">
                        <div class="bg-red-50 rounded-xl p-4 border border-red-100">
                            <p class="text-red-600 text-center" id="cv-error-message">Upload failed</p>
                        </div>
                    </div>
                </div>
                
                <!-- Footer -->
                <div class="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3" id="cv-modal-footer">
                    <button id="cv-modal-close" class="hidden px-4 py-2 text-gray-600 hover:text-gray-800 font-medium transition-colors">Close</button>
                    <button id="cv-modal-action" class="hidden px-6 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium hover:opacity-90 transition-opacity">View Profile</button>
                </div>
            </div>
        </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.modal = document.getElementById('cv-upload-modal');

        // Close button handler
        document.getElementById('cv-modal-close').addEventListener('click', () => this.hideModal());
        document.getElementById('cv-modal-action').addEventListener('click', () => {
            this.hideModal();
            // Reload to show new CV data
            window.location.reload();
        });
    }

    setupEventListeners() {
        // Drop Zone Click -> File Input Click
        this.dropZone.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.documentType = 'cv';
            this.fileInput.click();
        });

        // File Input Change
        this.fileInput.addEventListener('change', (e) => {
            this.documentType = 'cv';
            this.handleFileSelect(e);
        });

        const coverLabel = document.getElementById('coverLetterDropLabel') || this.coverDropZone?.querySelector('p');
        const coverLocked = window.PremiumGuard && !PremiumGuard.hasAccess('COVER_LETTER');
        if (coverLabel && coverLocked) {
            coverLabel.textContent = 'Upgrade to add a cover letter';
        }

        this.coverDropZone.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (window.PremiumGuard && !PremiumGuard.hasAccess('COVER_LETTER')) {
                PremiumGuard.enforce('COVER_LETTER', 'Upgrade', 'Selecting a cover letter is included on Basic and Premium.');
                return;
            }
            this.documentType = 'cover_letter';
            this.coverFileInput.click();
        });

        this.coverFileInput.addEventListener('change', (e) => {
            this.documentType = 'cover_letter';
            this.handleFileSelect(e);
        });

        // Drag & Drop Visuals
        ['dragenter', 'dragover'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.dropZone.classList.add('border-primary-500', 'bg-primary-50');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            this.dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.dropZone.classList.remove('border-primary-500', 'bg-primary-50');
            }, false);
        });

        // Drop Action
        this.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.dropZone.classList.remove('border-primary-500', 'bg-primary-50');

            const files = e.dataTransfer.files;
            if (files.length > 0) {
                // Don't sync to fileInput.files - it triggers change event causing duplicate upload
                this.documentType = 'cv';
                this.processFile(files[0]);
            }
        });

        this.setupCoverLetterDragAndDrop();
    }

    setupCoverLetterDragAndDrop() {
        ['dragenter', 'dragover'].forEach((eventName) => {
            this.coverDropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.coverDropZone.classList.add('border-primary-500', 'bg-primary-50');
            });
        });

        ['dragleave', 'drop'].forEach((eventName) => {
            this.coverDropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.coverDropZone.classList.remove('border-primary-500', 'bg-primary-50');
            });
        });

        this.coverDropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.documentType = 'cover_letter';
                this.processFile(files[0]);
            }
        });
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            this.processFile(file);
        }
    }

    async processFile(file) {
        // Prevent concurrent uploads
        if (this.isUploading) {
            console.warn('Upload already in progress');
            return;
        }

        // Validate
        const validation = this.validateFile(file);
        if (!validation.valid) {
            this.handleError(validation.error);
            this.resetInput();
            return;
        }

        if (this.getDocumentType() === 'cover_letter') {
            const tier = (window.CVision?.Utils?.getUser()?.subscription_tier || 'free').toLowerCase();
            const allowed = window.PremiumGuard
                ? PremiumGuard.hasAccess('COVER_LETTER')
                : tier === 'basic' || tier === 'premium';
            if (!allowed) {
                if (window.PremiumGuard) {
                    PremiumGuard.enforce('COVER_LETTER', 'Included on Basic', 'Selecting a cover letter is included on Basic and Premium.');
                } else {
                    this.handleError('Selecting a cover letter is included on Basic and Premium.');
                }
                this.resetInput();
                return;
            }
        }

        // Only CV uploads replace an existing CV; cover letters can be uploaded repeatedly.
        if (this.config.singleCvOnly && this.getDocumentType() === 'cv') {
            const canUpload = await this.checkSingleCvLimit(file);
            if (!canUpload) {
                this.resetInput();
                return;
            }
        }

        // Upload
        await this.uploadFile(file);
    }

    validateFile(file) {
        if (!this.config.allowedTypes.includes(file.type)) {
            return {
                valid: false,
                error: 'Invalid file type. Please upload PDF, DOCX, DOC, or TXT files.'
            };
        }

        if (file.size > this.config.maxSize) {
            return {
                valid: false,
                error: `File too large. Maximum size is ${this.config.maxSize / (1024 * 1024)}MB.`
            };
        }

        return { valid: true };
    }

    async uploadFile(file) {
        this.isUploading = true;
        this.showModal();
        this.updateProgress(1, `Uploading ${file.name}...`);

        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('document_type', this.getDocumentType());

            const token = window.CVision ? CVision.Utils.getToken() : localStorage.getItem('access_token');
            const uploadUrl = `${this.apiBaseUrl}${this.config.apiPath}`;

            const response = await fetch(uploadUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            // Transition to parsing immediately as backend starts processing
            this.updateProgress(2, this.getDocumentType() === 'cover_letter'
                ? 'Saving cover letter...'
                : 'Analysing CV content with AI...');

            if (!response.ok) {
                let errorMessage = `Upload failed (${response.status})`;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.detail || errorData.message || errorMessage;
                } catch (e) {
                    console.warn('Backend returned non-JSON error:', response.status);
                    if (response.status === 504) errorMessage = 'Server timed out. Please try again.';
                    else if (response.status === 413) errorMessage = 'File is too large.';
                }
                throw new Error(errorMessage);
            }

            const result = await response.json();

            // Step 3: Done
            this.updateProgress(3, this.getDocumentType() === 'cover_letter'
                ? 'Cover letter uploaded!'
                : 'Analysis complete!');

            // Success results
            setTimeout(() => {
                this.showAnalysisResults(result);
            }, 500);

            // Success Callback
            if (this.config.onSuccess) {
                this.config.onSuccess(result);
            }

            this.resetInput();

        } catch (error) {
            console.error('CvUploader Error:', error);
            this.handleError(error.message);
        } finally {
            this.isUploading = false;
        }
    }

    handleError(message) {
        // Show error in modal
        this.showModalError(message);

        if (this.config.onError) {
            this.config.onError(message);
        }
    }

    showModal() {
        if (!this.modal) return;
        this.modal.classList.remove('hidden');
        this.modal.classList.add('flex');
        this.currentStep = 0;
        this.resetModalState();
    }

    hideModal() {
        if (!this.modal) return;
        this.modal.classList.add('hidden');
        this.modal.classList.remove('flex');
    }

    resetModalState() {
        // Reset step icons
        const steps = ['upload', 'parse', 'done'];
        steps.forEach(step => {
            const icon = document.getElementById(`step-${step}-icon`);
            if (icon) {
                icon.classList.remove('bg-blue-100', 'text-blue-600', 'bg-green-100', 'text-green-600');
                icon.classList.add('bg-gray-100', 'text-gray-400');
            }
        });

        // Reset progress bars
        document.querySelector('#progress-bar-1 > div').style.width = '0%';
        document.querySelector('#progress-bar-2 > div').style.width = '0%';

        // Hide results and buttons
        document.getElementById('cv-modal-results').classList.add('hidden');
        document.getElementById('cv-modal-error').classList.add('hidden');
        document.getElementById('cv-modal-close').classList.add('hidden');
        document.getElementById('cv-modal-action').classList.add('hidden');

        // Reset title and status
        document.getElementById('cv-modal-title').textContent = this.getDocumentType() === 'cover_letter'
            ? 'Uploading Cover Letter'
            : 'Uploading CV';
        document.getElementById('cv-modal-status').textContent = 'Preparing upload...';
    }

    updateProgress(step, message) {
        const statusEl = document.getElementById('cv-modal-status');
        if (statusEl) statusEl.textContent = message;

        if (step === 1) {
            // Uploading
            const uploadIcon = document.getElementById('step-upload-icon');
            uploadIcon.classList.remove('bg-gray-100', 'text-gray-400');
            uploadIcon.classList.add('bg-blue-100', 'text-blue-600');
            document.querySelector('#progress-bar-1 > div').style.width = '50%';
        } else if (step === 2) {
            // Parsing
            const uploadIcon = document.getElementById('step-upload-icon');
            uploadIcon.classList.remove('bg-blue-100', 'text-blue-600');
            uploadIcon.classList.add('bg-green-100', 'text-green-600');
            uploadIcon.textContent = '✓';
            document.querySelector('#progress-bar-1 > div').style.width = '100%';

            const parseIcon = document.getElementById('step-parse-icon');
            parseIcon.classList.remove('bg-gray-100', 'text-gray-400');
            parseIcon.classList.add('bg-blue-100', 'text-blue-600');
            document.querySelector('#progress-bar-2 > div').style.width = '50%';
        } else if (step === 3) {
            // Done
            const parseIcon = document.getElementById('step-parse-icon');
            parseIcon.classList.remove('bg-blue-100', 'text-blue-600');
            parseIcon.classList.add('bg-green-100', 'text-green-600');
            parseIcon.textContent = '✓';
            document.querySelector('#progress-bar-2 > div').style.width = '100%';

            const doneIcon = document.getElementById('step-done-icon');
            doneIcon.classList.remove('bg-gray-100', 'text-gray-400');
            doneIcon.classList.add('bg-green-100', 'text-green-600');
        }

        this.currentStep = step;
    }

    showAnalysisResults(result) {
        if (this.getDocumentType() === 'cover_letter') {
            document.getElementById('cv-modal-title').textContent = 'Cover Letter Uploaded Successfully!';
            document.getElementById('cv-modal-results').classList.add('hidden');
            document.getElementById('cv-modal-close').classList.remove('hidden');
            document.getElementById('cv-modal-action').classList.remove('hidden');
            return;
        }

        const cvData = result.cv_data || result.document?.cv_data || {};
        const skills = Array.isArray(cvData.skills) ? cvData.skills : [];
        const experience = Array.isArray(cvData.experience) ? cvData.experience : [];
        const name = cvData.name || cvData.full_name || 'Unknown';

        const resultsGrid = document.getElementById('cv-results-grid');
        resultsGrid.innerHTML = `
            <div class="bg-white rounded-lg p-3 text-center shadow-sm">
                <div class="text-2xl font-bold text-blue-600">${skills.length}</div>
                <div class="text-xs text-gray-500">Skills Found</div>
            </div>
            <div class="bg-white rounded-lg p-3 text-center shadow-sm">
                <div class="text-2xl font-bold text-purple-600">${experience.length}</div>
                <div class="text-xs text-gray-500">Positions</div>
            </div>
            <div class="col-span-2 bg-white rounded-lg p-3 shadow-sm">
                <div class="text-xs text-gray-500 mb-1">Detected Name</div>
                <div class="font-semibold text-gray-800 truncate">${name}</div>
            </div>
        `;

        document.getElementById('cv-modal-title').textContent = 'CV Processed Successfully!';
        document.getElementById('cv-modal-results').classList.remove('hidden');
        document.getElementById('cv-modal-close').classList.remove('hidden');
        document.getElementById('cv-modal-action').classList.remove('hidden');
    }

    showModalError(message) {
        document.getElementById('cv-modal-title').textContent = 'Upload Failed';
        document.getElementById('cv-error-message').textContent = message;
        document.getElementById('cv-modal-error').classList.remove('hidden');
        document.getElementById('cv-modal-close').classList.remove('hidden');
        document.getElementById('cv-modal-status').textContent = 'An error occurred';
    }

    showLoading(isLoading) {
        // Keep legacy support for old loading element
        if (this.loadingEl) {
            if (isLoading) {
                this.loadingEl.classList.remove('hidden');
            } else {
                this.loadingEl.classList.add('hidden');
            }
        }
    }

    resetInput() {
        if (this.fileInput) {
            this.fileInput.value = '';
        }
    }

    getDocumentType() {
        return this.documentType;
    }

    async checkSingleCvLimit(file) {
        try {
            const token = window.CVision ? CVision.Utils.getToken() : localStorage.getItem('access_token');
            const response = await fetch(`${this.apiBaseUrl}/api/v1/documents/`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                const documents = data.documents || data || [];

                if (documents.length > 0) {
                    // Show our built-in confirm modal (now identical to dashboard Modal)
                    return new Promise((resolve) => {
                        this.showConfirmModal({
                            title: 'Replace Existing CV?',
                            message: 'You already have a CV uploaded. The new CV will replace it and be automatically processed. Continue?',
                            confirmText: 'Replace & Process',
                            confirmColor: 'blue',
                            onConfirm: async () => {
                                this.hideConfirmModal();
                                await this.deleteExistingCvs(documents);
                                await this.uploadFile(file);
                                resolve(false); // Don't continue with original flow
                            },
                            onCancel: () => {
                                this.hideConfirmModal();
                                resolve(false);
                            }
                        });
                    });
                }
            }
            return true; // No existing CVs, proceed
        } catch (error) {
            console.error('Error checking CV limit:', error);
            return true; // On error, allow upload
        }
    }

    showConfirmModal(options) {
        // Remove existing confirm modal if present
        const existingConfirm = document.getElementById('cv-confirm-modal');
        if (existingConfirm) existingConfirm.remove();

        // Exact markup from modal.js
        const confirmHTML = `
        <div id="cv-confirm-modal" class="fixed inset-0 z-50 bg-gray-900 bg-opacity-50 backdrop-blur-sm flex items-center justify-center transition-opacity opacity-0 hidden">
            <div id="cv-confirm-content" class="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 transform transition-all scale-95 opacity-0">
                <div class="mb-4">
                    <h3 class="text-lg font-bold text-gray-900">${options.title}</h3>
                    <p class="text-sm text-gray-600 mt-2">${options.message}</p>
                </div>
                <div class="flex justify-end gap-3 mt-6">
                    <button id="cv-confirm-cancel" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">
                        ${options.cancelText || 'Cancel'}
                    </button>
                    <button id="cv-confirm-ok" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm">
                        ${options.confirmText || 'Confirm'}
                    </button>
                </div>
            </div>
        </div>
        `;

        document.body.insertAdjacentHTML('beforeend', confirmHTML);

        const overlay = document.getElementById('cv-confirm-modal');
        const content = document.getElementById('cv-confirm-content');
        const btnOk = document.getElementById('cv-confirm-ok');
        const btnCancel = document.getElementById('cv-confirm-cancel');

        // Handlers
        btnOk.addEventListener('click', options.onConfirm);
        btnCancel.addEventListener('click', options.onCancel);

        // Show animation
        overlay.classList.remove('hidden');
        // Trigger reflow
        void overlay.offsetWidth;

        overlay.classList.remove('opacity-0');
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }

    hideConfirmModal() {
        const overlay = document.getElementById('cv-confirm-modal');
        const content = document.getElementById('cv-confirm-content');

        if (overlay && content) {
            overlay.classList.add('opacity-0');
            content.classList.remove('scale-100', 'opacity-100');
            content.classList.add('scale-95', 'opacity-0');

            setTimeout(() => {
                overlay.remove();
            }, 300);
        } else if (overlay) {
            overlay.remove();
        }
    }

    async deleteExistingCvs(documents) {
        const token = window.CVision ? CVision.Utils.getToken() : localStorage.getItem('access_token');

        for (const doc of documents) {
            try {
                await fetch(`${this.apiBaseUrl}/api/v1/documents/${doc.id || doc._id}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
            } catch (error) {
                console.error('Error deleting document:', error);
            }
        }
    }
}

// Export to global scope
window.CvUploader = CvUploader;
