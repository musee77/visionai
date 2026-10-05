// browser-automation/src/index.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');
const { AutofillEngine } = require('./automation/autofill');
const { FormDetector } = require('./automation/form-detector');
const { SiteHandlerFactory } = require('./automation/site-handlers/factory');
const { AuthHandler } = require('./automation/auth-handler');
const { PageClassifier } = require('./automation/page-classifier');

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
    const { session_id, url, autofill_data, job_source, credentials, auto_create_account } = req.body;
    if (!session_id || !url || !autofill_data) return res.status(400).json({ error: 'Missing fields' });
    autofill_data.auto_create_account = Boolean(auto_create_account || autofill_data.auto_create_account);
    autofill_data.portal_credentials = credentials || autofill_data.portal_credentials || null;
    if (autofill_data.connected_email && autofill_data.personal_info) {
        autofill_data.personal_info.email = autofill_data.connected_email;
    }

    try {
        const headlessEnv = process.env.HEADLESS ? process.env.HEADLESS.toLowerCase().trim() : 'true';
        const isHeadless = headlessEnv !== 'false';

        delete process.env.PWDEBUG;
        process.env.DEBUG = '0';

        const launchOptions = {
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
            slowMo: 50,
        };
        let browser;
        try {
            browser = await chromium.launch({ ...launchOptions, headless: isHeadless });
        } catch (launchError) {
            if (isHeadless) throw launchError;
            console.error('Headed browser failed, retrying headless:', launchError.message);
            browser = await chromium.launch({ ...launchOptions, headless: true });
        }

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
        console.error('Failed to start browser automation:', error);
        res.status(500).json({ error: 'Failed to start the browser' });
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

async function inspectTabs(context) {
    const reports = [];
    for (const tab of context.pages()) {
        const url = tab.url();
        if (!url || url === 'about:blank') continue;
        let type = 'unknown';
        try {
            type = await new PageClassifier(tab).classify();
        } catch (error) {
            type = 'unknown';
        }
        console.log(`[Tabs] ${type} | ${url}`);
        reports.push({ tab, type, url });
    }
    return reports;
}

function pickTab(reports) {
    const order = ['captcha', 'register', 'login', 'application', 'job_description', 'unknown'];
    for (const type of order) {
        const found = reports.find((report) => report.type === type);
        if (found) return found;
    }
    return reports[reports.length - 1] || null;
}

async function performAutofill(session_id, url, autofillData, jobSource, page) {
    const session = activeSessions.get(session_id);
    const handler = SiteHandlerFactory.getHandler(url, jobSource);
    let activePage = page;
    let applyClickCount = 0;
    let attempts = 0;
    const maxAttempts = 8;
    const filledFields = [];

    try {
        updateSessionStatus(session_id, 'navigating');
        await activePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await activePage.waitForTimeout(3000);

        // --- DYNAMIC MULTI-STAGE LOOP ---
        while (attempts < maxAttempts) {
            attempts++;
            const reports = await inspectTabs(session.context);
            const chosen = pickTab(reports);
            if (chosen) {
                activePage = chosen.tab;
                session.page = activePage;
                await activePage.bringToFront().catch(() => { });
            }
            const pageType = chosen ? chosen.type : 'unknown';
            console.log(`[Autofill] Stage ${attempts} | acting on ${pageType} | ${activePage.url()}`);

            const formDetector = new FormDetector(activePage);
            const authHandler = new AuthHandler(activePage, formDetector, handler, autofillData);

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
                    applyClickCount = 0;
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
                    autoCreateAccount: Boolean(autofillData.auto_create_account),
                    credentials: session.portal_credentials || autofillData.portal_credentials,
                    email: autofillData.connected_email
                });
                if (authResult.credentials) {
                    session.portal_credentials = {
                        email: authResult.credentials.email,
                        username: authResult.credentials.email,
                        password: authResult.credentials.password,
                        domain: authResult.credentials.domain,
                        portal_name: jobSource || authResult.credentials.domain
                    };
                }
                if (authResult.status === 'pending_verification') {
                    updateSessionStatus(session_id, 'pending_verification', authResult.message);
                    return;
                } else if (authResult.status === 'needs_authentication' || authResult.status === 'error') {
                    throw new Error(authResult.message || 'LOGIN_REQUIRED');
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
                const subBtn = activePage.locator('button[type="submit"], input[type="submit"], #submit_app, button:has-text("Submit application"), button:has-text("Submit")').first();
                if (await subBtn.count() && await subBtn.isVisible().catch(() => false)) {
                    await subBtn.click();
                    await activePage.waitForTimeout(5000);
                    continue;
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
        const message = error.message === 'LOGIN_REQUIRED'
            ? 'This job requires a RemoteOK account before you can apply.'
            : error.message;
        updateSessionStatus(session_id, 'error', message);
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