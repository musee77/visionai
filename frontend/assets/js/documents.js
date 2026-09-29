// frontend/assets/js/documents.js
/**
 * Document management functionality for CV processing
 * Integrated with CVision framework
 */

class DocumentManager {
    constructor() {
        // FIXED: Use the global CONFIG from main.js instead of relative URL
        this.getApiUrl = () => {
            // Check if window.CONFIG exists (from main.js)
            if (window.CONFIG) {
                return `${window.CONFIG.API_BASE_URL}${window.CONFIG.API_PREFIX}/documents`;
            }
            // Fallback to localhost if CONFIG not available
            console.warn('CONFIG not found, using fallback URL');
            return 'http://localhost:8000/api/v1/documents';
        };

        this.apiBaseUrl = this.getApiUrl();
        console.log('✅ DocumentManager initialized with API URL:', this.apiBaseUrl);

        this.maxFileSize = 10 * 1024 * 1024; // 10MB
        this.allowedTypes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword',
            'text/plain'
        ];
        this.currentDocuments = [];
        this.pageSize = 6;
        this.currentPage = 1;
        this.init();
    }

    init() {
        this.checkAuth();
        this.setupEventListeners();
        this.loadDocuments();

        if (typeof CVision !== 'undefined') {
            CVision.initUserInfo();
        }
    }

    checkAuth() {
        if (typeof CVision !== 'undefined' && CVision.Utils && !CVision.Utils.isAuthenticated()) {
            window.location.href = 'login.html';
        }
    }

    setupEventListeners() {
        // File upload
        const fileInput = document.getElementById('cvFileInput');
        const dropZone = document.getElementById('dropZone');

        if (fileInput) {
            fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        }

        document.getElementById('documentTypeSelect')?.addEventListener('change', (e) => {
            const isCoverLetter = e.target.value === 'cover_letter';
            document.getElementById('uploadHeading').textContent = isCoverLetter ? 'Upload Your Cover Letter' : 'Upload Your CV';
            document.getElementById('dropZoneText').textContent = isCoverLetter ? 'Drag and drop your cover letter here, or click to browse' : 'Drag and drop your CV here, or click to browse';
            document.getElementById('uploadProgressText').textContent = isCoverLetter ? 'Uploading your cover letter...' : 'Processing your CV...';
        });

        // Only attach dropZone click listener (uploadCvBtn doesn't exist in HTML)
        if (dropZone) {
            this.setupDragAndDrop(dropZone);
            dropZone.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent any bubbling issues
                fileInput?.click();
            });
        }

        // Document actions - Event delegation
        document.addEventListener('click', (e) => {
            const target = e.target.closest('button');
            if (!target) return;

            if (target.classList.contains('documents-page-btn')) {
                const page = Number(target.dataset.page);
                const pages = Math.ceil(this.currentDocuments.length / this.pageSize);
                if (page >= 1 && page <= pages && page !== this.currentPage) {
                    this.currentPage = page;
                    this.renderDocuments(this.currentDocuments);
                    document.getElementById('documentsContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                return;
            }

            const documentId = target.dataset.documentId;
            if (!documentId) return;

            if (target.classList.contains('delete-document-btn')) {
                this.deleteDocument(documentId);
            } else if (target.classList.contains('reparse-document-btn')) {
                this.reparseDocument(documentId);
            } else if (target.classList.contains('customize-cv-btn') || target.classList.contains('generate-cover-letter-btn')) {
                if (!this.canUseBasicDocuments()) return;
                if (target.classList.contains('customize-cv-btn')) {
                    this.showCustomizationModal(documentId);
                } else {
                    this.showCoverLetterModal(documentId);
                }
            }
        });

        // Modal forms
        document.getElementById('customizeCvForm')?.addEventListener('submit', (e) =>
            this.handleCustomizeCv(e));
        document.getElementById('coverLetterForm')?.addEventListener('submit', (e) =>
            this.handleGenerateCoverLetter(e));

        // Modal close handlers
        document.addEventListener('click', (e) => {
            if (e.target.matches('.modal-close') || e.target.closest('.modal-close')) {
                const modal = e.target.closest('.modal');
                modal?.classList.add('hidden');
                modal?.classList.remove('flex');
            }

            // Close on backdrop click
            if (e.target.classList.contains('modal')) {
                e.target.classList.add('hidden');
                e.target.classList.remove('flex');
            }
        });
    }

    setupDragAndDrop(dropZone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.add('border-primary-500', 'bg-primary-50');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.remove('border-primary-500', 'bg-primary-50');
            }, false);
        });

        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.processFile(files[0]);
            }
        }, false);
    }

    async processFile(file) {
        try {
            const validation = this.validateFile(file);
            if (!validation.valid) {
                this.showAlert(validation.error, 'error');
                return;
            }

            const documentType = document.getElementById('documentTypeSelect')?.value || 'cv';
            this.showLoading(documentType === 'cover_letter' ? 'Uploading cover letter...' : 'Uploading and analyzing CV...');
            await this.uploadFile(file, documentType);

            this.hideLoading();
            this.showAlert(documentType === 'cover_letter' ? 'Cover letter uploaded successfully!' : 'CV uploaded and processed successfully!', 'success');
            await this.loadDocuments(true);

            // Clear file input
            const fileInput = document.getElementById('cvFileInput');
            if (fileInput) fileInput.value = '';

        } catch (error) {
            console.error('File processing error:', error);
            this.showAlert(error.message || 'Failed to process file', 'error');
            this.hideUploadProgress();
        }
    }

    validateFile(file) {
        if (!file) {
            return { valid: false, error: 'No file selected' };
        }

        if (file.size > this.maxFileSize) {
            return { valid: false, error: 'File size exceeds 10MB limit' };
        }

        if (!this.allowedTypes.includes(file.type)) {
            return { valid: false, error: 'Invalid file type. Please upload PDF, DOCX, DOC, or TXT files.' };
        }

        return { valid: true };
    }

    async uploadFile(file, documentType = 'cv') {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('document_type', documentType);

        const response = await fetch(`${this.apiBaseUrl}/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.getAuthToken()}`
            },
            body: formData
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Upload failed');
        }

        return await response.json();
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            this.processFile(file);
        }
    }

    async loadDocuments(resetPage = false) {
        try {
            const url = `${this.apiBaseUrl}/`;
            console.log('📥 Fetching documents from:', url);

            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to load documents');
            }

            const data = await response.json();
            this.currentDocuments = data.documents || [];
            if (resetPage) this.currentPage = 1;
            const pages = Math.max(1, Math.ceil(this.currentDocuments.length / this.pageSize));
            if (this.currentPage > pages) this.currentPage = pages;
            this.renderDocuments(this.currentDocuments);
            this.updateDocumentCount(this.currentDocuments.length);

        } catch (error) {
            console.error('Error loading documents:', error);
            this.showAlert('Failed to load documents', 'error');
        }
    }

    updateDocumentCount(count) {
        const countElement = document.getElementById('documentsCountText');
        if (countElement) {
            countElement.textContent = `${count} document${count !== 1 ? 's' : ''}`;
        }
    }

    renderDocuments(documents) {
        const container = document.getElementById('documentsContainer');
        if (!container) return;

        if (documents.length === 0) {
            container.innerHTML = `
                <div class="text-center py-12 text-gray-500">
                    <svg class="mx-auto h-16 w-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p class="text-lg font-medium mb-2">No CVs uploaded yet</p>
                    <p class="text-sm">Upload your CV to get started with AI-powered customization</p>
                </div>
            `;
            this.renderPagination(0);
            return;
        }

        const start = (this.currentPage - 1) * this.pageSize;
        const pageItems = documents.slice(start, start + this.pageSize);
        container.innerHTML = pageItems.map(doc => this.renderDocumentCard(doc)).join('');
        this.renderPagination(documents.length);
    }

    renderPagination(total) {
        const nav = document.getElementById('documentsPagination');
        if (!nav) return;

        const pages = Math.ceil(total / this.pageSize);
        if (pages <= 1) {
            nav.innerHTML = '';
            nav.classList.add('hidden');
            return;
        }

        const start = (this.currentPage - 1) * this.pageSize + 1;
        const end = Math.min(this.currentPage * this.pageSize, total);
        const pageButton = (page) => {
            const current = page === this.currentPage;
            return `<button type="button" class="documents-page-btn min-w-9 px-3 py-2 text-sm font-semibold rounded-lg border ${current ? 'bg-primary-600 text-white border-primary-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}" data-page="${page}" ${current ? 'aria-current="page"' : ''}>${page}</button>`;
        };
        const numbers = [];
        const pushPage = (page) => numbers.push(pageButton(page));
        if (pages <= 7) {
            for (let page = 1; page <= pages; page += 1) pushPage(page);
        } else {
            pushPage(1);
            const windowStart = Math.max(2, this.currentPage - 1);
            const windowEnd = Math.min(pages - 1, this.currentPage + 1);
            if (windowStart > 2) numbers.push('<span class="px-1 text-gray-400">…</span>');
            for (let page = windowStart; page <= windowEnd; page += 1) pushPage(page);
            if (windowEnd < pages - 1) numbers.push('<span class="px-1 text-gray-400">…</span>');
            pushPage(pages);
        }
        nav.classList.remove('hidden');
        nav.innerHTML = `
            <p class="text-sm text-gray-500">${start}–${end} of ${total}</p>
            <nav class="flex flex-wrap items-center gap-2" aria-label="Documents pages">
                <button type="button" class="documents-page-btn px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed" data-page="${this.currentPage - 1}" ${this.currentPage === 1 ? 'disabled' : ''}>Previous</button>
                ${numbers.join('')}
                <button type="button" class="documents-page-btn px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed" data-page="${this.currentPage + 1}" ${this.currentPage === pages ? 'disabled' : ''}>Next</button>
            </nav>
        `;
    }

    renderDocumentCard(document) {
        const uploadDate = this.formatDate(document.upload_date);
        const fileSize = this.formatFileSize(document.file_size);
        const statusBadge = this.getStatusBadge(document.status);
        const hasValidData = document.cv_data && !document.cv_data.error;

        return `
            <div class="border border-gray-200 rounded-xl p-6 hover:shadow-md transition-all hover:border-primary-200">
                <div class="flex items-start justify-between">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center space-x-3 mb-3">
                            <div class="p-2 bg-primary-100 rounded-lg flex-shrink-0">
                                <svg class="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                                </svg>
                            </div>
                            <div class="flex-1 min-w-0">
                                <h3 class="font-semibold text-gray-900 text-lg truncate">${this.escapeHtml(document.filename)}</h3>
                                <div class="flex items-center flex-wrap gap-x-3 gap-y-1 text-sm text-gray-500">
                                    <span>${fileSize}</span>
                                    <span>•</span>
                                    <span>${uploadDate}</span>
                                    ${statusBadge}
                                </div>
                            </div>
                        </div>
                        
                        ${hasValidData ? this.renderParsedInfo(document.cv_data) : this.renderNeedsParsing()}
                    </div>
                    
                    <div class="flex flex-col space-y-2 ml-6 flex-shrink-0">
                        ${hasValidData ? `
                            <button class="customize-cv-btn bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap" 
                                    data-document-id="${document.id}">
                                ${this.hasBasicDocuments() ? '✨ Customize CV' : 'Upgrade to Customize CV'}
                            </button>
                            <button class="generate-cover-letter-btn bg-green-600 hover:bg-green-700 text-white px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap" 
                                    data-document-id="${document.id}">
                                ${this.hasBasicDocuments() ? '📝 Cover Letter' : 'Upgrade to Cover Letter'}
                            </button>
                        ` : ''}
                        <button class="reparse-document-btn bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap" 
                                data-document-id="${document.id}">
                            ${hasValidData ? '🔄 Re-analyze' : '🔍 Analyze'}
                        </button>
                        <button class="delete-document-btn bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap" 
                                data-document-id="${document.id}">
                            🗑️ Delete
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    renderParsedInfo(cvData) {
        const skills = cvData.skills?.technical || [];
        const experience = cvData.experience || [];

        return `
            <div class="bg-gray-50 rounded-lg p-4 mb-4">
                <h4 class="font-medium text-gray-900 mb-2 flex items-center">
                    <svg class="w-4 h-4 text-green-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    AI Analysis Complete
                </h4>
                <div class="text-sm text-gray-600 space-y-1">
                    ${cvData.personal_info?.name ? `<p><strong>Name:</strong> ${this.escapeHtml(cvData.personal_info.name)}</p>` : ''}
                    ${cvData.personal_info?.email ? `<p><strong>Email:</strong> ${this.escapeHtml(cvData.personal_info.email)}</p>` : ''}
                    ${skills.length > 0 ? `<p><strong>Key Skills:</strong> ${skills.slice(0, 4).map(s => this.escapeHtml(s)).join(', ')}${skills.length > 4 ? '...' : ''}</p>` : ''}
                    ${experience.length > 0 ? `<p><strong>Experience:</strong> ${experience.length} role${experience.length !== 1 ? 's' : ''}</p>` : ''}
                </div>
            </div>
        `;
    }

    renderNeedsParsing() {
        return `
            <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                <p class="text-yellow-800 text-sm flex items-center">
                    <svg class="w-4 h-4 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3l-6.928-12c-.77-1.333-1.964-1.333-2.732 0L3.07 16.5c-.77 1.333.192 3 1.732 3z"></path>
                    </svg>
                    Processing needed - Click "Analyze" to extract CV data
                </p>
            </div>
        `;
    }

    getStatusBadge(status) {
        const statusConfig = {
            'completed': { color: 'green', text: 'Processed' },
            'failed': { color: 'red', text: 'Failed' },
            'processing': { color: 'yellow', text: 'Processing' }
        };

        const config = statusConfig[status] || { color: 'gray', text: status };

        return `
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-${config.color}-100 text-${config.color}-800">
                ${config.text}
            </span>
        `;
    }

    async deleteDocument(documentId) {
        if (!confirm('Are you sure you want to delete this CV? This action cannot be undone.')) {
            return;
        }

        try {
            const response = await fetch(`${this.apiBaseUrl}/${documentId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to delete document');
            }

            this.showAlert('CV deleted successfully', 'success');
            await this.loadDocuments();

        } catch (error) {
            console.error('Delete error:', error);
            this.showAlert('Failed to delete CV', 'error');
        }
    }

    async reparseDocument(documentId) {
        try {
            this.showLoading('Re-analyzing CV with AI...');

            const response = await fetch(`${this.apiBaseUrl}/${documentId}/reparse`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.getAuthToken()}`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to reparse document');
            }

            this.hideLoading();
            this.showAlert('CV analyzed successfully!', 'success');
            await this.loadDocuments();

        } catch (error) {
            console.error('Reparse error:', error);
            this.hideLoading();
            this.showAlert('Failed to analyze CV', 'error');
        }
    }

    showCustomizationModal(documentId) {
        const modal = document.getElementById('customizeCvModal');
        const form = document.getElementById('customizeCvForm');

        if (modal && form) {
            form.dataset.documentId = documentId;
            form.reset();
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }
    }

    showCoverLetterModal(documentId) {
        const modal = document.getElementById('coverLetterModal');
        const form = document.getElementById('coverLetterForm');

        if (modal && form) {
            form.dataset.documentId = documentId;
            form.reset();
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }
    }

    hasBasicDocuments() {
        const tier = (window.CVision?.Utils?.getUser()?.subscription_tier || 'free').toLowerCase();
        return tier === 'basic' || tier === 'premium';
    }

    canUseBasicDocuments() {
        if (this.hasBasicDocuments()) return true;
        this.showAlert('Upgrade to Basic to customize a CV and select a cover letter.', 'warning');
        return false;
    }

    async handleCustomizeCv(e) {
        e.preventDefault();

        const form = e.target;
        const documentId = form.dataset.documentId;
        const formData = new FormData(form);

        const requestData = {
            job_description: formData.get('job_description'),
            company_name: formData.get('company_name'),
            user_preferences: {}
        };

        try {
            this.showLoading('Customizing CV with AI...');

            const response = await fetch(`${this.apiBaseUrl}/${documentId}/customize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify(requestData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Customization failed');
            }

            const result = await response.json();
            this.hideLoading();
            this.hideModal('customizeCvModal');
            this.showCustomizedCvResult(result);

        } catch (error) {
            console.error('CV customization error:', error);
            this.hideLoading();
            this.showAlert(error.message || 'Failed to customize CV', 'error');
        }
    }

    async handleGenerateCoverLetter(e) {
        e.preventDefault();

        const form = e.target;
        const documentId = form.dataset.documentId;
        const formData = new FormData(form);

        const requestData = {
            job_description: formData.get('job_description'),
            company_name: formData.get('company_name'),
            job_title: formData.get('job_title'),
            user_preferences: {}
        };

        try {
            this.showLoading('Generating cover letter with AI...');

            const response = await fetch(`${this.apiBaseUrl}/${documentId}/cover-letter`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.getAuthToken()}`
                },
                body: JSON.stringify(requestData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Cover letter generation failed');
            }

            const result = await response.json();
            this.hideLoading();
            this.hideModal('coverLetterModal');
            this.showCoverLetterResult(result);

        } catch (error) {
            console.error('Cover letter generation error:', error);
            this.hideLoading();
            this.showAlert(error.message || 'Failed to generate cover letter', 'error');
        }
    }

    showCustomizedCvResult(result) {
        const modal = document.getElementById('customizedCvResultModal');
        const content = document.getElementById('customizedCvContent');

        if (modal && content) {
            content.innerHTML = this.formatCvDataForDisplay(result.customized_cv);
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }
    }

    showCoverLetterResult(result) {
        const modal = document.getElementById('coverLetterResultModal');
        const content = document.getElementById('coverLetterContent');

        if (modal && content) {
            content.innerHTML = `
                <div class="whitespace-pre-wrap bg-gray-50 p-6 rounded-lg border text-gray-700 leading-relaxed">
                    ${this.escapeHtml(result.cover_letter)}
                </div>
                <div class="mt-6 p-4 bg-primary-50 rounded-lg border border-primary-200">
                    <h4 class="font-medium text-primary-900 mb-2">Generation Details</h4>
                    <div class="text-sm text-primary-700 space-y-1">
                        <p><strong>Generated:</strong> ${new Date(result.metadata.generated_at).toLocaleString()}</p>
                        <p><strong>Word count:</strong> ${result.metadata.word_count}</p>
                        <p><strong>Tone:</strong> ${result.metadata.tone}</p>
                    </div>
                </div>
            `;

            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }
    }

    formatCvDataForDisplay(cvData) {
        let html = '';

        // Personal Info
        if (cvData.personal_info) {
            html += `
                <div class="mb-6">
                    <h3 class="text-lg font-bold text-primary-900 mb-3">Personal Information</h3>
                    <div class="bg-gray-50 p-4 rounded-lg">
                        ${this.formatSection(cvData.personal_info)}
                    </div>
                </div>
            `;
        }

        // Professional Summary
        if (cvData.professional_summary) {
            html += `
                <div class="mb-6">
                    <h3 class="text-lg font-bold text-primary-900 mb-3">Professional Summary</h3>
                    <div class="bg-gray-50 p-4 rounded-lg">
                        <p class="text-gray-700 leading-relaxed">${this.escapeHtml(cvData.professional_summary)}</p>
                    </div>
                </div>
            `;
        }

        // Skills
        if (cvData.skills) {
            html += `
                <div class="mb-6">
                    <h3 class="text-lg font-bold text-primary-900 mb-3">Skills</h3>
                    <div class="bg-gray-50 p-4 rounded-lg space-y-2">
            `;

            if (cvData.skills.technical?.length > 0) {
                html += `
                    <p>
                        <strong class="text-gray-900">Technical:</strong> 
                        <span class="text-gray-700">${cvData.skills.technical.map(s => this.escapeHtml(s)).join(', ')}</span>
                    </p>
                `;
            }

            if (cvData.skills.soft?.length > 0) {
                html += `
                    <p>
                        <strong class="text-gray-900">Soft Skills:</strong> 
                        <span class="text-gray-700">${cvData.skills.soft.map(s => this.escapeHtml(s)).join(', ')}</span>
                    </p>
                `;
            }

            html += '</div></div>';
        }

        // Experience
        if (cvData.experience?.length > 0) {
            html += `
                <div class="mb-6">
                    <h3 class="text-lg font-bold text-primary-900 mb-3">Experience</h3>
                    <div class="space-y-4">
            `;

            cvData.experience.forEach(exp => {
                html += `
                    <div class="bg-gray-50 p-4 rounded-lg">
                        <h4 class="font-semibold text-gray-900">${this.escapeHtml(exp.title || 'Position')}</h4>
                        <p class="text-primary-600 font-medium">${this.escapeHtml(exp.company || '')}${exp.duration ? ' • ' + this.escapeHtml(exp.duration) : ''}</p>
                        ${exp.description ? `<p class="text-sm text-gray-700 mt-2 leading-relaxed">${this.escapeHtml(exp.description)}</p>` : ''}
                        ${exp.achievements?.length > 0 ? `
                            <ul class="list-disc list-inside text-sm text-gray-700 mt-2 space-y-1">
                                ${exp.achievements.map(achievement => `<li>${this.escapeHtml(achievement)}</li>`).join('')}
                            </ul>
                        ` : ''}
                    </div>
                `;
            });

            html += '</div></div>';
        }

        return html;
    }

    formatSection(data) {
        let html = '<div class="grid grid-cols-1 md:grid-cols-2 gap-2">';
        for (const [key, value] of Object.entries(data)) {
            if (value) {
                const label = this.capitalizeFirst(key.replace(/_/g, ' '));
                html += `
                    <p class="text-sm">
                        <strong class="text-gray-900">${label}:</strong> 
                        <span class="text-gray-700">${this.escapeHtml(String(value))}</span>
                    </p>
                `;
            }
        }
        html += '</div>';
        return html;
    }

    // Utility methods
    formatDate(dateString) {
        if (typeof CVision !== 'undefined' && CVision.Utils?.formatDate) {
            return CVision.Utils.formatDate(dateString);
        }
        return new Date(dateString).toLocaleDateString();
    }

    formatFileSize(bytes) {
        if (typeof CVision !== 'undefined' && CVision.Utils?.formatFileSize) {
            return CVision.Utils.formatFileSize(bytes);
        }

        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    getAuthToken() {
        if (typeof CVision !== 'undefined' && CVision.Utils?.getToken) {
            return CVision.Utils.getToken();
        }
        return localStorage.getItem('access_token') || sessionStorage.getItem('access_token');
    }

    showAlert(message, type = 'info') {
        if (typeof CVision !== 'undefined' && CVision.Utils?.showAlert) {
            CVision.Utils.showAlert(message, type);
        } else {
            this.showNotification(message, type);
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        const bgColor = type === 'success' ? 'bg-green-500' :
            type === 'error' ? 'bg-red-500' :
                'bg-primary-500';

        notification.className = `fixed top-4 right-4 ${bgColor} text-white p-4 rounded-xl shadow-lg z-50 max-w-sm animate-slide-in`;
        notification.innerHTML = `
            <div class="flex items-center">
                <span class="mr-2">${message}</span>
                <button onclick="this.parentElement.parentElement.remove()" class="ml-auto text-white hover:text-gray-200 focus:outline-none">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    showUploadProgress() {
        document.getElementById('uploadProgress')?.classList.remove('hidden');
    }

    hideUploadProgress() {
        document.getElementById('uploadProgress')?.classList.add('hidden');
    }

    showLoading(message) {
        const loadingEl = document.getElementById('loadingModal');
        const messageEl = document.getElementById('loadingMessage');

        if (loadingEl && messageEl) {
            messageEl.textContent = message;
            loadingEl.classList.remove('hidden');
            loadingEl.classList.add('flex');
        }
    }

    hideLoading() {
        const loadingEl = document.getElementById('loadingModal');
        if (loadingEl) {
            loadingEl.classList.add('hidden');
            loadingEl.classList.remove('flex');
        }
    }

    hideModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }
}

// Initialize document manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.documentManager = new DocumentManager();
});