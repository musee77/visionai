/**
 * CVision AI Chatbot
 * Smart chatbot with keyword-based responses and human support escalation
 */

const CVisionChatbot = {
    isOpen: false,
    messages: [],
    escalationTriggered: false,
    failedAttempts: 0,
    chatState: 'normal', // normal, awaiting_email, awaiting_message
    ticketData: { email: '', message: '' },

    // Knowledge base for AI responses
    knowledgeBase: {
        greeting: {
            keywords: ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening'],
            responses: [
                "Hi there! 👋 I'm the CVision AI assistant. How can I help you today?",
                "Hello! Welcome to CVision. What can I assist you with?",
                "Hey! I'm here to help. What would you like to know about CVision?"
            ]
        },
        account: {
            keywords: ['account', 'sign up', 'register', 'login', 'password', 'reset', 'forgot'],
            responses: [
                "For account-related questions:\n\n• To create an account, click 'Get Started' in the top right\n• Forgot password? Use the 'Forgot Password' link on the login page\n• You can sign up with email, Google, or LinkedIn\n\nNeed more help with your account?"
            ]
        },
        features: {
            keywords: ['features', 'what can', 'capabilities', 'ai', 'cv analysis', 'job matching', 'auto-apply'],
            responses: [
                "CVision offers powerful AI features:\n\n🤖 AI CV Analysis - Instant resume optimization\n🎯 Smart Job Matching - Find perfect opportunities\n📝 Custom CV Generation - Tailored for each job\n✉️ AI Cover Letters - Personalized applications\n🚀 One-Click Apply - Save hours every week\n📊 Application Tracking - Monitor all applications\n\nWant to learn more about any specific feature?"
            ]
        },
        pricing: {
            keywords: ['price', 'cost', 'plan', 'subscription', 'free', 'premium', 'basic', 'upgrade'],
            responses: [
                "We have 3 pricing plans:\n\n💚 Free — $0\n• 3 manual applications per month\n\n✋ Basic — $4.99/month\n• Manual applications with no monthly cap\n\n🚀 Premium — $49.99/month\n• Automated applications\n\nWant to see the pricing page?"
            ]
        },
        howItWorks: {
            keywords: ['how', 'work', 'process', 'steps', 'start', 'use'],
            responses: [
                "Getting started with CVision is easy:\n\n1️⃣ Upload Your CV - We analyze your skills instantly\n2️⃣ Find Jobs - AI matches you with perfect opportunities\n3️⃣ Customize - Generate tailored CVs and cover letters\n4️⃣ Apply - One-click application or full automation\n\nReady to get started? Click 'Get Started' to begin!"
            ]
        },
        technical: {
            keywords: ['error', 'bug', 'not working', 'broken', 'issue', 'problem', 'upload', 'file'],
            responses: [
                "I can help with technical issues:\n\n• Supported file formats: PDF, DOCX, TXT\n• Max file size: 10MB\n• Clear your browser cache if experiencing issues\n• Try a different browser (Chrome recommended)\n\nStill having problems? I can connect you with our technical support team."
            ]
        },
        billing: {
            keywords: ['cancel', 'refund', 'payment', 'charge', 'invoice', 'billing'],
            responses: [
                "Billing information:\n\n• Cancel anytime from account settings\n• 14-day money-back guarantee\n• We accept Visa, Mastercard, Amex, PayPal\n• Upgrade/downgrade anytime (prorated)\n\nNeed help with a specific billing issue?"
            ]
        },
        contact: {
            keywords: ['contact', 'support', 'email', 'phone', 'human', 'agent', 'representative'],
            responses: [
                "You can reach our support team directly here in the chat. Would you like me to connect you with a human agent now?"
            ]
        }
    },

    quickActions: [
        "How does CVision work?",
        "What are the pricing plans?",
        "How do I upload my CV?",
        "Talk to a human"
    ],

    init() {
        if (document.getElementById('chatButton')) return;
        this.createChatWidget();
        this.attachEventListeners();
        this.sendWelcomeMessage();
    },

    createChatWidget() {
        // Only create widget if not already present
        if (document.getElementById('chatButton')) return;

        const chatHTML = `
            <!-- Chat Button -->
            <button class="chat-button" id="chatButton" aria-label="Open chat">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                        d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>
                </svg>
                <span class="notification-badge" id="chatBadge" style="display: none;">1</span>
            </button>

            <!-- Chat Window -->
            <div class="chat-window" id="chatWindow">
                <!-- Header -->
                <div class="chat-header">
                    <div class="chat-header-info">
                        <div class="chat-avatar">🤖</div>
                        <div class="chat-header-text">
                            <h3>CVision AI Assistant</h3>
                            <p>Typically replies instantly</p>
                        </div>
                    </div>
                    <div class="chat-header-actions">
                        <button class="chat-header-btn" id="chatMinimize" aria-label="Minimize chat">
                            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- Messages -->
                <div class="chat-messages" id="chatMessages"></div>

                <!-- Quick Actions -->
                <div class="quick-actions" id="quickActions"></div>

                <!-- Input Area -->
                <div class="chat-input-area">
                    <div class="chat-input-wrapper">
                        <input type="text" class="chat-input" id="chatInput" placeholder="Type your message..." />
                        <button class="chat-send-btn" id="chatSend" aria-label="Send message">
                            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', chatHTML);
    },

    attachEventListeners() {
        const chatButton = document.getElementById('chatButton');
        const chatWindow = document.getElementById('chatWindow');
        const chatMinimize = document.getElementById('chatMinimize');
        const chatInput = document.getElementById('chatInput');
        const chatSend = document.getElementById('chatSend');

        if (chatButton) chatButton.addEventListener('click', () => this.toggleChat());
        if (chatMinimize) chatMinimize.addEventListener('click', () => this.toggleChat());
        if (chatSend) chatSend.addEventListener('click', () => this.sendMessage());
        if (chatInput) chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
    },

    toggleChat() {
        this.isOpen = !this.isOpen;
        const chatWindow = document.getElementById('chatWindow');
        const chatBadge = document.getElementById('chatBadge');

        if (this.isOpen) {
            chatWindow.classList.add('active');
            chatBadge.style.display = 'none';
        } else {
            chatWindow.classList.remove('active');
        }
    },

    sendWelcomeMessage() {
        setTimeout(() => {
            this.addMessage('bot', "👋 Hi! I'm your CVision AI assistant. I can help you with questions about our features, pricing, and how to get started. How can I help you today?");
            this.showQuickActions();
            const badge = document.getElementById('chatBadge');
            if (badge) badge.style.display = 'flex';
        }, 1000);
    },

    showQuickActions() {
        if (this.chatState !== 'normal') return;

        const quickActionsContainer = document.getElementById('quickActions');
        quickActionsContainer.innerHTML = this.quickActions.map(action =>
            `<button class="quick-action-btn" onclick="CVisionChatbot.handleQuickAction('${action}')">${action}</button>`
        ).join('');
    },

    handleQuickAction(action) {
        document.getElementById('chatInput').value = action;
        this.sendMessage();
    },

    sendMessage() {
        const input = document.getElementById('chatInput');
        const message = input.value.trim();

        if (!message) return;

        this.addMessage('user', message);
        input.value = '';

        // Show typing indicator
        this.showTypingIndicator();

        // Process message and respond
        setTimeout(() => {
            this.hideTypingIndicator();
            this.processMessage(message);
        }, 1000 + Math.random() * 1000);
    },

    addMessage(sender, text) {
        const messagesContainer = document.getElementById('chatMessages');
        const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        const messageHTML = `
            <div class="chat-message ${sender}">
                <div class="message-avatar">${sender === 'bot' ? '🤖' : '👤'}</div>
                <div class="message-content">
                    <div class="message-bubble">${text.replace(/\n/g, '<br>')}</div>
                    <div class="message-time">${time}</div>
                </div>
            </div>
        `;

        messagesContainer.insertAdjacentHTML('beforeend', messageHTML);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        this.messages.push({ sender, text, time });
    },

    showTypingIndicator() {
        const messagesContainer = document.getElementById('chatMessages');
        const typingHTML = `
            <div class="chat-message bot" id="typingIndicator">
                <div class="message-avatar">🤖</div>
                <div class="message-content">
                    <div class="typing-indicator">
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                    </div>
                </div>
            </div>
        `;
        messagesContainer.insertAdjacentHTML('beforeend', typingHTML);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    },

    hideTypingIndicator() {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) indicator.remove();
    },

    processMessage(message) {
        const lowerMessage = message.toLowerCase();

        // Handle state-based flows
        if (this.chatState === 'awaiting_email') {
            this.handleEmailInput(message);
            return;
        }

        if (this.chatState === 'awaiting_message') {
            this.handleTicketMessageInput(message);
            return;
        }

        // Check for escalation keywords
        if (lowerMessage.includes('talk to a human') || lowerMessage.includes('human') || lowerMessage.includes('agent') || lowerMessage.includes('representative')) {
            this.triggerEscalation();
            return;
        }

        // Find matching category
        let response = null;
        for (const [category, data] of Object.entries(this.knowledgeBase)) {
            if (data.keywords.some(keyword => lowerMessage.includes(keyword))) {
                response = Array.isArray(data.responses)
                    ? data.responses[Math.floor(Math.random() * data.responses.length)]
                    : data.responses[0];
                this.failedAttempts = 0;
                break;
            }
        }

        // If no match found
        if (!response) {
            this.failedAttempts++;
            if (this.failedAttempts >= 2) {
                response = "I'm not sure I understand. Would you like me to connect you with a human support agent who can better assist you?";
                this.showEscalationOptions();
            } else {
                response = "I'm not sure I understand that question. Could you rephrase it? You can also try:\n\n• How does CVision work?\n• What are the pricing plans?\n• How do I upload my CV?\n• Talk to a human";
            }
        }

        this.addMessage('bot', response);
    },

    triggerEscalation() {
        this.addMessage('bot', "Okay, let me check if a support agent is available...");
        document.getElementById('quickActions').innerHTML = ''; // Clear quick actions

        // Simulate checking availability
        setTimeout(() => {
            this.startInlineSupportTicket();
        }, 2000);
    },

    startInlineSupportTicket() {
        this.addMessage('bot', "Analysis complete: All our agents are currently assisting other users. 😔\n\nHowever, I can create a priority support ticket for you right here. An agent will assume this thread and email you shortly.\n\nWhat is the best email address to reach you at?");
        this.chatState = 'awaiting_email';

        const user = window.CVision?.Utils?.getUser?.();
        if (user?.email) {
            this.ticketData.email = user.email;
            this.chatState = 'awaiting_message';
            this.addMessage('bot', `I found your account email (${user.email}). What message would you like to leave for the support team?`);
        }
    },

    handleEmailInput(email) {
        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            this.addMessage('bot', "That doesn't look like a valid email address. Please try again.");
            return;
        }

        this.ticketData.email = email;
        this.chatState = 'awaiting_message';
        this.addMessage('bot', "Got it! And what message would you like to leave for the support team?");
    },

    handleTicketMessageInput(msg) {
        this.ticketData.message = msg;
        this.chatState = 'normal';

        this.addMessage('bot', "Creating your ticket...");
        const email = this.ticketData.email;
        const message = this.ticketData.message;
        this.ticketData = { email: '', message: '' };

        const apiBase = (window.CONFIG && CONFIG.API_BASE_URL) || '';
        const prefix = (window.CONFIG && CONFIG.API_PREFIX) || '/api/v1';
        fetch(`${apiBase}${prefix}/support/tickets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, message })
        })
            .then(async (response) => {
                if (!response.ok) throw new Error('Ticket was not saved');
                const saved = await response.json();
                const followUp = saved.email_sent
                    ? `A copy was sent to the support team. They will reply to **${email}**.`
                    : `Your message is saved. The support team will reply to **${email}**.`;
                this.addMessage('bot', `Ticket #${saved.id} is open.\n\n${followUp}`);
                this.showQuickActions();
            })
            .catch(() => {
                this.addMessage('bot', 'The ticket could not be saved. Please try again in a moment.');
                this.showQuickActions();
            });
    },

    showEscalationOptions() {
        const messagesContainer = document.getElementById('chatMessages');
        const escalationHTML = `
            <div class="escalation-notice">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <p>Having trouble? Our support team is here to help!</p>
            </div>
            <div class="escalation-actions">
                <button class="escalation-btn primary" onclick="CVisionChatbot.triggerEscalation()">Talk to Human</button>
                <button class="escalation-btn secondary" onclick="CVisionChatbot.continueWithBot()">Continue with AI</button>
            </div>
        `;
        messagesContainer.insertAdjacentHTML('beforeend', escalationHTML);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    },

    continueWithBot() {
        this.failedAttempts = 0;
        this.addMessage('bot', "No problem! I'm here to help. What else would you like to know?");
        this.showQuickActions();
    }
};

// Initialize safely whether the script loads before or after DOMContentLoaded.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => CVisionChatbot.init(), { once: true });
} else {
    CVisionChatbot.init();
}

// Make openLiveChat function available globally (for help.html)
function openLiveChat() {
    if (!CVisionChatbot.isOpen) {
        CVisionChatbot.toggleChat();
    }
}
