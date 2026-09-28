// frontend/assets/js/subscriptions.js
const API_BASE_URL = `${CONFIG.API_BASE_URL}`;
let PAYSTACK_PUBLIC_KEY = null;
let USER_EMAIL = null;

let selectedPlan = null;
let currentSubscription = null;
let allPlans = [];  // Store all plans for filtering
let currentBillingInterval = 'monthly';  // 'monthly' or 'yearly'

// Currency formatting helper - uses CVision.Currency if available
function formatPrice(amountInCents) {
    if (window.CVision && window.CVision.Currency) {
        return CVision.Currency.format(amountInCents);
    }
    // Fallback to basic USD formatting
    return `$${(amountInCents / 100).toLocaleString()}`;
}

// Get user's detected currency
function getUserCurrency() {
    if (window.CVision && window.CVision.Currency) {
        return CVision.Currency.getUserCurrency();
    }
    return 'USD';
}

// Format price in base currency (KES)
function formatBasePrice(amountInCents) {
    if (window.CVision && window.CVision.Currency) {
        return CVision.Currency.formatBase(amountInCents);
    }
    return `$${(amountInCents / 100).toLocaleString()}`;
}

// Load payment gateway configuration from backend
async function loadPaymentConfig() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/subscriptions/config`);
        if (response.ok) {
            const config = await response.json();

            // Set globals
            PAYSTACK_PUBLIC_KEY = config.paystack?.public_key;
            USER_EMAIL = config.user_email;

            if (window.CVision && window.CVision.Payment) {
                // Initialize Paystack
                if (PAYSTACK_PUBLIC_KEY) {
                    await CVision.Payment.init('paystack', { publicKey: PAYSTACK_PUBLIC_KEY });
                }

                // Other providers (Stripe, IntaSend, PayPal) are disabled to enforce Paystack


            }
        } else {
        }
    } catch (error) {
    }
}

// Helper function to handle API errors
async function handleApiError(response) {
    if (response.status === 401) {
        CVision.Utils.showAlert('Session expired. Please login again.', 'error');
        setTimeout(() => {
            window.location.href = '/login';
        }, 2000);
        return null;
    }

    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'An error occurred' }));
        throw new Error(error.detail || 'Request failed');
    }

    return response;
}

// Helper function to make authenticated requests
async function authenticatedFetch(url, options = {}) {
    const token = CVision.Utils.getToken();

    if (!token) {
        window.location.href = '/login';
        return null;
    }

    const headers = {
        'Authorization': `Bearer ${token}`,
        ...options.headers
    };

    const response = await fetch(url, { ...options, headers });
    return handleApiError(response);
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!CVision.Utils.isAuthenticated()) {
        window.location.href = '/login';
        return;
    }

    // Initialize currency from user's geolocation (uses CVision.Geolocation + CVision.Currency)
    if (window.CVision && window.CVision.Currency) {
        await CVision.Currency.initFromGeolocation();
    }

    // Load payment gateway config
    await loadPaymentConfig();

    // Get user email from profile if not in config
    if (!USER_EMAIL) {
        try {
            const user = CVision.Utils.getUser();
            if (user) USER_EMAIL = user.email;
        } catch (e) { }
    }

    // Load data
    await Promise.all([
        loadCurrentSubscription(),
        loadPlans(false),
        loadReferralStats()
    ]).catch(error => {
    });

    // Initialize PricingPlans component in authenticated mode
    initPricingComponent();
});

async function loadCurrentSubscription() {
    try {
        const response = await authenticatedFetch(`${API_BASE_URL}/api/v1/subscriptions/me`);

        if (!response) return;


        if (response.ok) {
            currentSubscription = await response.json();
            displayCurrentPlan(currentSubscription);
            await loadUsageStats();
        } else if (response.status === 404) {
            showFreePlanStats();
        }
    } catch (error) {
        if (error.message.includes('No subscription found') || error.message.includes('404')) {
            showFreePlanStats();
            return;
        }
        CVision.Utils.showAlert('Failed to load subscription information', 'warning');
    }
}

function showFreePlanStats() {
    document.getElementById('currentTierName').textContent = 'Free';
    document.getElementById('currentTierStatus').textContent = 'Status: Active · $0';
    renderUsageStats({ manual_applications: 0, auto_applications: 0 }, {
        manual_applications: 3,
        auto_applications: 0
    });
}

function formatQuota(used, limit) {
    const count = Number(used) || 0;
    if (limit === undefined || limit === null) return String(count);
    if (Number(limit) === 0) return 'Not included';
    if (Number(limit) >= 9999) return `${count} · unlimited`;
    return `${count} of ${limit}`;
}

function renderUsageStats(usage, limits) {
    const box = document.getElementById('currentUsage');
    if (!box) return;
    const source = usage || {};
    const allowance = limits || {};
    const manual = formatQuota(source.manual_applications, allowance.manual_applications);
    const bonusLeft = Number(allowance.referral_bonus_auto_applications) || 0;
    let automated = formatQuota(source.auto_applications, allowance.auto_applications);
    if (bonusLeft > 0 && Number(allowance.auto_applications) < 9999) {
        automated = Number(allowance.auto_applications) > 0
            ? `${automated} · ${bonusLeft} referral left`
            : `${bonusLeft} referral application${bonusLeft === 1 ? '' : 's'} left`;
    }
    box.innerHTML = `
        <div class="text-base font-semibold text-gray-900">${manual} manual</div>
        <div class="text-sm font-medium text-gray-500">${automated} automated</div>
    `;
}

function billingSummary(priceCents, interval) {
    const price = formatPrice(priceCents || 0);
    if (!priceCents) return `${price}`;
    if (interval === 'one_time') return `${price} one time`;
    if (interval === 'yearly') return `${price}/year`;
    return `${price}/month`;
}

function displayCurrentPlan(subscription) {
    const tierName = (subscription.plan_id || 'plan_free').replace('plan_', '').replace(/_/g, ' ');
    document.getElementById('currentTierName').textContent = tierName.charAt(0).toUpperCase() + tierName.slice(1);

    let statusText = `Status: ${subscription.status}`;
    if (subscription.cancel_at_period_end) {
        const endDate = new Date(subscription.current_period_end).toLocaleDateString();
        statusText = `Status: Active (Cancels on ${endDate})`;
        document.getElementById('currentTierStatus').classList.add('text-orange-600');
    } else {
        document.getElementById('currentTierStatus').classList.remove('text-orange-600');
    }
    document.getElementById('currentTierStatus').textContent = statusText;

    // Show/hide buttons based on plan tier
    const isFree = subscription.plan_id === 'plan_free';
    const isBasic = subscription.plan_id === 'plan_basic';
    const isPremium = subscription.plan_id === 'plan_premium';
    const isCancelled = subscription.cancel_at_period_end;

    // Get buttons
    const manageBtn = document.getElementById('manageBillingBtn');
    const cancelBtn = document.getElementById('cancelSubscriptionBtn');
    const upgradeBtn = document.getElementById('upgradeBtn');

    if (isFree) {
        // Free tier: Show upgrade button only
        if (manageBtn) manageBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'none';
        if (upgradeBtn) upgradeBtn.style.display = 'inline-block';
    } else {
        // Paid tiers: Show manage and cancel buttons
        // Hide Manage Billing for Paystack as there isn't a direct portal
        if (manageBtn) manageBtn.style.display = 'none';

        // Hide cancel button if already scheduled to cancel
        if (cancelBtn) {
            cancelBtn.style.display = isCancelled ? 'none' : 'inline-block';
        }

        // Show upgrade only if not on premium
        if (upgradeBtn) {
            // Can user upgrade if pending cancellation? Yes, probably creates new sub or upgrades existing.
            // Let's allow it, but usually you might want to reactivate.
            upgradeBtn.style.display = isPremium ? 'none' : 'inline-block';
        }

        // If cancelled, maybe show a "Reactivate" button? (Not requested yet, keep simple)
        if (isCancelled && upgradeBtn) {
            upgradeBtn.textContent = 'Reactivate / Upgrade';
        }
    }
}

function showUpgradeOptions() {
    // Scroll to pricing plans
    const plansSection = document.getElementById('pricingPlans');
    if (plansSection) {
        plansSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Add a highlight effect
        plansSection.classList.add('ring-2', 'ring-blue-500', 'ring-offset-4');
        setTimeout(() => {
            plansSection.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-4');
        }, 2000);
    }
}

async function loadUsageStats() {
    try {
        const response = await authenticatedFetch(`${API_BASE_URL}/api/v1/subscriptions/usage`);

        if (!response || !response.ok) return;

        const data = await response.json();
        if (data.plan) {
            document.getElementById('currentTierName').textContent = data.plan;
        }

        const statusEl = document.getElementById('currentTierStatus');
        if (statusEl && currentSubscription && !currentSubscription.cancel_at_period_end) {
            const status = data.status || currentSubscription.status || 'active';
            statusEl.textContent = `Status: ${status} · ${billingSummary(data.price_cents, data.billing_interval)}`;
        }

        renderUsageStats(data.current_usage, data.limits);

    } catch (error) {
        console.error('Failed to load usage:', error);
    }
}

async function loadPlans(render = true) {
    try {
        const currency = getUserCurrency();
        const response = await fetch(`${API_BASE_URL}/api/v1/subscriptions/plans?currency=${currency}`);

        if (!response.ok) throw new Error('Failed to load plans');

        allPlans = await response.json();
        if (render) displayFilteredPlans();
    } catch (error) {
        console.error('Failed to load plans:', error);
        CVision.Utils.showAlert('Failed to load subscription plans', 'error');
        displayFallbackPlans();
    }
}

// Initialize the reusable PricingPlans component
function initPricingComponent() {
    if (window.PricingPlans) {
        PricingPlans.init({
            mode: 'authenticated',
            container: '#pricing-plans-container',
            currentSubscription: currentSubscription,
            defaultInterval: currentBillingInterval,
            onSelectPlan: (plan) => {
                selectPlan(plan.id, plan.name, plan.price, plan.planCode);
            }
        });
    } else {
        console.error('[Subscriptions] PricingPlans component not loaded');
        displayFallbackPlans();
    }
}

function displayFilteredPlans() {
    // Use the PricingPlans component if available
    if (window.PricingPlans) {
        PricingPlans.setCurrentSubscription(currentSubscription);
    }
}

function setBillingInterval(interval) {
    currentBillingInterval = interval;

    // Delegate to PricingPlans component
    if (window.PricingPlans) {
        PricingPlans.setBillingInterval(interval);
    }
}

function displayFallbackPlans() {
    const container = document.getElementById('pricingPlans');
    container.innerHTML = `
        <div class="col-span-3 text-center p-8">
            <p class="text-gray-600 mb-4">Unable to load plans at this moment.</p>
            <button onclick="loadPlans()" class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                Retry
            </button>
        </div>
    `;
}

function displayPlans(plans) {
    const container = document.getElementById('pricingPlans');
    container.innerHTML = '';

    // Define tier hierarchy for comparison
    // Define tier hierarchy for comparison
    const tierOrder = { 'free': 0, 'basic': 1, 'premium': 2 };

    // Robust extraction of current tier from plan_id (handles _annual suffix)
    const currentTierRaw = currentSubscription ? currentSubscription.plan_id.replace('plan_', '') : 'free';
    let currentTier = 'free';
    if (currentTierRaw.includes('premium')) currentTier = 'premium';
    else if (currentTierRaw.includes('basic')) currentTier = 'basic';

    const currentTierOrder = tierOrder[currentTier] || 0;

    plans.forEach(plan => {
        const isCurrentPlan = currentSubscription &&
            currentSubscription.plan_id === plan.id;

        const planTierOrder = tierOrder[plan.tier] || 0;
        const isUpgrade = planTierOrder > currentTierOrder;
        const isDowngrade = planTierOrder < currentTierOrder;

        const card = document.createElement('div');
        card.className = `bg-white rounded-xl shadow-lg border-2 p-8 relative ${plan.is_popular ? 'border-blue-500' : 'border-gray-200'
            }`;

        if (plan.is_popular) {
            card.innerHTML += `
                <div class="absolute top-0 right-0 bg-blue-500 text-white px-4 py-1 rounded-bl-lg rounded-tr-lg text-sm font-semibold">
                    Most Popular
                </div>
            `;
        }

        // Pass plan code (paystack_plan_code) if available
        const planCode = plan.paystack_plan_code || '';

        // Determine what button/text to show
        let buttonHtml = '';
        if (isCurrentPlan) {
            buttonHtml = `
                <button class="w-full bg-green-100 text-green-700 rounded-lg px-6 py-3 font-semibold cursor-not-allowed border-2 border-green-300">
                    ✓ Current Plan
                </button>
            `;
        } else if (isDowngrade) {
            // Lower tier
            if (plan.tier === 'free') {
                // No button for Free plan as per request
                buttonHtml = '';
            } else {
                // Show Downgrade button for paid lower tiers
                buttonHtml = `
                    <button onclick="selectPlan('${plan.id}', '${plan.name}', ${plan.price.amount}, '${planCode}')" 
                        class="w-full bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 rounded-lg px-6 py-3 font-semibold hover:shadow transition-all">
                        Downgrade
                    </button>
                `;
            }
        } else if (isUpgrade) {
            // Higher tier - show Upgrade button
            buttonHtml = `
                <button onclick="selectPlan('${plan.id}', '${plan.name}', ${plan.price.amount}, '${planCode}')" 
                    class="w-full ${plan.is_popular ? 'btn-gradient text-white' : 'bg-blue-600 text-white hover:bg-blue-700'} 
                    rounded-lg px-6 py-3 font-semibold hover:shadow-lg transition-all">
                    Upgrade
                </button>
            `;
        } else {
            // Same tier but not current (e.g. Monthly -> Annual switch)
            if (plan.tier === 'free') {
                buttonHtml = '';
            } else {
                buttonHtml = `
                <button onclick="selectPlan('${plan.id}', '${plan.name}', ${plan.price.amount}, '${planCode}')" 
                    class="w-full bg-blue-600 text-white hover:bg-blue-700 rounded-lg px-6 py-3 font-semibold hover:shadow-lg transition-all">
                    Switch Plan
                </button>
            `;
            }
        }

        card.innerHTML += `
            <div class="text-center">
                <h3 class="text-2xl font-bold mb-2">${plan.name}</h3>
                <p class="text-gray-600 mb-6">${plan.description}</p>
                
                <div class="mb-6">
                    <span class="text-4xl font-bold">${formatPrice(plan.price.amount)}</span>
                    <span class="text-gray-600">/${plan.billing_interval === 'yearly' ? 'year' : 'month'}</span>
                    ${getUserCurrency() !== 'KES' ? `<div class="text-gray-500 text-sm mt-1">≈ ${formatBasePrice(plan.price.amount)}</div>` : ''}
                    ${plan.billing_interval === 'yearly' ? '<div class="text-green-600 text-sm font-semibold mt-1">Save 2 months!</div>' : ''}
                </div>
                
                <ul class="text-left space-y-3 mb-8">
                    ${plan.features.map(feature => `
                        <li class="flex items-start">
                            <svg class="w-5 h-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/>
                            </svg>
                            <span class="text-gray-700">${feature}</span>
                        </li>
                    `).join('')}
                </ul>
                
                ${buttonHtml}
            </div>
        `;

        container.appendChild(card);
    });
}

function selectPlan(planId, planName, price, planCode) {
    selectedPlan = { id: planId, name: planName, price: price, planCode: planCode };
    console.log('[Subscriptions] Selected plan:', selectedPlan);

    if (planId === 'plan_free') {
        subscribeToPlan(planId, null);
    } else {
        showSubscriptionModal(planName);
    }
}

function showSubscriptionModal(planName) {
    document.getElementById('selectedPlanName').textContent = planName;
    document.getElementById('subscriptionModal').classList.remove('hidden');
    document.getElementById('subscriptionModal').classList.add('flex');

    document.getElementById('payment-form').addEventListener('submit', handlePaymentSubmit);
}

function closeSubscriptionModal() {
    document.getElementById('subscriptionModal').classList.add('hidden');
    document.getElementById('subscriptionModal').classList.remove('flex');
}

async function handlePaymentSubmit(e) {
    e.preventDefault();

    if (!PAYSTACK_PUBLIC_KEY) {
        CVision.Utils.showAlert('Payment configuration error', 'error');
        return;
    }

    const submitButton = document.getElementById('submit-payment');
    submitButton.disabled = true;
    submitButton.textContent = 'Processing...';

    const referralCode = document.getElementById('referralCodeInput').value.trim();

    // Validation
    if (!USER_EMAIL) {
        console.error('User email not found for payment');
        CVision.Utils.showAlert('User account error: Email missing. Please re-login.', 'error');
        submitButton.disabled = false;
        submitButton.textContent = 'Subscribe Now';
        return;
    }

    if (!selectedPlan.price || isNaN(selectedPlan.price)) {
        console.error('Invalid plan price:', selectedPlan.price);
        CVision.Utils.showAlert('Plan configuration error: Invalid price.', 'error');
        submitButton.disabled = false;
        submitButton.textContent = 'Subscribe Now';
        return;
    }

    try {
        // Use Payment Gateway abstraction
        if (!window.CVision || !window.CVision.Payment) {
            throw new Error('Payment system components missing. Please refresh.');
        }

        // Lazy Initialization: Check if ready, if not, try to init again (handles race conditions)
        if (!CVision.Payment.isReady()) {
            console.log('[Subscriptions] Payment system not ready, attempting JIT initialization...');
            if (PAYSTACK_PUBLIC_KEY) {
                await CVision.Payment.init('paystack', { publicKey: PAYSTACK_PUBLIC_KEY });
            }

            // Re-check
            if (!CVision.Payment.isReady()) {
                const provider = CVision.Payment.getProviderName();
                throw new Error(`Payment system not ready${provider ? ` (${provider} failed)` : ''}. Try refreshing.`);
            }
        }

        const cleanEmail = USER_EMAIL.trim();

        // Determine currency and amount based on provider
        const provider = CVision.Payment.getProviderName();
        let targetCurrency = 'KES';
        let finalAmount = selectedPlan.price; // Start with KES cents

        if (provider === 'paystack') {
            // Paystack: Use User's Local Currency
            targetCurrency = CVision.Currency.getUserCurrency();
        }


        // Perform Conversion if needed (Base is USD)
        if (targetCurrency !== 'USD' && window.CVision && window.CVision.Currency) {
            const rate = CVision.Currency.getRate(targetCurrency);
            // Conversion: (USD Cents / 100) * Rate = Target Major Units
            let majorAmount = (selectedPlan.price / 100) * rate;

            // Smart Rounding for KES: Always round UP to next shilling (e.g. 2577.27 -> 2578)
            if (targetCurrency === 'KES') {
                majorAmount = Math.ceil(majorAmount);
            }

            // Convert to Target Cents/Smallest Unit
            // Assuming 2 decimals for standard currencies (factor 100)
            finalAmount = Math.round(majorAmount * 100);

            console.log(`[Subscriptions] Converted Payment: ${selectedPlan.price} USD -> ${finalAmount} ${targetCurrency} (Rate: ${rate})`);
        }

        console.log('Starting payment checkout for:', {
            email: cleanEmail,
            amount: finalAmount,
            currency: targetCurrency,
            plan: selectedPlan.planCode
        });

        await CVision.Payment.checkout({
            email: cleanEmail,
            amount: finalAmount,
            currency: targetCurrency,
            planCode: selectedPlan.planCode,
            metadata: {
                custom_fields: [{
                    display_name: "Plan",
                    variable_name: "plan_name",
                    value: selectedPlan.name
                }]
            },
            onSuccess: async (result) => {
                try {
                    // Use reusable SubscriptionManager
                    if (typeof SubscriptionManager === 'undefined') {
                        throw new Error('SubscriptionManager component not loaded');
                    }

                    await SubscriptionManager.handlePaymentSuccess(result, selectedPlan, referralCode, () => {
                        closeSubscriptionModal();
                    });

                } catch (error) {
                    console.error('Subscription error:', error);
                    CVision.Utils.showAlert('Subscription processing error: ' + error.message, 'error');

                    // Start buttons are re-enabled by the catch block below if this throws
                    // But handlePaymentSuccess usually handles the UI alert
                    submitButton.disabled = false;
                    submitButton.textContent = 'Subscribe Now';
                }
            },
            onCancel: () => {
                submitButton.disabled = false;
                submitButton.textContent = 'Subscribe Now';
            },
            onError: (error) => {
                console.error('Payment checkout error:', error);
                CVision.Utils.showAlert('Payment failed. Please try again.', 'error');
                submitButton.disabled = false;
                submitButton.textContent = 'Subscribe Now';
            }
        });

    } catch (error) {
        console.error('Payment initialization failed:', error);
        CVision.Utils.showAlert(error.message || 'Payment initialization failed', 'error');
        submitButton.disabled = false;
        submitButton.textContent = 'Subscribe Now';
    }

}
// Legacy subscribeToPlan removed (logic moved to SubscriptionManager)

function showCancelModal() {
    document.getElementById('cancelModal').classList.remove('hidden');
    document.getElementById('cancelModal').classList.add('flex');
}

function closeCancelModal() {
    document.getElementById('cancelModal').classList.add('hidden');
    document.getElementById('cancelModal').classList.remove('flex');
}

async function confirmCancel() {
    const reason = document.getElementById('cancelReason').value;

    try {
        const response = await authenticatedFetch(`${API_BASE_URL}/api/v1/subscriptions/cancel`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                cancel_immediately: false,
                reason: reason
            })
        });

        if (!response || !response.ok) throw new Error('Cancellation failed');

        CVision.Utils.showAlert('Subscription will be cancelled at the end of your billing period', 'success');
        closeCancelModal();

        setTimeout(() => window.location.reload(), 2000);

    } catch (error) {
        console.error('Cancel error:', error);
        CVision.Utils.showAlert('Failed to cancel subscription', 'error');
    }
}

async function loadReferralStats() {
    try {
        const response = await authenticatedFetch(`${API_BASE_URL}/api/v1/subscriptions/referrals/stats`);

        if (!response || !response.ok) return;

        const stats = await response.json();
        displayReferralStats(stats);
    } catch (error) {
        console.error('Failed to load referral stats:', error);
    }
}

function displayReferralStats(stats) {
    const container = document.getElementById('referralStats');
    container.innerHTML = `
        <div class="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
            <div class="text-3xl font-bold text-blue-600">${stats.total_referrals || 0}</div>
            <div class="text-gray-600 mt-1">Total Referrals</div>
        </div>
        <div class="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
            <div class="text-3xl font-bold text-green-600">${stats.successful_referrals || 0}</div>
            <div class="text-gray-600 mt-1">Successful</div>
        </div>
        <div class="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
            <div class="text-3xl font-bold text-purple-600">${stats.bonus_auto_applications || stats.bonus_searches_earned || 0}</div>
            <div class="text-gray-600 mt-1">Automated applications left</div>
        </div>
        <div class="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
            <div class="text-3xl font-bold text-orange-600">${stats.next_reward_in || 0}</div>
            <div class="text-gray-600 mt-1">Until Next Reward</div>
        </div>
    `;
}

async function showReferralModal() {
    document.getElementById('referralModal').classList.remove('hidden');
    document.getElementById('referralModal').classList.add('flex');

    await loadReferralInfo();
}

function closeReferralModal() {
    document.getElementById('referralModal').classList.add('hidden');
    document.getElementById('referralModal').classList.remove('flex');
}

async function loadReferralInfo() {
    try {
        const statsResponse = await authenticatedFetch(`${API_BASE_URL}/api/v1/subscriptions/referrals/stats`);

        if (statsResponse && statsResponse.ok) {
            const stats = await statsResponse.json();
            document.getElementById('referralCodeDisplay').textContent =
                stats.referral_code || 'N/A';
        }

        const listResponse = await authenticatedFetch(`${API_BASE_URL}/api/v1/subscriptions/referrals`);

        if (listResponse && listResponse.ok) {
            const data = await listResponse.json();
            displayReferralList(data.referrals || []);
        }

        // Also ensure user email is set for payment if not already
        if (!USER_EMAIL) {
            try {
                const user = CVision.Utils.getUser();
                if (user) USER_EMAIL = user.email;
            } catch (e) { }
        }

    } catch (error) {
        console.error('Failed to load referral info:', error);
    }
}

function displayReferralList(referrals) {
    const container = document.getElementById('referralList');

    if (!referrals || referrals.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-sm">No referrals yet. Share your code to get started!</p>';
        return;
    }

    container.innerHTML = referrals.map(ref => `
        <div class="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
            <div>
                <div class="font-medium">${ref.referee_email}</div>
                <div class="text-sm text-gray-500">${new Date(ref.referred_at).toLocaleDateString()}</div>
            </div>
            <span class="px-3 py-1 rounded-full text-xs font-semibold ${ref.status === 'completed' ? 'bg-green-100 text-green-700' :
            ref.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                'bg-gray-100 text-gray-700'
        }">
                ${ref.status}
            </span>
        </div>
    `).join('');
}

function copyReferralCode() {
    const code = document.getElementById('referralCodeDisplay').textContent;
    if (code && code !== 'N/A' && code !== 'LOADING...') {
        navigator.clipboard.writeText(code).then(() => {
            CVision.Utils.showAlert('Referral code copied!', 'success');
        }).catch(() => {
            CVision.Utils.showAlert('Failed to copy code', 'error');
        });
    }
}

// Make functions globally available
window.selectPlan = selectPlan;
// window.openCustomerPortal = openCustomerPortal; // Removed
window.showCancelModal = showCancelModal;
window.closeCancelModal = closeCancelModal;
window.confirmCancel = confirmCancel;
window.showReferralModal = showReferralModal;
window.closeReferralModal = closeReferralModal;
window.copyReferralCode = copyReferralCode;
window.showSubscriptionModal = showSubscriptionModal;
window.closeSubscriptionModal = closeSubscriptionModal;
window.showUpgradeOptions = showUpgradeOptions;
window.handlePaymentSubmit = handlePaymentSubmit;
window.setBillingInterval = setBillingInterval;