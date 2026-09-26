// browser-automation/src/automation/site-handlers/generic.js

class GenericHandler {
    constructor() {
        this.name = 'Generic';
    }

    /**
     * Prepare the page by finding and clicking "Apply" buttons.
     * Useful for generic sites where the form is hidden behind a button.
     */
    async preparePage(page) {
        console.log('[GenericHandler] Searching for "Apply" button...');

        // Common text on apply buttons
        const applyKeywords = [
            'continue application', 'start application', 'continue', 'proceed',
            'apply now', 'quick apply', 'apply for this job',
            'submit application', 'apply to this position', 'apply'
        ];

        // 1. Try to find by text content using Playwright's locator
        for (const keyword of applyKeywords) {
            try {
                // Look for buttons, links, or inputs with the text
                const selectors = [
                    `button:has-text("${keyword}")`,
                    `a:has-text("${keyword}")`,
                    `input[value*="${keyword}" i]`,
                    `[role="button"]:has-text("${keyword}")`,
                    `.btn:has-text("${keyword}")`,
                    `.button:has-text("${keyword}")`
                ];

                for (const selector of selectors) {
                    const element = page.locator(selector).first();
                    if (await element.isVisible()) {
                        console.log(`[GenericHandler] Found potential button with text "${keyword}" using selector: ${selector}`);

                        // Set up listener for new tabs if it opens one
                        const [newPage] = await Promise.all([
                            page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null),
                            element.click()
                        ]);

                        if (newPage) {
                            console.log('[GenericHandler] Click opened a new tab.');
                            return newPage;
                        }

                        // Wait to see if the same page changes
                        await page.waitForTimeout(2000);
                        return page;
                    }
                }
            } catch (e) {
                // Continue to next keyword/selector
            }
        }

        console.log('[GenericHandler] No obvious "Apply" button found via text.');

        // 2. Fallback: Look for aria-labels or titles
        const ariaSelectors = [
            '[aria-label*="apply" i]',
            '[title*="apply" i]'
        ];

