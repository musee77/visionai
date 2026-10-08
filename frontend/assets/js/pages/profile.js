// Use CONFIG.API_BASE_URL and CONFIG.API_PREFIX for all API calls

document.addEventListener('DOMContentLoaded', function () {
    if (!CVision.Utils.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    initializeProfile();
});

async function initializeProfile() {
    await loadUserProfile();
    await loadRecentGenerations();
    setupForms();
    await checkAndPopulateLocation();
}

async function checkAndPopulateLocation() {
    try {
        // Get current profile
        const response = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.API_PREFIX}/users/me/profile`, {
            headers: {
                'Authorization': `Bearer ${CVision.Utils.getToken()}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) return;
        const profile = await response.json();

        // Check if country is set
        if (!profile.location_preferences?.country?.code) {
            console.log('[PROFILE] Location preferences missing, detecting...');

            // Detect location
            const geoData = await CVision.Geolocation.detect();

            if (geoData.detected) {
                const countryObj = {
                    code: geoData.countryCode,
                    name: geoData.countryName,
                    currency: geoData.currency
                };

                // Construct city string
                let cityStr = geoData.city || '';
                if (geoData.region && geoData.city !== geoData.region) {
                    cityStr += cityStr ? `, ${geoData.region}` : geoData.region;
                }

                // Update UI immediately
                document.getElementById('country').value = `${countryObj.name} (${countryObj.code})`;
                if (cityStr) document.getElementById('cityState').value = cityStr;

                // Prepare update with ALL existing profile data to avoid overwriting
                const updateData = {
                    ...profile,
                    location_preferences: {
                        ...(profile.location_preferences || {}),
                        country: countryObj,
                        city: cityStr // Save auto-detected city
                    }
                };

                console.log('[PROFILE] Saving detected location:', countryObj);

                await fetch(`${CONFIG.API_BASE_URL}${CONFIG.API_PREFIX}/users/me/profile`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${CVision.Utils.getToken()}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(updateData)
                });

                console.log('[PROFILE] Location saved');
            } else {
                console.warn('[PROFILE] Geolocation detection failed');
                document.getElementById('country').value = 'Unknown Location';
                // Make editable if detection fails? Maybe just leave as Unknown for now.
            }
        }
    } catch (error) {
        console.warn('[PROFILE] Failed to populate location:', error);
    }
}

async function loadUserProfile() {
    try {
        // Get user info from /users/me
        const response = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.API_PREFIX}/users/me`, {
            headers: {
                'Authorization': `Bearer ${CVision.Utils.getToken()}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load profile');
        }

        const user = await response.json();
        console.log('[DEBUG] User data:', user);

        // Update profile display
        document.getElementById('userName').textContent = user.full_name || user.email.split('@')[0];
        document.getElementById('userEmail').textContent = user.email;
        document.getElementById('userInitial').textContent = (user.full_name || user.email)[0].toUpperCase();
        document.getElementById('subscriptionBadge').textContent =
            user.subscription_tier.charAt(0).toUpperCase() + user.subscription_tier.slice(1);

        // Update basic form fields
        document.getElementById('email').value = user.email;
        document.getElementById('fullName').value = user.full_name || '';

        // Get detailed profile if available
        try {
            const profileResponse = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.API_PREFIX}/users/me/profile`, {
                headers: {
                    'Authorization': `Bearer ${CVision.Utils.getToken()}`,
                    'Content-Type': 'application/json'
                }
            });

            if (profileResponse.ok) {
                const profile = await profileResponse.json();
                console.log('[DEBUG] Profile data:', profile);

                // Update profile fields
                const personalInfo = profile.personal_info || {};
                const locPrefs = profile.location_preferences || {};

                document.getElementById('phone').value = personalInfo.phone || '';

                // Handle split location fields
                document.getElementById('cityState').value = locPrefs.city || personalInfo.location || '';

                // Handle Country Object (Supports both new Object and legacy String)
                if (locPrefs.country) {
                    if (typeof locPrefs.country === 'string') {
                        // Legacy string format
                        document.getElementById('country').value = locPrefs.country;
                    } else if (locPrefs.country.name) {
                        document.getElementById('country').value = `${locPrefs.country.name} (${locPrefs.country.code})`;
                    } else {
                        document.getElementById('country').value = 'Not Set';
                    }
                } else {
                    document.getElementById('country').value = 'Detecting...';
                }

                document.getElementById('linkedin').value = personalInfo.linkedin || '';
                document.getElementById('streetAddress').value = personalInfo.address || '';
            } else {
                console.warn('Detailed profile not available (this is OK)');
            }
        } catch (profileError) {
            console.warn('Could not load detailed profile (this is OK):', profileError);
        }

        await loadPlanDetails((user.subscription_tier || 'free').toLowerCase());
        updateProfileJourney(user);

        // Load preferences
        try {
            const prefsResponse = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.API_PREFIX}/users/me/preferences`, {
                headers: {
                    'Authorization': `Bearer ${CVision.Utils.getToken()}`,
                    'Content-Type': 'application/json'
                }
            });

            if (prefsResponse.ok) {
                const preferences = await prefsResponse.json();
                console.log('[DEBUG] Preferences:', preferences);

                document.getElementById('defaultTemplate').value = preferences.default_template || 'professional';
                document.getElementById('defaultTone').value = preferences.default_tone || 'professional';
                document.getElementById('autoGenerateCover').checked = preferences.auto_generate_cover || false;
                document.getElementById('notifyGeneration').checked = preferences.notify_generation || false;
                const jobMatches = document.getElementById('emailJobMatches');
                const appUpdates = document.getElementById('emailApplications');
                const weekly = document.getElementById('emailWeekly');
                if (jobMatches) jobMatches.checked = preferences.job_alerts !== false;
                if (appUpdates) appUpdates.checked = preferences.application_reminders !== false;
                if (weekly) weekly.checked = preferences.weekly_reports !== false;
            }
        } catch (prefsError) {
            console.warn('Could not load preferences:', prefsError);
        }

    } catch (error) {
        console.error('Error loading profile:', error);
        CVision.Utils.showAlert('Failed to load profile', 'error');
    }
}

