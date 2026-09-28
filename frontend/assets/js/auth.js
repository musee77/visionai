// CVision Authentication JavaScript

document.addEventListener('DOMContentLoaded', function () {
    // Check if user is already authenticated
    if (CVision && CVision.Utils && CVision.Utils.isAuthenticated()) {
        window.location.href = '/dashboard';
        return;
    }

    // Initialize ForgotPasswordModal if available and needed
    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    if (forgotPasswordLink && typeof ForgotPasswordModal !== 'undefined') {
        const forgotPasswordModal = new ForgotPasswordModal();
        forgotPasswordLink.addEventListener('click', (e) => {
            e.preventDefault();
            forgotPasswordModal.open();
        });
    }

    // Initialize based on which form exists on the page
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    if (loginForm) {
        initializeLoginPage();
    }

    if (registerForm) {
        initializeRegisterPage();
    }

    // Initialize social login buttons (common to both pages)
    initializeSocialLogin();
});

function initializeLoginPage() {
    const form = document.getElementById('loginForm');
    const loginButton = document.getElementById('loginButton');
    const togglePassword = document.getElementById('togglePassword');

    // Check for URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('verified') === 'true') {
        // Wait for modal to be initialized
        setTimeout(() => {
            if (window.GenericModal && window.GenericModal.instance) {
                window.GenericModal.instance.show({
                    title: 'Email Verified!',
                    message: 'Your email has been successfully verified. You can now sign in to your account.',
                    type: 'success',
                    buttonText: 'Got it'
                });
            } else {
                // Fallback if modal script not loaded yet
                InlineMessage.success('Email verified successfully! Please sign in.');
            }
        }, 300); // Small delay to ensure DOM is ready
    }

    // Password toggle functionality
    if (togglePassword) {
        const passwordInput = document.getElementById('password');
        if (passwordInput) {
            togglePassword.addEventListener('click', function () {
                const type = passwordInput.type === 'password' ? 'text' : 'password';
                passwordInput.type = type;
            });
        }
    }

    // Form submission handler
    if (form) {
        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            await handleLogin();
        });
    }

    // Forgot password modal handler
    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    const forgotPasswordModal = document.getElementById('forgotPasswordModal');
    const closeForgotModal = document.getElementById('closeForgotModal');

    if (forgotPasswordLink && forgotPasswordModal) {
        forgotPasswordLink.addEventListener('click', function (e) {
            e.preventDefault();
            forgotPasswordModal.classList.remove('hidden');
        });
    }

    if (closeForgotModal && forgotPasswordModal) {
        closeForgotModal.addEventListener('click', function () {
            forgotPasswordModal.classList.add('hidden');
        });
    }
}

function initializeRegisterPage() {
    const form = document.getElementById('registerForm');
    const registerButton = document.getElementById('registerButton');
    const togglePassword = document.getElementById('togglePassword');

    // Password toggle functionality
    if (togglePassword) {
        const passwordInput = document.getElementById('password');
        if (passwordInput) {
            togglePassword.addEventListener('click', function () {
                const type = passwordInput.type === 'password' ? 'text' : 'password';
                passwordInput.type = type;
            });
        }
    }

    // Form submission handler
    if (form) {
        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            await handleRegister();
        });
    }
}

function initializeSocialLogin() {
    // Initialize Social Login Components
    if (typeof GoogleLoginManager !== 'undefined') {
        new GoogleLoginManager();
    }

    if (typeof LinkedInLoginManager !== 'undefined') {
        new LinkedInLoginManager();
    }
}

async function handleLogin() {
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const loginButton = document.getElementById('loginButton');

    if (!emailInput || !passwordInput) {
        return;
    }

    // Clear previous errors
    InlineMessage.clear();

    // Get form values
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const rememberMe = document.getElementById('rememberMe')?.checked || false;

    // Validate inputs
    if (!validateLoginForm(email, password)) {
        return;
    }

    try {
        // Show loading state
        if (loginButton) {
            setButtonLoading(loginButton, true);
        }

        // Detect location
        let location = null;
        try {
            // Check if CVision.Geolocation exists
            if (CVision.Geolocation) {
                const geoData = await CVision.Geolocation.detect();
                if (geoData && geoData.detected) {
                    location = {
                        code: geoData.countryCode,
                        name: geoData.countryName,
                        currency: geoData.currency
                    };
                }
            }
        } catch (err) {
            console.warn('Geolocation detection failed:', err);
        }

        // Make login request
        const response = await CVision.API.login({
            email: email,
            password: password,
            remember_me: rememberMe,
            location: location
        });

        if (response.success) {
            // Store tokens and user data
            CVision.Utils.setToken(response.data.access_token);
            if (response.data.refresh_token) {
                CVision.Utils.setRefreshToken(response.data.refresh_token);
            }
            CVision.Utils.setUser(response.data.user);

            // Start token refresh timer
            if (typeof CVision.startTokenRefreshTimer === 'function') {
                CVision.startTokenRefreshTimer();
            }

            InlineMessage.success('Logged In successfully! Redirecting to Dashboard...');

            // Redirect to dashboard
            setTimeout(() => {
                window.location.href = '/dashboard';
            }, 1000);
        } else {
            throw new Error(response.message || 'Login failed');
        }

    } catch (error) {
        console.error('Login error:', error);

        const errorMessage = error.message || 'Login failed. Please try again.';

        if (window.GenericModal && window.GenericModal.instance) {
            window.GenericModal.instance.show({
                title: 'Login Failed',
                message: errorMessage,
                type: 'error'
            });
        } else {
            InlineMessage.error(errorMessage);
        }

    } finally {
        if (loginButton) {
            setButtonLoading(loginButton, false);
        }
    }
}

