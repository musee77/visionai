class GmailConnect {
    constructor(config) {
        this.containerId = config.containerId;
        this.container = document.getElementById(this.containerId);
        this.apiUrl = config.apiUrl || `${CONFIG.API_BASE_URL}`; // CONFIG global assumed
        this.onConnect = config.onConnect || (() => { });
    }

    init() {
        if (!this.container) {
            console.error(`GmailConnect: Container #${this.containerId} not found`);
            return;
        }
        this.renderSkeleton();
        this.checkStatus();
    }

    async checkStatus() {
        try {
            // Use existing user info if available, or fetch
            let user = CVision.Utils.getUser();
            if (!user) {
                const response = await CVision.API.getProfile();
                if (response.success) {
                    user = response.data.user;
                    CVision.Utils.setUser(user);
                }
            }

            if (user && user.gmail_connected) {
                this.renderConnected(user);
            } else {
                this.renderConnect();
            }
        } catch (error) {
            console.error('GmailConnect: Error checking status', error);
            this.renderConnect(); // Fallback
        }
    }

    renderSkeleton() {
        this.container.innerHTML = `
            <div id="gmailAlertSkeleton" class="bg-gray-50 border-l-4 border-gray-200 p-4 mb-4 rounded-r shadow-sm animate-pulse">
                <div class="flex flex-col sm:flex-row items-center gap-4">
                    <div class="flex items-center w-full sm:flex-1">
                        <div class="flex-shrink-0 w-5 h-5 bg-gray-200 rounded-full"></div>
                        <div class="ml-3 w-full">
                            <div class="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
                            <div class="h-3 bg-gray-200 rounded w-1/4"></div>
                        </div>
                    </div>
                    <div class="flex items-center justify-end gap-3 w-full sm:w-auto mt-3 sm:mt-0">
                        <div class="h-8 w-24 bg-gray-200 rounded"></div>
                        <div class="h-[30px] w-[140px] bg-gray-200 rounded-full"></div>
                    </div>
                </div>
            </div>
        `;
    }

    renderConnect() {
        this.container.innerHTML = `
            <div id="connectGmailAlert" class="bg-white border border-gray-200 p-4 sm:p-6 mb-6 rounded-xl shadow-sm">
                <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div class="flex items-center gap-4">
                        <div class="flex-shrink-0 w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                            <svg class="h-6 w-6 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                                <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                            </svg>
                        </div>
                        <div>
                            <h3 class="text-base font-semibold text-gray-900">Connect Gmail for Auto-Apply</h3>
                            <p class="text-sm text-gray-500 mt-1">Enable the Email Agent to automatically submit applications via your email.</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <button id="btnConnectGmail" class="btn-gradient text-white px-6 py-2.5 rounded-lg font-medium shadow-sm hover:shadow transition-all flex items-center gap-2">
                             <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clip-rule="evenodd" />
                            </svg>
                            <span id="gmailConnectLabel">Connect Gmail</span>
                        </button>
                    </div>
                </div>
            </div>
        `;

        const connectBtn = this.container.querySelector('#btnConnectGmail');
        connectBtn.addEventListener('click', () => this.connect());
    }

    renderConnected(user) {
        this.container.innerHTML = `
            <div id="gmailConnectedAlert" class="bg-white border border-gray-200 p-4 sm:p-6 mb-6 rounded-xl shadow-sm">
                <div class="flex flex-col xl:flex-row items-center justify-between gap-6">
                    <div class="flex items-center gap-4 w-full xl:w-auto">
                        <div class="flex-shrink-0 w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center relative">
                            <svg class="h-6 w-6 text-green-600" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                            </svg>
                            <span class="absolute -top-1 -right-1 flex h-3 w-3">
                              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                              <span class="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                            </span>
                        </div>
                        <div>
                            <div class="flex items-center gap-2">
                                <h3 class="text-base font-semibold text-gray-900">Email Agent Active</h3>
                                <span class="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-bold uppercase tracking-wide">Live</span>
                            </div>
                            <p class="text-sm text-gray-500 mt-1">Tracking applications for <span class="font-medium text-gray-900">${user.email}</span></p>
                        </div>
                    </div>
                    
                    <div class="flex flex-wrap items-center justify-end gap-4 w-full xl:w-auto">
                        <div id="dashboardAutoApplyContainer" class="flex items-center justify-end" style="min-height: 40px;">
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Initialize AutoApplyButton
        if (typeof AutoApplyButton !== 'undefined') {
            const autoApplyBtn = new AutoApplyButton({
                containerId: 'dashboardAutoApplyContainer',
                textColor: 'text-gray-800',
                label: '',
                onToggle: (isEnabled) => {
                    // Could bubble this up if needed
                }
            });
            autoApplyBtn.init();
        }
    }

    async connect() {
        try {
            const response = await fetch(`${this.apiUrl}/api/v1/auth/gmail/connect`, {
                headers: {
                    'Authorization': `Bearer ${CVision.Utils.getToken()}`
                }
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.detail || errorData.message || 'Failed to initiate connection');
            }

            const data = await response.json();
            if (data.success && data.data.auth_url) {
                window.location.href = data.data.auth_url;
            }
        } catch (error) {
            console.error('Gmail connect error:', error);
            CVision.Utils.showAlert(error.message || 'Failed to connect Gmail', 'error');
        }
    }
}
