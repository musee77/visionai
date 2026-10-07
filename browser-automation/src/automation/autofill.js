const { FieldClassifier } = require('../ml/field-classifier');

class AutofillEngine {
    constructor(page, siteHandler) {
        this.page = page;
        this.siteHandler = siteHandler;
        this.fieldClassifier = new FieldClassifier();
    }
    
    async fillForms(forms, autofillData) {
        const filledFields = [];
        
        for (const form of forms) {
            try {
                // Use site-specific handler if available
                let handled = [];
                if (this.siteHandler && this.siteHandler.name !== 'Generic' && this.siteHandler.fillForm) {
                    const result = await this.siteHandler.fillForm(
                        this.page,
                        form,
                        autofillData
                    );
                    if (result && result.length) {
                        handled = result;
                        this.learnHandledFields(result);
                    }
                }
                const usedSelectors = handled.map((item) => item.selector).filter(Boolean);
                const remaining = {
                    ...form,
                    fields: (form.fields || []).filter((field) => !usedSelectors.some((selector) => (
                        selector === field.selector
                        || (field.id && selector.includes(field.id))
                        || (field.name && selector.includes(field.name))
                    )))
                };
                const result = await this.fillFormGeneric(remaining, autofillData);
                filledFields.push(...handled, ...result);
            } catch (error) {
                console.error('Error filling form:', error);
            }
        }
        
        this.fieldClassifier.save();
        return filledFields;
    }

    learnHandledFields(filled) {
        for (const item of filled) {
            if (!item.fieldType) continue;
            const field = item.field || {
                name: item.selector,
                id: item.selector,
                label: '',
                placeholder: ''
            };
            this.fieldClassifier.learn(field, item.fieldType);
        }
    }
    
    async fillFormGeneric(form, data) {
        const filledFields = [];
        const flat = (this.siteHandler && typeof this.siteHandler.extractAutofillData === 'function')
            ? this.siteHandler.extractAutofillData(data)
            : data;
        
        for (const field of form.fields) {
            try {
                if (field.type === 'file') {
                    const filePath = flat.resume || flat.resume_file_path || data.resume_file_path || '';
                    if (filePath) {
                        const uploaded = await this.fillField(field, filePath);
                        if (uploaded) {
                            filledFields.push({ selector: field.selector, type: 'resume', value: filePath });
                        }
                    }
                    continue;
                }
                // Classify field type using ML
                const fieldType = this.fieldClassifier.classifyField(field);
                
                // Get appropriate value
                const value = this.getValueForField(fieldType, flat);
                
                if (value) {
                    const filled = await this.fillField(field, value);
                    if (filled) {
                        this.fieldClassifier.learn(field, fieldType);
                        filledFields.push({
                            selector: field.selector,
                            type: fieldType,
                            value: field.type === 'password' ? '***' : value
                        });
                    }
                }
            } catch (error) {
                console.error(`Error filling field ${field.selector}:`, error);
            }
        }
        
        return filledFields;
    }
    
    async fillField(field, value) {
        try {
            const locator = this.page.locator(field.selector).first();

            if (field.type === 'file') {
                const fs = require('fs');
                if (!value || !fs.existsSync(String(value))) return false;
                await locator.setInputFiles(String(value));
                return true;
            }
            await locator.waitFor({ state: 'visible', timeout: 5000 });

            if (field.type === 'select') {
                await locator.selectOption({ label: String(value) }).catch(() => locator.selectOption(String(value)));
            } else if (field.type === 'checkbox' || field.type === 'radio') {
                if (value) await locator.check().catch(() => locator.click());
            } else {
                await locator.fill(String(value));
            }

            return true;
        } catch (error) {
            console.error(`Failed to fill field ${field.selector}:`, error.message);
            return false;
        }
    }
    
    getValueForField(fieldType, data) {
        const mapping = {
            'first_name': data.firstName || data.first_name,
            'last_name': data.lastName || data.last_name,
            'full_name': data.fullName || data.full_name,
            'email': data.email,
            'phone': data.phone,
            'address': data.address,
            'city': data.city,
            'state': data.state,
            'zip_code': data.zip || data.zip_code,
            'country': data.country,
            'linkedin': data.linkedin,
            'portfolio': data.portfolio,
            'github': data.github,
            'cover_letter': data.coverLetter || data.cover_letter,
            'resume': data.resume || data.resume_file_path
        };
        
        const value = mapping[fieldType];
        return value ? String(value).trim() : null;
    }
    
    async uploadFile(fileInputSelector, filePath) {
        try {
            const input = await this.page.$(fileInputSelector);
            if (input) {
                await input.uploadFile(filePath);
                return true;
            }
            return false;
        } catch (error) {
            console.error('File upload failed:', error);
            return false;
        }
    }
}

module.exports = { AutofillEngine };