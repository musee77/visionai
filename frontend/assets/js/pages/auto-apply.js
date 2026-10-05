/**
 * Auto-Apply Dashboard Logic
 * Handles initialization, settings, stats, and test runs.
 */

let currentUser = null;
let autoApplyEnabled = false;

// Initialize page
async function initAutoApplyPage() {
    // Wait for CVision to be ready
    if (!window.CVision) {
        console.log('Waiting for CVision...');
        setTimeout(initAutoApplyPage, 100);
        return;
    }

    currentUser = CVision.getUser();
    if (!currentUser) {
        window.location.href = '/login.html';
        return;
    }

    // Initialize RunTestButton
    const runTestBtn = new RunTestButton({
        containerId: 'runTestContainer',
        apiUrl: '/api/v1/auto-apply',
        label: 'Run test',
        styleClass: 'w-full justify-center bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-lg font-medium transition-colors',
        onComplete: (data) => {
            loadStats(); // Refresh stats
        }
    });
    runTestBtn.init();

    // Initialize AutoApplyButton
    const autoApplyBtn = new AutoApplyButton({
        containerId: 'autoApplyButtonContainer',
        label: '',
        textColor: 'text-gray-900',
        onToggle: (isEnabled, settings) => {
            autoApplyEnabled = isEnabled;
            // Show/hide settings panel based on state
            const settingsSection = document.getElementById('settingsSection');
            if (settingsSection) {
                settingsSection.style.display = isEnabled ? 'block' : 'none';
            }

            // Sync sliders if settings provided from component
            if (settings) {
                const maxApps = settings.max_daily_applications;
                const minScore = settings.min_match_score;

                if (maxApps) {
                    const maxSlider = document.getElementById('maxApplicationsSlider');
                    // Setup listener safely
                    if (maxSlider) {
                        maxSlider.value = maxApps;
                        maxSlider.oninput = function () {
                            const disp = document.getElementById('maxApplicationsValueDisplay');
                            if (disp) disp.textContent = this.value + ' Apps';
                        };
                        // Initial set
                        const disp = document.getElementById('maxApplicationsValueDisplay');
                        if (disp) disp.textContent = maxApps + ' Apps';
                    }
                }

                if (minScore) {
                    const minSlider = document.getElementById('minScoreSlider');
                    // Setup listener safely
                    if (minSlider) {
                        const scorePct = Math.round(minScore * 100);
                        minSlider.value = scorePct;
                        minSlider.oninput = function () {
                            const disp = document.getElementById('minScoreValueDisplay');
                            if (disp) disp.textContent = this.value + '% Match';
                        };
                        // Initial set
                        const disp = document.getElementById('minScoreValueDisplay');
                        if (disp) disp.textContent = scorePct + '% Match';
                    }
                }
            }
        }
    });

    // Initialize button first to get state
    await autoApplyBtn.init();

    const cvData = await loadCVData();
    await loadStats();
    await loadMatchingJobs(cvData);
    await loadSuggestedRoles();
    // await loadSettings(); // Removed - data comes from autoApplyBtn

    // Initialize CvUploader if available
    if (window.CvUploader) {
        initCvUploader();
    }

    if (location.hash === '#auto-apply') {
        document.getElementById('auto-apply')?.scrollIntoView();
    }
}

// Initialize CV Action
function initCvUploader() {
    const uploader = new CvUploader({
        dropZoneId: 'dropZone',
        fileInputId: 'fileInput',
        loadingId: 'uploadLoading',
        onSuccess: (result) => {
            showNotification('CV Uploaded Successfully! Updating profile...');

            // Extract CV Data directly from upload result
            const cvData = result.cv_data || result.document?.cv_data || {};

            // Synthesize user info if available or let loader fallback
            const userInfo = {
                full_name: cvData.name || cvData.full_name,
                email: cvData.email
            };

            // Immediate update without fetch
            loadCVData(cvData, userInfo);
            loadMatchingJobs(cvData);
            // Settings are managed by AutoApplyButton component
        },
        onError: (error) => {
            showNotification('Upload Failed: ' + error, 'error');
        }
    });
    uploader.init();
}

