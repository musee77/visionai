window.SavedJobsTab = {
    async load() {
        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/jobs/saved/me?page=1&size=20`, {
                headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
            });

            if (!res.ok) throw new Error('Failed');
            const data = await res.json();
            const jobs = data.jobs || data;
            window.currentSavedJobs = jobs; // Store for modal access globally
            const container = document.getElementById('savedJobsList');
            if (!container) return;

            if (!jobs || jobs.length === 0) {
                container.innerHTML = `
                    <div class="bg-white rounded-lg border p-12 text-center">
                        <h3 class="text-lg font-medium mb-2">No Saved Jobs</h3>
                        <p class="text-gray-600 mb-6">Save jobs while searching</p>
                        <a href="jobs.html" class="btn-gradient text-white px-6 py-2 rounded-lg inline-block">Search Jobs</a>
                    </div>
                `;
                return;
            }
            container.innerHTML = jobs.map(j => `
                <div class="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-all duration-300 group relative">
                    <button onclick="unsaveJob('${j._id || j.id}')" class="absolute top-4 right-4 text-gray-400 hover:text-red-500 transition-colors p-2 rounded-full hover:bg-red-50" title="Remove from saved">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                        </svg>
                    </button>
    
                    <div class="pr-12">
                        <h3 class="text-xl font-bold text-gray-900 group-hover:text-primary-600 transition-colors mb-1">
                            <a href="javascript:void(0)" onclick="showJobDetails('${escapeHtml(j._id || j.id || '')}')" class="hover:underline">${escapeHtml(j.title || 'Untitled role')}</a>
                        </h3>
                        <div class="flex items-center gap-2 mb-3">
                            <span class="text-gray-700 font-medium">${escapeHtml(j.company_name || 'Company not listed')}</span>
                            <span class="text-gray-300">•</span>
                            <span class="text-sm text-gray-500 flex items-center gap-1">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                                ${escapeHtml(j.location || 'Location not listed')}
                            </span>
                        </div>
    
                        <div class="flex flex-wrap gap-2 mb-4">
                            ${j.employment_type ? `<span class="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium">${formatEnumValue(j.employment_type)}</span>` : ''}
                            ${j.salary_range ? `<span class="px-2 py-1 bg-green-50 text-green-700 rounded text-xs font-medium">${j.salary_range.min_amount ? '$' + j.salary_range.min_amount.toLocaleString() : ''} - ${j.salary_range.max_amount ? '$' + j.salary_range.max_amount.toLocaleString() : ''}</span>` : ''}
                            <span class="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs">Saved ${formatDate(j.saved_at)}</span>
                        </div>
    
                        <div class="flex items-center justify-between border-t pt-4 mt-4">
                            <div class="w-full">
                                ${window.JobActions ? window.JobActions.getButtonsHTML(j) : ''}
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');
        } catch (error) {
            console.error('Saved jobs error:', error);
            const container = document.getElementById('savedJobsList');
            if (container) {
                container.innerHTML = '<div class="bg-white rounded-lg border p-6 text-center"><p class="text-red-600">Failed to load saved jobs</p></div>';
            }
        }
    },

    async unsaveJob(jobId) {
        if (!confirm('Remove this job?')) return;
        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/jobs/save/${jobId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
            });
            if (!res.ok) throw new Error('Failed');
            CVision.Utils.showAlert('Job removed', 'success');
            this.load();
        } catch (error) {
            CVision.Utils.showAlert('Failed to remove', 'error');
        }
    },

    showJobDetails(jobId) {
        if (!window.JobModal) {
            console.error('SavedJobsTab: JobModal not available');
            return;
        }
        window.JobModal.show(jobId, window.currentSavedJobs);
    },

    closeJobDetailsModal() {
        if (window.JobModal) {
            window.JobModal.hide();
        }
    },

    // Kept here as it's often used with saved jobs, though could be shared
    async saveJob(jobId, silent = false, extraData = null) {
        try {
            const options = {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${CVision.Utils.getToken()} `
                }
            };

            if (extraData) {
                options.headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(extraData);
            }

            const response = await fetch(`${API_BASE_URL}/api/v1/jobs/save/${jobId}`, options);

            if (!response.ok) throw new Error('Failed to save job');

            if (!silent) {
                CVision.Utils.showAlert('Job saved successfully!', 'success');
            }

            return response.json();
        } catch (error) {
            console.error('Error saving job:', error);
            if (!silent) {
                CVision.Utils.showAlert('Failed to save job', 'error');
            }
            throw error;
        }
    }
};

window.loadSavedJobs = () => window.SavedJobsTab.load();
window.unsaveJob = (id) => window.SavedJobsTab.unsaveJob(id);
window.showJobDetails = (id) => window.SavedJobsTab.showJobDetails(id);
window.closeJobDetailsModal = () => window.SavedJobsTab.closeJobDetailsModal();
window.saveJob = (id, silent, extra) => window.SavedJobsTab.saveJob(id, silent, extra);
