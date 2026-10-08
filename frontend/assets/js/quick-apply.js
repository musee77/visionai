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
    async openQuickApplyForm(jobId, preSelectedCvId = null, preSelectedClId = null, options = null) {
        try {
            this.currentJobId = jobId;
            this.linkOnly = !!(options && options.linkOnly);
            this.companyUrl = (options && options.companyUrl) || '';

            const modal = document.getElementById('quickApplyModal');
            if (!modal) {
                throw new Error('Quick apply form not loaded. Please refresh the page.');
            }
            document.body.appendChild(modal);
            modal.style.zIndex = '140';
            modal.classList.remove('hidden');
            this.setFormStatus('Reading the company form...');

            await this.fillFromProfile();
            try {
                await this.loadPrefillData(jobId);
            } catch (error) {
                console.error('Prefill request failed:', error);
                this.setFormStatus('');
                this.showError('Your profile details are filled in. The company form could not be read.');
            }
            this.configureMode();
            await this.loadUserDocuments(preSelectedCvId, preSelectedClId);

        } catch (error) {
            console.error('Error opening quick apply form:', error);
            this.showError('Failed to load application form. Please try again.');
            this.closeQuickApplyForm();
        }
    }

    applyFieldValues(values) {
        const form = document.getElementById('quickApplyForm');
        if (!form || !values) return;
        Object.keys(values).forEach((key) => {
            const input = form.querySelector(`[name="${key}"]`);
            const value = values[key];
            if (!input || value === undefined || value === null || value === '') return;
            input.value = Array.isArray(value) ? value.join(', ') : value;
        });
    }

    async fillFromProfile() {
        try {
            const token = localStorage.getItem('access_token');
            const headers = { 'Authorization': `Bearer ${token}` };
            const [userResponse, profileResponse] = await Promise.all([
                fetch(`${this.API_BASE_URL}/api/v1/users/me`, { headers }),
                fetch(`${this.API_BASE_URL}/api/v1/users/me/profile`, { headers })
            ]);
            const user = userResponse.ok ? await userResponse.json() : {};
            const profile = profileResponse.ok ? await profileResponse.json() : {};
            const personal = profile.personal_info || {};
            const location = profile.location_preferences || {};
            let firstName = personal.first_name || user.first_name || '';
            let lastName = personal.last_name || user.last_name || '';
            const fullName = (user.full_name || '').trim();
            if (!firstName && !lastName && fullName && !fullName.startsWith('User ')) {
                const parts = fullName.split(/\s+/);
                firstName = parts[0] || '';
                lastName = parts.slice(1).join(' ');
            }
            this.applyFieldValues({
                first_name: firstName,
                last_name: lastName,
                email: user.email || '',
                phone: personal.phone || user.phone || '',
                address: personal.address || '',
                city: location.city || personal.city || personal.location || '',
                state: location.state || personal.state || '',
                postal_code: personal.postal_code || '',
                linkedin_url: personal.linkedin || personal.linkedin_url || '',
                portfolio_url: personal.portfolio_url || personal.portfolio || '',
                github_url: personal.github_url || personal.github || ''
            });
        } catch (error) {
            console.error('Could not read profile for the application form:', error);
        }
    }

    setFormStatus(message) {
        const status = document.getElementById('quickApplyFormStatus');
        if (!status) return;
        status.textContent = message || '';
        status.classList.toggle('hidden', !message);
    }

    escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    renderCompanyFields(fields) {
        const section = document.getElementById('companyFieldsSection');
        const list = document.getElementById('companyFields');
        const standard = document.getElementById('standardApplyFields');
        fields = (fields || []).filter((field) => !this.skipCompanyField(field));
        if (!section || !list) return;
        if (!fields.length) {
            section.classList.add('hidden');
            list.innerHTML = '';
            if (standard) standard.classList.remove('hidden');
            return;
        }
        const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent';
        list.innerHTML = fields.map((field, index) => {
            const label = this.escapeHtml(field.label || 'Field');
            const fieldType = this.escapeHtml(field.field_type || 'unknown');
            const value = this.escapeHtml(field.value || '');
            const placeholder = this.escapeHtml(field.placeholder || '');
            const required = field.required ? 'required' : '';
            const mark = field.required ? ' *' : '';
            const inputType = String(field.input_type || 'text').toLowerCase();
            let control;
            if (inputType === 'textarea') {
                control = `<textarea data-company-field data-label="${label}" data-field-type="${fieldType}" rows="4" placeholder="${placeholder}" ${required} class="${inputClass}">${value}</textarea>`;
            } else if (inputType === 'checkbox' || inputType === 'radio') {
                const choice = this.escapeHtml(field.choice || field.label || 'Yes');
                control = `<input data-company-field data-label="${label}" data-field-type="${fieldType}" data-choice="${choice}" type="${inputType}" value="${choice}" ${required} class="h-4 w-4">`;
            } else if (inputType === 'select' || inputType === 'select-multiple') {
                const multiple = inputType === 'select-multiple' ? 'multiple' : '';
                const options = (field.options || []).map((option) => {
                    const optionValue = this.escapeHtml(option.value || option.label || '');
                    const optionLabel = this.escapeHtml(option.label || option.value || '');
                    return `<option value="${optionValue}">${optionLabel}</option>`;
                }).join('');
                control = `<select data-company-field data-label="${label}" data-field-type="${fieldType}" ${multiple} ${required} class="${inputClass}"><option value="">Select</option>${options}</select>`;
            } else {
                const allowed = ['email', 'tel', 'url', 'number', 'date', 'time', 'datetime-local'];
                const type = allowed.includes(inputType) ? inputType : 'text';
                control = `<input data-company-field data-label="${label}" data-field-type="${fieldType}" type="${type}" value="${value}" placeholder="${placeholder}" ${required} class="${inputClass}">`;
            }
            return `<div><label class="block text-sm font-medium text-gray-700 mb-1">${label}${mark}</label>${control}</div>`;
        }).join('');
        section.classList.remove('hidden');
        if (standard) {
            standard.classList.add('hidden');
            standard.querySelectorAll('[required]').forEach((input) => {
                input.dataset.wasRequired = 'true';
                input.required = false;
            });
        }
    }

    skipCompanyField(field) {
        const fieldType = String(field.field_type || '').toLowerCase();
        if (['first_name', 'last_name', 'full_name'].includes(fieldType)) return true;
        if (String(field.input_type || '').toLowerCase() === 'search') return true;
        const label = String(field.label || '');
        const text = `${label} ${field.name || ''} ${field.placeholder || ''}`.toLowerCase();
        if (text.includes('search')) return true;
        if (/\b(first name|last name|full name|your name|given name|surname|family name)\b/.test(text)) return true;
        if (/\bname\b/.test(label.toLowerCase()) && !/company|user|file/.test(label.toLowerCase())) return true;
        return false;
    }

    collectCompanyFields() {
        const answers = [];
        document.querySelectorAll('#companyFields [data-company-field]').forEach((input) => {
            let value = '';
            if (input.type === 'checkbox' || input.type === 'radio') {
                value = input.checked ? (input.dataset.choice || input.value || 'Yes') : '';
            } else if (input.multiple) {
                value = Array.from(input.selectedOptions).map((option) => option.value).filter(Boolean).join(', ');
            } else {
                value = input.value;
            }
            answers.push({
                label: input.dataset.label || 'Field',
                field_type: input.dataset.fieldType || 'unknown',
                value: value || ''
            });
        });
        return answers;
    }

    applyCompanyAnswers(formData, answers) {
        const taken = {
            first_name: 'first_name',
            last_name: 'last_name',
            email: 'email',
            phone: 'phone',
            address: 'address',
            city: 'city',
            state: 'state',
            zip_code: 'postal_code',
            country: 'country',
            linkedin: 'linkedin_url',
            portfolio: 'portfolio_url',
            github: 'github_url',
            cover_letter: 'cover_letter'
        };
        answers.forEach((answer) => {
            if (!answer.value) return;
            if (answer.field_type === 'full_name' && !formData.first_name) {
                const parts = answer.value.trim().split(/\s+/);
                formData.first_name = parts[0] || '';
                formData.last_name = parts.slice(1).join(' ');
                return;
            }
            const key = taken[answer.field_type];
            if (key) formData[key] = answer.value;
        });
        return formData;
    }

    configureMode() {
        const recipient = document.querySelector('#quickApplyForm [name="recipient_email"]');
        const recipientWrap = recipient ? recipient.closest('div') : null;
        const cvSelect = document.querySelector('#quickApplyForm [name="cv_document_id"]');
        const buttonLabel = document.querySelector('#quickApplySubmitBtn span');
        if (this.linkOnly || !(this.currentJobData && this.currentJobData.recipient_email)) {
            if (!(this.currentJobData && this.currentJobData.recipient_email) && this.companyUrl) {
                this.linkOnly = true;
            }
        }
        if (this.linkOnly) {
            if (recipient) recipient.required = false;
            if (recipientWrap) recipientWrap.classList.add('hidden');
            if (cvSelect) cvSelect.required = false;
            if (buttonLabel) buttonLabel.textContent = 'Submit';
            const loadingText = document.getElementById('quickApplyLoadingText');
            if (loadingText) loadingText.textContent = 'Submitting this application...';
        } else {
            if (recipient) recipient.required = true;
            if (recipientWrap) recipientWrap.classList.remove('hidden');
            if (cvSelect) cvSelect.required = true;
            if (buttonLabel) buttonLabel.textContent = 'Save for review';
            const loadingText = document.getElementById('quickApplyLoadingText');
            if (loadingText) loadingText.textContent = 'Saving this application for review...';
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

            // Prefill form fields from the profile response without clearing values already shown
            this.applyFieldValues(data.form_data);

            if (data.recipient_email) {
                this.linkOnly = false;
                const recipient = document.querySelector('#quickApplyForm [name="recipient_email"]');
                if (recipient) recipient.value = data.recipient_email;
            } else if (data.apply_url || this.companyUrl) {
                this.companyUrl = this.companyUrl || data.apply_url || '';
                this.linkOnly = true;
            }
            this.renderCompanyFields(data.detected_fields || []);
            this.setFormStatus('');

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

            const formData = new FormData(form);
            const companyFields = this.collectCompanyFields();
            if (this.linkOnly) {
                const token = localStorage.getItem('access_token');
                const notes = companyFields
                    .filter((field) => field.value)
                    .map((field) => `${field.label}: ${field.value}`)
                    .join('\n');
                const response = await fetch(`${this.API_BASE_URL}/api/v1/email-applications/track`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        job_id: formData.get('job_id'),
                        application_url: this.companyUrl || null,
                        notes: notes || null
                    })
                });
                if (!response.ok && response.status !== 409) {
                    const error = await response.json().catch(() => ({}));
                    throw new Error(error.detail || 'Could not save this application.');
                }
                if (window.JobActions) {
                    window.JobActions.markAsApplied(this.currentJobId);
                    document.dispatchEvent(new CustomEvent('job:applied', { detail: { jobId: this.currentJobId } }));
                }
                this.showSuccess('Your application has been submitted.', 'Submitted');
                this.closeQuickApplyForm();
                return;
            }

            const answers = new FormData(form);
            const submission = {
                job_id: answers.get('job_id'),
                recipient_email: answers.get('recipient_email'),
                cv_document_id: answers.get('cv_document_id'),
                cover_letter_document_id: answers.get('cover_letter_document_id') || null,
                additional_message: answers.get('cover_letter') || null,
                company_fields: companyFields,
                form_data: this.applyCompanyAnswers({
                    first_name: answers.get('first_name'),
                    last_name: answers.get('last_name'),
                    email: answers.get('email'),
                    phone: answers.get('phone') || null,
                    address: answers.get('address') || null,
                    city: answers.get('city') || null,
                    state: answers.get('state') || null,
                    postal_code: answers.get('postal_code') || null,
                    linkedin_url: answers.get('linkedin_url') || null,
                    portfolio_url: answers.get('portfolio_url') || null,
                    github_url: answers.get('github_url') || null,
                    cover_letter: answers.get('cover_letter') || null
                }, companyFields)
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
                this.showSuccess(
                    result.message || 'Application is ready for review. Open Applications and choose In Review to send it.',
                    'Ready for review'
                );

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
        const companyFields = document.getElementById('companyFields');
        const companySection = document.getElementById('companyFieldsSection');
        const standard = document.getElementById('standardApplyFields');
        if (companyFields) companyFields.innerHTML = '';
        if (companySection) companySection.classList.add('hidden');
        if (standard) standard.classList.remove('hidden');
        this.setFormStatus('');
        this.currentJobId = null;
        this.currentJobData = null;
    }

    /**
     * Show success message
     */
    /**
     * Show success message with custom modal
     */
    showSuccess(message, title = 'Ready for review') {
        this.injectSuccessModal(message, title);
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
                        <button onclick="window.location.href='applications.html#review'" class="w-full btn-gradient text-white rounded-xl px-4 py-3 font-semibold hover:shadow-lg transition-all shadow-md">
                            Open In Review
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
function openQuickApplyForm(jobId, cvId = null, clId = null, options = null) {
    quickApplyManager.openQuickApplyForm(jobId, cvId, clId, options);
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