/**
 * JobModal Component
 * 
 * A standalone, reusable component for rendering job detail modals.
 */

class JobModalComponent {
    constructor() {
        this.currentJobs = [];
        this.initialized = false;

        this.show = this.show.bind(this);
        this.hide = this.hide.bind(this);
    }

    static SHELL = `
        <div id="jobModal" class="fixed inset-0 bg-black/60 backdrop-blur-sm hidden items-center justify-center z-[100] p-4 transition-all duration-300">
            <style>
                #jobModal .markdown-body {
                    color: #374151;
                    line-height: 1.625;
                }
                #jobModal .markdown-body h1, #jobModal .markdown-body h2, #jobModal .markdown-body h3 {
                    color: #111827;
                    font-weight: 800;
                    margin-top: 1.5rem;
                    margin-bottom: 0.75rem;
                }
                #jobModal .markdown-body h1 { font-size: 1.5rem; }
                #jobModal .markdown-body h2 { font-size: 1.25rem; }
                #jobModal .markdown-body h3 { font-size: 1.125rem; }
                #jobModal .markdown-body p { margin-bottom: 1rem; }
                #jobModal .markdown-body ul, #jobModal .markdown-body ol {
                    margin-bottom: 1rem;
                    padding-left: 1.5rem;
                }
                #jobModal .markdown-body ul { list-style-type: disc; }
                #jobModal .markdown-body ol { list-style-type: decimal; }
                #jobModal .markdown-body li { margin-bottom: 0.375rem; }
                #jobModal .markdown-body strong { color: #111827; font-weight: 700; }
                #jobModal .markdown-body a { color: #4f46e5; text-decoration: underline; font-weight: 500; }
                #jobModal .markdown-body blockquote {
                    border-left: 4px solid #e5e7eb;
                    padding-left: 1rem;
                    color: #6b7280;
                    font-style: italic;
                }
                #jobModal .markdown-body table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 1rem;
                }
                #jobModal .markdown-body th, #jobModal .markdown-body td {
                    border: 1px solid #e5e7eb;
                    padding: 0.75rem;
                    text-align: left;
                }
                #jobModal .markdown-body th { background-color: #f9fafb; font-weight: 600; }
            </style>
            <div class="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] overflow-hidden shadow-2xl flex flex-col transform transition-all scale-95 opacity-0 duration-300" id="jobModalInner">
                <!-- Modal Header -->
                <div class="p-6 border-b border-gray-100 flex justify-between items-start sticky top-0 bg-white/80 backdrop-blur-md z-10">
                    <div class="flex-1 pr-6">
                        <div class="flex items-center gap-4 mb-2">
                            <div id="modalLogoContainer" class="hidden flex-shrink-0"></div>
                            <h2 id="modalTitle" class="text-2xl font-extrabold text-gray-900 leading-tight"></h2>
                        </div>
                        <div class="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                            <p id="modalCompany" class="text-primary-600 font-bold text-lg"></p>
                            <p id="modalLocation" class="text-gray-500 text-sm font-medium flex items-center"></p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button id="modalCopyLink" class="p-2.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-xl transition-all group" title="Copy Job Link">
                            <svg class="w-5.5 h-5.5 transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m-1 8h2m-2 3h2m3-9h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </button>
                        <button id="closeModal" class="p-2.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all group">
                            <svg class="w-6 h-6 transition-transform group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- Modal Content Area -->
                <div class="flex-1 overflow-y-auto p-8 custom-scrollbar">
                    <div id="modalContent" class="max-w-3xl mx-auto">
                        <!-- Content injected dynamically -->
                    </div>
                </div>

                <!-- Modal Footer Actions -->
                <div class="p-6 border-t border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row gap-3 items-center sticky bottom-0 z-10">
                    <button id="modalSaveJob" class="flex-1 w-full sm:w-auto px-6 py-3 rounded-xl border-2 border-gray-200 text-gray-700 font-bold hover:border-primary-200 hover:bg-white hover:text-primary-600 transition-all flex items-center justify-center gap-2">
                        Save Job
                    </button>
                    <button id="modalCustomize" class="flex-1 w-full sm:w-auto px-6 py-3 rounded-xl border-2 border-primary-100 bg-white text-primary-700 font-extrabold hover:bg-primary-50 transition-all flex items-center justify-center gap-2">
                        Customize Documents
                    </button>
                    <button id="modalApply" class="flex-[1.5] w-full sm:w-auto px-8 py-3 rounded-xl btn-gradient text-white font-extrabold shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff;">
                        Apply
                    </button>
                </div>
            </div>
        </div>
    `;

