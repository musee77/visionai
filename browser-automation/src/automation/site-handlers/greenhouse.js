const { GenericHandler } = require('./generic');

class GreenhouseHandler extends GenericHandler {
    constructor() {
        super();
        this.name = 'Greenhouse';
    }

    async fillForm(page, form, autofillData) {
        const flat = this.extractAutofillData(autofillData);
        const pairs = [
            ['#first_name, input[name="job_application[first_name]"]', flat.firstName, 'first_name'],
            ['#last_name, input[name="job_application[last_name]"]', flat.lastName, 'last_name'],
            ['#email, input[name="job_application[email]"]', flat.email, 'email'],
            ['#phone, input[name="job_application[phone]"]', flat.phone, 'phone']
        ];
        return fillKnownFields(page, pairs);
    }
}

async function fillKnownFields(page, pairs) {
    const filled = [];
    for (const [selector, value, fieldType] of pairs) {
        if (!value) continue;
        const locator = page.locator(selector).first();
        if (!(await locator.count())) continue;
        try {
            await locator.fill(String(value));
            filled.push({
                selector,
                fieldType,
                field: { name: selector, id: selector, label: fieldType.replace(/_/g, ' ') },
                value: String(value)
            });
        } catch (error) {
            console.error(`[Greenhouse] Could not fill ${selector}:`, error.message);
        }
    }
    return filled;
}

module.exports = { GreenhouseHandler };