function formatPlanPrice(cents, interval) {
    const amount = (Number(cents) || 0) / 100;
    const price = `$${amount.toFixed(2)}`;
    if (!cents) return `${price}`;
    if (interval === 'yearly') return `${price}/year`;
    if (interval === 'one_time') return `${price} one time`;
    return `${price}/month`;
}

function formatQuota(used, limit) {
    const count = Number(used) || 0;
    if (limit === undefined || limit === null) return String(count);
    if (Number(limit) === 0) return 'Not included';
    if (Number(limit) >= 9999) return `${count} · unlimited`;
    return `${count} of ${limit}`;
}

function quotaWidth(used, limit) {
    const count = Number(used) || 0;
    const cap = Number(limit);
    if (!cap || cap >= 9999) return count > 0 ? '100%' : '0%';
    return `${Math.min(100, Math.round((count / cap) * 100))}%`;
}

async function loadPlanDetails(tier) {
    const fallback = {
        free: { plan: 'Free', price_cents: 0, billing_interval: 'monthly', limits: { manual_applications: 3, auto_applications: 0 }, current_usage: {} },
        basic: { plan: 'Basic', price_cents: 499, billing_interval: 'monthly', limits: { manual_applications: 999999, auto_applications: 0 }, current_usage: {} },
        premium: { plan: 'Premium', price_cents: 4999, billing_interval: 'monthly', limits: { manual_applications: 9999, auto_applications: 9999 }, current_usage: {} }
    };
    let data = fallback[tier] || fallback.free;
    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.API_PREFIX}/subscriptions/usage`, {
            headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
        });
        if (response.ok) data = await response.json();
    } catch (error) {
        console.warn('Could not load plan usage:', error);
    }

    const limits = data.limits || {};
    const usage = data.current_usage || {};
    const manualText = formatQuota(usage.manual_applications, limits.manual_applications);
    const bonusLeft = Number(limits.referral_bonus_auto_applications) || 0;
    let autoText = formatQuota(usage.auto_applications, limits.auto_applications);
    if (bonusLeft > 0 && Number(limits.auto_applications) < 9999) {
        autoText = Number(limits.auto_applications) > 0
            ? `${autoText} · ${bonusLeft} referral left`
            : `${bonusLeft} referral application${bonusLeft === 1 ? '' : 's'} left`;
    }

    const price = document.getElementById('planPrice');
    if (price) price.textContent = formatPlanPrice(data.price_cents, data.billing_interval);
    const badge = document.getElementById('subscriptionBadge');
    if (badge && data.plan) badge.textContent = data.plan;
    const manual = document.getElementById('manualUsage');
    const manualBar = document.getElementById('manualBar');
    const auto = document.getElementById('autoUsage');
    if (manual) manual.textContent = manualText;
    if (manualBar) manualBar.style.width = quotaWidth(usage.manual_applications, limits.manual_applications);
    if (auto) auto.textContent = autoText;

    const upgrade = document.getElementById('upgradeAccountBtn');
    const planId = String(data.plan_id || data.tier || tier || '');
    if (upgrade) upgrade.textContent = planId.includes('premium') ? 'View plan' : 'Upgrade plan';
}

async function loadRecentGenerations() {
    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.API_PREFIX}/generation/history?page=1&size=5`, {
            headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
        });
        if (!response.ok) return;
        const history = await response.json();
        if (history && history.documents && history.documents.length > 0) {
            displayRecentGenerations(history.documents.slice(0, 5));
        }
    } catch (error) {
        console.error('Error loading generations:', error);
    }
}

