// browser-automation/src/automation/page-classifier.js

/**
 * PageClassifier
 * 
 * A reusable component to determine the "type" of the current page.
 * Helps the automation engine decide whether to:
 * - Login (if 'login')
 * - Fill Form (if 'application')
 * - Click Apply (if 'job_description')
 */
class PageClassifier {
    constructor(page) {
        this.page = page;
    }

    /**
     * Classify the current page based on DOM heuristics
     * @returns {Promise<string>} 'login' | 'application' | 'job_description' | 'unknown'
     */
    async classify() {
        return await this.page.evaluate(() => {
            const url = window.location.href.toLowerCase();
            const title = document.title.toLowerCase();
            const textRaw = document.body.innerText.toLowerCase();

            // 0. Check for CAPTCHA or Anti-Bot Pages
            const captchaSelectors = [
                'iframe[src*="recaptcha"]',
                'iframe[src*="hcaptcha"]',
                'iframe[src*="challenges.cloudflare.com"]',
                '.g-recaptcha',
                '#g-recaptcha',
                '.h-captcha',
                '#h-captcha',
                '#cf-turnstile',
                '#px-captcha', // PerimeterX
                '[id*="captcha"]',
                '[class*="captcha"]'
            ];

            const hasCaptcha = captchaSelectors.some(s => !!document.querySelector(s));
            const hasBotText = textRaw.includes('verify you are a human') ||
                textRaw.includes('verify you are not a robot') ||
                textRaw.includes('checking your browser') ||
                textRaw.includes('access denied');

            if (hasCaptcha || (hasBotText && textRaw.length < 2000)) {
                return 'captcha';
            }

            // 1. Check for Login/Register Pages (Auth Walls)
            // Heuristic: Password field + Keywords
            const hasPasswordField = !!document.querySelector('input[type="password"]');

            const loginKeywords = ['login', 'sign in', 'signin', 'log in', 'access'];
            const registerKeywords = ['register', 'sign up', 'signup', 'create account', 'join', 'start now', 'get started'];

            const isLoginUrl = loginKeywords.some(k => url.includes(k));
            const isLoginTitle = loginKeywords.some(k => title.includes(k));
            const isLoginContent = loginKeywords.some(k => textRaw.includes(k));

            const isRegisterUrl = registerKeywords.some(k => url.includes(k));
            const isRegisterTitle = registerKeywords.some(k => title.includes(k));
            const isRegisterContent = registerKeywords.some(k => textRaw.includes(k));

            // Strong signal: Password field represents specific intent
            if (hasPasswordField) {
                // If we see registration keywords, it's likely a signup page
                if (isRegisterUrl || isRegisterTitle) return 'register';

                // If it's a login URL or title, it's login
                if (isLoginUrl || isLoginTitle) return 'login';

                // Count input fields. Registration usually has more fields (name, confirm password, etc.)
                const inputCount = document.querySelectorAll('input:not([type="hidden"])').length;
                if (inputCount > 3 && isRegisterContent) return 'register';

                // Default for password fields is login if it's a small page
                if (textRaw.length < 3000) return 'login';
            }

            // 2. Check for Application Page
            // Heuristic: File upload or significant form density + Apply keywords
            const hasFileUpload = !!document.querySelector('input[type="file"]');
            const applyKeywords = ['apply', 'application', 'submit'];
            const isApplyUrl = applyKeywords.some(k => url.includes(k));

            const forms = document.querySelectorAll('form');
            // Count "substantive" forms (more than just a search bar)
            const niceFormCount = Array.from(forms).filter(f =>
                f.querySelectorAll('input:not([type="hidden"]), select, textarea').length > 3
            ).length;

            if (hasFileUpload) return 'application'; // File upload is a very strong signal for ATS
            if (isApplyUrl && niceFormCount > 0) return 'application';
            if (niceFormCount > 0 && title.includes('apply')) return 'application';

            // 3. Check for Job Description / Landing Page
            // Heuristic: "Apply" button exists but no substantive forms yet
            const applyButtonRegex = /apply|start application|continue application|continue|proceed/i;
            const buttons = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"]'));

            // Check visible buttons only
            const hasApplyButton = buttons.some(b => {
                const text = b.innerText || b.value || '';
                const style = window.getComputedStyle(b);
                return applyButtonRegex.test(text) && style.display !== 'none' && style.visibility !== 'hidden';
            });

            if (hasApplyButton && niceFormCount === 0) {
                return 'job_description';
            }

            // Default
            return 'unknown';
        });
    }
}

module.exports = { PageClassifier };