// Load CV data using the reusable CVLoader component
async function loadCVData(injectedCvData = null, injectedUserInfo = null) {
    if (!window.CVLoader) {
        console.error('CVLoader not loaded!');
        return null;
    }

    let cvData, source, userInfo;

    if (injectedCvData) {
        // Use injected data (from immediate upload)
        cvData = injectedCvData;
        userInfo = injectedUserInfo;
        source = 'upload';
        console.log('Using injected CV data from upload');
    } else {
        // Fetch from backend
        const result = await CVLoader.getParsedCV();
        cvData = result.cvData;
        source = result.source;
        userInfo = result.userInfo;
    }

    // Delegate rendering to local helper
    renderCVProfile('cvDataContainer', cvData, userInfo);

    return cvData;
}

/**
 * Render the CV data into a container.
 * @param {string} containerId - The ID of the container to render into.
 * @param {Object} cvData - The parsed CV data.
 * @param {Object} userInfo - User info for fallback (name, email).
 */
function renderCVProfile(containerId, cvData, userInfo = null) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`CVLoader: Container #${containerId} not found.`);
        return;
    }

    if (!cvData || Object.keys(cvData).length === 0) {
        container.innerHTML = `
        <div class="text-center py-12">
            <div class="text-4xl mb-4">📄</div>
            <h3 class="text-lg font-semibold text-gray-700 mb-2">No CV Data Found</h3>
            <p class="text-gray-500 mb-4">Upload your CV to see your profile here.</p>
            <button onclick="document.getElementById('fileInput').click()" class="btn-apply" style="padding: 0.75rem 1.5rem; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 500;">
                Upload CV
            </button>
            <div id="suggestedRolesContainer" class="mt-6 text-left"></div>
        </div>
        `;
        return;
    }

    // Debug: Log the raw CV data structure
    console.log('CV Data Structure:', cvData);

    const experience = Array.isArray(cvData.experience) ? cvData.experience : [];

    // Handle summary - could be professional_summary or summary
    const summary = cvData.professional_summary || cvData.summary || 'No summary available';

    // Handle skills - could be nested object { technical: [], soft: [] } or flat array
    let skills = [];
    if (cvData.skills) {
        if (Array.isArray(cvData.skills)) {
            skills = cvData.skills;
        } else if (typeof cvData.skills === 'object') {
            // Nested skills object - combine technical and soft skills
            skills = [
                ...(cvData.skills.technical || []),
                ...(cvData.skills.soft || []),
                ...(cvData.skills.languages || [])
            ];
        }
    }

    // Generate HTML
    const maxVisibleSkills = 8;
    const maxVisibleExperience = 3;
    const hasMoreSkills = skills.length > maxVisibleSkills;
    const hasMoreExperience = experience.length > maxVisibleExperience;

    const cvHTML = `
    <div class="space-y-6">
        <div class="flex flex-col gap-6">
            <!-- Summary -->
            <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h3 class="flex items-center gap-2 text-lg font-bold text-gray-900 mb-4">
                    <span class="text-xl">📝</span> Professional Summary
                </h3>
                <div class="text-gray-600 leading-relaxed bg-gray-50 p-4 rounded-lg border border-gray-100/50">
                    ${summary.length > 300 ? `
                        <span id="summaryShort">${summary.substring(0, 300)}...</span>
                        <span id="summaryFull" class="hidden">${summary}</span>
                        <button onclick="toggleSummary()" id="summaryToggle" class="text-blue-600 hover:text-blue-700 font-medium text-sm ml-1">View more</button>
                    ` : summary}
                </div>
            </div>

            <!-- Skills -->
            <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex-1">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="flex items-center gap-2 text-lg font-bold text-gray-900">
                        <span class="text-xl">🎯</span> Skills & Expertise
                    </h3>
                    <span class="text-xs text-gray-400">${skills.length} skills</span>
                </div>
                <div class="flex flex-wrap gap-2" id="skillsContainer">
                    ${skills.slice(0, maxVisibleSkills).map(skill => `
                        <span class="px-3 py-1 bg-white border border-gray-200 text-gray-700 text-sm rounded-full font-medium shadow-sm hover:shadow-md hover:border-blue-200 hover:text-blue-600 transition-all cursor-default">
                            ${skill}
                        </span>
                    `).join('') || '<p class="text-gray-500 italic">No skills listed</p>'}
                    ${hasMoreSkills ? `
                        <span id="hiddenSkills" class="hidden">
                            ${skills.slice(maxVisibleSkills).map(skill => `
                                <span class="px-3 py-1 bg-white border border-gray-200 text-gray-700 text-sm rounded-full font-medium shadow-sm hover:shadow-md hover:border-blue-200 hover:text-blue-600 transition-all cursor-default inline-block mb-2 mr-2">
                                    ${skill}
                                </span>
                            `).join('')}
                        </span>
                    ` : ''}
                </div>
                ${hasMoreSkills ? `
                    <button onclick="toggleSkills()" id="skillsToggle" class="mt-3 text-blue-600 hover:text-blue-700 font-medium text-sm flex items-center gap-1">
                        <span>View ${skills.length - maxVisibleSkills} more</span>
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                ` : ''}
            </div>
        </div>

        <div>
            <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="flex items-center gap-2 text-lg font-bold text-gray-900">
                        <span class="text-xl">🎯</span> Suggested Job Roles
                    </h3>
                    <span class="text-xs text-gray-400">Based on your CV analysis • Click to search</span>
                </div>
                <div id="suggestedRolesContainer" class="flex flex-wrap gap-3">
                    <div class="animate-pulse flex gap-3">
                        <div class="h-10 w-32 bg-gray-200 rounded-lg"></div>
                        <div class="h-10 w-40 bg-gray-200 rounded-lg"></div>
                        <div class="h-10 w-36 bg-gray-200 rounded-lg"></div>
                    </div>
                </div>
            </div>
        </div>

        <div>
            <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <div class="flex items-center justify-between mb-6">
                    <h3 class="flex items-center gap-2 text-lg font-bold text-gray-900">
                        <span class="text-xl">💼</span> Work Experience
                    </h3>
                    <span class="text-xs text-gray-400">${experience.length} positions</span>
                </div>
                <div class="grid gap-4" id="experienceContainer">
                    ${experience.slice(0, maxVisibleExperience).map((exp, idx) => {
        const desc = exp.description || 'No description provided';
        const maxLen = 150;
        const isLong = desc.length > maxLen;
        return `
                        <div class="group relative p-5 bg-gray-50 hover:bg-white border border-transparent hover:border-blue-100 rounded-xl transition-all duration-300 hover:shadow-md">
                            <div class="flex flex-col sm:flex-row justify-between sm:items-start gap-2 mb-3">
                                <div>
                                    <h4 class="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors">${exp.title || 'Position'}</h4>
                                    <p class="text-gray-600 font-medium">${exp.company || 'Company'}</p>
                                </div>
                                <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-100 whitespace-nowrap">
                                    ${exp.start_date || 'Start'} - ${exp.end_date || 'Present'}
                                </span>
                            </div>
                            <div class="text-gray-600 text-sm leading-relaxed border-t border-gray-200 pt-3 mt-1 group-hover:border-blue-50 transition-colors">
                                ${isLong ? `
                                    <span id="expDesc${idx}Short">${desc.substring(0, maxLen)}...</span>
                                    <span id="expDesc${idx}Full" class="hidden">${desc}</span>
                                    <button onclick="toggleExpDesc(${idx})" id="expDesc${idx}Toggle" class="text-blue-600 hover:text-blue-700 font-medium text-xs ml-1">more</button>
                                ` : desc}
                            </div>
                        </div>
                    `}).join('') || '<p class="text-gray-500 italic p-4 text-center">No work experience found</p>'}
                    
                    ${hasMoreExperience ? `
                        <div id="hiddenExperience" class="hidden grid gap-4">
                            ${experience.slice(maxVisibleExperience).map((exp, idx) => {
            const realIdx = idx + maxVisibleExperience;
            const desc = exp.description || 'No description provided';
            const maxLen = 150;
            const isLong = desc.length > maxLen;
            return `
                                <div class="group relative p-5 bg-gray-50 hover:bg-white border border-transparent hover:border-blue-100 rounded-xl transition-all duration-300 hover:shadow-md">
                                    <div class="flex flex-col sm:flex-row justify-between sm:items-start gap-2 mb-3">
                                        <div>
                                            <h4 class="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors">${exp.title || 'Position'}</h4>
                                            <p class="text-gray-600 font-medium">${exp.company || 'Company'}</p>
                                        </div>
                                        <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-100 whitespace-nowrap">
                                            ${exp.start_date || 'Start'} - ${exp.end_date || 'Present'}
                                        </span>
                                    </div>
                                    <div class="text-gray-600 text-sm leading-relaxed border-t border-gray-200 pt-3 mt-1 group-hover:border-blue-50 transition-colors">
                                        ${isLong ? `
                                            <span id="expDesc${realIdx}Short">${desc.substring(0, maxLen)}...</span>
                                            <span id="expDesc${realIdx}Full" class="hidden">${desc}</span>
                                            <button onclick="toggleExpDesc(${realIdx})" id="expDesc${realIdx}Toggle" class="text-blue-600 hover:text-blue-700 font-medium text-xs ml-1">more</button>
                                        ` : desc}
                                    </div>
                                </div>
                            `}).join('')}
                        </div>
                    ` : ''}
                </div>
                ${hasMoreExperience ? `
                    <button onclick="toggleExperience()" id="experienceToggle" class="mt-4 text-blue-600 hover:text-blue-700 font-medium text-sm flex items-center gap-1">
                        <span>View ${experience.length - maxVisibleExperience} more positions</span>
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                ` : ''}
            </div>
        </div>
    </div>
    `;

    container.innerHTML = cvHTML;
}