async function handleRegister() {
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const termsInput = document.getElementById('terms');
    const registerButton = document.getElementById('registerButton');

    if (!emailInput || !passwordInput) {
        console.error('Register form inputs not found');
        return;
    }

    // Clear previous errors
    InlineMessage.clear();

    // Get form values
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const termsAccepted = termsInput ? termsInput.checked : false;

    // Validate inputs
    if (!validateRegisterForm(email, password, termsAccepted)) {
        return;
    }

    try {
        // Show loading state
        if (registerButton) {
            setButtonLoading(registerButton, true);
        }

        // Make register request
        const referralCode = new URLSearchParams(window.location.search).get('ref');
        const response = await CVision.API.register({
            email: email,
            password: password,
            ...(referralCode ? { referral_code: referralCode } : {})
        });

        if (response.success) {
            // Redirect to verification pending page
            window.location.href = `/verification-pending?email=${encodeURIComponent(email)}`;
        } else {
            throw new Error(response.message || 'Registration failed');
        }


    } catch (error) {
        console.error('Registration error:', error);

        const errorMessage = error.message || 'Registration failed. Please try again.';

        if (window.GenericModal && window.GenericModal.instance) {
            window.GenericModal.instance.show({
                title: 'Registration Failed',
                message: errorMessage,
                type: 'error'
            });
        } else {
            InlineMessage.error(errorMessage);
        }

    } finally {
        if (registerButton) {
            setButtonLoading(registerButton, false);
        }
    }
}

function validateLoginForm(email, password) {
    let errors = [];

    // Validate email
    if (!email) {
        errors.push('Email is required');
    } else if (!isValidEmail(email)) {
        errors.push('Please enter a valid email address');
    }

    // Validate password
    if (!password) {
        errors.push('Password is required');
    }

    if (errors.length > 0) {
        if (window.GenericModal && window.GenericModal.instance) {
            window.GenericModal.instance.show({
                title: 'Validation Error',
                message: errors.join('\n'),
                type: 'error'
            });
        } else {
            InlineMessage.error(errors.join('. '));
        }
        return false;
    }

    return true;
}

function validateRegisterForm(email, password, termsAccepted) {
    let errors = [];

    // Validate email
    if (!email) {
        errors.push('Email is required');
    } else if (!isValidEmail(email)) {
        errors.push('Please enter a valid email address');
    }

    // Validate password
    if (!password) {
        errors.push('Password is required');
    } else if (password.length < 6) {
        errors.push('Password must be at least 6 characters long');
    }

    // Validate terms
    if (!termsAccepted) {
        errors.push('You must agree to the Terms of Service');
    }

    if (errors.length > 0) {
        if (window.GenericModal && window.GenericModal.instance) {
            window.GenericModal.instance.show({
                title: 'Validation Error',
                message: errors.join('\n'),
                type: 'error'
            });
        } else {
            InlineMessage.error(errors.join('. '));
        }
        return false;
    }

    return true;
}

function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function setButtonLoading(button, loading) {
    if (!button) return;

    const textElement = button.querySelector('.button-text');
    const spinnerElement = button.querySelector('.loading-spinner');

    if (loading) {
        button.disabled = true;
        button.classList.add('opacity-75', 'cursor-not-allowed');
        if (textElement) textElement.classList.add('opacity-0');
        if (spinnerElement) spinnerElement.classList.remove('hidden');
    } else {
        button.disabled = false;
        button.classList.remove('opacity-75', 'cursor-not-allowed');
        if (textElement) textElement.classList.remove('opacity-0');
        if (spinnerElement) spinnerElement.classList.add('hidden');
    }
}

// Google login is now handled by GoogleLoginManager component

// LinkedIn login is now handled by LinkedInLoginManager component

// Export functions for external use if needed
window.CVisionAuth = {
    handleLogin,
    handleRegister,
    validateLoginForm,
    validateRegisterForm,
    setButtonLoading
};
