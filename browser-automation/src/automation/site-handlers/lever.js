const { GenericHandler } = require('./generic');

class LeverHandler extends GenericHandler {
    constructor() {
        super();
        this.name = 'Lever';
    }

    async fillForm(page, form, autofillData) {
        const flat = this.extractAutofillData(autofillData);
        const pairs = [
            ['input[name="name"]', flat.fullName, 'full_name'],
            ['input[name="email"]', flat.email, 'email'],
            ['input[name="phone"]', flat.phone, 'phone']
        ];
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
                console.error(`[Lever] Could not fill ${selector}:`, error.message);
            }
        }
        return filled;
    }
}

module.exports = { LeverHandler };