// Toggle individual experience description
function toggleExpDesc(idx) {
    const short = document.getElementById(`expDesc${idx}Short`);
    const full = document.getElementById(`expDesc${idx}Full`);
    const btn = document.getElementById(`expDesc${idx}Toggle`);

    if (full.classList.contains('hidden')) {
        short.classList.add('hidden');
        full.classList.remove('hidden');
        btn.textContent = 'less';
    } else {
        short.classList.remove('hidden');
        full.classList.add('hidden');
        btn.textContent = 'more';
    }
}

// Toggle functions for View More/Less
function toggleSummary() {
    const short = document.getElementById('summaryShort');
    const full = document.getElementById('summaryFull');
    const btn = document.getElementById('summaryToggle');

    if (full.classList.contains('hidden')) {
        short.classList.add('hidden');
        full.classList.remove('hidden');
        btn.textContent = 'View less';
    } else {
        short.classList.remove('hidden');
        full.classList.add('hidden');
        btn.textContent = 'View more';
    }
}

function toggleSkills() {
    const hidden = document.getElementById('hiddenSkills');
    const btn = document.getElementById('skillsToggle');

    if (hidden.classList.contains('hidden')) {
        hidden.classList.remove('hidden');
        btn.innerHTML = '<span>View less</span><svg class="w-4 h-4 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';
    } else {
        hidden.classList.add('hidden');
        const count = document.querySelectorAll('#hiddenSkills span').length;
        btn.innerHTML = `<span>View ${count} more</span><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>`;
    }
}

