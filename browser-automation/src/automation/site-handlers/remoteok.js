// browser-automation/src/automation/site-handlers/remoteok.js

const { GenericHandler } = require('./generic');
const { PageClassifier } = require('../page-classifier');

class RemoteOKHandler extends GenericHandler {
    constructor() {
        super();
        this.name = 'RemoteOK';
        this.version = '2.2';
    }

    jobIdFromUrl(url) {
        const match = String(url || '').match(/(\d+)(?:[/?#]|$)/);
        return match ? match[1] : null;
    }

    isAuthWall(url) {
        return /remoteok\.com\/(?:sign-up|signup|sign-in|signin|login)\b/i.test(String(url || ''));
    }

    async waitForSettledUrl(page) {
        const started = Date.now();
        while (Date.now() - started < 8000) {
            const current = page.url();
            if (current && current !== 'about:blank' && !/remoteok\.com\/l\//.test(current)) {
                return current;
            }
            await page.waitForTimeout(500);
        }
        return page.url();
    }

    // Open this job's apply link. RemoteOK sends logged-out visitors to sign-up.
    async preparePage(page) {
        console.log(`\n[RemoteOK V${this.version}] Handler engaged for ${page.url()}`);

        try {
            await page.waitForLoadState('domcontentloaded');

            const classifier = new PageClassifier(page);
            const pageType = await classifier.classify();
            console.log(`[RemoteOK] Current page type: ${pageType}`);

            if (pageType === 'application') {
                console.log('[RemoteOK] Application form detected on current page.');
                return page;
            }

            const jobId = this.jobIdFromUrl(page.url());
            const applyLink = jobId
                ? page.locator(`a.action-apply[href*="/l/${jobId}"]`).first()
                : page.locator('a.action-apply').first();

            if (await applyLink.count() === 0) {
                console.warn('[RemoteOK] No apply link for this job.');
                return page;
            }

            const href = await applyLink.getAttribute('href');
            const destinationUrl = new URL(href, page.url()).href;
            console.log(`[RemoteOK] Opening apply link for job ${jobId || 'unknown'}: ${destinationUrl}`);

            await applyLink.scrollIntoViewIfNeeded();
            const context = page.context();
            const newPagePromise = context.waitForEvent('page', { timeout: 10000 }).catch(() => null);
            await applyLink.click({ timeout: 8000 });
            let destinationPage = await newPagePromise;
            if (!destinationPage) {
                destinationPage = await context.newPage();
                await destinationPage.goto(destinationUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: 60000,
                    referer: page.url(),
                });
            } else {
                await destinationPage.waitForLoadState('domcontentloaded').catch(() => { });
            }

            const destination = await this.waitForSettledUrl(destinationPage);
            console.log(`[RemoteOK] Destination: ${destination}`);

            if (this.isAuthWall(destination)) {
                console.warn('[RemoteOK] Account wall detected.');
                throw new Error('LOGIN_REQUIRED');
            }

            const resultType = await new PageClassifier(destinationPage).classify();
            console.log(`[RemoteOK] Resulting page type: ${resultType}`);
            if (resultType === 'login' || resultType === 'register' || resultType === 'captcha') {
                throw new Error('LOGIN_REQUIRED');
            }

            return destinationPage;
        } catch (error) {
            if (error.message === 'LOGIN_REQUIRED') throw error;
            console.error('[RemoteOK] prepPage error:', error.message);
            return page;
        }
    }

    async fillForm(page, form, autofillData) {
        console.log(`[RemoteOK V${this.version}] Filling form...`);
        return super.fillForm(page, form, autofillData);
    }
}

module.exports = { RemoteOKHandler };
