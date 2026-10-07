window.ReviewTab = {
    async load() {
        const container = document.getElementById('reviewList');
        if (!container) return;
        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/applications/?status=awaiting_review&page=1&size=50`, {
                headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
            });
            if (!response.ok) throw new Error('Failed');
            const data = await response.json();
            const applications = data.applications || [];
            if (!applications.length) {
                container.innerHTML = `
                    <div class="bg-white rounded-lg border p-12 text-center">
                        <h3 class="text-lg font-medium mb-2">Nothing waiting for review</h3>
                        <p class="text-gray-600">Automated applications stop here so you can read the documents and the submission.</p>
                    </div>
                `;
                return;
            }
            container.innerHTML = applications.map((app) => {
                const channel = app.review_channel === 'email' ? 'Email' : 'Application form';
                const score = app.match_score != null ? `${Math.round(Number(app.match_score) * 100)}% match` : '';
                return `
                    <div class="bg-white rounded-xl border border-gray-200 p-6">
                        <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                            <div>
                                <h3 class="text-xl font-bold text-gray-900">${escapeHtml(app.job_title || 'Untitled role')}</h3>
                                <p class="text-gray-700 mt-1">${escapeHtml(app.company_name || 'Company not listed')}</p>
                                <p class="text-sm text-gray-500 mt-1">${escapeHtml(app.location || '')}</p>
                                <div class="flex flex-wrap gap-2 mt-3">
                                    <span class="px-2 py-1 rounded text-xs font-medium bg-amber-100 text-amber-800">In Review</span>
                                    <span class="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700">${escapeHtml(channel)}</span>
                                    ${score ? `<span class="px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-700">${escapeHtml(score)}</span>` : ''}
                                </div>
                            </div>
                            <button type="button" onclick="openApplicationReview('${escapeHtml(app.id)}')" class="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium">Review</button>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (error) {
            console.error('Review list error:', error);
            container.innerHTML = '<div class="bg-white rounded-lg border p-6 text-center"><p class="text-red-600">Failed to load applications in review</p></div>';
        }
    },

    async open(applicationId) {
        const container = document.getElementById('reviewList');
        if (!container) return;
        container.innerHTML = '<div class="bg-white rounded-lg border p-8 text-center text-gray-500">Loading review...</div>';
        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/applications/${applicationId}/review`, {
                headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.detail || 'Could not open this review');
            this.renderDetail(data);
        } catch (error) {
            container.innerHTML = `<div class="bg-white rounded-lg border p-6 text-center"><p class="text-red-600">${escapeHtml(error.message || 'Could not open this review')}</p></div>`;
        }
    },

    renderDetail(review) {
        const container = document.getElementById('reviewList');
        if (!container) return;
        const submission = review.submission || {};
        const channel = submission.channel === 'email' ? 'Email' : 'Application form';
        const destination = submission.channel === 'email'
            ? `To ${submission.recipient_email || 'the employer'}`
            : (submission.apply_url || 'The company application form');
        const documents = (review.documents || []).map((document) => `
            <section class="bg-white rounded-xl border border-gray-200 p-6">
                <h3 class="text-lg font-semibold text-gray-900">${escapeHtml(document.label)}</h3>
                <p class="text-sm text-gray-500 mt-1">${escapeHtml(document.name || '')}</p>
                <pre class="mt-4 whitespace-pre-wrap text-sm text-gray-700 max-h-80 overflow-y-auto">${escapeHtml(document.text || '')}</pre>
            </section>
        `).join('') || '<section class="bg-white rounded-xl border border-gray-200 p-6 text-gray-500">No documents are attached.</section>';
        const score = review.match_score != null ? `${Math.round(Number(review.match_score) * 100)}% match` : '';

        container.innerHTML = `
            <div class="space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <button type="button" onclick="loadReviewApplications()" class="text-sm text-gray-600 hover:text-gray-900">Back to In Review</button>
                    <div class="flex gap-2">
                        <button type="button" onclick="submitReviewedApplication('${escapeHtml(review.id)}')" class="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium">Submit</button>
                        <button type="button" onclick="skipReviewedApplication('${escapeHtml(review.id)}')" class="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium">Skip</button>
                    </div>
                </div>
                <section class="bg-white rounded-xl border border-gray-200 p-6">
                    <h2 class="text-2xl font-bold text-gray-900">${escapeHtml(review.job_title || 'Untitled role')}</h2>
                    <p class="text-gray-700 mt-1">${escapeHtml(review.company_name || '')}</p>
                    <p class="text-sm text-gray-500 mt-1">${escapeHtml(review.location || '')} ${score ? '· ' + escapeHtml(score) : ''}</p>
                    <h3 class="text-sm font-semibold text-gray-900 mt-6">Job description</h3>
                    <pre class="mt-2 whitespace-pre-wrap text-sm text-gray-700 max-h-64 overflow-y-auto">${escapeHtml(review.job_description || 'No job description is stored.')}</pre>
                </section>
                ${documents}
                <section class="bg-white rounded-xl border border-gray-200 p-6">
                    <h3 class="text-lg font-semibold text-gray-900">Submission</h3>
                    <p class="text-sm text-gray-500 mt-1">${escapeHtml(channel)}</p>
                    <p class="text-sm text-gray-800 mt-3">${escapeHtml(destination)}</p>
                    <pre class="mt-4 whitespace-pre-wrap text-sm text-gray-700">${escapeHtml(submission.message || '')}</pre>
                </section>
            </div>
        `;
    },

    async submit(applicationId) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/applications/${applicationId}/submit`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.detail || 'Could not submit');
            if (window.CVision && CVision.Utils) CVision.Utils.showAlert('Application submitted.', 'success');
            this.load();
            if (typeof loadStats === 'function') loadStats();
        } catch (error) {
            if (window.CVision && CVision.Utils) CVision.Utils.showAlert(error.message || 'Could not submit', 'error');
        }
    },

    async skip(applicationId) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/applications/${applicationId}/skip-review`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.detail || 'Could not skip');
            this.load();
        } catch (error) {
            if (window.CVision && CVision.Utils) CVision.Utils.showAlert(error.message || 'Could not skip', 'error');
        }
    }
};

window.loadReviewApplications = () => window.ReviewTab.load();
window.openApplicationReview = (id) => window.ReviewTab.open(id);
window.submitReviewedApplication = (id) => window.ReviewTab.submit(id);
window.skipReviewedApplication = (id) => window.ReviewTab.skip(id);
