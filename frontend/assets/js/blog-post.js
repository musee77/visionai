// Single blog post page JavaScript
(function () {
    'use strict';

    const API_BASE = window.location.hostname === 'localhost'
        ? 'http://localhost:8000/api/v1'
        : `https://${window.location.hostname}/api/v1`;

    let currentPost = null;

    // Helper to get valid image URL or fallback to default
    const DEFAULT_BLOG_IMAGE = '/assets/images/defaults/blog-default.png';
    function getValidImageUrl(url) {
        if (!url) return DEFAULT_BLOG_IMAGE;
        // Detect placeholder URLs
        const invalidPatterns = ['example.com', 'placeholder', 'via.placeholder', 'picsum.photos'];
        if (invalidPatterns.some(pattern => url.toLowerCase().includes(pattern))) {
            return DEFAULT_BLOG_IMAGE;
        }
        return url;
    }

    // DOM Elements
    const loadingState = document.getElementById('loading-state');
    const errorState = document.getElementById('error-state');
    const articleContent = document.getElementById('article-content');

    // Initialize
    async function init() {
        const slug = getSlugFromURL();

        if (!slug) {
            showError();
            return;
        }

        await loadPost(slug);
    }

    // Get slug from URL
    function getSlugFromURL() {
        const params = new URLSearchParams(window.location.search);
        return params.get('slug');
    }

    // Load post
    async function loadPost(slug) {
        const fetchFn = async () => {
            const response = await fetch(`${API_BASE}/blog/posts/${slug}`);
            if (!response.ok) throw new Error('Post not found');
            return await response.json();
        };

        const onUpdate = async (post, isFromCache) => {
            currentPost = post;
            displayPost(post);
            // Visual feedback
            articleContent.style.opacity = isFromCache ? '0.7' : '1';

            // Re-load related posts if we have an ID
            if (post && post.id) {
                await loadRelatedPosts(post.id);
            }
        };

        try {
            await CVision.Cache.swr(`blog_post_${slug}`, fetchFn, onUpdate);
        } catch (error) {
            console.error('Error loading post:', error);
            if (!currentPost) showError();
        }
    }

    // Display post
    function displayPost(post) {
        // Default seo object if null
        const seo = post.seo || { meta_description: '', keywords: [], og_title: '', og_description: '' };

        // Update page title and meta tags
        document.getElementById('page-title').textContent = `${post.title} - JobsApply Blog`;
        document.getElementById('meta-description').setAttribute('content', seo.meta_description || post.excerpt || '');
        document.getElementById('meta-keywords').setAttribute('content', (seo.keywords || []).join(', '));

        // Open Graph
        document.getElementById('og-title').setAttribute('content', seo.og_title || post.title);
        document.getElementById('og-description').setAttribute('content', seo.og_description || post.excerpt || '');
        document.getElementById('og-url').setAttribute('content', window.location.href);
        const ogImage = getValidImageUrl(post.featured_image);
        const absoluteImageUrl = ogImage.startsWith('/')
            ? `${window.location.origin}${ogImage}`
            : ogImage;
        document.getElementById('og-image').setAttribute('content', absoluteImageUrl);

        // Article times (with null checks for elements)
        const articlePublished = document.getElementById('article-published');
        const articleModified = document.getElementById('article-modified');
        if (post.published_at && articlePublished) {
            articlePublished.setAttribute('content', post.published_at);
        }
        if (post.updated_at && articleModified) {
            articleModified.setAttribute('content', post.updated_at);
        }

        // Twitter Card (with null checks for elements)
        const twitterTitle = document.getElementById('twitter-title');
        const twitterDesc = document.getElementById('twitter-description');
        const twitterImage = document.getElementById('twitter-image');
        if (twitterTitle) twitterTitle.setAttribute('content', seo.og_title || post.title);
        if (twitterDesc) twitterDesc.setAttribute('content', seo.og_description || post.excerpt || '');
        if (twitterImage) twitterImage.setAttribute('content', absoluteImageUrl);

        // Canonical URL (with null check)
        const canonicalUrl = document.getElementById('canonical-url');
        if (canonicalUrl) canonicalUrl.setAttribute('href', window.location.href);

        // Breadcrumb
        document.getElementById('breadcrumb-title').textContent = post.title;

        // Categories
        const categoriesContainer = document.getElementById('article-categories');
        categoriesContainer.innerHTML = post.categories.map(cat => `
            <a href="/info/blog?category=${cat}" class="category-badge">${cat}</a>
        `).join('');

        // Title
        document.getElementById('article-title').textContent = post.title;

        // Author (Handle missing author data safely)
        const authorName = post.author && post.author.name ? post.author.name : 'JobsApply Team';
        const authorAvatarUrl = post.author ? post.author.avatar_url : null;

        const authorAvatar = document.getElementById('author-avatar');
        if (authorAvatarUrl) {
            authorAvatar.innerHTML = `<img src="${authorAvatarUrl}" alt="${authorName}" class="w-full h-full rounded-full object-cover">`;
        } else {
            authorAvatar.textContent = authorName.charAt(0).toUpperCase();
        }

        document.getElementById('author-name').textContent = authorName;

        // Date
        const publishDate = new Date(post.published_at).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        document.getElementById('publish-date').textContent = publishDate;

        // Reading time
        document.getElementById('reading-time').textContent = post.reading_time;

        // Views
        document.getElementById('view-count').textContent = post.views;

        // Featured image
        const featuredImageContainer = document.getElementById('featured-image-container');
        const featuredImage = document.getElementById('featured-image');
        const imageUrl = getValidImageUrl(post.featured_image);
        featuredImage.src = imageUrl;
        featuredImage.alt = post.title;
        featuredImageContainer.classList.remove('hidden');

        // Article body
        document.getElementById('article-body').innerHTML = post.content;

        // Tags
        const tagsContainer = document.getElementById('article-tags');
        tagsContainer.innerHTML = post.tags.map(tag => `
            <a href="/info/blog?tag=${tag}" class="tag-badge">${tag}</a>
        `).join('');

        // Setup social sharing
        setupSocialSharing(post);

        // Show article
        loadingState.classList.add('hidden');
        articleContent.classList.remove('hidden');

        // Add JSON-LD structured data
        addStructuredData(post);
    }

    // Load related posts
    async function loadRelatedPosts(postId) {
        const fetchFn = async () => {
            const response = await fetch(`${API_BASE}/blog/posts/${postId}/related?limit=3`);
            if (!response.ok) return [];
            return await response.json();
        };

        const onUpdate = (relatedPosts) => {
            if (relatedPosts && relatedPosts.length > 0) {
                displayRelatedPosts(relatedPosts);
            }
        };

        try {
            await CVision.Cache.swr(`blog_related_${postId}`, fetchFn, onUpdate);
        } catch (error) {
            console.error('Error loading related posts:', error);
        }
    }

    // Display related posts
    function displayRelatedPosts(posts) {
        const container = document.getElementById('related-posts');
        const section = document.getElementById('related-posts-section');

        container.innerHTML = posts.map(post => {
            const imageUrl = getValidImageUrl(post.featured_image);

            return `
                <div class="blog-card">
                    <img src="${imageUrl}" alt="${post.title}" class="blog-card-image" loading="lazy">
                    <div class="blog-card-content">
                        <a href="/info/blog-post?slug=${post.slug}" class="blog-card-title hover:text-primary-600 transition">
                            ${post.title}
                        </a>
                        <p class="blog-card-excerpt">${post.excerpt || ''}</p>
                        <div class="blog-card-meta">
                            <span>${post.reading_time} min read</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        section.classList.remove('hidden');
    }

    // Setup social sharing
    function setupSocialSharing(post) {
        const url = encodeURIComponent(window.location.href);
        const title = encodeURIComponent(post.title);
        const text = encodeURIComponent(post.excerpt || '');

        // Twitter
        document.getElementById('share-twitter').addEventListener('click', () => {
            window.open(`https://twitter.com/intent/tweet?url=${url}&text=${title}`, '_blank', 'width=600,height=400');
        });

        // LinkedIn
        document.getElementById('share-linkedin').addEventListener('click', () => {
            window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${url}`, '_blank', 'width=600,height=400');
        });

        // Facebook
        document.getElementById('share-facebook').addEventListener('click', () => {
            window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank', 'width=600,height=400');
        });

        // Instagram (copy link since Instagram doesn't have direct share URL)
        document.getElementById('share-instagram').addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(window.location.href);
                alert('Link copied! Paste it on Instagram.');
            } catch (error) {
                console.error('Failed to copy link:', error);
            }
        });

        // Copy link
        document.getElementById('copy-link').addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(window.location.href);
                const btn = document.getElementById('copy-link');
                const originalText = btn.innerHTML;
                btn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Copied!';
                setTimeout(() => {
                    btn.innerHTML = originalText;
                }, 2000);
            } catch (error) {
                console.error('Failed to copy link:', error);
            }
        });
    }

    // Add structured data (JSON-LD)
    function addStructuredData(post) {
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.textContent = JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            "headline": post.title,
            "description": post.excerpt || '',
            "image": getValidImageUrl(post.featured_image),
            "author": {
                "@type": "Person",
                "name": post.author && post.author.name ? post.author.name : 'JobsApply Team'
            },
            "publisher": {
                "@type": "Organization",
                "name": "JobsApply",
                "logo": {
                    "@type": "ImageObject",
                    "url": `https://${window.location.hostname}/logo.png`
                }
            },
            "datePublished": post.published_at,
            "dateModified": post.updated_at,
            "mainEntityOfPage": {
                "@type": "WebPage",
                "@id": window.location.href
            }
        });
        document.head.appendChild(script);
    }

    // Show error
    function showError() {
        loadingState.classList.add('hidden');
        errorState.classList.remove('hidden');
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
