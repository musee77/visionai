const MATCHING_PAGE_SIZE = 10;

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
    loadMatchingJobsPage(page);
});

async function loadMatchingJobsPage(page) {
    const list = document.getElementById('matchingJobsList');
    const pager = document.getElementById('matchingJobsPager');
    list.innerHTML = '<div class="text-center py-8 text-gray-500">Loading matches…</div>';
    pager.innerHTML = '';

    try {
        const response = await fetch(`/api/v1/auto-apply/matching-jobs?limit=${MATCHING_PAGE_SIZE}&page=${page}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detail = typeof data.detail === 'string' ? data.detail : 'Could not load matching jobs.';
            list.innerHTML = `<div class="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-600">${escapeHtml(detail)}</div>`;
            return;
        }

        const jobs = Array.isArray(data.jobs) ? data.jobs : [];
        const total = Number(data.total) || 0;
        const pages = Math.max(1, Math.ceil(total / MATCHING_PAGE_SIZE));
        if (page > pages) {
            goToMatchingPage(pages);
            return;
        }

        if (!jobs.length) {
            list.innerHTML = '<div class="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-600">No matching jobs found.</div>';
            return;
        }

        list.innerHTML = jobs.map(renderMatchingJobCard).join('');
        pager.innerHTML = renderMatchingPager(page, pages, total);
        pager.querySelectorAll('[data-page]').forEach((button) => {
            button.addEventListener('click', () => {
                const next = Number(button.dataset.page);
                if (next >= 1 && next <= pages && next !== page) goToMatchingPage(next);
            });
        });
    } catch (error) {
        console.error('Error loading matching jobs:', error);
        list.innerHTML = '<div class="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-600">Could not load matching jobs.</div>';
    }
}

function goToMatchingPage(page) {
    const url = new URL(window.location.href);
    url.searchParams.set('page', String(page));
    history.pushState({}, '', url);
    loadMatchingJobsPage(page);
}

function renderMatchingJobCard(job) {
    const score = scorePercent(job.match_score || 0);
    const scoreClass = score >= 80 ? 'score-high' : score >= 60 ? 'score-medium' : 'score-low';
    const jobId = job._id || job.id || '';
    const company = job.company_name || job.company || 'Company';
    return `
        <article class="job-card">
            <div class="job-header">
                <div>
                    <div class="job-title">${escapeHtml(job.title || 'Job')}</div>
                    <div class="job-company">${escapeHtml(company)}</div>
                </div>
                <div class="match-score">
                    <div class="score-circle ${scoreClass}">${score}%</div>
                    <div class="score-label">Match</div>
                </div>
            </div>
            <div class="job-details">
                <div class="job-detail-item">${escapeHtml(job.location || 'Remote')}</div>
                <div class="job-detail-item">${escapeHtml(job.salary || 'Salary not specified')}</div>
            </div>
            <div class="job-description">${escapeHtml(truncateText(job.description || '', 200))}</div>
            <div class="job-actions">
                <button type="button" class="btn-view" data-job="${escapeHtml(jobId)}">View job</button>
            </div>
        </article>
    `;
}

document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-job]');
    if (!button) return;
    const jobId = button.dataset.job;
    if (!jobId) return;
    window.location.href = `/pages/jobs.html?job=${encodeURIComponent(jobId)}`;
});

function renderMatchingPager(page, pages, total) {
    if (pages <= 1) {
        return `<p class="text-sm text-gray-500">${total} matching job${total === 1 ? '' : 's'}</p>`;
    }
    const start = (page - 1) * MATCHING_PAGE_SIZE + 1;
    const end = Math.min(page * MATCHING_PAGE_SIZE, total);
    const button = (label, target, disabled, current) => `
        <button type="button" data-page="${target}" ${disabled ? 'disabled' : ''}
            class="px-3 py-2 text-sm font-medium rounded-lg border ${current ? 'bg-primary-600 text-white border-primary-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'} disabled:opacity-40 disabled:cursor-not-allowed">
            ${label}
        </button>`;
    const numbers = [];
    for (let index = 1; index <= pages; index += 1) {
        numbers.push(button(String(index), index, false, index === page));
    }
    return `
        <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="text-sm text-gray-500">${start}–${end} of ${total}</p>
            <nav class="flex flex-wrap items-center gap-2" aria-label="Matching jobs pages">
                ${button('Previous', page - 1, page === 1, false)}
                ${numbers.join('')}
                ${button('Next', page + 1, page === pages, false)}
            </nav>
        </div>
    `;
}

function scorePercent(score) {
    const value = Number(score) || 0;
    return Math.round(value <= 1 ? value * 100 : value);
}

function truncateText(value, length) {
    const text = String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length <= length) return text;
    return text.slice(0, length - 1) + '…';
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

window.addEventListener('popstate', () => {
    const params = new URLSearchParams(window.location.search);
    const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
    loadMatchingJobsPage(page);
});
