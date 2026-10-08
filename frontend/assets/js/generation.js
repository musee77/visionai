// frontend/assets/js/generation.js - Phase 3 Content Generation Module

const GenerationModule = (() => {
    const API_BASE_URL = `${CONFIG.API_BASE_URL}${CONFIG.API_PREFIX}`;
    let currentGeneration = null;

    // Define utility functions FIRST before they're used
    const showLoading = (message = 'Processing...') => {
        const loadingDiv = document.getElementById('loadingState');
        if (loadingDiv) {
            loadingDiv.classList.remove('hidden');
            const text = loadingDiv.querySelector('p');
            if (text) text.textContent = message;
        }
    };

    const hideLoading = () => {
        const loadingDiv = document.getElementById('loadingState');
        if (loadingDiv) loadingDiv.classList.add('hidden');
    };

    const closeModal = () => {
        const modals = document.querySelectorAll('.fixed.inset-0.bg-black');
        modals.forEach(modal => modal.remove());
    };

    const showGenerationModal = (data) => {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        modal.style.zIndex = '9999';

        modal.innerHTML = `
            <div class="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 p-6">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-2xl font-bold text-gray-900">Documents Generated Successfully</h2>
                    <button onclick="GenerationModule.closeModal()" class="text-gray-400 hover:text-gray-600">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
                
                <div class="text-center mb-6">
                    <svg class="w-16 h-16 text-green-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    <p class="text-gray-600">Your customized documents are ready for download</p>
                    ${data.match_score ? `
                        <div class="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-green-50 rounded-lg">
                            <span class="text-sm font-medium text-green-900">Job Match Score:</span>
                            <span class="text-lg font-bold text-green-600">${Math.round(data.match_score * 100)}%</span>
                        </div>
                    ` : ''}
                </div>
                
                <div class="space-y-3">
                    ${data.cv_pdf_url ? `
                        <button type="button" onclick="GenerationModule.downloadFile('${data.cv_pdf_url}', 'Customized-CV.pdf')"
                        class="flex items-center justify-between w-full px-4 py-3 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
                            <div class="flex items-center gap-3">
                                <span class="text-2xl">📄</span>
                                <div>
                                    <p class="font-medium text-blue-900">Customized CV</p>
                                    <p class="text-sm text-blue-700">Tailored for this position</p>
                                </div>
                            </div>
                            <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                            </svg>
                        </button>
                    ` : ''}
                    
                    ${data.cover_letter_pdf_url ? `
                        <button type="button" onclick="GenerationModule.downloadFile('${data.cover_letter_pdf_url}', 'Cover-Letter.pdf')"
                        class="flex items-center justify-between w-full px-4 py-3 bg-green-50 hover:bg-green-100 rounded-lg transition-colors">
                            <div class="flex items-center gap-3">
                                <span class="text-2xl">✉️</span>
                                <div>
                                    <p class="font-medium text-green-900">Cover Letter</p>
                                    <p class="text-sm text-green-700">Personalized application letter</p>
                                </div>
                            </div>
                            <svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                            </svg>
                        </button>
                    ` : ''}
                </div>

                <button onclick="GenerationModule.closeModal()" 
                        class="w-full mt-6 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-medium transition-colors">
                    Close
                </button>
            </div>
        `;

        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
    };

    // Main functions that use the utilities defined above
    const customizeForJob = async (documentId, jobId, options = {}) => {
        try {
            const requestData = {
                document_id: documentId,
                job_id: jobId,
                template: options.template || 'professional',
                include_cover_letter: options.includeCoverLetter !== false,
                cover_letter_tone: options.tone || 'professional'
            };

            console.log('=== GENERATION REQUEST ===');
            console.log('Document ID:', documentId);
            console.log('Job ID:', jobId);
            console.log('Full request:', JSON.stringify(requestData, null, 2));

            let response;
            try {
                response = await fetch(`${API_BASE_URL}/generation/customize-cv`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${CVision.Utils.getToken()}`
                    },
                    body: JSON.stringify(requestData)
                });
                console.log('=== FETCH COMPLETED ===');
            } catch (fetchError) {
                console.error('=== NETWORK ERROR ===', fetchError);
                hideLoading();
                throw new Error(`Network error: ${fetchError.message}`);
            }

            console.log('Response status:', response.status);

            hideLoading();

            // Read response body
            const responseText = await response.text();
            console.log('Response body:', responseText);

            // Proper error extraction
            if (!response.ok) {
                let errorMessage = 'Generation failed';
                try {
                    const errorData = JSON.parse(responseText);
                    console.error('=== BACKEND ERROR ===', errorData);

                    // Handle Pydantic validation errors
                    if (errorData.detail) {
                        if (typeof errorData.detail === 'string') {
                            errorMessage = errorData.detail;
                        } else if (Array.isArray(errorData.detail)) {
                            // FastAPI validation errors
                            errorMessage = errorData.detail.map(err => {
                                const field = err.loc.slice(1).join('.');
                                return `${field}: ${err.msg}`;
                            }).join('; ');
                        } else if (typeof errorData.detail === 'object') {
                            errorMessage = JSON.stringify(errorData.detail);
                        }
                    }
                } catch (e) {
                    console.error('Could not parse error response:', e);
                    errorMessage = `HTTP ${response.status}: ${responseText.substring(0, 200)}`;
                }
                throw new Error(errorMessage);
            }

            const result = JSON.parse(responseText);
            console.log('=== SUCCESS ===', result);
            currentGeneration = result;

            // Auto-save generated docs paths to the saved job
            if (window.saveJob && jobId) {
                // Ensure job is saved/updated with new docs paths
                // We use silent=true to avoid double alerts (generation success alert is enough)
                const updateData = {
                    generated_cv_path: result.cv_pdf_url,
                    generated_cover_letter_path: result.cover_letter_pdf_url,
                    generated_cv_id: result.cv_document_id,
                    generated_cover_letter_id: result.cover_letter_id
                };
                console.log('Updating saved job with docs:', updateData);
                // Don't await this to keep UI responsive? Actually better to await to ensure consistency
                await window.saveJob(jobId, true, updateData).catch(err =>
                    console.error('Failed to update saved job with generation paths:', err)
                );

                // Update frontend state immediately to fix "View" button (avoid stale .htm links)
                if (window.updateJobInList) {
                    window.updateJobInList(jobId, updateData);
                } else {
                    console.warn('updateJobInList not found, UI might be stale until reload');
                }
            }

            // Don't show modal automatically - let caller decide
            // CVision.Utils.showAlert('Documents generated successfully!', 'success');
            // showGenerationModal(result);

            return result;

        } catch (error) {
            hideLoading();
            console.error('=== GENERATION ERROR ===', error);
            CVision.Utils.showAlert(error.message || 'Failed to generate documents', 'error');
            throw error;
        }
    };

    const batchCustomize = async (documentId, jobIds, template = 'professional') => {
        try {
            if (jobIds.length > 10) {
                CVision.Utils.showAlert('Maximum 10 jobs allowed per batch', 'error');
                return;
            }

            showLoading(`Generating documents for ${jobIds.length} jobs...`);

            const response = await fetch(`${API_BASE_URL}/generation/batch-customize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${CVision.Utils.getToken()}`
                },
                body: JSON.stringify({
                    document_id: documentId,
                    job_ids: jobIds,
                    template: template
                })
            });

            hideLoading();

            if (!response.ok) {
                throw new Error('Batch generation failed');
            }

            const result = await response.json();
            CVision.Utils.showAlert(`Generated documents for ${result.success_count || jobIds.length} jobs!`, 'success');

            return result;

        } catch (error) {
            hideLoading();
            console.error('Batch error:', error);
            CVision.Utils.showAlert(error.message || 'Batch generation failed', 'error');
            throw error;
        }
    };

    const downloadFile = (url, filename) => {
        if (window.DocumentViewer) {
            return window.DocumentViewer.downloadDocument(url, filename);
        }
        const full = String(url).startsWith('http') ? url : `${API_BASE_URL}${String(url).startsWith('/') ? '' : '/'}${url}`;
        window.open(full, '_blank', 'noopener,noreferrer');
    };

    // Return public API
    return {
        customizeForJob,
        batchCustomize,
        showGenerationModal,
        downloadFile,
        closeModal
    };
})();

// Make globally available
window.GenerationModule = GenerationModule;