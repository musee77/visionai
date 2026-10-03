window.InterviewsTab = {
    async load() {
        const container = document.getElementById('interviewsList');
        if (!container) return;

        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/applications/upcoming-interviews?days_ahead=30`, {
                headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
            });

            if (!res.ok) {
                container.innerHTML = '<div class="bg-white rounded-lg border p-12 text-center"><p class="text-red-600">Failed to load interviews</p></div>';
                return;
            }

            const data = await res.json();

            if (!data.interviews || data.interviews.length === 0) {
                container.innerHTML = `
                    <div class="bg-white rounded-lg border p-12 text-center">
                        <svg class="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                        </svg>
                        <h3 class="text-lg font-medium text-gray-900 mb-2">No Upcoming Interviews</h3>
                        <p class="text-gray-600">Schedule interviews from your applications</p>
                    </div>
                `;
                return;
            }
            container.innerHTML = data.interviews.map(i => this.renderInterviewCard(i)).join('');
        } catch (error) {
            console.error('Load interviews error:', error);
            container.innerHTML = '<div class="bg-white rounded-lg border p-12 text-center"><p class="text-gray-600">No upcoming interviews</p></div>';
        }
    },

    renderInterviewCard(i) {
        if (!i.interview_date) {
            return `
            <div class="bg-white rounded-lg border-l-4 border-l-red-500 border border-t-gray-200 border-r-gray-200 border-b-gray-200 p-6 hover:shadow-lg transition-all duration-200">
                <div class="flex justify-between items-start mb-4">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-2">
                            <h3 class="text-xl font-bold text-gray-900">${escapeHtml(i.job_title || 'Untitled role')}</h3>
                            <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700 animate-pulse">Action Required</span>
                        </div>
                        <p class="text-gray-700 font-medium text-lg">${escapeHtml(i.company_name || 'Company not listed')}</p>
                    </div>
                    <div class="flex flex-col items-end gap-2">
                        <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-red-50 text-red-700">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                            Scheduling Needed
                        </span>
                    </div>
                </div>
                
                <div class="mb-4 p-3 bg-red-50 rounded-lg border border-red-100">
                    <div class="flex items-start gap-3">
                        <svg class="w-5 h-5 text-red-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                        </svg>
                        <div>
                            <p class="text-sm font-semibold text-red-800">Interview Invitation Received</p>
                            <p class="text-sm text-red-700">You have been invited to an interview. Please review the email and schedule a time.</p>
                        </div>
                    </div>
                </div>
                
                <div class="flex flex-wrap gap-2 pt-4 border-t border-gray-100">
                    <button onclick="viewInterviewDetails('${i.application_id || i._id}')" 
                            class="flex-1 min-w-[140px] px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all font-medium text-sm shadow-sm flex items-center justify-center gap-2">
                        View Details
                    </button>
                    <button onclick="updateStatus('${i.application_id || i._id}')" 
                            class="flex-1 min-w-[140px] px-4 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-all font-medium text-sm flex items-center justify-center gap-2">
                        Update Status / Schedule
                    </button>
                </div>
            </div>
            `;
        }

        const interviewDate = new Date(i.interview_date);
        const now = new Date();
        const hoursUntil = Math.floor((interviewDate - now) / (1000 * 60 * 60));
        const daysUntil = Math.floor(hoursUntil / 24);
        const isUrgent = hoursUntil <= 24 && hoursUntil > 0;
        const isPast = hoursUntil < 0;

        let timeUntilText = '';
        let timeUntilColor = 'text-gray-600';
        if (isPast) {
            timeUntilText = 'Past interview';
            timeUntilColor = 'text-gray-400';
        } else if (hoursUntil < 1) {
            timeUntilText = 'Starting soon!';
            timeUntilColor = 'text-red-600 font-semibold';
        } else if (hoursUntil < 24) {
            timeUntilText = `In ${hoursUntil} hour${hoursUntil !== 1 ? 's' : ''}`;
            timeUntilColor = 'text-orange-600 font-semibold';
        } else if (daysUntil === 1) {
            timeUntilText = 'Tomorrow';
            timeUntilColor = 'text-yellow-600 font-medium';
        } else if (daysUntil <= 7) {
            timeUntilText = `In ${daysUntil} days`;
            timeUntilColor = 'text-blue-600';
        } else {
            timeUntilText = `In ${daysUntil} days`;
            timeUntilColor = 'text-gray-600';
        }

        const typeColor = 'bg-blue-100 text-blue-700'; // Simplified for brevity in refactor
        const borderClass = isUrgent ? 'border-l-4 border-l-orange-500' : isPast ? 'border-l-4 border-l-gray-300' : 'border-l-4 border-l-blue-500';

        return `
            <div class="bg-white rounded-lg border ${borderClass} p-6 hover:shadow-lg transition-all duration-200 ${isPast ? 'opacity-75' : ''}">
                <div class="flex justify-between items-start mb-4">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-2">
                            <h3 class="text-xl font-bold text-gray-900">${escapeHtml(i.job_title || 'Untitled role')}</h3>
                            ${isUrgent ? '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-700 animate-pulse">Urgent</span>' : ''}
                        </div>
                        <p class="text-gray-700 font-medium text-lg">${escapeHtml(i.company_name || 'Company not listed')}</p>
                    </div>
                    <div class="flex flex-col items-end gap-2">
                        <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${typeColor}">
                            ${formatEnumValue(i.interview_type)}
                        </span>
                    </div>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div class="flex items-center gap-3">
                        <div class="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                            <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                        </div>
                        <div>
                            <p class="text-xs text-gray-500 font-medium uppercase">Date & Time</p>
                            <p class="text-sm font-semibold text-gray-900">${formatDateTime(i.interview_date)}</p>
                        </div>
                    </div>
                    
                    <div class="flex items-center gap-3">
                        <div class="flex-shrink-0 w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                            <svg class="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        </div>
                        <div>
                            <p class="text-xs text-gray-500 font-medium uppercase">Time Until</p>
                            <p class="text-sm font-semibold ${timeUntilColor}">${timeUntilText}</p>
                        </div>
                    </div>
                </div>
                
                ${i.location ? `
                    <div class="flex items-start gap-3 mb-4 p-3 bg-gray-50 rounded-lg">
                        <svg class="w-5 h-5 text-gray-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                        <div class="flex-1">
                            <p class="text-xs text-gray-500 font-medium uppercase mb-1">Location</p>
                            <p class="text-sm text-gray-900">${escapeHtml(i.location)}</p>
                        </div>
                    </div>
                ` : ''}
                
                ${i.notes ? `
                    <div class="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                        <p class="text-xs text-blue-600 font-medium uppercase mb-1">Notes</p>
                        <p class="text-sm text-gray-700">${escapeHtml(i.notes)}</p>
                    </div>
                ` : ''}
                
                <div class="flex flex-wrap gap-2 pt-4 border-t border-gray-100">
                    <button onclick="viewInterviewDetails('${i.application_id || i._id}')" 
                            class="flex-1 min-w-[140px] px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all font-medium text-sm shadow-sm flex items-center justify-center gap-2">
                        View Details
                    </button>
                    <button type="button" data-title="${escapeHtml(i.job_title || '')}" data-company="${escapeHtml(i.company_name || '')}" data-date="${escapeHtml(i.interview_date || '')}" data-location="${escapeHtml(i.location || '')}" onclick="addToCalendarFromButton(this)" 
                            class="flex-1 min-w-[140px] px-4 py-2.5 bg-white border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 hover:bg-gray-50 transition-all duration-200 font-medium text-sm flex items-center justify-center gap-2">
                        Add to Calendar
                    </button>
                </div>
            </div>
        `;
    },

    addToCalendar(jobTitle, companyName, interviewDate, location) {
        try {
            const date = new Date(interviewDate);
            const endDate = new Date(date.getTime() + 60 * 60 * 1000); // 1 hour duration

            // Format dates for .ics file (YYYYMMDDTHHMMSSZ)
            const formatICSDate = (d) => {
                return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
            };

            const icsContent = [
                'BEGIN:VCALENDAR',
                'VERSION:2.0',
                'PRODID:-//CVision//Interview Calendar//EN',
                'BEGIN:VEVENT',
                `UID:${Date.now()}@cvision.app`,
                `DTSTAMP:${formatICSDate(new Date())}`,
                `DTSTART:${formatICSDate(date)}`,
                `DTEND:${formatICSDate(endDate)}`,
                `SUMMARY:Interview: ${jobTitle} at ${companyName}`,
                `DESCRIPTION:Interview for ${jobTitle} position at ${companyName}`,
                location ? `LOCATION:${location}` : '',
                'STATUS:CONFIRMED',
                'BEGIN:VALARM',
                'TRIGGER:-PT1H',
                'ACTION:DISPLAY',
                'DESCRIPTION:Interview reminder',
                'END:VALARM',
                'END:VEVENT',
                'END:VCALENDAR'
            ].filter(line => line).join('\r\n');

            // Create and download .ics file
            const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `interview-${companyName.replace(/\s+/g, '-')}.ics`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);

            InlineMessage.success('Calendar event downloaded! Open the file to add to your calendar.');
        } catch (error) {
            console.error('Calendar error:', error);
            InlineMessage.error('Failed to create calendar event');
        }
    }
};

window.loadUpcomingInterviews = () => window.InterviewsTab.load();
window.addToCalendar = (t, c, d, l) => window.InterviewsTab.addToCalendar(t, c, d, l);
window.addToCalendarFromButton = (button) => window.InterviewsTab.addToCalendar(
    button.dataset.title || '',
    button.dataset.company || '',
    button.dataset.date || '',
    button.dataset.location || ''
);

// ==================== MOVED LOGIC ====================

async function viewInterviewDetails(applicationId) {
    try {
        const res = await fetch(`${API_BASE_URL}/api/v1/applications/${applicationId}`, {
            headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
        });
        if (!res.ok) throw new Error('Failed to load interview details');
        const app = await res.json();

        displayInterviewModal(app);
    } catch (error) {
        console.error('Error loading interview:', error);
        CVision.Utils.showAlert('Failed to load interview details', 'error');
    }
}

function closeInterviewModal() {
    const modal = document.getElementById('interviewModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function displayInterviewModal(app) {
    const modalContent = document.getElementById('interviewModalContent');
    const modal = document.getElementById('interviewModal');
    if (!modalContent || !modal) return;

    const interviewDate = app.interview_date ? new Date(app.interview_date) : null;
    const isScheduled = !!interviewDate;

    // Helper for meeting link
    const rawMeeting = app.meeting_link || (app.location && app.location.match(/https?:\/\/[^\s]+/) ? app.location.match(/https?:\/\/[^\s]+/)[0] : null);
    const meetingLink = rawMeeting && /^https?:\/\//i.test(rawMeeting) ? escapeHtml(rawMeeting) : '';

    modalContent.innerHTML = `
        <!-- Gradient Header -->
        <div class="relative bg-gradient-to-br from-blue-600 to-indigo-700 p-8 rounded-t-xl text-white overflow-hidden">
            <div class="absolute top-0 right-0 -mt-10 -mr-10 w-40 h-40 bg-white opacity-10 rounded-full blur-3xl"></div>
            <div class="absolute bottom-0 left-0 -mb-10 -ml-10 w-40 h-40 bg-white opacity-10 rounded-full blur-3xl"></div>
            
            <div class="flex justify-between items-start relative z-10">
                <div>
                     <div class="flex items-center gap-2 mb-2 text-blue-100">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2-2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
                        <span class="font-medium text-lg">${escapeHtml(app.company_name || 'Company not listed')}</span>
                    </div>
                    <h2 class="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-blue-100 font-display mb-1">${escapeHtml(app.job_title || 'Untitled role')}</h2>
                    <div class="flex items-center gap-3 mt-4">
                        <span class="px-3 py-1 bg-white/20 backdrop-blur-sm rounded-full text-sm font-medium border border-white/20">
                            ${formatEnumValue(app.interview_type)}
                        </span>
                        ${isScheduled ? `
                        <span class="px-3 py-1 bg-green-500/20 backdrop-blur-sm rounded-full text-sm font-medium border border-green-400/30 text-green-50 flex items-center gap-1.5">
                            <span class="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
                            Scheduled
                        </span>` : `
                        <span class="px-3 py-1 bg-red-500/20 backdrop-blur-sm rounded-full text-sm font-medium border border-red-400/30 text-red-50">
                            Scheduling Required
                        </span>`}
                    </div>
                </div>
                <button onclick="closeInterviewModal()" class="text-white/70 hover:text-white transition-colors p-2 rounded-full hover:bg-white/10">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
        </div>

        <div class="p-8">
            ${isScheduled ? `
                <!-- Main Date Display -->
                <div class="flex flex-col md:flex-row gap-6 mb-8 items-center bg-blue-50/50 p-6 rounded-2xl border border-blue-100">
                    <div class="text-center md:text-left flex-1">
                        <p class="text-sm font-semibold text-blue-600 uppercase tracking-wide mb-1">Date & Time</p>
                        <h3 class="text-3xl font-bold text-gray-900 mb-1">${formatDateTime(interviewDate)}</h3>
                        <p class="text-lg text-gray-600 font-medium">${getTimeUntil(app.interview_date)}</p>
                    </div>
                    
                    <div class="h-12 w-px bg-blue-200 hidden md:block"></div>
                    
                    <div class="flex flex-col gap-2 w-full md:w-auto">
                        ${meetingLink ? `
                            <a href="${meetingLink}" target="_blank" class="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 transition-all transform hover:-translate-y-0.5">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                                Join Meeting
                            </a>
                        ` : ''}
                        <button type="button" data-title="${escapeHtml(app.job_title || '')}" data-company="${escapeHtml(app.company_name || '')}" data-date="${escapeHtml(app.interview_date || '')}" data-location="${escapeHtml(app.location || '')}" onclick="addToCalendarFromButton(this)" class="w-full px-6 py-3 bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-gray-700 rounded-xl font-medium shadow-sm transition-all flex items-center justify-center gap-2">
                            <svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                            Add to Calendar
                        </button>
                    </div>
                </div>
            ` : `
                <div class="bg-red-50 border border-red-200 rounded-xl p-8 mb-8 text-center">
                    <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg class="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                    </div>
                    <h3 class="text-xl font-bold text-gray-900 mb-2">Action Required</h3>
                    <p class="text-gray-600 mb-6 max-w-md mx-auto">You have been invited to an interview for this position but haven't scheduled a date yet.</p>
                    <button onclick="closeInterviewModal(); scheduleInterview('${app._id || app.id}')" class="px-8 py-3 bg-red-600 text-white rounded-xl font-semibold hover:bg-red-700 shadow-lg shadow-red-600/20 transition-all transform hover:-translate-y-0.5">
                        Schedule Interview Now
                    </button>
                </div>
            `}

            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <!-- Details Column -->
                <div class="space-y-6">
                    <div>
                        <h4 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Interview Details</h4>
                        
                        <div class="space-y-4">
                             <!-- Attendees/Interviewer -->
                             <div class="flex items-start gap-4">
                                <div class="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0">
                                    <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                                </div>
                                <div>
                                    <p class="text-sm font-medium text-gray-900">Interviewer</p>
                                    <p class="text-gray-600">${escapeHtml(app.interviewer_name || 'Not specified')}</p>
                                    ${app.interviewer_title ? `<p class="text-xs text-gray-500">${escapeHtml(app.interviewer_title)}</p>` : ''}
                                </div>
                            </div>

                            <!-- Location -->
                            <div class="flex items-start gap-4">
                                <div class="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center flex-shrink-0">
                                    <svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                </div>
                                <div>
                                    <p class="text-sm font-medium text-gray-900">Location</p>
                                    <p class="text-gray-600 break-all">${escapeHtml(app.location || 'Remote / Online')}</p>
                                </div>
                            </div>
                            
                            <!-- Duration -->
                            <div class="flex items-start gap-4">
                                <div class="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center flex-shrink-0">
                                    <svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                </div>
                                <div>
                                    <p class="text-sm font-medium text-gray-900">Duration</p>
                                    <p class="text-gray-600">${app.interview_duration || 'Not specified'} minutes</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Notes Column -->
                <div>
                     <div class="flex justify-between items-center mb-4">
                        <h4 class="text-sm font-semibold text-gray-400 uppercase tracking-wider">Preparation & Notes</h4>
                        <button onclick="CVision.Utils.showAlert('AI Preparation Assistant coming soon!', 'info')" class="text-sm text-purple-600 font-medium hover:text-purple-700 flex items-center gap-1">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                            AI Prep
                        </button>
                    </div>
                    
                    <div class="bg-gray-50 rounded-xl border border-gray-200 p-5 min-h-[160px]">
                        <p class="text-gray-700 whitespace-pre-line leading-relaxed text-sm">
                            ${app.notes ? escapeHtml(app.notes) : '<span class="text-gray-400 italic">No notes added. Use "Update Status" to add notes.</span>'}
                        </p>
                    </div>
                    
                    ${isScheduled ? `
                    <button type="button" data-id="${escapeHtml(app._id || app.id || '')}" data-title="${escapeHtml(app.job_title || '')}" data-company="${escapeHtml(app.company_name || '')}" data-interviewer="${escapeHtml(app.interviewer_name || '')}" data-date="${escapeHtml(app.interview_date || '')}" onclick="showConfirmationCompose(this.dataset.id, this.dataset.title, this.dataset.company, this.dataset.interviewer, this.dataset.date)" class="w-full mt-4 py-2 bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                        Confirm Availability
                    </button>
                    ` : ''}
                    
                    <button onclick="closeInterviewModal(); updateStatus('${app._id || app.id}')" class="w-full mt-2 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 hover:text-gray-800 text-sm font-medium transition-colors">
                        Edit Notes / Update Status
                    </button>
                    
                     <button onclick="closeInterviewModal(); scheduleInterview('${app._id || app.id}')" class="w-full mt-2 py-2 text-blue-600 hover:text-blue-700 hover:underline text-sm font-medium transition-colors">
                        ${isScheduled ? 'Reschedule Interview' : 'Schedule Interview'}
                    </button>
                </div>
            </div>
        </div>
    `;

    modal.classList.remove('hidden');
}

// Helper for relative time
function getTimeUntil(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const hours = Math.floor((date - now) / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 0) return 'Past';
    if (hours < 24) return `In ${hours} hour${hours !== 1 ? 's' : ''}`;
    if (days === 1) return 'Tomorrow';
    return `In ${days} days`;
}

async function sendEmailReply(appId) {
    const subject = document.getElementById('replySubject').value;
    const content = document.getElementById('replyContent').value;
    const toEmail = document.getElementById('replyTo').value || null;

    if (!subject || !content) {
        CVision.Utils.showToast('Please fill in subject and content', 'error');
        return;
    }

    // Show Loading
    const btn = document.getElementById('sendReplyBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Sending...';
    btn.disabled = true;

    try {
        const res = await fetch(`${API_BASE_URL}/api/v1/applications/${appId}/email-reply`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CVision.Utils.getToken()}`
            },
            body: JSON.stringify({ subject, content, to_email: toEmail })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Failed to send email');
        }

        CVision.Utils.showToast('Confirmation email sent successfully', 'success');
        // Return to details view
        viewInterviewDetails(appId);
    } catch (error) {
        console.error('Email send error:', error);
        CVision.Utils.showAlert(error.message, 'error');
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function showConfirmationCompose(appId, title, company, interviewer, date) {
    const modalContent = document.getElementById('interviewModalContent');
    const formattedDate = new Date(date).toLocaleString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });

    // Sanitize values for template safely
    const safeInterviewer = interviewer && interviewer !== 'null' ? interviewer : 'Hiring Manager';

    const templateContent = `Hi ${safeInterviewer},

I am writing to officially confirm my availability for the interview for the ${title} position at ${company}.
I look forward to speaking with you on ${formattedDate}.

Best regards,`;

    modalContent.innerHTML = `
        <div class="flex justify-between items-center mb-6 border-b border-gray-100 pb-4">
            <h2 class="text-xl font-bold text-gray-900">Confirm Availability</h2>
            <button onclick="viewInterviewDetails('${appId}')" class="text-gray-500 hover:text-gray-700 text-sm p-2 rounded hover:bg-gray-100">
                Cancel
            </button>
        </div>
        
        <div class="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-6">
            <p class="text-sm text-blue-800 flex items-center gap-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                This will send an email from your connected Gmail via the AI Agent.
            </p>
        </div>

        <div class="space-y-4">
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">To</label>
                <input type="text" id="replyTo" class="w-full rounded-lg border-gray-300 bg-gray-50 text-gray-500" value="" placeholder="Automatic (Recruiter / Last Contact)" readonly>
            </div>
            
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                <input type="text" id="replySubject" class="w-full rounded-lg border-gray-300 focus:ring-blue-500 focus:border-blue-500" value="Re: Interview Confirmation: ${title} - ${company}">
            </div>
            
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Message</label>
                <textarea id="replyContent" rows="8" class="w-full rounded-lg border-gray-300 font-sans focus:ring-blue-500 focus:border-blue-500 p-3">${templateContent}</textarea>
            </div>
        </div>
        
        <div class="flex gap-3 justify-end pt-6 mt-4 border-t border-gray-100">
             <button onclick="viewInterviewDetails('${appId}')" class="px-5 py-2.5 bg-white border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors">
                Cancel
            </button>
             <button id="sendReplyBtn" onclick="sendEmailReply('${appId}')" class="px-5 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 shadow-lg shadow-blue-600/20 transition-all transform hover:-translate-y-0.5 flex items-center gap-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
                Send Email
            </button>
        </div>
    `;
}

window.viewInterviewDetails = viewInterviewDetails;
window.closeInterviewModal = closeInterviewModal;
window.sendEmailReply = sendEmailReply;
window.showConfirmationCompose = showConfirmationCompose;
