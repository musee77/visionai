// browser-automation/src/automation/form-detector.js

class FormDetector {
    constructor(page) {
        this.page = page;
    }

    async detectForms() {
        return await this.page.evaluate(() => {
            // Helper functions defined inside evaluate context
            function getUniqueSelector(element) {
                if (element.id) {
                    return `#${element.id}`;
                }

                if (element.name) {
                    return `[name="${element.name}"]`;
                }

                // Build path selector
                const path = [];
                let current = element;

                while (current && current !== document.body) {
                    let selector = current.tagName.toLowerCase();

                    if (current.className) {
                        const classes = current.className.trim().split(/\s+/);
                        if (classes.length > 0) {
                            selector += '.' + classes.join('.');
                        }
                    }

                    path.unshift(selector);
                    current = current.parentElement;
                }

                return path.join(' > ');
            }

            function getFieldLabel(element) {
                // Try to find associated label
                if (element.id) {
                    const label = document.querySelector(`label[for="${element.id}"]`);
                    if (label) {
                        return label.textContent.trim();
                    }
                }

                // Check parent label
                const parentLabel = element.closest('label');
                if (parentLabel) {
                    return parentLabel.textContent.trim();
                }

                // Check nearby text
                const prev = element.previousElementSibling;
                if (prev && prev.tagName === 'LABEL') {
                    return prev.textContent.trim();
                }

                return element.placeholder || element.name || '';
            }

            function readField(input) {
                const tag = input.tagName.toLowerCase();
                let controlType = (input.type || tag || 'text').toLowerCase();
                if (tag === 'textarea') controlType = 'textarea';
                if (tag === 'select') controlType = input.multiple ? 'select-multiple' : 'select';
                const options = tag === 'select'
                    ? Array.from(input.options).slice(0, 40).map((option) => ({
                        value: option.value || option.text || '',
                        label: (option.text || option.value || '').trim().slice(0, 120)
                    })).filter((option) => option.label)
                    : [];
                return {
                    selector: getUniqueSelector(input),
                    type: controlType,
                    name: input.name,
                    id: input.id,
                    label: getFieldLabel(input),
                    placeholder: input.placeholder,
                    required: input.required,
                    autocomplete: input.autocomplete,
                    choice: input.value || '',
                    options
                };
            }

            // Main detection logic
            const forms = [];
            const formElements = document.querySelectorAll('form');

            formElements.forEach((form, index) => {
                const formData = {
                    index,
                    selector: `form:nth-of-type(${index + 1})`,
                    action: form.action,
                    method: form.method,
                    fields: []
                };

                // Find all input fields
                const inputs = form.querySelectorAll(
                    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), ' +
                    'textarea, select'
                );

                inputs.forEach((input) => {
                    const field = readField(input);
                    formData.fields.push(field);
                });

                if (formData.fields.length > 0) {
                    forms.push(formData);
                }
            });

            // Also detect standalone fields (not in a form)
            const standaloneFields = document.querySelectorAll(
                'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not(form input), ' +
                'textarea:not(form textarea), ' +
                'select:not(form select)'
            );

            if (standaloneFields.length > 0) {
                const standaloneForm = {
                    index: -1,
                    selector: 'body',
                    action: null,
                    method: null,
                    fields: []
                };

                standaloneFields.forEach((input) => {
                    standaloneForm.fields.push(readField(input));
                });

                forms.push(standaloneForm);
            }

            return forms;
        });
    }
}

// ES Module export
module.exports = { FormDetector };

// CommonJS export (comment out ES Module export above if using this)
// module.exports = { FormDetector };