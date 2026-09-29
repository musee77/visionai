/**
 * CVision Currency Utility
 * Handles currency conversion, formatting, and display
 * 
 * Usage:
 *   CVision.Currency.setBaseCurrency('KES');
 *   CVision.Currency.setUserCurrency('USD');
 *   const formatted = CVision.Currency.format(260000);  // "$20.02"
 *   const converted = CVision.Currency.convert(260000); // 20.02
 */

(function (global) {
    'use strict';

    // Base currency (what prices are stored in)
    let baseCurrency = 'USD';

    // User's display currency
    let userCurrency = 'USD';

    // Exchange rates FROM base currency (USD)
    // In production, these should be fetched from an API
    const EXCHANGE_RATES = {
        // Base
        'USD': 1,

        // Major currencies (approx rates from USD)
        'KES': 129.0,
        'EUR': 0.92,
        'GBP': 0.79,
        'NGN': 1500.0,
        'ZAR': 18.5,
        'GHS': 12.0,
        'CAD': 1.35,
        'AUD': 1.5,
        'INR': 83.0
    };

    // Currency symbols and formatting
    const CURRENCY_CONFIG = {
        'KES': { symbol: 'KES', position: 'before', space: true, decimals: 0 },
        'USD': { symbol: '$', position: 'before', space: false, decimals: 2 },
        'EUR': { symbol: '€', position: 'before', space: false, decimals: 2 },
        'GBP': { symbol: '£', position: 'before', space: false, decimals: 2 },
        'CAD': { symbol: 'C$', position: 'before', space: false, decimals: 2 },
        'AUD': { symbol: 'A$', position: 'before', space: false, decimals: 2 },
        'CHF': { symbol: 'CHF', position: 'before', space: true, decimals: 2 },
        'NGN': { symbol: '₦', position: 'before', space: false, decimals: 0 },
        'ZAR': { symbol: 'R', position: 'before', space: false, decimals: 2 },
        'GHS': { symbol: 'GH₵', position: 'before', space: false, decimals: 2 },
        'UGX': { symbol: 'UGX', position: 'before', space: true, decimals: 0 },
        'TZS': { symbol: 'TZS', position: 'before', space: true, decimals: 0 },
        'INR': { symbol: '₹', position: 'before', space: false, decimals: 0 },
        'CNY': { symbol: '¥', position: 'before', space: false, decimals: 2 },
        'JPY': { symbol: '¥', position: 'before', space: false, decimals: 0 },
        'KRW': { symbol: '₩', position: 'before', space: false, decimals: 0 },
        'SGD': { symbol: 'S$', position: 'before', space: false, decimals: 2 },
        'AED': { symbol: 'AED', position: 'before', space: true, decimals: 2 },
        'SAR': { symbol: 'SAR', position: 'before', space: true, decimals: 2 },
        'PKR': { symbol: 'Rs', position: 'before', space: true, decimals: 0 },
        'PHP': { symbol: '₱', position: 'before', space: false, decimals: 2 },
        'IDR': { symbol: 'Rp', position: 'before', space: true, decimals: 0 },
        'MYR': { symbol: 'RM', position: 'before', space: true, decimals: 2 },
        'THB': { symbol: '฿', position: 'before', space: false, decimals: 2 },
        'VND': { symbol: '₫', position: 'after', space: false, decimals: 0 },
        'SEK': { symbol: 'kr', position: 'after', space: true, decimals: 2 },
        'NOK': { symbol: 'kr', position: 'after', space: true, decimals: 2 },
        'DKK': { symbol: 'kr', position: 'after', space: true, decimals: 2 },
        'PLN': { symbol: 'zł', position: 'after', space: true, decimals: 2 },
        'MXN': { symbol: 'MX$', position: 'before', space: false, decimals: 2 },
        'BRL': { symbol: 'R$', position: 'before', space: false, decimals: 2 },
        'NZD': { symbol: 'NZ$', position: 'before', space: false, decimals: 2 },
        'RWF': { symbol: 'FRw', position: 'before', space: true, decimals: 0 },
        'ETB': { symbol: 'ETB', position: 'before', space: true, decimals: 2 },
        'EGP': { symbol: 'E£', position: 'before', space: false, decimals: 2 },
        'MAD': { symbol: 'MAD', position: 'before', space: true, decimals: 2 },
        'BDT': { symbol: '৳', position: 'before', space: false, decimals: 0 }
    };

    const Currency = {
        /**
         * Set the base currency (what prices are stored in)
         * @param {string} currency ISO 4217 currency code
         */
        setBaseCurrency(currency) {
            if (EXCHANGE_RATES[currency] !== undefined) {
                baseCurrency = currency;
            }
        },

        /**
         * Set the user's display currency
         * @param {string} currency ISO 4217 currency code
         */
        setUserCurrency(currency) {
            if (EXCHANGE_RATES[currency] !== undefined) {
                userCurrency = currency;
            }
        },

        /**
         * Get the current user currency
         * @returns {string} Currency code
         */
        getUserCurrency() {
            return userCurrency;
        },

        /**
         * Get the base currency
         * @returns {string} Currency code
         */
        getBaseCurrency() {
            return baseCurrency;
        },

        /**
         * Convert amount from base currency to user currency
         * @param {number} amountInCents Amount in smallest currency unit (cents/kobo/etc)
         * @param {string} [toCurrency] Target currency (defaults to user currency)
         * @returns {number} Converted amount
         */
        convert(amountInCents, toCurrency = null) {
            const targetCurrency = toCurrency || userCurrency;
            const baseAmount = amountInCents / 100;  // Convert from cents
            const rate = EXCHANGE_RATES[targetCurrency] || 1;
            const converted = baseAmount * rate;

            // Round UP for KES (e.g. 2577.2 -> 2578)
            if (targetCurrency === 'KES') {
                return Math.ceil(converted);
            }

            return converted;
        },

        /**
         * Format amount in user's currency with proper symbol
         * @param {number} amountInCents Amount in smallest currency unit
         * @param {string} [currency] Currency to format in (defaults to user currency)
         * @returns {string} Formatted price string
         */
        format(amountInCents, currency = null) {
            const targetCurrency = currency || userCurrency;
            const convertedAmount = this.convert(amountInCents, targetCurrency);
            const config = CURRENCY_CONFIG[targetCurrency] || {
                symbol: targetCurrency,
                position: 'before',
                space: true,
                decimals: 2
            };

            // Format the number
            let formattedNum;
            if (config.decimals === 0) {
                formattedNum = Math.round(convertedAmount).toLocaleString();
            } else {
                formattedNum = convertedAmount.toFixed(config.decimals);
                // Add thousand separators
                const parts = formattedNum.split('.');
                parts[0] = parseInt(parts[0]).toLocaleString();
                formattedNum = parts.join('.');
            }

            // Apply symbol
            const space = config.space ? ' ' : '';
            if (config.position === 'before') {
                return `${config.symbol}${space}${formattedNum}`;
            } else {
                return `${formattedNum}${space}${config.symbol}`;
            }
        },

        /**
         * Format amount in base currency (for showing original price)
         * @param {number} amountInCents Amount in smallest currency unit
         * @returns {string} Formatted price string
         */
        formatBase(amountInCents) {
            return this.format(amountInCents, baseCurrency);
        },

        /**
         * Get currency symbol
         * @param {string} [currency] Currency code (defaults to user currency)
         * @returns {string} Currency symbol
         */
        getSymbol(currency = null) {
            const targetCurrency = currency || userCurrency;
            return (CURRENCY_CONFIG[targetCurrency] || {}).symbol || targetCurrency;
        },

        /**
         * Check if currency is supported
         * @param {string} currency Currency code
         * @returns {boolean}
         */
        isSupported(currency) {
            return EXCHANGE_RATES[currency] !== undefined;
        },

        /**
         * Get list of supported currencies
         * @returns {string[]} Array of currency codes
         */
        getSupportedCurrencies() {
            return Object.keys(EXCHANGE_RATES);
        },

        /**
         * Update exchange rates (for fetching live rates)
         * @param {Object} rates Object with currency codes as keys and rates as values
         */
        updateRates(rates) {
            Object.assign(EXCHANGE_RATES, rates);
        },

        /**
         * Get current exchange rate for a currency
         * @param {string} currency Currency code
         * @returns {number} Exchange rate from base currency
         */
        getRate(currency) {
            return EXCHANGE_RATES[currency] || 1;
        },

        /**
         * Fetch live exchange rates
         * @param {string} base Base currency code
         */
        async fetchRates(base = 'USD') {
            try {
                const response = await fetch(`https://open.er-api.com/v6/latest/${base}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.result === 'success') {
                        this.updateRates(data.rates);
                    }
                }
            } catch (error) {
                console.warn('[Currency] Failed to fetch live rates:', error);
            }
        },

        /**
         * Load display rates. Location from IP is only a job filter, not a currency.
         */
        async initFromGeolocation() {
            this.setUserCurrency('USD');
            await this.fetchRates('USD');
        }
    };

    // Expose to global CVision namespace
    global.CVision = global.CVision || {};
    global.CVision.Currency = Currency;

})(typeof window !== 'undefined' ? window : this);