function toggleExperience() {
    const hidden = document.getElementById('hiddenExperience');
    const btn = document.getElementById('experienceToggle');

    if (hidden.classList.contains('hidden')) {
        hidden.classList.remove('hidden');
        btn.innerHTML = '<span>View less</span><svg class="w-4 h-4 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';
    } else {
        hidden.classList.add('hidden');
        const count = document.querySelectorAll('#hiddenExperience > div').length;
        btn.innerHTML = `<span>View ${count} more positions</span><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>`;
    }
}

// Load suggested roles from backend
async function loadSuggestedRoles() {
    const container = document.getElementById('suggestedRolesContainer');
    if (!container) return;

    try {
        const response = await fetch('/api/v1/auto-apply/suggested-roles', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('access_token')}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch suggested roles');
        }

        const data = await response.json();
        const roles = data.suggested_roles || [];

        if (roles.length === 0) {
            container.innerHTML = '<p class="text-gray-500 italic text-sm">Upload your CV to see suggested roles based on your skills.</p>';
            return;
        }

        container.innerHTML = roles.map(role => `
            <a href="/pages/jobs.html?search=${encodeURIComponent(role.title)}" 
               class="group inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-50 to-purple-50 hover:from-blue-100 hover:to-purple-100 border border-blue-200 hover:border-blue-300 text-blue-700 rounded-lg font-medium text-sm transition-all duration-200 hover:shadow-md"
               title="${role.reason}">
                <span>${role.title}</span>
                <span class="text-xs text-blue-400 bg-white/50 px-1.5 py-0.5 rounded border border-blue-100">${role.match_score ? role.match_score + '%' : (role.match_type === 'current' ? 'Current' : 'Past')}</span>
                <svg class="w-4 h-4 opacity-50 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                </svg>
            </a>
        `).join('');

    } catch (error) {
        console.error('Error loading suggested roles:', error);
        container.innerHTML = '<p class="text-gray-500 italic text-sm">Unable to load suggested roles.</p>';
    }
}