        for (const selector of ariaSelectors) {
            try {
                const element = page.locator(selector).first();
                if (await element.isVisible()) {
                    console.log(`[GenericHandler] Found potential button via ARIA/Title: ${selector}`);
                    const [newPage] = await Promise.all([
                        page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null),
                        element.click()
                    ]);
                    return newPage || page;
                }
            } catch (e) { }
        }

        return page;
    }

    /**
     * Extract and flatten autofill data from nested structure
     */
    extractAutofillData(autofillData) {
        // Handle the ACTUAL structure from backend:
        // { personal_info: {...}, experience: [...], education: [...], skills: {...} }
        const personalInfo = autofillData.personal_info || {};
        const user = autofillData.user || {}; // Fallback for old structure
        const cvData = autofillData.cv_data || {};
        const job = autofillData.job || {};

        // Parse name into first/last if only full name provided
        let firstName = '';
        let lastName = '';
        let fullName = personalInfo.name || user.full_name || cvData.full_name || '';

        if (fullName && !firstName) {
            const parts = fullName.split(' ');
            firstName = parts[0] || '';
            lastName = parts.slice(1).join(' ') || '';
        }

        const result = {
            // Personal Information
            firstName: user.first_name || cvData.first_name || firstName,
            lastName: user.last_name || cvData.last_name || lastName,
            fullName: fullName,
            email: personalInfo.email || user.email || cvData.email || '',
            phone: personalInfo.phone || user.phone || cvData.phone || '',

            // Location - parse from personal_info.location if available
            location: personalInfo.location || '',
            address: user.address || cvData.address || '',
            city: user.city || cvData.city || '',
            state: user.state || cvData.state || '',
            zip: user.zip_code || cvData.zip_code || '',
            country: user.country || cvData.country || '',

            // Professional
            linkedin: personalInfo.linkedin || cvData.linkedin || user.linkedin || '',
            github: personalInfo.github || cvData.github || user.github || '',
            portfolio: personalInfo.portfolio || cvData.portfolio || user.portfolio || '',

            // Resume/Cover Letter
            resume: cvData.resume_path || '',
            coverLetter: autofillData.cover_letter || '',

            // Job Info (for reference)
            jobTitle: job.title || '',
            company: job.company || '',
        };

        console.log('Flattened data:', JSON.stringify(result, null, 2));
        return result;
    }

    getFieldMapping() {
        return {
            // Personal Information
            firstName: ['firstname', 'first-name', 'first_name', 'fname', 'givenname', 'given-name'],
            lastName: ['lastname', 'last-name', 'last_name', 'lname', 'surname', 'familyname', 'family-name'],
            fullName: ['fullname', 'full-name', 'full_name', 'name'],
            email: ['email', 'e-mail', 'email-address', 'emailaddress', 'mail'],
            phone: ['phone', 'telephone', 'mobile', 'phonenumber', 'phone-number', 'tel'],

            // Location
            address: ['address', 'street', 'streetaddress', 'street-address', 'address1'],
            address2: ['address2', 'address-2', 'apt', 'suite', 'unit'],
            city: ['city', 'town', 'locality'],
            state: ['state', 'province', 'region', 'county'],
            zip: ['zip', 'zipcode', 'postal', 'postcode', 'postalcode', 'postal-code'],
            country: ['country', 'nation'],

            // Professional
            linkedin: ['linkedin', 'linkedin-url', 'linkedinurl', 'linkedin-profile'],
            github: ['github', 'github-url', 'githuburl', 'github-profile'],
            portfolio: ['portfolio', 'website', 'personal-website', 'portfoliourl'],

            // Work Authorization
            authorized: ['authorized', 'work-authorized', 'eligible', 'authorization'],
            sponsorship: ['sponsorship', 'visa-sponsorship', 'require-sponsorship'],

            // Resume/Cover Letter
            resume: ['resume', 'cv', 'curriculum-vitae'],
            coverLetter: ['cover-letter', 'coverletter', 'cover_letter', 'letter'],

            // Authentication
            password: ['password', 'pass', 'pwd', 'secret'],
            passwordConfirm: ['confirm', 'verification', 'retype', 'repeat'],
        };
    }

    matchField(fieldName, fieldType, flattenedData, fieldObj = null) {
        const mapping = this.getFieldMapping();

        // Build a combined identifier from all available attributes
        let identifiers = [fieldName];
        if (fieldObj) {
            if (fieldObj.label) identifiers.push(fieldObj.label);
            if (fieldObj.autocomplete) identifiers.push(fieldObj.autocomplete);
            if (fieldObj.placeholder) identifiers.push(fieldObj.placeholder);
            if (fieldObj.id) identifiers.push(fieldObj.id);
            if (fieldObj.name) identifiers.push(fieldObj.name);
        }

        const combinedIdentifier = identifiers.filter(Boolean).join(' ');
        const normalizedName = combinedIdentifier.toLowerCase().replace(/[_\s-]/g, '');

        console.log(`Trying to match field: "${fieldName}" (combined: "${combinedIdentifier}", normalized: "${normalizedName}")`);

        // Skip if we have nothing to match on
        if (!normalizedName || normalizedName.length === 0) {
            console.log(`✗ No identifiable attributes for this field`);
            return null;
        }

        // Try to find a match
        for (const [dataKey, patterns] of Object.entries(mapping)) {
            for (const pattern of patterns) {
                const normalizedPattern = pattern.replace(/[_\s-]/g, '');
                if (normalizedName.includes(normalizedPattern)) {
                    const value = flattenedData[dataKey];
                    if (value) {
                        console.log(`✓ Matched "${fieldName}" to ${dataKey} = ${value}`);
                        return value;
                    }
                }
            }
        }

        console.log(`✗ No match found for "${fieldName}"`);
        return null;
    }

    async fillForm(page, form, autofillData) {
        // Extract and flatten the data first
        const flattenedData = this.extractAutofillData(autofillData);

        console.log(`Generic handler filling form with ${form.fields?.length || 0} fields`);
        console.log(`Flattened data:`, flattenedData);

        const filledFields = [];

        if (!form.fields || form.fields.length === 0) {
            console.log('No fields to fill in this form');
            return filledFields;
        }

        for (const field of form.fields) {
            try {
                const fieldIdentifier = field.name || field.id || field.placeholder || field.label || '';
                console.log(`Processing field: "${fieldIdentifier}" (type: ${field.type}, label: "${field.label || ''}", autocomplete: "${field.autocomplete || ''}")`);

                const value = this.matchField(
                    fieldIdentifier,
                    field.type,
                    flattenedData,
                    field  // Pass the full field object for comprehensive matching
                );

                if (value) {
                    await this.fillField(page, field, value);
                    filledFields.push({
                        field: fieldIdentifier || field.label || 'unknown',
                        value: value,
                        type: field.type
                    });
                    console.log(`✓ Filled field: "${fieldIdentifier}" with value: ${value}`);
                } else {
                    console.log(`✗ No value to fill for field: "${fieldIdentifier}"`);
                }
            } catch (error) {
                console.error(`Error filling field ${field.name || field.id}:`, error.message);
            }
        }

        return filledFields;
    }

    async fillField(page, field, value) {
        const selector = field.selector;

        if (!selector) {
            console.log('No selector for field');
            return;
        }

        try {
            // Wait for the field to be available
            await page.waitForSelector(selector, { timeout: 5000 });

            // Handle different field types
            switch (field.type) {
                case 'checkbox':
                    if (value) {
                        await page.check(selector);
                    }
                    break;

                case 'radio':
                    await page.check(selector);
                    break;

                case 'select':
                    await page.selectOption(selector, value);
                    break;

                case 'file':
                    console.log('File upload field detected - skipping for now');
                    break;

                case 'password':
                    await page.fill(selector, String(value));
                    break;

                default:
                    // Text inputs, textareas, etc.
                    await page.fill(selector, String(value));
                    break;
            }
        } catch (error) {
            console.error(`Failed to fill field ${selector}:`, error.message);
        }
    }
}

module.exports = { GenericHandler };