// browser-automation/src/ml/field-classifier.js

const { getFormLearner } = require('./form-learner');

class FieldClassifier {
    constructor() {
        this.learner = getFormLearner();
        // Field type patterns for classification
        this.patterns = {
            first_name: [
                /first[\s_-]?name/i,
                /fname/i,
                /given[\s_-]?name/i,
                /forename/i
            ],
            last_name: [
                /last[\s_-]?name/i,
                /lname/i,
                /surname/i,
                /family[\s_-]?name/i
            ],
            full_name: [
                /^name$/i,
                /full[\s_-]?name/i,
                /complete[\s_-]?name/i
            ],
            email: [
                /e?mail/i,
                /email[\s_-]?address/i,
                /contact[\s_-]?email/i
            ],
            phone: [
                /phone/i,
                /telephone/i,
                /mobile/i,
                /contact[\s_-]?number/i,
                /phone[\s_-]?number/i
            ],
            address: [
                /^address$/i,
                /street[\s_-]?address/i,
                /address[\s_-]?line/i,
                /home[\s_-]?address/i
            ],
            city: [
                /city/i,
                /town/i
            ],
            state: [
                /state/i,
                /province/i,
                /region/i
            ],
            zip_code: [
                /zip/i,
                /postal/i,
                /postcode/i,
                /zip[\s_-]?code/i
            ],
            country: [
                /country/i,
                /nation/i
            ],
            linkedin: [
                /linkedin/i,
                /linked[\s_-]?in/i
            ],
            portfolio: [
                /portfolio/i,
                /personal[\s_-]?site/i
            ],
            website: [
                /website/i,
                /web[\s_-]?site/i,
                /personal[\s_-]?url/i
            ],
            github: [
                /github/i,
                /git[\s_-]?hub/i
            ],
            cover_letter: [
                /cover[\s_-]?letter/i,
                /motivation/i,
                /why[\s_-]?you/i,
                /about[\s_-]?yourself/i
            ],
            open_question: [
                /why\b/i,
                /describe/i,
                /tell us/i,
                /additional[\s_-]?(information|comments|details)/i,
                /anything else/i,
                /comments/i,
                /\bquestion\b/i
            ],
            resume: [
                /resume/i,
                /cv/i,
                /curriculum/i
            ]
        };
    }
    
    classifyField(field) {
        const learned = this.learner.predict(field);
        const ruled = this.matchRules(field);
        const trusted = learned
            && learned.confidence >= 0.55
            && learned.support >= 2;

        if (trusted) {
            if (ruled !== learned.type) {
                console.log(`[ML] ${this.describe(field)} -> ${learned.type} (${learned.confidence.toFixed(2)}, ${learned.support} examples)`);
            }
            return learned.type;
        }
        if (ruled !== 'unknown') return ruled;
        if (field.type === 'textarea') return 'open_question';
        if (learned && learned.confidence >= 0.4 && learned.support >= 1) {
            console.log(`[ML] ${this.describe(field)} -> ${learned.type} (${learned.confidence.toFixed(2)}, ${learned.support} examples)`);
            return learned.type;
        }
        return 'unknown';
    }

    learn(field, fieldType) {
        if (!fieldType || fieldType === 'unknown') return;
        const trained = this.learner.train(field, fieldType);
        if (trained) {
            console.log(`[ML] Learned ${fieldType} from ${this.describe(field)} (${this.learner.model.total} examples)`);
        }
    }

    save() {
        this.learner.save();
    }

    matchRules(field) {
        const features = this.extractFeatures(field);

        for (const [fieldType, patterns] of Object.entries(this.patterns)) {
            for (const pattern of patterns) {
                if (pattern.test(features.searchText)) {
                    return fieldType;
                }
            }
        }

        if (field.autocomplete) {
            const autocompleteMap = {
                'given-name': 'first_name',
                'family-name': 'last_name',
                'name': 'full_name',
                'email': 'email',
                'tel': 'phone',
                'street-address': 'address',
                'address-line1': 'address',
                'address-level2': 'city',
                'address-level1': 'state',
                'postal-code': 'zip_code',
                'country': 'country'
            };

            if (autocompleteMap[field.autocomplete]) {
                return autocompleteMap[field.autocomplete];
            }
        }

        return 'unknown';
    }

    describe(field) {
        return field.label || field.name || field.id || field.placeholder || 'field';
    }
    
    extractFeatures(field) {
        // Combine all text features for matching
        const searchText = [
            field.name,
            field.id,
            field.label,
            field.placeholder
        ].filter(Boolean).join(' ');
        
        return {
            searchText,
            type: field.type,
            required: field.required
        };
    }
}

module.exports = { FieldClassifier };