// browser-automation/src/automation/auth-handler.js
const { PageClassifier } = require('./page-classifier');

/**
 * AuthHandler
 * 
 * Handles authentication walls (Login/Registration) encountered during automation.
 */
class AuthHandler {
    constructor(page, formDetector, siteHandler, autofillData) {
        this.page = page;
        this.formDetector = formDetector;
        this.siteHandler = siteHandler;
        this.autofillData = autofillData;
        this.classifier = new PageClassifier(page);
    }

    /**
     * Detect and handle auth walls if present
     * @returns {Promise<{status: string, message: string, credentials_extracted?: any}>}
     */
    async handleAuth(options = {}) {
        const { autoCreateAccount = false, credentials = null, email = '' } = options;
        this.connectedEmail = email || this.autofillData.connected_email || this.autofillData.personal_info?.email || '';
        const pageType = await this.classifier.classify();

        console.log(`AuthHandler: Detected page type: ${pageType}`);

        if (pageType === 'login') {
            if (credentials) {
                console.log('AuthHandler: Attempting login with provided credentials...');
                return await this.performLogin(credentials);
            } else if (autoCreateAccount) {
                console.log('AuthHandler: No credentials but autoCreateAccount is true. Looking for registration link...');
                const registerLinkFound = await this.navigateToRegister();
                if (registerLinkFound) {
                    return await this.handleAuth(options); // Recursive call after navigation
                }
            }
            return { status: 'needs_authentication', message: 'Login required but no credentials provided.' };
        }

        if (pageType === 'register') {
            if (autoCreateAccount) {
                console.log('AuthHandler: Attempting registration...');
                return await this.performRegistration();
            }
            return { status: 'needs_authentication', message: 'Registration required but auto-account creation is disabled.' };
        }

        return { status: 'ok', message: 'No auth wall detected.' };
    }

    /**
     * Perform login using provided credentials
     */
    async performLogin(credentials) {
        const { username, password, email } = credentials;
        const loginValue = email || username || this.connectedEmail;

        if (!loginValue || !password) {
            return { status: 'error', message: 'Missing login identifier or password.' };
        }

        const emailField = this.page.locator('input[type="email"], input[name*="email" i], input[id*="email" i]').first();
        if (await emailField.count()) {
            await emailField.fill(loginValue);
        }
        const passwordField = this.page.locator('input[type="password"]').first();
        if (await passwordField.count()) {
            await passwordField.fill(password);
        } else {
            return { status: 'error', message: 'No password field on the login page.' };
        }

        await this.submitAuthForm();
        return {
            status: 'success',
            message: 'Login attempt submitted.',
            credentials: { email: loginValue, password, domain: new URL(this.page.url()).hostname }
        };
    }

    /**
     * Perform registration using user data
     */
    async performRegistration() {
        console.log('AuthHandler: Starting registration flow...');

        // 1. Detect registration forms
        const forms = await this.formDetector.detectForms();

        if (forms.length === 0) {
            return { status: 'error', message: 'No registration form detected.' };
        }

        const accountEmail = this.connectedEmail;
        if (!accountEmail) {
            return { status: 'needs_authentication', message: 'Premium account creation needs a connected email.' };
        }

        // 2. Generate a secure password if not provided
        const generatedPassword = Math.random().toString(36).slice(-10) + 'A1!';

        // 3. Fill the form with the connected email
        const registrationData = {
            ...this.autofillData,
            connected_email: accountEmail,
            password: generatedPassword,
            personal_info: {
                ...(this.autofillData.personal_info || {}),
                email: accountEmail
            }
        };

        if (this.siteHandler && this.siteHandler.fillForm) {
            await this.siteHandler.fillForm(this.page, forms[0], registrationData);
        }
        const emailField = this.page.locator('input[type="email"], input[name*="email" i]').first();
        if (await emailField.count()) await emailField.fill(accountEmail);
        const passwordFields = this.page.locator('input[type="password"]');
        const passwordCount = await passwordFields.count();
        for (let index = 0; index < passwordCount; index += 1) {
            await passwordFields.nth(index).fill(generatedPassword);
        }

        // 4. Submit
        console.log('AuthHandler: Submitting registration...');
        await this.submitAuthForm();

        // 5. Check if we are now on a "Verify Email" page
        const newPageType = await this.classifier.classify();
        const text = await this.page.innerText('body');
        const isVerificationPending = text.toLowerCase().includes('verify') ||
            text.toLowerCase().includes('check your email') ||
            text.toLowerCase().includes('confirmation');

        if (isVerificationPending) {
            return {
                status: 'pending_verification',
                message: 'Registration successful. Email verification required.',
                credentials: {
                    email: registrationData.personal_info?.email || registrationData.user?.email,
                    password: generatedPassword,
                    domain: new URL(this.page.url()).hostname
                }
            };
        }

        return {
            status: 'success',
            message: 'Registration presumed successful.',
            credentials: {
                email: registrationData.personal_info?.email || registrationData.user?.email,
                password: generatedPassword,
                domain: new URL(this.page.url()).hostname
            }
        };
    }

    /**
     * Try to find a registration link on a login page
     */
    async navigateToRegister() {
        const link = this.page.getByRole('link', { name: /register|sign up|signup|create account|join/i }).first();
        if (!(await link.count())) return false;
        console.log('AuthHandler: Found a registration link. Navigating...');
        await link.click();
        await this.page.waitForLoadState('domcontentloaded').catch(() => { });
        return true;
    }

    async submitAuthForm() {
        const submit = this.page.locator('button[type="submit"], input[type="submit"]').first();
        if (await submit.count()) {
            await submit.click();
        } else {
            await this.page.keyboard.press('Enter');
        }
        await this.page.waitForLoadState('domcontentloaded').catch(() => { });
        await this.page.waitForTimeout(2000);
    }
}

module.exports = { AuthHandler };
