/**
 * BrowserAutomationManager.js
 * 
 * Reusable component for handling Playwright-based browser automation.
 * Manages:
 * - Session initiation
 * - Real-time status polling
 * - User-facing log messages
 * - Error handling and recovery
 */
class BrowserAutomationManager {
    constructor() {
        this.activeSessions = new Map();
        this.pollIntervals = new Map();
    }

    get API_BASE_URL() {
        return `${window.CONFIG?.API_BASE_URL || ''}${window.CONFIG?.API_PREFIX || '/api/v1'}`;
    }

    /**
     * Start browser automation for a job application
     * @param {string} jobId - The ID of the job to apply for
     * @param {string} cvId - The ID of the CV to use
     * @param {string} coverLetterId - Optional cover letter ID
     */
    async startAutofill(jobId, cvId, coverLetterId = null) {
        console.group(`🤖 [Browser Automation] Starting for Job: ${jobId}`);
        console.log('Selected CV:', cvId);
        console.log('Selected CL:', coverLetterId);

        try {
            const token = CVision.Utils.getToken();
            if (!token) throw new Error('Authentication required.');

            // Notify user
            window.AutomationUI?.show();
            window.AutomationUI?.updateStatus('Active', 'Initiating automated application...', 5);

            const url = `${this.API_BASE_URL}/browser-automation/autofill/start`;
            const payload = {
                job_id: jobId,
                cv_id: cvId,
                cover_letter_id: coverLetterId
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (!response.ok) {
                console.error('❌ Initiation failed:', data);
                throw new Error(data.detail || 'Failed to start automation');
            }

            console.log('✅ Application held for review. Session ID:', data.session_id);

            window.AutomationUI?.updateStatus(
                'Review',
                data.message || 'Application is ready for review. Open Applications and choose In Review to send it.',
                100
            );

            console.groupEnd();
            return data;

        } catch (error) {
            console.error('💥 [Browser Automation] Error:', error);
            window.AutomationUI?.updateStatus('Error', error.message, 100);
            console.groupEnd();
            throw error;
        }
    }

    /**
     * Poll the backend for automation status
     * @param {string} sessionId 
     */
    pollStatus(sessionId) {
        if (this.pollIntervals.has(sessionId)) return;

        console.log(`📡 [Browser Automation] Polling started for session: ${sessionId}`);

        const intervalId = setInterval(async () => {
            try {
                const token = CVision.Utils.getToken();
                const url = `${this.API_BASE_URL}/browser-automation/autofill/status/${sessionId}`;

                const response = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!response.ok) throw new Error('Status check failed');

                const statusData = await response.json();
                this._handleStatusUpdate(sessionId, statusData);

            } catch (error) {
                console.error(`📡 Polling error for ${sessionId}:`, error);
                window.AutomationUI?.updateStatus('Error', 'Connection lost or polling failed.', 100);
                this.stopPolling(sessionId);
            }
        }, 3000); // Poll every 3 seconds

        this.pollIntervals.set(sessionId, intervalId);
    }

    /**
     * Handle status updates and stop polling on completion/error
     */
    _handleStatusUpdate(sessionId, data) {
        const { status, filled_fields, error } = data;
        console.log(`📊 [Automation Status] ${sessionId}: ${status}`, data);

        // Map status to progress for the UI
        const statusMap = {
            'initializing': 10,
            'navigating': 30,
            'detecting_forms': 50,
            'filling_forms': 75,
            'login_required': 90,
            'completed': 100,
            'failed': 100,
            'error': 100
        };

        const progress = statusMap[status] || 0;

        // Update UI or provide feedback based on status
        if (status === 'navigating') {
            window.AutomationUI?.updateStatus('Active', 'Navigating to job page...', progress);
        } else if (status === 'filling_forms') {
            window.AutomationUI?.updateStatus('Active', `Filling forms (${filled_fields?.length || 0} fields)...`, progress);
        } else if (status === 'login_required') {
            window.AutomationUI?.updateStatus('Active', 'Manual login required on job board. Closing browser...', progress);
            // We keep polling here - index.js will eventually set status to 'error' after closing browser
        } else if (status === 'completed') {
            window.AutomationUI?.updateStatus('Success', 'Application Submitted', 100);
            this.stopPolling(sessionId);
        } else if (status === 'failed' || status === 'error') {
            window.AutomationUI?.updateStatus('Error', `Automation Error: ${error || 'Unknown error'}`, 100);
            this.stopPolling(sessionId);
        } else {
            // Default update for other states
            window.AutomationUI?.updateStatus('Active', `System: ${status.replace('_', ' ')}...`, progress);
        }
    }

    stopPolling(sessionId) {
        const intervalId = this.pollIntervals.get(sessionId);
        if (intervalId) {
            clearInterval(intervalId);
            this.pollIntervals.delete(sessionId);
            console.log(`🛑 [Browser Automation] Polling stopped for ${sessionId}`);
        }
    }
}

// Global initialization
window.BrowserAutomation = new BrowserAutomationManager();
