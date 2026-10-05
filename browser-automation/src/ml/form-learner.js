const fs = require('fs');
const path = require('path');

const MODEL_PATH = path.join(__dirname, '../../data/field-model.json');

/**
 * Incremental Naive Bayes model.
 * Each successfully filled field is one training example.
 * Features are tokens from the field label, name, id, and placeholder.
 * The label is the kind of answer that was written (email, phone, first name, ...).
 * Personal answers are never stored.
 */
class FormLearner {
    constructor() {
        this.model = {
            docs: {},
            tokens: {},
            vocab: {},
            total: 0
        };
        this.load();
    }

    tokenize(field) {
        const text = [
            field && field.name,
            field && field.id,
            field && field.label,
            field && field.placeholder,
            field && field.autocomplete,
            field && field.type
        ].filter(Boolean).join(' ');

        return [...new Set(
            text.toLowerCase()
                .replace(/[^a-z0-9]+/g, ' ')
                .split(/\s+/)
                .filter((token) => token.length > 1)
        )];
    }

    train(field, fieldType) {
        const tokens = this.tokenize(field);
        if (!tokens.length || !fieldType || fieldType === 'unknown') return false;

        this.model.docs[fieldType] = (this.model.docs[fieldType] || 0) + 1;
        this.model.total += 1;
        if (!this.model.tokens[fieldType]) this.model.tokens[fieldType] = {};

        for (const token of tokens) {
            this.model.tokens[fieldType][token] = (this.model.tokens[fieldType][token] || 0) + 1;
            this.model.vocab[token] = (this.model.vocab[token] || 0) + 1;
        }
        return true;
    }

    predict(field) {
        const tokens = this.tokenize(field);
        const labels = Object.keys(this.model.docs);
        if (!tokens.length || !labels.length || this.model.total < 1) return null;

        const vocabSize = Math.max(Object.keys(this.model.vocab).length, 1);
        const scores = {};
        let best = null;

        for (const label of labels) {
            const tokenCounts = this.model.tokens[label] || {};
            const tokenTotal = Object.values(tokenCounts).reduce((sum, count) => sum + count, 0);
            let logScore = Math.log(this.model.docs[label] / this.model.total);
            for (const token of tokens) {
                const count = tokenCounts[token] || 0;
                logScore += Math.log((count + 1) / (tokenTotal + vocabSize));
            }
            scores[label] = logScore;
            if (!best || logScore > best.logScore) {
                best = { type: label, logScore };
            }
        }

        const maxLog = best.logScore;
        const weights = labels.map((label) => Math.exp(scores[label] - maxLog));
        const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
        const confidence = weightSum > 0 ? Math.exp(best.logScore - maxLog) / weightSum : 0;

        return {
            type: best.type,
            confidence,
            support: this.model.docs[best.type] || 0,
            examples: this.model.total
        };
    }

    load() {
        try {
            if (!fs.existsSync(MODEL_PATH)) return;
            const saved = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'));
            if (saved && saved.docs && saved.tokens) {
                this.model = {
                    docs: saved.docs,
                    tokens: saved.tokens,
                    vocab: saved.vocab || {},
                    total: saved.total || 0
                };
            }
        } catch (error) {
            console.error('[ML] Could not load field model:', error.message);
        }
    }

    save() {
        try {
            fs.mkdirSync(path.dirname(MODEL_PATH), { recursive: true });
            const tempPath = `${MODEL_PATH}.tmp`;
            fs.writeFileSync(tempPath, JSON.stringify(this.model));
            fs.renameSync(tempPath, MODEL_PATH);
        } catch (error) {
            console.error('[ML] Could not save field model:', error.message);
        }
    }
}

let sharedLearner = null;

function getFormLearner() {
    if (!sharedLearner) sharedLearner = new FormLearner();
    return sharedLearner;
}

module.exports = { FormLearner, getFormLearner };