    inject() {
        if (!document.getElementById('jobModal')) {
            const container = document.createElement('div');
            container.innerHTML = JobModalComponent.SHELL;
            document.body.appendChild(container.firstElementChild);
            if (!document.getElementById('job-description-prose-style')) {
                const style = document.createElement('style');
                style.id = 'job-description-prose-style';
                style.textContent = `
                    .job-description-prose { color: #44403c; font-size: 15px; line-height: 1.7; font-weight: 400; }
                    .job-description-prose p { margin: 0 0 0.9rem; }
                    .job-description-prose p:last-child { margin-bottom: 0; }
                    .job-description-prose h2, .job-description-prose h3, .job-description-prose h4 {
                        color: #1c1917; font-size: 1.05rem; font-weight: 650; margin: 1.25rem 0 0.45rem; line-height: 1.35;
                    }
                    .job-description-prose ul, .job-description-prose ol { margin: 0 0 1rem 1.25rem; }
                    .job-description-prose li { margin: 0.2rem 0; }
                    .job-description-prose strong, .job-description-prose b { color: #1c1917; font-weight: 650; }
                    .job-description-prose a { color: #4c51bf; text-decoration: underline; }
                    .job-description-prose blockquote { margin: 0 0 1rem; padding-left: 0.9rem; border-left: 3px solid #e6dfd2; color: #57534e; }
                    .job-description-empty { color: #78716c; }
                `;
                document.head.appendChild(style);
            }

            // Wire close button immediately
            const closeBtn = document.getElementById('closeModal');
            if (closeBtn) closeBtn.addEventListener('click', () => this.hide());

            // Close on backdrop click
            const modal = document.getElementById('jobModal');
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.hide();
            });
        }
    }

    init() {
        if (this.initialized) return;
        this.inject();
        window.JobModal = this;
        // Maintain backward compatibility for global calls if needed
        window.showJobDetails = (jobId) => this.show(jobId);
        this.initialized = true;
    }

    formatDescription(text) {
        if (!text) return '<p class="job-description-empty">No description available</p>';

        const utils = window.CVision?.Utils || {};
        const decode = utils.decodeHtmlEntities || (value => value);
        const raw = decode(String(text)).trim();
        if (!raw) return '<p class="job-description-empty">No description available</p>';

        const body = /<\/?[a-z][\s\S]*>/i.test(raw)
            ? this.sanitizeJobHtml(raw)
            : this.plainTextToHtml(raw);

        return `<div class="job-description-prose">${body}</div>`;
    }

    sanitizeJobHtml(html) {
        const allowed = new Set(['p', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'h2', 'h3', 'h4', 'a', 'blockquote']);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const out = document.createElement('div');

        const appendClean = (source, target) => {
            source.childNodes.forEach((node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    if (node.textContent) target.appendChild(document.createTextNode(node.textContent));
                    return;
                }
                if (node.nodeType !== Node.ELEMENT_NODE) return;

                const tag = node.tagName.toLowerCase();
                if (!allowed.has(tag)) {
                    appendClean(node, target);
                    return;
                }

                const element = document.createElement(tag);
                if (tag === 'a') {
                    const href = node.getAttribute('href') || '';
                    if (/^https?:/i.test(href)) {
                        element.setAttribute('href', href);
                        element.setAttribute('target', '_blank');
                        element.setAttribute('rel', 'noopener noreferrer');
                    }
                }
                appendClean(node, element);
                if ((tag === 'p' || tag === 'li' || tag === 'h2' || tag === 'h3' || tag === 'h4') && !element.textContent.trim()) {
                    return;
                }
                target.appendChild(element);
            });
        };

        appendClean(doc.body, out);
        return out.innerHTML || this.plainTextToHtml(doc.body.textContent || '');
    }

    plainTextToHtml(text) {
        const blocks = String(text).split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
        return blocks.map((block) => {
            const safe = block
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n/g, '<br>');
            return `<p>${safe}</p>`;
        }).join('');
    }

    applyInlineFormatting(text) {
        // This is now redundant with marked.js but kept for safety in non-marked contexts
        if (!text) return '';

        return text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" class="text-primary-600 hover:underline font-medium">$1</a>');
    }

    show(jobId, jobsArray = null) {
        // Use provided array or fallback to shared JobCard array if available
        const sourceJobs = jobsArray || (window.JobCard ? window.JobCard.currentJobs : []);
        const job = sourceJobs.find(j => (j._id || j.id) === jobId);

        if (!job) {
            console.error('JobModal: Job not found', jobId);
            return;
        }

        const utils = window.CVision?.Utils || {};
        const decode = utils.decodeHtmlEntities || (t => t);
        const formatEnum = utils.formatEnumValue || (t => t);

        // Ensure shell exists
        this.inject();

        const modal = document.getElementById('jobModal');
        const modalInner = document.getElementById('jobModalInner');

        // Reset scroll
        const scrollContainer = modalInner.querySelector('.overflow-y-auto');
        if (scrollContainer) scrollContainer.scrollTop = 0;

        // Populate Header
        document.getElementById('modalTitle').textContent = decode(job.title);
        document.getElementById('modalCompany').textContent = decode(job.company_name);
        document.getElementById('modalLocation').innerHTML = `<svg class="w-4 h-4 mr-1.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>${decode(job.location)}`;

        const logoContainer = document.getElementById('modalLogoContainer');
        if (logoContainer) {
            if (job.company_info?.logo_url) {
                logoContainer.innerHTML = `<img src="${job.company_info.logo_url}" alt="${job.company_name}" class="w-12 h-12 rounded-xl object-contain bg-gray-50 p-1.5 border border-gray-100 shadow-sm">`;
                logoContainer.classList.remove('hidden');
            } else {
                logoContainer.classList.add('hidden');
            }
        }

        const canAutoApply = (job.application_email || job.contact_email || job.email || (job.company_info?.contact?.email) || job.application_url || job.external_url || job.apply_url);
        const originalUrl = job.external_url || job.application_url || job.apply_url;
        const content = document.getElementById('modalContent');

        // Sections HTML construction
        const requirementsHtml = (job.requirements && job.requirements.length > 0) ? `
            <div class="mt-10">
                <h4 class="text-lg font-bold text-gray-900 mb-4 flex items-center">
                    <span class="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center mr-3">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
                    </span>
                    Requirements
                </h4>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    ${job.requirements.map(req => `
                        <div class="flex items-start p-4 rounded-2xl border border-gray-100 bg-gray-50/50 hover:bg-white hover:shadow-md transition-all duration-300">
                            <svg class="w-5 h-5 mt-0.5 mr-3 text-primary-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
                            <span class="text-[15px] text-gray-700 font-medium">${decode(req.requirement || req)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>` : '';

        const benefitsHtml = (job.benefits && job.benefits.length > 0) ? `
            <div class="mt-10">
                <h4 class="text-lg font-bold text-gray-900 mb-4 flex items-center">
                    <span class="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center mr-3">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
                    </span>
                    Benefits & Perks
                </h4>
                <div class="flex flex-wrap gap-2.5">
                    ${job.benefits.map(benefit => `
                        <span class="px-4 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-sm font-bold border border-emerald-100 flex items-center shadow-sm hover:scale-105 transition-transform">
                            <span class="w-2 h-2 rounded-full bg-emerald-400 mr-2.5"></span>
                            ${decode(benefit.name || benefit)}
                        </span>
                    `).join('')}
                </div>
            </div>` : '';

        const skillsHtml = (job.skills_required && job.skills_required.length > 0) ? `
            <div class="mt-10">
                <h4 class="text-lg font-bold text-gray-900 mb-4 flex items-center">
                    <span class="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center mr-3">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>
                    </span>
                    Technical Skills
                </h4>
                <div class="flex flex-wrap gap-2.5">
                    ${job.skills_required.map(skill => `
                        <span class="px-4 py-2 bg-gray-50 text-gray-700 rounded-xl text-xs font-black uppercase tracking-widest border border-gray-200 shadow-sm hover:bg-white hover:border-primary-200 transition-all cursor-default">
                            ${skill}
                        </span>
                    `).join('')}
                </div>
            </div>` : '';

        const companyInfoHtml = job.company_info ? `
            <div class="mt-12 p-8 rounded-3xl bg-gray-50 border border-gray-100 flex flex-col gap-6">
                <div class="flex items-center gap-5">
                    ${job.company_info.logo_url ? `<img src="${job.company_info.logo_url}" alt="${job.company_name}" class="w-20 h-20 rounded-2xl object-contain bg-white p-3 shadow-md border border-gray-100">` : ''}
                    <div>
                        <h4 class="text-xl font-black text-gray-900">About ${job.company_name}</h4>
                        <div class="flex flex-wrap gap-4 mt-2">
                            ${job.company_info.industry ? `<span class="text-sm font-bold text-gray-500 flex items-center bg-white px-3 py-1 rounded-lg border border-gray-100"><svg class="w-4 h-4 mr-2 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>${job.company_info.industry}</span>` : ''}
                            ${job.company_info.size ? `<span class="text-sm font-bold text-gray-500 flex items-center bg-white px-3 py-1 rounded-lg border border-gray-100"><svg class="w-4 h-4 mr-2 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>${formatEnum(job.company_info.size)} employees</span>` : ''}
                        </div>
                    </div>
                </div>
                ${job.company_info.description ? `<p class="text-base text-gray-600 leading-relaxed font-medium capitalize-first">${decode(job.company_info.description)}</p>` : ''}
                ${job.company_info.website ? `<a href="${job.company_info.website}" target="_blank" class="inline-flex items-center self-start px-5 py-2.5 bg-white text-primary-600 font-bold rounded-xl border-2 border-primary-50 hover:bg-primary-50 hover:border-primary-100 transition-all group">Visit Website <svg class="w-5 h-5 ml-2 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg></a>` : ''}
            </div>` : '';

        content.innerHTML = `
            ${job.match_score ? `
                <div class="bg-gradient-to-br from-primary-500 to-indigo-600 rounded-3xl p-8 mb-10 flex items-center justify-between shadow-xl shadow-primary-100 relative overflow-hidden group">
                    <div class="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                    <div class="flex items-center relative z-10">
                        <div class="w-16 h-16 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mr-6 border border-white/30 shadow-inner">
                            <span class="text-3xl font-black text-white">${Math.round(job.match_score * 100)}%</span>
                        </div>
                        <div>
                            <span class="text-xl font-black text-white block">Perfect Match Found</span>
                            <span class="text-primary-100 font-bold opacity-80">This role perfectly aligns with your career path</span>
                        </div>
                    </div>
                    <div class="hidden sm:block relative z-10">
                        <div class="w-32 h-3 bg-white/20 rounded-full overflow-hidden border border-white/20 backdrop-blur-sm">
                            <div class="bg-white h-full rounded-full shadow-[0_0_15px_rgba(255,255,255,0.5)]" style="width: ${job.match_score * 100}%"></div>
                        </div>
                    </div>
                </div>` : ''}

            <div class="flex gap-3 flex-wrap mb-10">
                ${job.employment_type ? `<span class="px-4 py-2 bg-blue-50 text-blue-700 rounded-xl text-sm font-bold border border-blue-100 shadow-sm">${formatEnum(job.employment_type)}</span>` : ''}
                ${job.work_arrangement ? `<span class="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-xl text-sm font-bold border border-indigo-100 shadow-sm">${formatEnum(job.work_arrangement)}</span>` : ''}
                ${job.experience_level ? `<span class="px-4 py-2 bg-amber-50 text-amber-700 rounded-xl text-sm font-bold border border-amber-100 shadow-sm">${formatEnum(job.experience_level)}</span>` : ''}
                ${canAutoApply ? '' : `<span class="px-4 py-2 bg-red-50 text-red-700 border border-red-100 rounded-xl text-sm flex items-center font-black"><svg class="w-5 h-5 mr-2 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>External Portal</span>`}
            </div>

            <div class="max-w-none">
                <h4 class="text-xl font-bold text-gray-900 mb-5 flex items-center">
                    <span class="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center mr-3">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"/></svg>
                    </span>
                    Role Overview
                </h4>
                <div class="mb-10">
                    ${this.formatDescription(job.description)}
                </div>
            </div>

            ${requirementsHtml}
            ${skillsHtml}
            ${benefitsHtml}

            ${job.salary_range && (job.salary_range.min_amount || job.salary_range.max_amount) ? `
                <div class="mt-12 p-8 rounded-3xl bg-emerald-50/30 border-2 border-emerald-100/50 flex flex-col items-center sm:items-start text-center sm:text-left">
                    <h4 class="text-lg font-bold text-emerald-900 mb-4 flex items-center">
                        <svg class="w-6 h-6 mr-2.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                        Proposed Compensation
                    </h4>
                    <div class="text-3xl font-black text-emerald-700 tracking-tight">
                        ${job.salary_range.min_amount ? `${job.salary_range.min_amount.toLocaleString()} ` : ''}${job.salary_range.min_amount && job.salary_range.max_amount ? '- ' : ''}${job.salary_range.max_amount ? `${job.salary_range.max_amount.toLocaleString()} ` : ''}${job.salary_range.currency || 'USD'} 
                        <span class="text-sm font-bold text-emerald-600/70 ml-2 uppercase tracking-widest">per ${job.salary_range.period || 'year'}</span>
                    </div>
                </div>` : ''}

            ${companyInfoHtml}

            ${originalUrl ? `
            <div class="mt-12 pt-8 border-t border-gray-100 flex justify-center">
                <a href="${originalUrl}" target="_blank" class="text-gray-400 text-xs font-bold uppercase tracking-widest hover:text-primary-500 transition-all flex items-center group">
                    View original source
                    <svg class="w-4 h-4 ml-2 transition-transform group-hover:translate-y-[-2px] group-hover:translate-x-[2px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                </a>
            </div>` : ''}

            <div class="mt-12 pt-8 border-t-2 border-dashed border-gray-100">
                <h4 class="text-xl font-black text-gray-900 mb-6 flex items-center justify-center sm:justify-start">
                    <span class="w-10 h-10 rounded-xl bg-primary-600 text-white flex items-center justify-center mr-4 shadow-lg shadow-primary-200">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                    </span>
                    AI-Powered Matching Materials
                </h4>
                ${window.JobActions ? window.JobActions.getButtonsHTML(job, false) : ''}
            </div>
        `;

        this.wireActions(job);

        // Show with animation
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        void modal.offsetWidth;
        modalInner.classList.remove('scale-95', 'opacity-0');
        modalInner.classList.add('scale-100', 'opacity-100');
        document.body.style.overflow = 'hidden';
    }

    wireActions(job) {
        const jobId = job._id || job.id;
        const utils = window.CVision?.Utils || {};
        const canAutoApply = (job.application_email || job.contact_email || job.email || (job.company_info?.contact?.email) || job.application_url || job.external_url || job.apply_url);
        const originalUrl = job.external_url || job.application_url || job.apply_url;

        // Copy Link Action
        const copyBtn = document.getElementById('modalCopyLink');
        if (copyBtn) {
            copyBtn.onclick = (e) => {
                e.stopPropagation();
                const url = `${window.location.origin}/pages/jobs.html?job=${jobId}`;
                navigator.clipboard.writeText(url).then(() => {
                    const originalIcon = copyBtn.innerHTML;
                    copyBtn.innerHTML = `<svg class="w-5.5 h-5.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`;
                    setTimeout(() => copyBtn.innerHTML = originalIcon, 2000);
                    if (utils.showAlert) utils.showAlert('Job link copied to clipboard!', 'success');
                });
            };
        }

        // Save Job Action
        const saveBtn = document.getElementById('modalSaveJob');
        if (saveBtn) {
            saveBtn.onclick = (e) => {
                e.stopPropagation();
                if (window.saveJob) window.saveJob(jobId);
                else if (window.CVision?.JobActions?.saveJob) window.CVision.JobActions.saveJob(jobId);
            };
            if (job.is_saved) {
                saveBtn.innerHTML = `<svg class="w-5 h-5 text-primary-500" fill="currentColor" viewBox="0 0 24 24"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg> Saved to List`;
                saveBtn.classList.add('bg-primary-50', 'border-primary-200', 'text-primary-700');
            } else {
                saveBtn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg> Save for Later`;
                saveBtn.classList.remove('bg-primary-50', 'border-primary-200', 'text-primary-700');
            }
        }

        const isApplied = window.JobActions && window.JobActions.appliedJobIds.has(String(jobId));

        // Customize Button
        const customizeBtn = document.getElementById('modalCustomize');
        if (customizeBtn) {
            customizeBtn.style.display = isApplied ? 'none' : 'flex';
            const needsUpgrade = window.PremiumGuard && !PremiumGuard.hasAccess('CV_CUSTOMIZATION');
            customizeBtn.textContent = needsUpgrade ? 'Upgrade to Customize' : 'Customize Documents';
            customizeBtn.onclick = (e) => {
                e.stopPropagation();
                if (window.JobActions?.openCustomizeModal) window.JobActions.openCustomizeModal(jobId);
            };
        }

        // Apply Button
        const applyBtn = document.getElementById('modalApply');
        if (applyBtn) {
            if (isApplied) {
                applyBtn.disabled = true;
                applyBtn.innerHTML = `<svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Already Applied`;
                applyBtn.className = 'flex-[1.5] w-full sm:w-auto px-8 py-3 rounded-xl bg-emerald-100 text-emerald-700 font-extrabold border-2 border-emerald-200 opacity-80 cursor-not-allowed flex items-center justify-center gap-2';
                applyBtn.style.background = '';
                applyBtn.style.color = '';
            } else {
                applyBtn.disabled = false;
                applyBtn.innerHTML = `<svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg> Apply`;
                applyBtn.className = 'flex-[1.5] w-full sm:w-auto px-8 py-3 rounded-xl btn-gradient text-white font-extrabold shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2';
                applyBtn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                applyBtn.style.color = '#ffffff';
                applyBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (window.JobModal && window.JobModal.hide) window.JobModal.hide();
                    if (window.JobApply && window.JobApply.openApplyModal) window.JobApply.openApplyModal(jobId, job);
                };
            }
        }
    }

    hide() {
        const modal = document.getElementById('jobModal');
        const modalInner = document.getElementById('jobModalInner');
        if (modal && modalInner) {
            modalInner.classList.add('scale-95', 'opacity-0');
            modalInner.classList.remove('scale-100', 'opacity-100');
            setTimeout(() => {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
                document.body.style.overflow = '';
            }, 300);
        }
    }
}

// Global initialization
document.addEventListener('DOMContentLoaded', () => {
    const jobModal = new JobModalComponent();
    jobModal.init();
});