function displayRecentGenerations(generations) {
    const container = document.getElementById('recentGenerations');

    if (generations.length === 0) return;

    container.innerHTML = generations.map(gen => `
        <div class="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
            <div class="flex items-center justify-between">
                <div class="flex items-center space-x-3">
                    <div class="text-2xl">${gen.type === 'customized_cv' ? '📄' : '✉️'}</div>
                    <div>
                        <h4 class="text-sm font-medium text-gray-900">${gen.job_title || 'Unknown Job'}</h4>
                        <p class="text-xs text-gray-500">${formatDate(gen.generated_at)}</p>
                    </div>
                </div>
                <a href="./documents.html" class="px-3 py-1 text-xs font-medium text-primary-600 bg-primary-100 hover:bg-primary-200 rounded-md transition-colors">Open</a>
            </div>
        </div>
    `).join('');
}

function updateProfileJourney(user) {
    const countryValue = (document.getElementById('country')?.value || '').trim();
    const countryReady = countryValue && countryValue !== 'Not Set' && countryValue !== 'Detecting...';
    const fullName = (document.getElementById('fullName')?.value || user.full_name || '').trim();
    const fields = [
        { label: 'Name', done: fullName.split(/\s+/).filter(Boolean).length >= 2 },
        { label: 'Email', done: !!(document.getElementById('email')?.value || user.email || '').trim() },
        { label: 'Phone', done: !!(document.getElementById('phone')?.value || '').trim() },
        { label: 'Location', done: !!(document.getElementById('cityState')?.value || '').trim() },
        { label: 'Country', done: countryReady },
        { label: 'LinkedIn', done: !!(document.getElementById('linkedin')?.value || '').trim() },
        { label: 'Address', done: !!(document.getElementById('streetAddress')?.value || '').trim(), optional: true },
    ];
    const requiredFields = fields.filter((field) => !field.optional);
    const doneCount = requiredFields.filter((field) => field.done).length;
    const bar = document.getElementById('profileProgressBar');
    if (bar) bar.style.width = `${Math.round((doneCount / requiredFields.length) * 100)}%`;
    const progressText = document.getElementById('profileProgressText');
    if (progressText) progressText.textContent = `${doneCount} / ${requiredFields.length} fields`;
    const doneLabel = document.getElementById('profileFieldsDone');
    if (doneLabel) doneLabel.textContent = String(doneCount);
    const left = document.getElementById('profileFieldsLeft');
    if (left) left.textContent = String(requiredFields.length - doneCount);
    const status = document.getElementById('profileJourneyStatus');
    if (status) status.textContent = doneCount === requiredFields.length ? 'Ready' : 'Not yet';
    const note = document.getElementById('profileCompleteNote');
    if (note) note.classList.toggle('hidden', doneCount !== requiredFields.length);
    const markers = document.getElementById('profileFieldMarkers');
    if (markers) {
        markers.innerHTML = fields.map((field) => `
            <span class="flex flex-col items-center gap-1 ${field.done ? 'text-purple-600 font-semibold' : ''}">
                <span class="w-4 h-4 rounded-full border-2 border-white shadow ${field.done ? 'bg-gradient-to-r from-purple-500 to-blue-500' : 'bg-gray-300'}"></span>
                ${field.label}
                ${field.optional ? '<span class="font-normal text-gray-400">optional</span>' : ''}
            </span>
        `).join('');
    }
}

