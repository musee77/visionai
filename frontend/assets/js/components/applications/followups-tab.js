window.FollowupsTab = {
    async load() {
        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/applications/follow-ups/needed`, {
                headers: { 'Authorization': `Bearer ${CVision.Utils.getToken()}` }
            });
            if (!res.ok) throw new Error('Failed');
            const data = await res.json();
            const container = document.getElementById('followupsList');
            if (!container) return;

            if (!data.applications || data.applications.length === 0) {
                container.innerHTML = '<div class="bg-white rounded-lg border p-12 text-center"><p class="text-gray-600">No follow-ups needed</p></div>';
                return;
            }
            container.innerHTML = data.applications.map(a => `
                <div class="bg-white rounded-lg border border-yellow-200 border-l-4 p-6">
                    <h3 class="text-lg font-semibold">${a.job_title || 'Untitled role'}</h3>
                    <p class="text-gray-600">${a.company_name || 'Company not listed'}</p>
                    <p class="text-sm text-yellow-600 mt-2">Follow-up due: ${formatDate(a.next_follow_up || a.follow_up_date)}</p>
                    <button onclick="viewApplicationDetails('${a.id || a._id}')" class="mt-4 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg">View Details</button>
                </div>
            `).join('');
        } catch (error) {
            const container = document.getElementById('followupsList');
            if (container) {
                container.innerHTML = '<div class="bg-white rounded-lg border p-6 text-center"><p class="text-red-600">Failed to load</p></div>';
            }
        }
    }
};

window.loadFollowUps = () => window.FollowupsTab.load();
