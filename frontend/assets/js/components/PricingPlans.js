/**
 * PricingPlans Component
 * Reusable pricing display for both public and authenticated pages
 * 
 * Usage:
 *   // Public mode (static data, no auth required)
 *   PricingPlans.init({ mode: 'public', container: '#pricing-container' });
 * 
 *   // Authenticated mode (loads from API, shows upgrade buttons)
 *   PricingPlans.init({ mode: 'authenticated', container: '#pricing-container' });
 */

const PricingPlans = (function () {
    'use strict';

    // Centralized plan configuration - single source of truth
    const PLAN_CONFIG = {
        free: {
            id: 'plan_free',
            name: 'Free',
            tier: 'free',
            description: 'Perfect for trying out Synovae',
            monthlyPrice: 0,
            yearlyPrice: 0,
            isPopular: false,
            features: [
                '3 manual applications per month',
                'Basic job search',
                'CV upload & analysis'
            ],
            limitations: [
                'Auto-apply is on Premium'
            ]
        },
        basic: {
            id: 'plan_basic',
            name: 'Basic',
            tier: 'basic',
            description: 'Basic plan, billed monthly',
            monthlyPrice: 299,
            yearlyPrice: 2990,
            isPopular: false,
            features: [
                'Manual applications with no monthly cap',
                'Upload and reuse cover letters',
                'Billed monthly'
            ],
            limitations: [
                'Auto-apply is on Premium'
            ]
        },
        premium: {
            id: 'plan_premium',
            name: 'Premium',
            tier: 'premium',
            description: 'Monthly Premium plan',
            monthlyPrice: 2999,
            yearlyPrice: 2999,
            isPopular: true,
            features: [
                'Auto-apply included',
                'Manual applications with no monthly cap',
                'Billed monthly'
            ],
            limitations: []
        }
    };

    let currentBillingInterval = 'monthly';
    let mode = 'public'; // 'public' or 'authenticated'
    let containerSelector = '#pricing-plans-container';
    let currentSubscription = null;
    let onSelectPlan = null; // Callback for authenticated mode

    /**
     * Format price in user's currency
     */
    function formatPrice(amountInCents) {
        if (window.CVision && window.CVision.Currency) {
            return CVision.Currency.format(amountInCents, 'USD');
        }
        // Fallback to USD
        return `$${(amountInCents / 100).toFixed(2)}`;
    }

    /**
     * Generate SVG checkmark icon
     */
    function checkIcon(color = 'text-green-500') {
        return `<svg class="w-5 h-5 ${color} mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/>
        </svg>`;
    }

    /**
     * Generate SVG X icon for limitations
     */
    function xIcon() {
        return `<svg class="w-5 h-5 text-gray-400 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"/>
        </svg>`;
    }

    /**
     * Get price for current billing interval
     */
    function getPrice(plan) {
        return currentBillingInterval === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice;
    }

    /**
     * Get billing period text
     */
    function getBillingPeriod() {
        if (currentBillingInterval === 'one_time') return 'one time';
        return currentBillingInterval === 'yearly' ? 'year' : 'month';
    }

    /**
     * Render the billing toggle
     */
    function renderBillingToggle() {
        const activeClass = 'bg-white text-gray-900 shadow';
        const inactiveClass = 'text-gray-600 hover:text-gray-900';
        const baseClass = 'px-6 py-2 rounded-full text-sm font-semibold transition-all cursor-pointer';

        return `
            <div class="inline-flex items-center bg-gray-100 rounded-full p-1">
                <button id="pp-monthly-toggle" class="${baseClass} ${currentBillingInterval === 'monthly' ? activeClass : inactiveClass}">
                    Monthly
                </button>
                <button id="pp-yearly-toggle" class="${baseClass} ${currentBillingInterval === 'yearly' ? activeClass : inactiveClass}">
                    Annual <span class="text-green-600 text-xs ml-1">Save 17%</span>
                </button>
            </div>
        `;
    }

    /**
     * Render a single plan card
     */
    function renderPlanCard(plan) {
        const price = getPrice(plan);
        const currentPlanId = currentSubscription && currentSubscription.plan_id;
        const isCurrentPlan = currentPlanId === plan.id
            || (plan.id === 'plan_basic' && currentPlanId === 'plan_manual_plus');

        // Determine button based on mode and plan state
        let buttonHtml = '';

        if (mode === 'public') {
            // Public mode - always show CTA to register
            if ((plan.monthlyPrice || 0) === 0) {
                buttonHtml = `
                    <a href="/register" class="block w-full py-4 px-6 bg-gray-100 text-gray-800 hover:bg-gray-200 rounded-xl font-bold text-center transition-all">
                        Get Started Free
                    </a>`;
            } else {
                const btnClass = plan.isPopular
                    ? 'btn-gradient text-white shadow-lg hover:shadow-xl'
                    : 'bg-gray-100 text-gray-800 hover:bg-gray-200';
                buttonHtml = `
                    <a href="/register" class="block w-full py-4 px-6 ${btnClass} rounded-xl font-bold text-center transition-all">
                        ${plan.isPopular ? 'Start Free Trial' : 'Get Started'}
                    </a>`;
            }
        } else {
            // Authenticated mode - show upgrade/downgrade/current
            if (isCurrentPlan) {
                buttonHtml = `
                    <button class="w-full bg-green-100 text-green-700 rounded-xl px-6 py-4 font-bold cursor-not-allowed border-2 border-green-300">
                        ✓ Current Plan
                    </button>`;
            } else if (plan.tier === 'free' && !plan.oneTime) {
                // No button for free tier when authenticated
                buttonHtml = '';
            } else {
                const planCode = plan.paystack_plan_code || '';
                const btnClass = plan.isPopular
                    ? 'btn-gradient text-white'
                    : 'bg-blue-600 text-white hover:bg-blue-700';
                buttonHtml = `
                    <button onclick="PricingPlans.selectPlan('${plan.id}', '${plan.name}', ${price}, '${planCode}')" 
                        class="w-full ${btnClass} rounded-xl px-6 py-4 font-bold hover:shadow-lg transition-all">
                        ${plan.oneTime ? 'Unlock offer' : 'Upgrade'}
                    </button>`;
            }
        }

        // Build features list
        const featuresHtml = plan.features.map(f => `
            <li class="flex items-start">
                ${checkIcon()}
                <span class="text-gray-700">${f}</span>
            </li>
        `).join('');

        // Build limitations list (shown with X icon)
        const limitationsHtml = (plan.limitations || []).map(l => `
            <li class="flex items-start">
                ${xIcon()}
                <span class="text-gray-400">${l}</span>
            </li>
        `).join('');

        // Card styling
        const cardBorder = plan.isPopular ? 'border-2 border-primary-500 shadow-xl' : 'border border-gray-200 shadow-md hover:shadow-lg';
        const cardScale = plan.isPopular ? 'scale-105 z-10' : '';

        return `
            <div class="bg-white rounded-2xl p-8 relative ${cardBorder} ${cardScale} transition-all">
                ${plan.isPopular ? `
                    <div class="absolute -top-4 left-1/2 transform -translate-x-1/2 bg-gradient-to-r from-primary-600 to-primary-500 text-white px-4 py-1 rounded-full text-sm font-bold shadow-md">
                        Most Popular
                    </div>
                ` : ''}
                
                <div class="text-center mb-8">
                    <h3 class="text-2xl font-bold text-gray-900 mb-4">${plan.name}</h3>
                    <div class="flex justify-center items-baseline mb-2">
                        <span class="text-4xl font-extrabold text-gray-900">${formatPrice(price)}</span>
                        <span class="text-gray-500 ml-1">${plan.oneTime ? 'one time' : `/${getBillingPeriod()}`}</span>
                    </div>
                    <p class="text-gray-600 text-sm">${plan.description}</p>
                </div>

                <ul class="space-y-4 mb-8">
                    ${featuresHtml}
                    ${limitationsHtml}
                </ul>

                ${buttonHtml}
            </div>
        `;
    }

    /**
     * Render all plan cards
     */
    function render() {
        const container = document.querySelector(containerSelector);
        if (!container) {
            console.error('[PricingPlans] Container not found:', containerSelector);
            return;
        }

        // Get plans in order
        const plans = [PLAN_CONFIG.free, PLAN_CONFIG.basic, PLAN_CONFIG.premium];

        // For yearly billing, update plan IDs
        const displayPlans = plans.map(plan => {
            if (currentBillingInterval === 'yearly' && plan.tier !== 'free' && !plan.oneTime) {
                return { ...plan, id: `${plan.id}_annual` };
            }
            return plan;
        });

        // Render header and toggle
        const headerHtml = `
            <div class="text-center mb-12">
                <h2 class="text-3xl font-bold text-gray-900 mb-4">Choose Your Plan</h2>
                <p class="text-gray-600 mb-8">Free, Basic, and Premium.</p>
            </div>
        `;

        // Render cards grid
        const cardsHtml = `
            <div class="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                ${displayPlans.map(plan => renderPlanCard(plan)).join('')}
            </div>
        `;

        container.innerHTML = headerHtml + cardsHtml;

        // Attach toggle event listeners
        document.getElementById('pp-monthly-toggle')?.addEventListener('click', () => setBillingInterval('monthly'));
        document.getElementById('pp-yearly-toggle')?.addEventListener('click', () => setBillingInterval('yearly'));
    }

    /**
     * Set billing interval and re-render
     */
    function setBillingInterval(interval) {
        currentBillingInterval = interval;
        render();
    }

    /**
     * Handle plan selection (authenticated mode)
     */
    function selectPlan(planId, planName, price, planCode) {
        if (onSelectPlan) {
            onSelectPlan({ id: planId, name: planName, price, planCode });
        } else {
            console.log('[PricingPlans] Plan selected:', { planId, planName, price, planCode });
        }
    }

    /**
     * Initialize the component
     */
    function init(options = {}) {
        mode = options.mode || 'public';
        containerSelector = options.container || '#pricing-plans-container';
        currentSubscription = options.currentSubscription || null;
        onSelectPlan = options.onSelectPlan || null;
        currentBillingInterval = options.defaultInterval || 'monthly';

        render();
    }

    /**
     * Update current subscription (for re-rendering after changes)
     */
    function setCurrentSubscription(subscription) {
        currentSubscription = subscription;
        render();
    }

    /**
     * Get plan config (for external use)
     */
    function getPlanConfig() {
        return PLAN_CONFIG;
    }

    // Public API
    return {
        init,
        render,
        setBillingInterval,
        selectPlan,
        setCurrentSubscription,
        getPlanConfig,
        PLAN_CONFIG
    };
})();

// Expose globally
window.PricingPlans = PricingPlans;