function setupForms() {
    // SECTION 1: Personal Information Form (Name + Contact Info)
    document.getElementById('personalInfoForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const fullName = document.getElementById('fullName').value;
        const phone = document.getElementById('phone').value;
        const cityState = document.getElementById('cityState').value;
        const linkedin = document.getElementById('linkedin').value;
        const address = document.getElementById('streetAddress').value;

        console.log('[PERSONAL INFO] Saving:', { fullName, phone, cityState, linkedin });

        try {
            // Step 1: Update full_name using existing PUT /me endpoint
            if (fullName) {
                console.log('[PERSONAL INFO] Step 1: Updating name via PUT /me');
                const nameResponse = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.API_PREFIX}/users/me`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${CVision.Utils.getToken()}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        full_name: fullName
                    })
                });

                if (!nameResponse.ok) {
                    const error = await nameResponse.json();
                    console.error('[PERSONAL INFO] Name update error:', error);
                    throw new Error(error.detail || 'Failed to update name');
                }
                console.log('[PERSONAL INFO] ✓ Name updated');
            }

            // Step 2: Update contact info - get current user data first
            if (phone || cityState || linkedin || address) {
                console.log('[PERSONAL INFO] Step 2: Getting current profile data');

                // Get current profile to preserve existing data
                const currentProfileResponse = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.API_PREFIX}/users/me/profile`, {
                    headers: {
                        'Authorization': `Bearer ${CVision.Utils.getToken()}`,
                        'Content-Type': 'application/json'
                    }
                });

                let existingProfile = {};
                if (currentProfileResponse.ok) {
                    existingProfile = await currentProfileResponse.json();
                    console.log('[PERSONAL INFO] Current profile:', existingProfile);
                }

                // Get current user for first_name and last_name
                const userResponse = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.API_PREFIX}/users/me`, {
                    headers: {
                        'Authorization': `Bearer ${CVision.Utils.getToken()}`,
                        'Content-Type': 'application/json'
                    }
                });

                let userData = {};
                if (userResponse.ok) {
                    userData = await userResponse.json();
                }

                console.log('[PERSONAL INFO] Step 3: Updating contact info via PUT /me/profile');

                // Merge with existing profile data and include required fields
                // IMPORTANT: We must preserve other profile fields like location_preferences
                const profileData = {
                    ...existingProfile, // Preserve all existing fields

                    // Update Personal Info
                    personal_info: {
                        ...existingProfile.personal_info,
                        first_name: userData.first_name || '',
                        last_name: userData.last_name || '',
                        phone: phone || existingProfile.personal_info?.phone || '',
                        address: address || '',
                        location: cityState || existingProfile.personal_info?.location || '', // Legacy support
                        linkedin: linkedin || existingProfile.personal_info?.linkedin || ''
                    },

                    // Update Location Preferences (preserve country)
                    location_preferences: {
                        ...(existingProfile.location_preferences || {}),
                        city: cityState, // Extract city/state
                        country: existingProfile.location_preferences?.country // KEEP EXISTING COUNTRY
                    }
                };

                console.log('[PERSONAL INFO] Sending profile data:', profileData);

                const profileResponse = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.API_PREFIX}/users/me/profile`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${CVision.Utils.getToken()}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(profileData)
                });

                if (!profileResponse.ok) {
                    const error = await profileResponse.json();
                    console.error('[PERSONAL INFO] Profile update error:', error);
                    console.error('[PERSONAL INFO] Error details:', JSON.stringify(error, null, 2));

                    // Parse validation errors if they exist
                    if (Array.isArray(error.detail)) {
                        const errorMessages = error.detail.map(err =>
                            `${err.loc ? err.loc.join('.') : 'unknown'}: ${err.msg}`
                        ).join(', ');
                        throw new Error(errorMessages);
                    }

                    throw new Error(error.detail || 'Failed to update contact information');
                }
                console.log('[PERSONAL INFO] ✓ Contact info updated');
            }

            console.log('[PERSONAL INFO] ✓ All fields saved successfully');
            CVision.Utils.showAlert('Personal information updated successfully', 'success');
            updateProfileJourney(CVision.Utils.getUser() || {});

            // Refresh navbar to show updated name
            if (window.CVisionNavbar && window.CVisionNavbar.refreshUserInfo) {
                await window.CVisionNavbar.refreshUserInfo();
            }

        } catch (error) {
            console.error('[PERSONAL INFO] Error:', error);
            CVision.Utils.showAlert(error.message || 'Failed to update personal information', 'error');
        }
    });

    // SECTION 2: Generation Preferences Form
    document.getElementById('generationPrefsForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const preferencesData = {
            default_template: document.getElementById('defaultTemplate').value,
            default_tone: document.getElementById('defaultTone').value,
            auto_generate_cover: document.getElementById('autoGenerateCover').checked,
            notify_generation: document.getElementById('notifyGeneration').checked
        };

        console.log('[PREFERENCES] Saving:', preferencesData);

        try {
            const response = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.API_PREFIX}/users/me/preferences`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${CVision.Utils.getToken()}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(preferencesData)
            });

            if (!response.ok) {
                const error = await response.json();
                console.error('[PREFERENCES] Error:', error);
                throw new Error(error.detail || 'Failed to save preferences');
            }

            console.log('[PREFERENCES] ✓ Successfully saved');
            CVision.Utils.showAlert('Preferences saved successfully', 'success');

        } catch (error) {
            console.error('[PREFERENCES] Error:', error);
            CVision.Utils.showAlert(error.message || 'Failed to save preferences', 'error');
        }
    });

    document.getElementById('saveEmailNotifications')?.addEventListener('click', async () => {
        const preferencesData = {
            job_alerts: document.getElementById('emailJobMatches').checked,
            application_reminders: document.getElementById('emailApplications').checked,
            weekly_reports: document.getElementById('emailWeekly').checked
        };
        try {
            const response = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.API_PREFIX}/users/me/preferences`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${CVision.Utils.getToken()}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(preferencesData)
            });
            if (!response.ok) throw new Error('Failed to save notifications');
            CVision.Utils.showAlert('Notification settings saved', 'success');
        } catch (error) {
            CVision.Utils.showAlert(error.message || 'Failed to save notifications', 'error');
        }
    });
}