function scorePercent(score) {
    const value = Number(score) || 0;
    return Math.round(value <= 1 ? value * 100 : value);
}

// Load stats
async function loadStats() {
    try {
        const response = await fetch('/api/v1/auto-apply/stats', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('access_token')}`
            }
        });

        if (!response.ok) return;

        const stats = await response.json();
        document.getElementById('todayApplications').textContent = stats.today_applications || 0;
        document.getElementById('totalApplications').textContent = stats.total_applications || 0;
        document.getElementById('avgMatchScore').textContent = scorePercent(stats.avg_match_score) + '%';
        document.getElementById('interviewRate').textContent = scorePercent(stats.interview_rate) + '%';

        const limitSpan = document.getElementById('dailyLimit');
        if (limitSpan && stats.daily_limit) limitSpan.textContent = stats.daily_limit;

        const remaining = document.getElementById('remainingToday');
        if (remaining) {
            const left = stats.remaining_today ?? Math.max(0, (stats.daily_limit || 0) - (stats.today_applications || 0));
            remaining.textContent = left;
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Load matching jobs
async function loadMatchingJobs(cvData = null) {
    // If no CV data is present, show upload prompt immediately without fetching
    if (!cvData || Object.keys(cvData).length === 0) {
        document.getElementById('matchingJobsContainer').innerHTML = `
            <div style="text-align: center; padding: 3rem 1rem; background: #f9fafb; border-radius: 12px; border: 1px dashed #d1d5db;">
                <div style="font-size: 2rem; margin-bottom: 1rem;">📄</div>
                <h3 style="font-weight: 600; color: #374151; margin-bottom: 0.5rem;">Ready to find jobs?</h3>
                <p style="color: #6b7280; margin-bottom: 1.5rem;">Upload your CV to see AI-matched jobs here.</p>
                <button onclick="document.getElementById('fileInput').click()" class="btn-view" style="padding: 0.5rem 1.5rem; background: #667eea; color: white; border: none;">
                    Upload CV Now
                </button>
            </div>
        `;
        return;
    }

    try {
        const response = await fetch('/api/v1/auto-apply/matching-jobs?limit=2', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('access_token')}`
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            // Gracefully handle "CV not uploaded" error (400)
            if (response.status === 400 && (errorData.detail || '').includes('CV')) {
                document.getElementById('matchingJobsContainer').innerHTML = `
                    <div style="text-align: center; padding: 3rem 1rem; background: #f9fafb; border-radius: 12px; border: 1px dashed #d1d5db;">
                        <div style="font-size: 2rem; margin-bottom: 1rem;">📄</div>
                        <h3 style="font-weight: 600; color: #374151; margin-bottom: 0.5rem;">Ready to find jobs?</h3>
                        <p style="color: #6b7280; margin-bottom: 1.5rem;">Upload your CV to see AI-matched jobs here.</p>
                        <button onclick="document.getElementById('fileInput').click()" class="btn-view" style="padding: 0.5rem 1.5rem; background: #667eea; color: white; border: none;">
                            Upload CV Now
                        </button>
                    </div>
                `;
                return;
            }
            throw new Error(errorData.detail || 'Failed to fetch jobs');
        }

        const jobs = await response.json();

        if (!Array.isArray(jobs) || jobs.length === 0) {
            document.getElementById('matchingJobsContainer').innerHTML = `
        <div style="text-align: center; padding: 2rem;">
            <p style="color: #6b7280; margin-bottom: 1rem;">No matching jobs found.</p>
        </div>
    `;
            return;
        }

        const jobsHTML = jobs.map(job => {
            const score = scorePercent(job.match_score || 0);
            const scoreClass = score >= 80 ? 'score-high' : score >= 60 ? 'score-medium' : 'score-low';
            const isApplied = job.applied || false;
            const jobId = job._id || job.id;
            const company = job.company_name || job.company || 'Company';
            const description = job.description || '';

            return `
        <div class="job-card">
            <div class="job-header">
                <div>
                    <div class="job-title">${job.title}</div>
                    <div class="job-company">${company}</div>
                </div>
                <div class="match-score">
                    <div class="score-circle ${scoreClass}">
                        ${score}%
                    </div>
                    <div class="score-label">Match</div>
                </div>
            </div>
            <div class="job-details">
                <div class="job-detail-item">
                    📍 ${job.location || 'Remote'}
                </div>
                <div class="job-detail-item">
                    💰 ${job.salary || 'Not specified'}
                </div>
                <div class="job-detail-item">
                    ⏰ Posted ${getTimeAgo(job.created_at)}
                </div>
            </div>
            <div class="job-description">
                ${truncate(description, 200)}
            </div>
            <div class="job-actions">
                <button class="btn-apply ${isApplied ? 'auto-applied' : ''}"
                    ${isApplied ? 'disabled' : ''}
                    onclick="${isApplied ? '' : `viewJob('${jobId}')`}">
                    ${isApplied ? '✓ Applied' : 'Apply Now'}
                </button>
                <button class="btn-view" onclick="viewJob('${jobId}')">View Details</button>
            </div>
        </div>
    `;
        }).join('');

        document.getElementById('matchingJobsContainer').innerHTML = jobsHTML;
    } catch (error) {
        console.error('Error loading matching jobs:', error);
        document.getElementById('matchingJobsContainer').innerHTML = `
    <div style="text-align: center; padding: 2rem;">
        <p style="color: #6b7280; margin-bottom: 1rem;">${error.message.includes('CV') ? 'Please upload your CV to see matching jobs.' : 'Error loading jobs.'}</p>
        ${error.message.includes('CV') ? '<button onclick="document.getElementById(\'fileInput\').click()" class="btn-apply" style="cursor: pointer;">Upload CV</button>' : ''}
    </div>
`;
    }
}



