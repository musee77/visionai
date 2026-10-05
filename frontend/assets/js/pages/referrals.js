// frontend/assets/js/referrals.js - Referral Management System

const API_BASE_URL = `${CONFIG.API_BASE_URL}`;
let currentReferralPage = 1;
let referralPageSize = 10;
let currentStatusFilter = 'all';
let userReferralCode = '';
let referralStats = null;

// Initialize page
document.addEventListener('DOMContentLoaded', async () => {
    if (!CVision.isAuthenticated()) {
        window.location.href = 'login.html';
        return;
    }

    await Promise.all([
        loadReferralCode(),
        loadReferralStats(),
        loadTierCards(),
        loadReferralList(),
        loadRecentActivity()
    ]);
});

/**
 * Load tier cards from backend subscription plans
 */
async function loadTierCards() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/subscriptions/plans`);

        if (response.ok) {
            const plans = await response.json();
            displayTierCards(plans);
        } else {
            throw new Error('Failed to load plans');
        }
    } catch (error) {
        console.error('Error loading tier cards:', error);
        document.getElementById('tierCardsContainer').innerHTML = `
            <div class="text-center py-12 col-span-3">
                <p class="text-red-500">Failed to load tier information</p>
                <button onclick="loadTierCards()" class="mt-4 text-blue-600 hover:text-blue-700">Try Again</button>
            </div>
        `;
    }
}

/**
 * Display tier cards - grouped by tier (not by billing cycle)
 */
function displayTierCards(plans) {
    const container = document.getElementById('tierCardsContainer');
    const tierColors = {
        'free': { border: 'border-gray-200', bg: 'bg-gray-100', text: 'text-gray-600', gradient: 'from-gray-400 to-gray-500' },
        'basic': { border: 'border-blue-500', bg: 'bg-blue-100', text: 'text-blue-600', gradient: 'from-blue-500 to-blue-600' },
        'premium': { border: 'border-purple-500', bg: 'bg-purple-100', text: 'text-purple-600', gradient: 'from-purple-500 to-pink-500' }
    };

    // Group plans by tier to avoid duplicates (monthly/annual)
    const tierMap = new Map();
    plans.forEach(plan => {
        const tier = plan.tier || 'free';
        // Keep only one plan per tier (prefer the first one or the popular one)
        if (!tierMap.has(tier) || plan.is_popular) {
            tierMap.set(tier, plan);
        }
    });

    // Convert to array and sort: free, basic, premium
    const tierOrder = ['free', 'basic', 'premium'];
    const uniquePlans = tierOrder
        .filter(tier => tierMap.has(tier))
        .map(tier => tierMap.get(tier));

    container.innerHTML = uniquePlans.map(plan => {
        const tier = plan.tier || 'free';
        const colors = tierColors[tier] || tierColors.free;
        const isPopular = plan.is_popular;
        const isPaid = tier !== 'free';

        // Determine referral reward text
        let rewardText = '';
        let rewardIcon = '';
        if (tier === 'free') {
            rewardText = 'Signed up. They count after they subscribe to Basic or Premium.';
            rewardIcon = '👋';
        } else {
            rewardText = 'Counts as 1 paid referral toward your next set of 5.';
            rewardIcon = '✓';
        }

        // Get tier display name (capitalize first letter)
        const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);

        return `
            <div class="border-2 ${colors.border} rounded-xl p-6 ${isPopular ? 'relative ring-2 ring-blue-500 ring-offset-2' : ''} hover:shadow-lg transition-all duration-300 bg-white">
                ${isPopular ? `
                    <div class="absolute -top-3 left-1/2 transform -translate-x-1/2">
                        <span class="bg-gradient-to-r from-blue-500 to-purple-500 text-white px-4 py-1 rounded-full text-xs font-semibold shadow-lg">MOST POPULAR</span>
                    </div>
                ` : ''}
                
                <!-- Tier Header -->
                <div class="flex items-center gap-3 mb-4">
                    <div class="w-12 h-12 bg-gradient-to-br ${colors.gradient} rounded-xl flex items-center justify-center shadow-lg">
                        ${tier === 'free' ? `
                            <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"/>
                            </svg>
                        ` : tier === 'basic' ? `
                            <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clip-rule="evenodd"/>
                            </svg>
                        ` : `
                            <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                            </svg>
                        `}
                    </div>
                    <div>
                        <h3 class="text-xl font-bold text-gray-900">${tierName}</h3>
                        <p class="text-sm text-gray-500">${tier === 'free' ? 'Get started' : tier === 'basic' ? 'For job seekers' : 'Maximum power'}</p>
                    </div>
                </div>
                
                <!-- Referral Reward Highlight -->
                <div class="mb-4 p-3 rounded-lg ${isPaid ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'}">
                    <div class="flex items-start gap-2">
                        <span class="text-lg">${rewardIcon}</span>
                        <div>
                            <p class="text-sm font-medium ${isPaid ? 'text-green-800' : 'text-gray-600'}">Referral Rewards</p>
                            <p class="text-xs ${isPaid ? 'text-green-700' : 'text-gray-500'}">${rewardText}</p>
                        </div>
                    </div>
                </div>
                
                <!-- Key Features -->
                <ul class="space-y-2">
                    ${plan.features.slice(0, 3).map(feature => `
                        <li class="flex items-start text-sm">
                            <svg class="w-5 h-5 text-green-500 mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd"
                                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                    clip-rule="evenodd" />
                            </svg>
                            <span class="text-gray-700">${feature}</span>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }).join('');
}

/**
 * Load user's referral code
 */
async function loadReferralCode() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/subscriptions/referral/code`, {
            headers: {
                'Authorization': `Bearer ${CVision.getToken()}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            userReferralCode = data.code;

            // Update all referral code displays
            const codeElements = document.querySelectorAll('#referralCodeMain, #referralCodeDisplay');
            codeElements.forEach(el => el.textContent = userReferralCode);

            const referralLink = referralShareLink();
            ['referralLinkInput', 'referralLinkMain'].forEach((id) => {
                const field = document.getElementById(id);
                if (field) field.value = referralLink;
            });
        } else {
            throw new Error('Failed to load referral code');
        }
    } catch (error) {
        console.error('Error loading referral code:', error);
        CVision.showMessage('Failed to load referral code', 'error');
    }
}

/**
 * Load referral statistics
 */
async function loadReferralStats() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/v1/subscriptions/referral/stats`, {
            headers: {
                'Authorization': `Bearer ${CVision.getToken()}`
            }
        });

        if (response.ok) {
            referralStats = await response.json();
            updateStatsDisplay();
        } else {
            throw new Error('Failed to load referral stats');
        }
    } catch (error) {
        console.error('Error loading referral stats:', error);
        CVision.showMessage('Failed to load statistics', 'error');
    }
}

/**
 * Update statistics display
 */
function updateStatsDisplay() {
    if (!referralStats) return;

    document.getElementById('totalReferrals').textContent = referralStats.total_referrals || 0;
    document.getElementById('activeReferrals').textContent = referralStats.paid_referrals || 0;

    document.getElementById('bonusApplications').textContent = referralStats.bonus_auto_applications || 0;

    document.getElementById('pendingRewards').textContent = referralStats.next_reward_in || 0;

    // Update milestone progress tracker
    updateMilestoneProgress();
}

/**
 * Update the milestone progress tracker UI
 */
function updateMilestoneProgress() {
    if (!referralStats) return;

    const paidReferrals = referralStats.paid_referrals || 0;
    const bonusApps = referralStats.referral_auto_earned || 0;
    const milestoneSize = 5;
    const completedMilestones = Math.floor(paidReferrals / milestoneSize);
    const remainder = paidReferrals % milestoneSize;
    const cycleComplete = paidReferrals > 0 && remainder === 0;
    const currentCycleProgress = cycleComplete ? milestoneSize : remainder;
    const referralsToNextReward = cycleComplete || paidReferrals === 0
        ? milestoneSize
        : milestoneSize - remainder;
    const progressPercent = (currentCycleProgress / milestoneSize) * 100;
    const progressBar = document.getElementById('progressBar');
    if (progressBar) {
        // Animate the progress bar
        setTimeout(() => {
            progressBar.style.width = `${progressPercent}%`;
        }, 100);
    }

    // Update progress text
    const progressText = document.getElementById('progressText');
    if (progressText) {
        progressText.textContent = `${currentCycleProgress} / ${milestoneSize} paid referrals`;
    }

    // Update referrals needed
    const referralsNeeded = document.getElementById('referralsNeeded');
    if (referralsNeeded) {
        referralsNeeded.textContent = referralsToNextReward;
    }

    // Update total earned apps
    const totalEarnedApps = document.getElementById('totalEarnedApps');
    if (totalEarnedApps) {
        totalEarnedApps.textContent = bonusApps;
    }

    // Update milestones completed badge
    const milestonesCompleted = document.getElementById('totalMilestonesCompleted');
    if (milestonesCompleted) {
        milestonesCompleted.textContent = completedMilestones;
    }
    const milestonesLabel = document.getElementById('milestonesCompletedLabel');
    if (milestonesLabel) {
        milestonesLabel.textContent = completedMilestones === 1 ? 'Milestone Completed' : 'Milestones Completed';
    }
    const cycleNote = document.getElementById('cycleNote');
    if (cycleNote) cycleNote.classList.toggle('hidden', !cycleComplete);

    // Update milestone markers
    for (let i = 1; i <= 5; i++) {
        const marker = document.getElementById(`milestone${i}Marker`);
        if (marker) {
            if (currentCycleProgress >= i) {
                // Milestone reached - show completed state
                marker.classList.remove('bg-gray-300');
                marker.classList.add('bg-gradient-to-r', 'from-purple-500', 'to-blue-500');
            } else {
                marker.classList.add('bg-gray-300');
                marker.classList.remove('bg-gradient-to-r', 'from-purple-500', 'to-blue-500');
            }
        }
    }
    const checkIcon = document.getElementById('milestone5Check');
    if (checkIcon) checkIcon.classList.toggle('hidden', currentCycleProgress < milestoneSize);
}

/**
 * Load referral list with pagination
 */
async function loadReferralList(page = 1) {
    currentReferralPage = page;
    const container = document.getElementById('referralListContainer');

    try {
        // Show loading state
        container.innerHTML = `
            <div class="text-center py-12">
                <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p class="text-gray-500 mt-4">Loading referrals...</p>
            </div>
        `;

        const params = new URLSearchParams({
            page: page.toString(),
            page_size: referralPageSize.toString()
        });

        if (currentStatusFilter !== 'all') {
            params.append('status', currentStatusFilter);
        }

        const response = await fetch(
            `${API_BASE_URL}/api/v1/subscriptions/referral/list?${params}`,
            {
                headers: {
                    'Authorization': `Bearer ${CVision.getToken()}`
                }
            }
        );

        if (response.ok) {
            const data = await response.json();
            displayReferralList(data.referrals, data.total, data.pages);
        } else {
            throw new Error('Failed to load referrals');
        }
    } catch (error) {
        console.error('Error loading referral list:', error);
        container.innerHTML = `
            <div class="text-center py-12">
                <svg class="w-16 h-16 mx-auto mb-4 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <p class="text-gray-500">Failed to load referrals</p>
                <button onclick="loadReferralList()" class="mt-4 text-blue-600 hover:text-blue-700">Try Again</button>
            </div>
        `;
    }
}

/**
 * Display referral list
 */
function displayReferralList(referrals, total, totalPages) {
    const container = document.getElementById('referralListContainer');

    if (!referrals || referrals.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 text-gray-500">
                <svg class="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
                </svg>
                <p class="font-semibold mb-2">No referrals yet</p>
                <p class="text-sm">Start sharing your referral code to earn rewards!</p>
            </div>
        `;
        return;
    }

    container.innerHTML = referrals.map(ref => `
        <div class="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors">
            <div class="flex items-start justify-between">
                <div class="flex-1">
                    <div class="flex items-center gap-3 mb-2">
                        <div class="bg-gray-100 rounded-full p-2">
                            <svg class="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"/>
                            </svg>
                        </div>
                        <div>
                            <p class="font-semibold text-gray-900">${ref.referee_email || 'User'}</p>
                            <p class="text-sm text-gray-500">${referredWhen(ref.created_at)}</p>
                        </div>
                    </div>
                    
                    <div class="flex flex-wrap gap-2 mt-3">
                        ${getStatusBadge(paidPlan(ref) ? 'completed' : ref.status)}
                        ${ref.subscription_tier ? `
                            <span class="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-700">
                                ${ref.subscription_tier.charAt(0).toUpperCase() + ref.subscription_tier.slice(1)} Plan
                            </span>
                        ` : ''}
                        ${ref.reward_granted ? `
                            <span class="px-2 py-1 text-xs rounded-full bg-green-100 text-green-700 flex items-center gap-1">
                                <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                                </svg>
                                Reward Granted
                            </span>
                        ` : ''}
                    </div>
                </div>
                
                <div class="text-right">
                    ${paidPlan(ref) ? `
                        <p class="text-sm font-semibold text-green-600">Counts toward your reward</p>
                    ` : `
                        <p class="text-sm text-gray-500">Waiting for Basic or Premium</p>
                    `}
                </div>
            </div>
        </div>
    `).join('');

    // Update pagination
    updatePagination(totalPages);
}

/**
 * Get status badge HTML
 */
function paidPlan(ref) {
    return ['basic', 'premium'].includes((ref.subscription_tier || '').toLowerCase());
}

function referredWhen(dateString) {
    const label = formatDate(dateString);
    if (label === 'Today' || label === 'Yesterday') return `Referred ${label.toLowerCase()}`;
    return `Referred on ${label}`;
}

function getStatusBadge(status) {
    const badges = {
        pending: '<span class="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-700">Pending</span>',
        completed: '<span class="px-2 py-1 text-xs rounded-full bg-green-100 text-green-700">Subscribed</span>',
        active: '<span class="px-2 py-1 text-xs rounded-full bg-green-100 text-green-700">Active</span>',
        expired: '<span class="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-700">Expired</span>',
        cancelled: '<span class="px-2 py-1 text-xs rounded-full bg-red-100 text-red-700">Cancelled</span>'
    };
    return badges[status] || badges.pending;
}

/**
 * Update pagination controls
 */
function updatePagination(totalPages) {
    const container = document.getElementById('referralPagination');
    if (!container || totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let paginationHTML = '';

    // Previous button
    paginationHTML += `
        <button 
            onclick="loadReferralList(${currentReferralPage - 1})"
            ${currentReferralPage === 1 ? 'disabled' : ''}
            class="px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
            Previous
        </button>
    `;

    // Page numbers
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentReferralPage - 1 && i <= currentReferralPage + 1)) {
            paginationHTML += `
                <button 
                    onclick="loadReferralList(${i})"
                    class="px-3 py-1 border ${i === currentReferralPage ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 hover:bg-gray-50'} rounded-lg"
                >
                    ${i}
                </button>
            `;
        } else if (i === currentReferralPage - 2 || i === currentReferralPage + 2) {
            paginationHTML += '<span class="px-2">...</span>';
        }
    }

    // Next button
    paginationHTML += `
        <button 
            onclick="loadReferralList(${currentReferralPage + 1})"
            ${currentReferralPage === totalPages ? 'disabled' : ''}
            class="px-3 py-1 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
            Next
        </button>
    `;

    container.innerHTML = paginationHTML;
}

/**
 * Load recent activity
 */
async function loadRecentActivity() {
    try {
        const response = await fetch(
            `${API_BASE_URL}/api/v1/subscriptions/referral/activity?limit=10`,
            {
                headers: {
                    'Authorization': `Bearer ${CVision.getToken()}`
                }
            }
        );

        if (response.ok) {
            const activities = await response.json();
            displayRecentActivity(activities);
        }
    } catch (error) {
        console.error('Error loading recent activity:', error);
    }
}

/**
 * Display recent activity timeline
 */
function displayRecentActivity(activities) {
    const container = document.getElementById('recentActivity');

    if (!activities || activities.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-500 py-8">No recent activity</p>';
        return;
    }

    container.innerHTML = activities.map(activity => `
        <div class="flex gap-4 pb-4 border-b border-gray-200 last:border-0">
            <div class="flex-shrink-0 mt-1">
                ${getActivityIcon(activity.type)}
            </div>
            <div class="flex-1">
                <p class="text-gray-900">${activity.description}</p>
                <p class="text-sm text-gray-500 mt-1">${formatDate(activity.created_at)}</p>
            </div>
        </div>
    `).join('');
}

/**
 * Get activity icon based on type
 */
function getActivityIcon(type) {
    const icons = {
        signup: '<div class="bg-blue-100 rounded-full p-2"><svg class="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20"><path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z"/></svg></div>',
        subscription: '<div class="bg-green-100 rounded-full p-2"><svg class="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg></div>',
        reward: '<div class="bg-purple-100 rounded-full p-2"><svg class="w-5 h-5 text-purple-600" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg></div>',
        cancelled: '<div class="bg-red-100 rounded-full p-2"><svg class="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg></div>'
    };
    return icons[type] || icons.signup;
}

/**
 * Filter referrals by status
 */
function filterReferrals() {
    const select = document.getElementById('statusFilter');
    currentStatusFilter = select.value;
    loadReferralList(1);
}

/**
 * Copy referral code
 */
function referralShareLink() {
    if (!userReferralCode) return '';
    return `${window.location.origin}/register?ref=${encodeURIComponent(userReferralCode)}`;
}

async function writeClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    if (!copied) throw new Error('Copy failed');
}

function markCopied(button, label) {
    if (!button) return;
    if (!button.dataset.labelHtml) button.dataset.labelHtml = button.innerHTML;
    button.textContent = label;
    setTimeout(() => {
        button.innerHTML = button.dataset.labelHtml;
    }, 2000);
}

async function copyReferralCode(button) {
    try {
        if (!userReferralCode) throw new Error('Code not ready');
        await writeClipboard(userReferralCode);
        markCopied(button, 'Copied');
        CVision.showMessage('Referral code copied.', 'success');
    } catch (error) {
        console.error('Failed to copy:', error);
        CVision.showMessage('Failed to copy referral code', 'error');
    }
}

/**
 * Copy referral link
 */
async function copyReferralLink(button) {
    const link = referralShareLink();
    try {
        if (!link) throw new Error('Link not ready');
        await writeClipboard(link);
        markCopied(button, 'Copied');
        CVision.showMessage('Referral link copied.', 'success');
    } catch (error) {
        console.error('Failed to copy:', error);
        CVision.showMessage('Failed to copy referral link', 'error');
    }
}

/**
 * Share via email
 */
function shareViaEmail() {
    const subject = encodeURIComponent('Join me on CVision AI - AI-Powered Job Applications');
    const body = encodeURIComponent(
        `Hey! I've been using CVision AI for my job search and it's amazing. It uses AI to automatically find and apply to jobs that match my profile.\n\n` +
        `Use my referral code ${userReferralCode} when you sign up and we both get bonus applications!\n\n` +
        `Sign up here: ${window.location.origin}/register?ref=${userReferralCode}`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
}

/**
 * Share via Twitter
 */
function shareViaTwitter() {
    const text = encodeURIComponent(
        `I'm using CVision AI for automated job applications. Join me with code ${userReferralCode} and get bonus applications!`
    );
    const url = encodeURIComponent(`${window.location.origin}/register?ref=${userReferralCode}`);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank');
}

/**
 * Share via LinkedIn
 */
function shareViaLinkedIn() {
    const url = encodeURIComponent(`${window.location.origin}/register?ref=${userReferralCode}`);
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${url}`, '_blank');
}

/**
 * Share via WhatsApp
 */
function shareViaWhatsApp() {
    const text = encodeURIComponent(
        `Hey! Check out CVision AI - it uses AI to automate job applications. Use my code ${userReferralCode} when signing up: ${window.location.origin}/register?ref=${userReferralCode}`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
}

/**
 * Export referrals to CSV
 */
async function exportReferrals() {
    try {
        const response = await fetch(
            `${API_BASE_URL}/api/v1/subscriptions/referral/export`,
            {
                headers: {
                    'Authorization': `Bearer ${CVision.getToken()}`
                }
            }
        );

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `referrals_${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            CVision.showMessage('Referrals exported successfully', 'success');
        } else {
            throw new Error('Export failed');
        }
    } catch (error) {
        console.error('Error exporting referrals:', error);
        CVision.showMessage('Failed to export referrals', 'error');
    }
}

