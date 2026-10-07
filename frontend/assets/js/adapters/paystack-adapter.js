/**
 * Paystack Payment Adapter
 * 
 * Implementation of the PaymentGateway interface for Paystack.
 * 
 * Usage:
 *   // This adapter auto-registers with CVision.Payment
 *   await CVision.Payment.init('paystack', { publicKey: 'pk_xxx' });
 *   
 *   await CVision.Payment.checkout({
 *       email: 'user@example.com',
 *       amount: 260000,  // In kobo/cents
 *       currency: 'KES',
 *       onSuccess: (response) => console.log('Paid!', response),
 *       onCancel: () => console.log('Cancelled')
 *   });
 */

(function (global) {
    'use strict';

    let publicKey = null;
    let isInitialized = false;
    let paystackLoaded = false;

    /**
     * Paystack Adapter Implementation
     */
    const PaystackAdapter = {
        /**
         * Initialize Paystack with public key
         * @param {Object} config Configuration object
         * @param {string} config.publicKey Paystack public key
         */
        async init(config) {
            if (!config.publicKey) {
                throw new Error('Paystack public key is required');
            }

            publicKey = config.publicKey;

            // Check if Paystack inline JS is loaded
            if (typeof PaystackPop === 'undefined') {
                // Try to load Paystack script dynamically
                await this._loadPaystackScript();
            }

            paystackLoaded = typeof PaystackPop !== 'undefined';
            isInitialized = paystackLoaded && publicKey !== null;

            if (!paystackLoaded) {
                throw new Error('Paystack script not loaded. Include https://js.paystack.co/v1/inline.js');
            }

        },

        /**
         * Load Paystack script dynamically
         */
        async _loadPaystackScript() {
            return new Promise((resolve, reject) => {
                if (typeof PaystackPop !== 'undefined') {
                    resolve();
                    return;
                }

                const script = document.createElement('script');
                script.src = 'https://js.paystack.co/v1/inline.js';
                script.async = true;
                script.onload = () => {
                    resolve();
                };
                script.onerror = () => reject(new Error('Failed to load Paystack script'));
                document.head.appendChild(script);
            });
        },

        /**
         * Process checkout using Paystack Popup
         * @param {Object} options Checkout options
         */
        async checkout(options) {
            if (!isInitialized) {
                throw new Error('Paystack not initialized');
            }

            const {
                email,
                amount,
                currency = 'KES',
                planCode,
                reference,
                metadata = {},
                onSuccess,
                onCancel,
                onError
            } = options;

            // Validate required fields
            if (!email) throw new Error('Email is required');
            if (!amount && !planCode) throw new Error('Amount or planCode is required');

            return new Promise((resolve, reject) => {
                const paystackConfig = {
                    key: publicKey,
                    email: email.trim().toLowerCase(),
                    ref: reference,
                    currency: currency,
                    metadata: {
                        ...metadata,
                        custom_fields: [
                            {
                                display_name: "Payment Reference",
                                variable_name: "payment_reference",
                                value: reference
                            }
                        ]
                    },
                    callback: function (response) {
                        const result = {
                            success: true,
                            reference: response.reference,
                            transaction: response.transaction,
                            status: response.status,
                            provider: 'paystack',
                            raw: response
                        };

                        if (onSuccess) onSuccess(result);
                        resolve(result);
                    },
                    onClose: function () {
                        const result = {
                            success: false,
                            cancelled: true,
                            reference: reference,
                            provider: 'paystack'
                        };

                        if (onCancel) onCancel(result);
                        resolve(result);
                    }
                };

                // Charge the amount shown in the app. A Paystack plan code bills
                // the price saved in the Paystack dashboard instead.
                paystackConfig.amount = Math.ceil(amount);

                try {
                    const handler = PaystackPop.setup(paystackConfig);
                    handler.openIframe();
                } catch (error) {
                    if (onError) onError(error);
                    reject(error);
                }
            });
        },

        /**
         * Verify transaction (typically done server-side via API)
         * This is a placeholder - actual verification should be done on backend
         * @param {string} reference Transaction reference
         */
        async verify(reference) {
            console.warn('[Paystack] Client-side verification is not secure. Use backend verification.');
            return {
                reference: reference,
                provider: 'paystack',
                message: 'Verification should be done on the backend'
            };
        },

        /**
         * Check if Paystack is ready
         * @returns {boolean}
         */
        isReady() {
            return isInitialized && paystackLoaded;
        },

        /**
         * Get adapter name
         * @returns {string}
         */
        getName() {
            return 'paystack';
        },

        /**
         * Get Paystack-specific features
         * @returns {Object}
         */
        getFeatures() {
            return {
                subscriptions: true,
                oneTimePayments: true,
                mobileMoney: true,
                bankTransfer: true,
                cards: true,
                currencies: ['NGN', 'GHS', 'ZAR', 'USD', 'KES']
            };
        }
    };

    // Auto-register with CVision.Payment if available
    if (global.CVision && global.CVision.Payment) {
        global.CVision.Payment.registerAdapter('paystack', PaystackAdapter);
    } else {
        // Store for later registration
        global._paystackAdapter = PaystackAdapter;

        // Try to register when CVision.Payment becomes available
        const checkAndRegister = setInterval(() => {
            if (global.CVision && global.CVision.Payment) {
                global.CVision.Payment.registerAdapter('paystack', PaystackAdapter);
                delete global._paystackAdapter;
                clearInterval(checkAndRegister);
            }
        }, 100);

        // Stop checking after 5 seconds
        setTimeout(() => clearInterval(checkAndRegister), 5000);
    }

    // Also expose directly for manual use
    global.CVision = global.CVision || {};
    global.CVision.PaystackAdapter = PaystackAdapter;

})(typeof window !== 'undefined' ? window : this);