// Save settings
async function saveSettings() {
    // Check Premium Access
    if (typeof PremiumGuard !== 'undefined') {
        if (!PremiumGuard.enforce('AUTO_APPLY', 'Premium Automation', 'Saving automation settings requires a Premium subscription.')) {
            return;
        }
    }

    const maxApps = parseInt(document.getElementById('maxApplicationsSlider').value);
    const minScore = parseInt(document.getElementById('minScoreSlider').value) / 100;

    try {
        const response = await fetch('/api/v1/auto-apply/settings', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                max_daily_applications: maxApps,
                min_match_score: minScore
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const detail = errorData.detail;
            throw new Error(typeof detail === 'string' ? detail : 'Could not save settings');
        }

        document.getElementById('dailyLimit').textContent = maxApps;
        const remaining = document.getElementById('remainingToday');
        const sentToday = parseInt(document.getElementById('todayApplications').textContent, 10) || 0;
        if (remaining) remaining.textContent = Math.max(0, maxApps - sentToday);
        showNotification('Settings saved successfully!');
    } catch (error) {
        console.error('Error saving settings:', error);
        showNotification('Error saving settings', 'error');
    }
}

// Run Test


// Helpers
function truncate(str, n) {
    if (!str) return '';
    return (str.length > n) ? str.substr(0, n - 1) + '&hellip;' : str;
}

