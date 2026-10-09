const InboxPage = {
    threads: [],
    activeId: null,

    escape(value) {
        return String(value || '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[char]));
    },

    when(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString();
    },

    async load() {
        const payload = await CVision.API.request('/support/inbox');
        this.threads = (payload && payload.threads) || [];
        if (this.activeId) {
            const current = this.threads.find((thread) => thread.id === this.activeId);
            if (current) {
                this.renderThread(current);
                return;
            }
        }
        this.renderList();
    },

    renderList() {
        const list = document.getElementById('inboxList');
        const thread = document.getElementById('inboxThread');
        const starter = document.getElementById('inboxStartForm');
        if (thread) thread.classList.add('hidden');
        if (starter) starter.classList.remove('hidden');
        if (!list) return;
        list.classList.remove('hidden');
        if (!this.threads.length) {
            list.innerHTML = `
                <div class="bg-white rounded-xl border border-gray-200 p-12 text-center">
                    <h2 class="text-lg font-medium text-gray-900 mb-2">No earlier messages</h2>
                    <p class="text-gray-600">Send a message above. The admin reply will show up in this chat.</p>
                </div>
            `;
            return;
        }
        list.innerHTML = this.threads.map((item) => {
            const latest = (item.messages || [])[item.messages.length - 1] || {};
            const fromAdmin = latest.sender === 'admin';
            return `
                <button type="button" data-thread="${this.escape(item.id)}"
                    class="w-full text-left bg-white rounded-xl border ${item.unread ? 'border-blue-300' : 'border-gray-200'} p-5 hover:border-blue-400">
                    <div class="flex items-center justify-between gap-3">
                        <p class="text-sm font-semibold text-gray-900">${fromAdmin ? 'Support' : 'You'}</p>
                        <span class="text-xs text-gray-500">${this.escape(this.when(latest.created_at || item.updated_at))}</span>
                    </div>
                    <p class="text-sm text-gray-700 mt-2 line-clamp-2">${this.escape(latest.body || '')}</p>
                    ${item.unread ? '<p class="text-xs font-medium text-blue-600 mt-2">New reply</p>' : ''}
                </button>
            `;
        }).join('');
    },

    async open(id) {
        this.activeId = id;
        await CVision.API.request(`/support/inbox/${id}/read`, { method: 'POST' });
        if (window.CVisionNavbar && CVisionNavbar.refresh) CVisionNavbar.refresh();
        await this.load();
    },

    renderThread(item) {
        const list = document.getElementById('inboxList');
        const thread = document.getElementById('inboxThread');
        const starter = document.getElementById('inboxStartForm');
        const messages = document.getElementById('inboxMessages');
        const status = document.getElementById('inboxStatus');
        if (list) list.classList.add('hidden');
        if (starter) starter.classList.add('hidden');
        if (thread) thread.classList.remove('hidden');
        if (status) status.textContent = item.status || '';
        if (!messages) return;
        messages.innerHTML = (item.messages || []).map((message) => {
            const mine = message.sender !== 'admin';
            return `
                <article class="flex ${mine ? 'justify-end' : 'justify-start'}">
                    <div class="max-w-[80%] rounded-xl px-4 py-3 ${mine ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'}">
                        <p class="text-xs font-medium ${mine ? 'text-blue-100' : 'text-gray-500'}">${mine ? 'You' : 'Support'}</p>
                        <p class="text-sm mt-1 whitespace-pre-wrap">${this.escape(message.body)}</p>
                        <p class="text-xs mt-2 ${mine ? 'text-blue-100' : 'text-gray-500'}">${this.escape(this.when(message.created_at))}</p>
                    </div>
                </article>
            `;
        }).join('');
    },

    async reply(event) {
        event.preventDefault();
        const input = document.getElementById('inboxReply');
        const body = input ? input.value.trim() : '';
        if (!this.activeId || !body) return;
        const thread = await CVision.API.request(`/support/inbox/${this.activeId}/reply`, {
            method: 'POST',
            body: JSON.stringify({ message: body })
        });
        if (input) input.value = '';
        const index = this.threads.findIndex((item) => item.id === this.activeId);
        if (index >= 0 && thread) this.threads[index] = thread;
        if (thread) this.renderThread(thread);
    },

    async start(event) {
        event.preventDefault();
        const input = document.getElementById('inboxStart');
        const body = input ? input.value.trim() : '';
        if (!body) return;
        const thread = await CVision.API.request('/support/inbox', {
            method: 'POST',
            body: JSON.stringify({ message: body })
        });
        if (input) input.value = '';
        if (!thread || !thread.id) return;
        this.activeId = thread.id;
        const index = this.threads.findIndex((item) => item.id === thread.id);
        if (index >= 0) this.threads[index] = thread;
        else this.threads.unshift(thread);
        this.renderThread(thread);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('inboxList').addEventListener('click', (event) => {
        const button = event.target.closest('[data-thread]');
        if (button) InboxPage.open(button.dataset.thread);
    });
    document.getElementById('inboxBack').addEventListener('click', () => {
        InboxPage.activeId = null;
        InboxPage.renderList();
    });
    document.getElementById('inboxReplyForm').addEventListener('submit', (event) => InboxPage.reply(event));
    document.getElementById('inboxStartForm').addEventListener('submit', (event) => {
        InboxPage.start(event).catch(() => alert('The message could not be sent.'));
    });
    setInterval(() => {
        InboxPage.load().catch(() => {});
    }, 8000);
    InboxPage.load().catch(() => {
        const list = document.getElementById('inboxList');
        if (list) list.innerHTML = '<div class="bg-white rounded-xl border p-6 text-center text-red-600">Could not load messages.</div>';
    });
});
