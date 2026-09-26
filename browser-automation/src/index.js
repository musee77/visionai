// browser-automation/src/index.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');
const { AutofillEngine } = require('./automation/autofill');
const { FormDetector } = require('./automation/form-detector');
const { SiteHandlerFactory } = require('./automation/site-handlers/factory');
const { AuthHandler } = require('./automation/auth-handler');

const app = express();
const PORT = process.env.PORT || 3001;
const AUTH_TOKEN = process.env.BROWSER_AUTOMATION_TOKEN || 'dev-automation-token';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const activeSessions = new Map();

const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.substring(7);
    if (token !== AUTH_TOKEN) return res.status(401).json({ error: 'Invalid token' });
    next();
};

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'Browser Automation Service',
        active_sessions: activeSessions.size,
        version: '2.6.0'
    });
});

app.post('/api/automation/start', authenticate, async (req, res) => {
    const { session_id, url, autofill_data, job_source } = req.body;
    if (!session_id || !url || !autofill_data) return res.status(400).json({ error: 'Missing fields' });

    try {
        const headlessEnv = process.env.HEADLESS ? process.env.HEADLESS.toLowerCase().trim() : 'true';
        const isHeadless = headlessEnv !== 'false';

        delete process.env.PWDEBUG;
        process.env.DEBUG = '0';

        const browser = await chromium.launch({
            headless: isHeadless,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
            slowMo: 50,
        });

        const context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        });

        const page = await context.newPage();
        activeSessions.set(session_id, { browser, context, page, autofill_data, job_source, started_at: new Date(), status: 'initialized' });

        performAutofill(session_id, url, autofill_data, job_source, page).catch(err => {
            console.error(`Autofill error:`, err);
            updateSessionStatus(session_id, 'error', err.message);
        });

        res.json({ browser_session_id: session_id, status: 'started' });
    } catch (error) {
        res.status(500).json({ error: 'Failed' });
    }
});

app.get('/api/automation/status/:session_id', authenticate, (req, res) => {
    const { session_id } = req.params;
    const session = activeSessions.get(session_id);
    if (!session) return res.status(404).json({ error: 'Not found' });
    res.json({
        session_id,
        status: session.status,
        filled_fields: session.filled_fields || [],
        errors: session.errors || [],
        new_credentials: session.portal_credentials || null,
        verification_domain: session.portal_credentials?.domain || null
    });
});

app.post('/api/automation/close/:session_id', authenticate, async (req, res) => {
    const session = activeSessions.get(req.params.session_id);
    if (session) {
        await session.context.close();
        await session.browser.close();
        activeSessions.delete(req.params.session_id);
    }
    res.json({ success: true });
});

async function performAutofill(session_id, url, autofillData, jobSource, page) {
    const session = activeSessions.get(session_id);
    const handler = SiteHandlerFactory.getHandler(url, jobSource);
    let activePage = page;
    let applyClickCount = 0;
    let attempts = 0;
    const maxAttempts = 6;
    const filledFields = [];

    try {
        updateSessionStatus(session_id, 'navigating');
        await activePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await activePage.waitForTimeout(3000);

        // --- DYNAMIC MULTI-STAGE LOOP ---
        while (attempts < maxAttempts) {
            attempts++;
            console.log(`[Autofill] Stage ${attempts} | URL: ${activePage.url()}`);

            const formDetector = new FormDetector(activePage);
            const authHandler = new AuthHandler(activePage, formDetector, handler, autofillData);
            const pageType = await authHandler.classifier.classify();
            console.log(`[Autofill] Page classified as: ${pageType}`);

            if (pageType === 'captcha') {
                updateSessionStatus(session_id, 'manual_action_required', 'CAPTCHA detected.');
                return;
            }

            // 1. Handle Job Description
            if (pageType === 'job_description' && applyClickCount < 3) {
                applyClickCount++;
                console.log(`[Autofill] Job description - Clicking Apply/Continue (Attempt ${applyClickCount})...`);
                const newPage = await handler.preparePage(activePage);
                if (newPage && newPage !== activePage) {
                    activePage = newPage;
                    if (session) session.page = activePage;
                    await activePage.waitForLoadState('domcontentloaded').catch(() => { });
                }
                await activePage.waitForTimeout(4000);
                continue;
            }

            // 2. Handle Auth Wall
            if (pageType === 'login' || pageType === 'register') {
                console.log('[Autofill] Auth Wall detected.');
                const authResult = await authHandler.handleAuth({
                    autoCreateAccount: autofillData.auto_create_account || false,
                    credentials: autofillData.portal_credentials
                });
                if (authResult.status === 'pending_verification') {
                    updateSessionStatus(session_id, 'pending_verification', authResult.message);
                    session.portal_credentials = authResult.credentials;
                    return;
                } else if (authResult.status === 'needs_authentication') {
                    throw new Error('LOGIN_REQUIRED');
                } else if (authResult.status === 'success') {
                    await activePage.waitForTimeout(4000);
                    continue;
                }
            }

            // 3. Find and Fill Forms
            const forms = await formDetector.detectForms();
            const excludePatterns = ['search', 'filter', 'subscribe', 'newsletter'];
            const appForms = forms.filter(form => {
                const combinedText = form.fields?.map(f => `${f.name} ${f.id} ${f.placeholder} ${f.label}`).join(' ').toLowerCase();
                const isSearch = excludePatterns.some(p => combinedText.includes(p));
                const hasAppFields = combinedText.includes('email') || combinedText.includes('name') || combinedText.includes('resume') ||
                    combinedText.includes('cv') || combinedText.includes('apply');
                return !isSearch || hasAppFields;
            });

            if (appForms.length > 0) {
                console.log(`[Autofill] Found ${appForms.length} application forms. Filling...`);
                updateSessionStatus(session_id, 'filling_forms');
                const autofillEngine = new AutofillEngine(activePage, handler);
                const result = await autofillEngine.fillForms(appForms, autofillData);
                filledFields.push(...result);
                session.filled_fields = filledFields;

                // Try to SUBMIT or Click NEXT
                console.log('[Autofill] Attempting to submit/proceed to next page...');
                const subBtn = await activePage.$('button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Next"), button:has-text("Continue"), button:has-text("Proceed"), button:has-text("Continue Application"), [role="button"]:has-text("Apply"), [role="button"]:has-text("Continue")');
                if (subBtn) {
                    await subBtn.click();
                    await activePage.waitForTimeout(5000);
                    continue; // See if there is more on the next page
                } else {
                    console.log('[Autofill] No submit button found. Presuming completion.');
                    break;
                }
            }

            // 4. Default / Stuck
            console.log('[Autofill] No conclusive state. Waiting for changes...');
            await activePage.waitForTimeout(4000);
            if (attempts > 3 && appForms.length === 0) break; // Exit if stuck
        }

        if (filledFields.length === 0) throw new Error('No form found or filled after multiple attempts.');

        updateSessionStatus(session_id, 'completed', null, filledFields);
        await activePage.screenshot({ path: `/tmp/done-${session_id}.png` }).catch(() => { });

    } catch (error) {
        console.error('Autofill error:', error);
        updateSessionStatus(session_id, 'error', error.message);
    }
}

function updateSessionStatus(session_id, status, error = null, filledFields = null) {
    const session = activeSessions.get(session_id);
    if (!session) return;
    session.status = status;
    session.updated_at = new Date();
    if (error) {
        session.errors = session.errors || [];
        session.errors.push({ message: error, timestamp: new Date() });
    }
    if (filledFields) session.filled_fields = filledFields;
}

app.listen(PORT, () => {
    console.log(`Service running on port ${PORT}`);
});