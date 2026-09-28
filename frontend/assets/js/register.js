// CVision Authentication JavaScript - Updated for compatibility

document.addEventListener('DOMContentLoaded', function() {
    // Check if user is already authenticated
    if (CVision && CVision.Utils && CVision.Utils.isAuthenticated()) {
        window.location.href = 'dashboard.html';
        return;
    }

    // Initialize based on which form exists on the page
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('register-form');
    
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

    // Password toggle functionality
    if (togglePassword) {
        const passwordInput = document.getElementById('password');
        if (passwordInput) {
            togglePassword.addEventListener('click', function() {
                const type = passwordInput.type === 'password' ? 'text' : 'password';
                passwordInput.type = type;
            });
        }
    }

    // Form submission handler
    if (form) {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            await handleLogin();
        });
    }

    // Forgot password modal handler
    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    const forgotPasswordModal = document.getElementById('forgotPasswordModal');
    const closeForgotModal = document.getElementById('closeForgotModal');
    
    if (forgotPasswordLink && forgotPasswordModal) {
        forgotPasswordLink.addEventListener('click', function(e) {
            e.preventDefault();
            forgotPasswordModal.classList.remove('hidden');
        });
    }
    
    if (closeForgotModal && forgotPasswordModal) {
        closeForgotModal.addEventListener('click', function() {
            forgotPasswordModal.classList.add('hidden');
        });
    }
}

function initializeRegisterPage() {
    const form = document.getElementById('register-form');
    const registerButton = document.getElementById('registerButton');
    const togglePassword = document.getElementById('togglePassword');

    // Password toggle functionality
    if (togglePassword) {
        const passwordInput = document.getElementById('password');
        if (passwordInput) {
            togglePassword.addEventListener('click', function() {
                const type = passwordInput.type === 'password' ? 'text' : 'password';
                passwordInput.type = type;
            });
        }
    }

    // Form submission handler
    if (form) {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            await handleRegister();
        });
    }
}

function initializeSocialLogin() {
    const googleButton = document.getElementById('googleLogin') || document.getElementById('googleSignup');
    const linkedinButton = document.getElementById('linkedinLogin') || document.getElementById('linkedinSignup');

    if (googleButton) {
        googleButton.addEventListener('click', handleGoogleLogin);
    }

    if (linkedinButton) {
        linkedinButton.addEventListener('click', handleLinkedInLogin);
    }
}

async function handleLogin() {
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const loginButton = document.getElementById('loginButton');
    const formError = document.getElementById('formError');
    
    if (!emailInput || !passwordInput) {
        console.error('Login form inputs not found');
        return;
    }

    // Clear previous errors
    if (formError) {
        formError.classList.add('hidden');
    }
    clearFieldErrors();

    // Get form values
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    // Validate inputs
    if (!validateLoginForm(email, password)) {
        return;
    }

    try {
        // Show loading state
        if (loginButton) {
            setButtonLoading(loginButton, true);
        }

        // Make login request
        const response = await CVision.API.login({
            email: email,
            password: password
        });

        if (response.success) {
            // Store token and user data
            CVision.Utils.setToken(response.data.access_token);
            CVision.Utils.setUser(response.data.user);

            // Show success message
            CVision.Utils.showAlert('Login successful! Redirecting...', 'success');

            // Redirect to dashboard
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 1000);
        } else {
            throw new Error(response.message || 'Login failed');
        }

    } catch (error) {
        console.error('Login error:', error);
        
        const errorMessage = error.message || 'Login failed. Please try again.';
        CVision.Utils.showAlert(errorMessage, 'error');
        
        if (formError) {
            formError.textContent = errorMessage;
            formError.classList.remove('hidden');
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
    const formError = document.getElementById('formError');
    
    if (!emailInput || !passwordInput) {
        console.error('Register form inputs not found');
        return;
    }

    // Clear previous errors
    if (formError) {
        formError.classList.add('hidden');
    }
    clearFieldErrors();

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

        // Make register request - simplified to match backend expectations
        const referralCode = new URLSearchParams(window.location.search).get('ref');
        const response = await CVision.API.register({
            email: email,
            password: password,
            first_name: "",
            last_name: "",
            ...(referralCode ? { referral_code: referralCode } : {})
        });

        if (response.success) {
            // Store token and user data immediately (auto-login after registration)
            if (response.data && response.data.access_token) {
                CVision.Utils.setToken(response.data.access_token);
                CVision.Utils.setUser(response.data.user);
                CVision.Utils.showAlert('Account created successfully! Redirecting to dashboard...', 'success');
                
                // Redirect to dashboard
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 2000);
            } else {
                CVision.Utils.showAlert('Account created successfully! Please login.', 'success');
                
                // Redirect to login page
                setTimeout(() => {
                    window.location.href = 'login.html';
                }, 2000);
            }
        } else {
            throw new Error(response.message || 'Registration failed');
        }

    } catch (error) {
        console.error('Registration error:', error);
        
        const errorMessage = error.message || 'Registration failed. Please try again.';
        CVision.Utils.showAlert(errorMessage, 'error');
        
        if (formError) {
            formError.textContent = errorMessage;
            formError.classList.remove('hidden');
        }

    } finally {
        if (registerButton) {
            setButtonLoading(registerButton, false);
        }
    }
}

function validateLoginForm(email, password) {
    let isValid = true;

    // Validate email
    if (!email) {
        showFieldError('emailError', 'Email is required');
        isValid = false;
    } else if (!isValidEmail(email)) {
        showFieldError('emailError', 'Please enter a valid email address');
        isValid = false;
    }

    // Validate password
    if (!password) {
        showFieldError('passwordError', 'Password is required');
        isValid = false;
    }

    return isValid;
}

function validateRegisterForm(email, password, termsAccepted) {
    let isValid = true;

    // Validate email
    if (!email) {
        showFieldError('emailError', 'Email is required');
        isValid = false;
    } else if (!isValidEmail(email)) {
        showFieldError('emailError', 'Please enter a valid email address');
        isValid = false;
    }

    // Validate password
    if (!password) {
        showFieldError('passwordError', 'Password is required');
        isValid = false;
    } else if (password.length < 6) {
        showFieldError('passwordError', 'Password must be at least 6 characters long');
        isValid = false;
    }

    // Validate terms
    if (!termsAccepted) {
        showFieldError('termsError', 'You must agree to the Terms of Service');
        isValid = false;
    }

    return isValid;
}

function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function showFieldError(elementId, message) {
    const errorElement = document.getElementById(elementId);
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.classList.remove('hidden');
    }
}

function clearFieldErrors() {
    const errorElements = document.querySelectorAll('.error-message');
    errorElements.forEach(element => {
        element.classList.add('hidden');
    });
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

function handleGoogleLogin() {
    CVision.Utils.showAlert('Google login is coming soon! Please use email login for now.', 'info');
}

function handleLinkedInLogin() {
    CVision.Utils.showAlert('LinkedIn login is coming soon! Please use email login for now.', 'info');
}

// Export functions for external use if needed
window.CVisionAuth = {
    handleLogin,
    handleRegister,
    handleGoogleLogin,
    handleLinkedInLogin,
    validateLoginForm,
    validateRegisterForm,
    setButtonLoading
};