function getTimeAgo(dateString) {
    if (!dateString) return 'recently';
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    const intervals = {
        year: 31536000,
        month: 2592000,
        week: 604800,
        day: 86400,
        hour: 3600,
        minute: 60
    };

    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
        const interval = Math.floor(seconds / secondsInUnit);
        if (interval >= 1) {
            return interval === 1 ? `1 ${unit} ago` : `${interval} ${unit}s ago`;
        }
    }
    return 'Just now';
}

function showNotification(message, type = 'success') {
    // Ensure toast container exists
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'fixed bottom-5 right-5 z-50 flex flex-col space-y-3 pointer-events-none';
        document.body.appendChild(container);
    }

    // Create toast element
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-50 border-green-200' : (type === 'error' ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200');
    const iconColor = type === 'success' ? 'text-green-500' : (type === 'error' ? 'text-red-500' : 'text-blue-500');
    const icon = type === 'success'
        ? '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>'
        : (type === 'error'
            ? '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>'
            : '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>');

    toast.className = `${bgColor} border shadow-lg rounded-xl p-4 flex items-center space-x-3 transform transition-all duration-300 translate-y-2 opacity-0 pointer-events-auto min-w-[300px]`;
    toast.innerHTML = `
        <div class="flex-shrink-0 ${iconColor}">
            ${icon}
        </div>
        <div class="flex-1 text-sm font-medium text-gray-800">
            ${message}
        </div>
        <button onclick="this.parentElement.remove()" class="text-gray-400 hover:text-gray-600 focus:outline-none">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
    `;

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-2', 'opacity-0');
    });

    // Auto dismiss
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function viewJob(jobId) {
    if (!jobId || jobId === 'undefined') return;
    window.location.href = `/pages/jobs.html?job=${encodeURIComponent(jobId)}`;
}

document.addEventListener('DOMContentLoaded', () => {
    const maxSlider = document.getElementById('maxApplicationsSlider');
    const minSlider = document.getElementById('minScoreSlider');

    if (maxSlider) {
        maxSlider.addEventListener('input', (e) => {
            const disp = document.getElementById('maxApplicationsValueDisplay');
            if (disp) disp.textContent = e.target.value + ' Apps';
        });
    }

    if (minSlider) {
        minSlider.addEventListener('input', (e) => {
            const disp = document.getElementById('minScoreValueDisplay');
            if (disp) disp.textContent = e.target.value + '% Match';
        });
    }

    // Event Listeners for Buttons (Replacing inline onclicks)
    const uploadCvBtn = document.getElementById('uploadCvBtn');
    if (uploadCvBtn) {
        uploadCvBtn.addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });
    }



    // Initialize logic
    initAutoApplyPage();
});
