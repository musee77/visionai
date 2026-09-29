/**
 * CVision Geolocation Utility
 * Detects user's location and provides country/currency information
 * 
 * Usage:
 *   await CVision.Geolocation.detect();
 *   const country = CVision.Geolocation.getCountry();
 *   const currency = CVision.Geolocation.getCurrency();
 */

(function (global) {
    'use strict';

    // Country to currency mapping
    const COUNTRY_CURRENCY_MAP = {
        // Africa
        'KE': 'KES',  // Kenya
        'NG': 'NGN',  // Nigeria
        'ZA': 'ZAR',  // South Africa
        'GH': 'GHS',  // Ghana
        'UG': 'UGX',  // Uganda
        'TZ': 'TZS',  // Tanzania
        'RW': 'RWF',  // Rwanda
        'ET': 'ETB',  // Ethiopia
        'EG': 'EGP',  // Egypt
        'MA': 'MAD',  // Morocco

        // Americas
        'US': 'USD',  // United States
        'CA': 'CAD',  // Canada
        'MX': 'MXN',  // Mexico
        'BR': 'BRL',  // Brazil

        // Europe
        'GB': 'GBP',  // United Kingdom
        'DE': 'EUR',  // Germany
        'FR': 'EUR',  // France
        'IT': 'EUR',  // Italy
        'ES': 'EUR',  // Spain
        'NL': 'EUR',  // Netherlands
        'BE': 'EUR',  // Belgium
        'AT': 'EUR',  // Austria
        'PT': 'EUR',  // Portugal
        'IE': 'EUR',  // Ireland
        'FI': 'EUR',  // Finland
        'CH': 'CHF',  // Switzerland
        'SE': 'SEK',  // Sweden
        'NO': 'NOK',  // Norway
        'DK': 'DKK',  // Denmark
        'PL': 'PLN',  // Poland

        // Asia
        'IN': 'INR',  // India
        'CN': 'CNY',  // China
        'JP': 'JPY',  // Japan
        'KR': 'KRW',  // South Korea
        'SG': 'SGD',  // Singapore
        'AE': 'AED',  // UAE
        'SA': 'SAR',  // Saudi Arabia
        'PK': 'PKR',  // Pakistan
        'BD': 'BDT',  // Bangladesh
        'PH': 'PHP',  // Philippines
        'ID': 'IDR',  // Indonesia
        'MY': 'MYR',  // Malaysia
        'TH': 'THB',  // Thailand
        'VN': 'VND',  // Vietnam

        // Oceania
        'AU': 'AUD',  // Australia
        'NZ': 'NZD'   // New Zealand
    };

    // Default location data
    let locationData = {
        detected: false,
        countryCode: 'KE',
        countryName: 'Kenya',
        city: null,
        region: null,
        currency: 'KES',
        timezone: 'Africa/Nairobi',
        ip: null
    };

    // Cache key for sessionStorage
    const CACHE_KEY = 'cvision_geolocation';
    const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

    const Geolocation = {
        /**
         * Detect user's location using IP geolocation with multiple fallbacks
         * @returns {Promise<Object>} Location data
         */
        async detect() {
            // Check cache first
            try {
                const cached = sessionStorage.getItem(CACHE_KEY);
                if (cached) {
                    const { data, timestamp } = JSON.parse(cached);
                    if (Date.now() - timestamp < CACHE_DURATION) {
                        locationData = data;
                        return locationData;
                    }
                }
            } catch (e) { /* ignore cache errors */ }

            // Build providers list based on protocol
            const providers = [];

            // ip-api.com only works on HTTP (free tier doesn't support HTTPS)
            if (window.location.protocol === 'http:') {
                providers.push({
                    url: 'http://ip-api.com/json/?fields=status,country,countryCode,city,regionName,timezone',
                    parse: (data) => data.status === 'success' ? {
                        countryCode: data.countryCode,
                        countryName: data.country,
                        city: data.city,
                        region: data.regionName,
                        timezone: data.timezone
                    } : null
                });
            }

            // On HTTPS, we skip external APIs (they're all rate-limited or have CORS issues)
            // and rely on the timezone fallback below

            for (const provider of providers) {
                try {
                    const response = await fetch(provider.url, {
                        signal: AbortSignal.timeout(3000)
                    });

                    if (response.ok) {
                        const data = await response.json();
                        const parsed = provider.parse(data);

                        if (parsed) {
                            locationData = {
                                detected: true,
                                countryCode: parsed.countryCode || 'KE',
                                countryName: parsed.countryName || 'Kenya',
                                city: parsed.city || null,
                                region: parsed.region || null,
                                currency: COUNTRY_CURRENCY_MAP[parsed.countryCode] || 'KES',
                                timezone: parsed.timezone || 'Africa/Nairobi',
                                ip: parsed.ip || null
                            };

                            // Cache successful result
                            try {
                                sessionStorage.setItem(CACHE_KEY, JSON.stringify({
                                    data: locationData,
                                    timestamp: Date.now()
                                }));
                            } catch (e) { /* ignore cache errors */ }

                            return locationData;
                        }
                    }
                } catch (error) {
                    // Continue to next provider
                }
            }

            // Final fallback: detect country from browser timezone
            try {
                const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                const tzCountryMap = {
                    'Africa/Nairobi': 'KE', 'Africa/Lagos': 'NG', 'Africa/Johannesburg': 'ZA',
                    'Africa/Cairo': 'EG', 'Africa/Accra': 'GH', 'Africa/Kampala': 'UG',
                    'America/New_York': 'US', 'America/Los_Angeles': 'US', 'America/Chicago': 'US',
                    'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Mexico_City': 'MX',
                    'Europe/London': 'GB', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE',
                    'Europe/Amsterdam': 'NL', 'Europe/Rome': 'IT', 'Europe/Madrid': 'ES',
                    'Asia/Dubai': 'AE', 'Asia/Kolkata': 'IN', 'Asia/Tokyo': 'JP',
                    'Asia/Singapore': 'SG', 'Asia/Shanghai': 'CN', 'Asia/Seoul': 'KR',
                    'Australia/Sydney': 'AU', 'Pacific/Auckland': 'NZ'
                };

                const detectedCode = tzCountryMap[timezone];
                const countryNames = {
                    KE: 'Kenya', NG: 'Nigeria', ZA: 'South Africa', EG: 'Egypt', GH: 'Ghana', UG: 'Uganda',
                    US: 'United States', CA: 'Canada', MX: 'Mexico', GB: 'United Kingdom', FR: 'France',
                    DE: 'Germany', NL: 'Netherlands', IT: 'Italy', ES: 'Spain', AE: 'United Arab Emirates',
                    IN: 'India', JP: 'Japan', SG: 'Singapore', CN: 'China', KR: 'South Korea',
                    AU: 'Australia', NZ: 'New Zealand'
                };
                if (detectedCode && COUNTRY_CURRENCY_MAP[detectedCode]) {
                    locationData = {
                        detected: true,
                        countryCode: detectedCode,
                        countryName: countryNames[detectedCode] || detectedCode,
                        city: null,
                        region: null,
                        currency: COUNTRY_CURRENCY_MAP[detectedCode],
                        timezone: timezone,
                        ip: null
                    };
                }
            } catch (e) { /* ignore timezone detection errors */ }

            return locationData;
        },

        /**
         * Get detected country code (ISO 3166-1 alpha-2)
         * @returns {string} Country code (e.g., 'US', 'KE', 'GB')
         */
        getCountryCode() {
            return locationData.countryCode;
        },

        /**
         * Get detected country name
         * @returns {string} Country name
         */
        getCountryName() {
            return locationData.countryName;
        },

        /**
         * Get detected currency code (ISO 4217)
         * @returns {string} Currency code (e.g., 'USD', 'KES', 'EUR')
         */
        getCurrency() {
            return locationData.currency;
        },

        /**
         * Get full location data
         * @returns {Object} Full location data object
         */
        getData() {
            return { ...locationData };
        },

        /**
         * Check if location has been detected
         * @returns {boolean}
         */
        isDetected() {
            return locationData.detected;
        },

        /**
         * Manually set location (useful for testing or user preference)
         * @param {string} countryCode ISO country code
         */
        setCountry(countryCode) {
            if (COUNTRY_CURRENCY_MAP[countryCode]) {
                locationData.countryCode = countryCode;
                locationData.currency = COUNTRY_CURRENCY_MAP[countryCode];
                locationData.detected = true;
            }
        },

        /**
         * Get supported countries list
         * @returns {Object} Country to currency mapping
         */
        getSupportedCountries() {
            return { ...COUNTRY_CURRENCY_MAP };
        }
    };

    // Expose to global CVision namespace
    global.CVision = global.CVision || {};
    global.CVision.Geolocation = Geolocation;

})(typeof window !== 'undefined' ? window : this);