/**
 * Show share modal
 */
function showShareModal() {
    const modal = document.getElementById('shareModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

/**
 * Close share modal
 */
function closeShareModal() {
    const modal = document.getElementById('shareModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

/**
 * Format date for display
 */
function formatDate(dateString) {
    if (!dateString) return 'N/A';

    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        return 'Today';
    } else if (diffDays === 1) {
        return 'Yesterday';
    } else if (diffDays < 7) {
        return `${diffDays} days ago`;
    } else if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    } else if (diffDays < 365) {
        const months = Math.floor(diffDays / 30);
        return `${months} month${months > 1 ? 's' : ''} ago`;
    } else {
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }
}

/**
 * Format currency
 */
function formatCurrency(amount, currency = 'USD') {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency
    }).format(amount);
}

/**
 * Refresh all data
 */
async function refreshAllData() {
    CVision.showMessage('Refreshing data...', 'info');
    await Promise.all([
        loadReferralCode(),
        loadReferralStats(),
        loadReferralList(currentReferralPage),
        loadRecentActivity()
    ]);
    CVision.showMessage('Data refreshed successfully', 'success');
}

// Auto-refresh stats every 60 seconds
setInterval(() => {
    loadReferralStats();
}, 60000);

// Make functions globally available
window.loadTierCards = loadTierCards;
window.copyReferralCode = copyReferralCode;
window.copyReferralLink = copyReferralLink;
window.shareViaEmail = shareViaEmail;
window.shareViaTwitter = shareViaTwitter;
window.shareViaLinkedIn = shareViaLinkedIn;
window.shareViaWhatsApp = shareViaWhatsApp;
window.filterReferrals = filterReferrals;
window.exportReferrals = exportReferrals;
window.showShareModal = showShareModal;
window.closeShareModal = closeShareModal;
window.loadReferralList = loadReferralList;
window.refreshAllData = refreshAllData;