// Change Password Modal Logic
// Change Password Modal Logic
console.log('[Profile] Script loaded');

// Load Change Password Component
document.addEventListener('DOMContentLoaded', async function () {
    console.log('[Profile] DOM Content Loaded');

    // Event Delegation for "Update Password" button
    document.body.addEventListener('click', function (e) {
        if (e.target && (e.target.id === 'openChangePasswordBtn' || e.target.closest('#openChangePasswordBtn'))) {
            console.log('[Profile] Update Password button clicked');

            if (window.ChangePasswordModal) {
                console.log('[Profile] Opening Modal');
                ChangePasswordModal.open();
            } else {
                console.error('[Profile] ChangePasswordModal not defined');
                CVision.Utils.showAlert('Component not loaded yet, please wait...', 'info');
                // Try force reload of component if missing?
            }
        }
    });

    try {
        // Load Change Password Modal
        const pwResponse = await fetch('../components/change-password-modal.html');
        if (pwResponse.ok) {
            const html = await pwResponse.text();
            let container = document.getElementById('change-password-modal-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'change-password-modal-container';
                document.body.appendChild(container);
            }
            container.innerHTML = html;
            if (window.ChangePasswordModal) ChangePasswordModal.init();
        }

        // Load Delete Account Modal
        const delResponse = await fetch('../components/delete-account-modal.html');
        if (delResponse.ok) {
            const html = await delResponse.text();
            let container = document.getElementById('delete-account-modal-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'delete-account-modal-container';
                document.body.appendChild(container);
            }
            container.innerHTML = html;
            if (window.DeleteAccountModal) DeleteAccountModal.init();
        }
    } catch (e) {
        console.error('Failed to load modals:', e);
    }
});

function deleteAccount() {
    if (window.DeleteAccountModal) {
        DeleteAccountModal.open();
    } else {
        CVision.Utils.showAlert('Component loading...', 'info');
    }
}

function upgradeAccount() {
    window.location.href = './subscription.html';
}

function logout() {
    CVision.Utils.logout();
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;

    return date.toLocaleDateString();
}
