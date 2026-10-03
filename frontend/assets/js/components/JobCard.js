/**
 * JobCard Component
 * 
 * A standalone, reusable component for rendering job cards and their detailed modals.
 */

class JobCardComponent {
    constructor() {
        this.currentJobs = [];
        this.initialized = false;
        this.batchModeActive = false;
        this.selectedJobs = new Set();

        this.render = this.render.bind(this);
        this.toggleJobSelection = this.toggleJobSelection.bind(this);
    }

    init(options = {}) {
        if (this.initialized) return;
        window.JobCard = this;
        window.showJobDetails = (jobId) => {
            if (window.JobModal) {
                window.JobModal.show(jobId, this.currentJobs);
            } else {
                console.error('JobModal not available');
            }
        };
        window.toggleJobSelection = (jobId, checkbox) => this.toggleJobSelection(jobId, checkbox);
        this.initialized = true;
    }

    setJobs(jobs) {
        this.currentJobs = jobs;
    }

    escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    previewDescription(raw) {
        if (!raw) return '';
        const utils = window.CVision?.Utils || {};
        const decode = utils.decodeHtmlEntities || (value => value);
        let text = decode(String(raw));
        text = text
            .replace(/<\s*br\s*\/?>/gi, ' ')
            .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, ' ')
            .replace(/<li[^>]*>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!text) return '';
        if (text.length <= 220) return text;
        const cut = text.slice(0, 220).replace(/\s+\S*$/, '').trim();
        return `${cut || text.slice(0, 220).trim()}…`;
    }

    formatRelativeTime(date) {
        if (!date) return 'Some time ago';
        const now = new Date();
        const posted = new Date(date);
        const diffMs = now - posted;
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHour = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHour / 24);
        const diffWeek = Math.floor(diffDay / 7);
        const diffMonth = Math.floor(diffDay / 30);

        if (diffSec < 60) return 'Just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        if (diffHour < 24) return `${diffHour}h ago`;
        if (diffDay === 1) return 'Yesterday';
        if (diffDay < 7) return `${diffDay} days ago`;
        if (diffWeek === 1) return '1 week ago';
        if (diffWeek < 4) return `${diffWeek} weeks ago`;
        if (diffMonth === 1) return '1 month ago';
        return posted.toLocaleDateString();
    }

    getBadgeStyles(category) {
        const styles = {
            requirement: 'bg-indigo-50 text-indigo-700 border-indigo-100',
            benefit: 'bg-emerald-50 text-emerald-700 border-emerald-100',
            skill: 'bg-slate-50 text-slate-700 border-slate-100',
            default: 'bg-gray-50 text-gray-700 border-gray-100'
        };
        return styles[category] || styles.default;
    }

    render(job, isPublic = false) {
        if (!job) return document.createElement('div');
        const card = document.createElement('div');
        const jobId = job._id || job.id || 'unknown';

        const utils = window.CVision?.Utils || {};
        const decode = utils.decodeHtmlEntities || (t => t);
        const formatEnum = utils.formatEnumValue || (t => t);

        const title = decode(job.title || 'Untitled Job');
        const company = decode(job.company_name || 'Unknown Company');
        const location = decode(job.location || 'Remote');

        card.className = `job-card bg-white rounded-2xl shadow-sm border border-gray-100 hover:shadow-xl transition-all duration-300 relative overflow-hidden group flex flex-col h-full ${isPublic ? 'cursor-pointer hover:-translate-y-1' : ''}`;

        const matchBorder = ''; // Removed to avoid potential "two bars" confusion with badges

        const batchCheckboxHTML = (!isPublic && this.batchModeActive) ? `
            <div class="absolute top-5 left-5 z-10">
                <input type="checkbox" 
                       class="job-select-checkbox w-5 h-5 rounded-md text-primary-600 border-gray-300 focus:ring-primary-500 shadow-sm transition-all" 
                       ${this.selectedJobs.has(String(jobId)) ? 'checked' : ''}
                       onchange="toggleJobSelection('${jobId}', this)">
            </div>
        ` : '';

        const matchBadge = (job.match_score && (!isPublic || job.cv_matched))
            ? `<span class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-green-50 text-green-700 border border-green-100 shadow-sm mr-2 mb-2 transition-all group-hover:bg-green-100">
                 <svg class="w-3.5 h-3.5 mr-1.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"/></svg>
                 ${Math.round(job.match_score * 100)}% Match
               </span>`
            : '';

        const canAutoApply = !!(
            job.application_email || job.contact_email || job.email ||
            (job.company_info?.contact?.email) || job.application_url ||
            job.external_url || job.apply_url
        );

        const autoApplyBadge = canAutoApply
            ? `<span class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-primary-50 text-primary-700 border border-primary-100 shadow-sm mr-2 mb-2 transition-all group-hover:bg-primary-100">
                 <svg class="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                 Auto-Apply Ready
               </span>`
            : `<span class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 text-amber-700 border border-amber-100 shadow-sm mr-2 mb-2 transition-all group-hover:bg-amber-100">
                 <svg class="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                 Manual Review
               </span>`;

        const timeString = this.formatRelativeTime(job.posted_date || job.created_at);
        const description = this.previewDescription(job.description);
        const descriptionHtml = description
            ? `<p class="text-sm text-gray-600 leading-6 line-clamp-3 mb-4 ${(!isPublic && this.batchModeActive) ? 'ml-10' : ''}">${this.escapeHtml(description)}</p>`
            : '';
        const publicApply = `<button type="button" class="w-full px-6 py-4 bg-primary-600 text-white text-sm font-bold text-center border-t border-primary-700 transition-all group-hover:bg-primary-700" onclick="event.stopPropagation(); window.location.href='/login.html?apply_job=${encodeURIComponent(jobId)}'">See job</button>`;
        const clickHandler = isPublic ? `window.location.href='/login.html?job_id=${jobId}'` : `showJobDetails('${jobId}')`;

        if (isPublic) {
            card.setAttribute('onclick', clickHandler);
        }

        card.innerHTML = `
            ${matchBorder}
            ${batchCheckboxHTML}
            <div class="p-6 flex-1 flex flex-col" ${!isPublic ? `onclick="${clickHandler}"` : ''}>
                <div class="flex justify-between items-start mb-3 ${(!isPublic && this.batchModeActive) ? 'ml-10' : ''}">
                    <div class="flex-1 min-w-0">
                        <div class="flex flex-wrap items-center gap-1 mb-2">${matchBadge}${autoApplyBadge}</div>
                        <h3 class="text-lg font-bold text-gray-900 leading-tight group-hover:text-primary-600 transition-colors line-clamp-2 mb-1">${title}</h3>
                        <div class="text-sm font-semibold text-primary-600 mb-2">${company}</div>
                    </div>
                    ${!isPublic ? `
                    <button class="save-job-btn p-2.5 rounded-xl bg-gray-50 hover:bg-primary-50 ${job.is_saved ? 'text-primary-600 shadow-inner' : 'text-gray-400'} hover:text-primary-600 transition-all duration-300 flex-shrink-0" onclick="event.stopPropagation(); window.saveJob('${jobId}')">
                        <svg class="w-5 h-5" fill="${job.is_saved ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>
                    </button>` : ''}
                </div>
                <div class="flex flex-wrap items-center gap-y-2 gap-x-4 text-xs font-medium text-gray-500 mb-4 ${(!isPublic && this.batchModeActive) ? 'ml-10' : ''}">
                    <div class="flex items-center"><svg class="w-4 h-4 mr-1.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>${location}</div>
                    <div class="flex items-center"><svg class="w-4 h-4 mr-1.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>${timeString}</div>
                </div>
                ${!isPublic ? `
                <div class="flex flex-wrap gap-2 mb-4 ${this.batchModeActive ? 'ml-10' : ''}">
                    ${job.employment_type ? `<span class="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-blue-100 shadow-sm">${formatEnum(job.employment_type)}</span>` : ''}
                    ${job.work_arrangement ? `<span class="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-indigo-100 shadow-sm">${formatEnum(job.work_arrangement)}</span>` : ''}
                </div>
                ` : ''}
                ${descriptionHtml}
            </div>
            ${!isPublic ? `
            <div class="px-6 py-4 bg-gray-50 border-t border-gray-100 mt-auto">${window.JobActions ? window.JobActions.getButtonsHTML(job) : ''}</div>`
                : publicApply}
        `;
        return card;
    }

    toggleJobSelection(jobId, checkbox) {
        if (checkbox.checked) {
            this.selectedJobs.add(String(jobId));
        } else {
            this.selectedJobs.delete(String(jobId));
        }
        document.dispatchEvent(new CustomEvent('job:selectionUpdated', {
            detail: { selectedCount: this.selectedJobs.size }
        }));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const component = new JobCardComponent();
    component.init();
});
