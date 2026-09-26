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
        const { autoCreateAccount = false, credentials = null } = options;
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
        const loginValue = username || email;

        if (!loginValue || !password) {
            return { status: 'error', message: 'Missing login identifier or password.' };
        }

        // Detect login forms
        const forms = await this.formDetector.detectForms();

        if (forms.length === 0) {
            return { status: 'error', message: 'No login form detected on login page.' };
        }

        // Fill the form
        // We use a simplified mapping for login
        const loginData = {
            email: loginValue,
            firstName: loginValue, // Sometimes login fields match 'name' or 'firstname' patterns
            fullName: loginValue,
            lastName: password, // This is a hack because GenericHandler doesn't know about 'password' yet
        };

        // Actually, let's update GenericHandler to support password patterns
        const filled = await this.siteHandler.fillForm(this.page, forms[0], {
            personal_info: { email: loginValue },
            password: password // We need to handle this in GenericHandler
        });

        // Manual password fill if GenericHandler skipped it
        const passwordField = await this.page.$('input[type="password"]');
        if (passwordField) {
            await passwordField.fill(password);
        }

        // Submit the form
        await Promise.all([
            this.page.keyboard.press('Enter'),
            this.page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => { })
        ]);

        return { status: 'success', message: 'Login attempt submitted.' };
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

        // 2. Generate a secure password if not provided
        const generatedPassword = Math.random().toString(36).slice(-10) + 'A1!';

        // 3. Fill the form
        // Wrap registration data in the structure expected by GenericHandler
        const registrationData = {
            ...this.autofillData,
            password: generatedPassword
        };

        const filled = await this.siteHandler.fillForm(this.page, forms[0], registrationData);

        // Explicitly fill password fields as they might not be in GenericHandler's mapping
        const passwordFields = await this.page.$$('input[type="password"]');
        for (const field of passwordFields) {
            await field.fill(generatedPassword);
        }

        // 4. Submit
        console.log('AuthHandler: Submitting registration...');
        await Promise.all([
            this.page.keyboard.press('Enter'),
            this.page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => { })
        ]);

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
        const registerKeywords = ['register', 'sign up', 'signup', 'create account', 'join'];
        const links = await this.page.$$('a');

        for (const link of links) {
            const text = await link.innerText();
            if (registerKeywords.some(k => text.toLowerCase().includes(k))) {
                console.log(`AuthHandler: Found registration link: "${text}". Navigating...`);
                await Promise.all([
                    link.click(),
                    this.page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => { })
                ]);
                return true;
            }
        }
        return false;
    }
}

module.exports = { AuthHandler };
