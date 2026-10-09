/**
 * Reusable SEO Component
 * Place in: /assets/js/seo.js
 * 
 * Usage in HTML:
 * <head>
 *     <script src="/assets/js/seo.js"></script>
 * </head>
 */

(function () {
    'use strict';

    // SEO Configuration for all pages
    const seoConfig = {
        baseUrl: 'https://www.synovae.io',
        siteName: 'JobsApply',
        author: 'JobsApply',
        twitterHandle: '@synovae',
        locale: 'en_US',

        // Social media links for structured data
        socialLinks: [
            'https://x.com/synovaeio',
            'https://linkedin.com/company/synovae',
            'https://facebook.com/synovae'
        ],
        contactEmail: 'support@synovae.io',

        // Default fallback values
        defaultImage: 'https://www.synovae.io/assets/images/og/og-default.png',
        defaultTitle: 'JobsApply - Upload Your CV and Find Jobs',
        defaultDescription: 'Upload a PDF, DOCX, or TXT CV on JobsApply. Set a job title, location, and salary, then browse matching jobs and apply.',

        // Page-specific configurations
        pages: {
            'index': {
                title: 'JobsApply - Upload Your CV and Find Jobs',
                description: 'Drop a PDF, DOCX, or TXT CV. JobsApply reads it, then you set a title, location, and salary and browse the jobs underneath.',
                keywords: 'upload CV, find jobs, job search, job matching, apply to jobs, resume, JobsApply',
                image: 'https://www.synovae.io/assets/images/og/og-home.png',
                type: 'website'
            },
            'home': {
                title: 'About JobsApply - A CV That Already Fits the Job',
                description: 'JobsApply matches openings, rewrites your materials for each role, and takes the repetitive application work off your plate.',
                keywords: 'JobsApply, AI job applications, CV matching, tailored resume, job search',
                image: 'https://www.synovae.io/assets/images/og/og-home.png',
                type: 'website'
            },
            'how-it-works': {
                title: 'How It Works - JobsApply',
                description: 'Four steps: upload your CV, find matching jobs, customize each application, and apply.',
                keywords: 'how it works, upload CV, find jobs, customize application, apply to jobs',
                image: 'https://www.synovae.io/assets/images/og/og-how-it-works.png',
                type: 'article'
            },
            'features': {
                title: 'Features - JobsApply',
                description: 'AI CV analysis, job matching, tailored applications, cover letters, and application tracking. Built to get you hired faster.',
                keywords: 'CV analysis, job matching, cover letter, application tracking, auto apply',
                image: 'https://www.synovae.io/assets/images/og/og-features.png',
                type: 'website'
            },
            'pricing': {
                title: 'Pricing - JobsApply',
                description: 'Simple, transparent pricing. Start free and upgrade as your job search picks up. No hidden fees, cancel anytime.',
                keywords: 'pricing, free plan, basic plan, premium plan, job application pricing',
                image: 'https://www.synovae.io/assets/images/og/og-pricing.png',
                type: 'website'
            },
            'info/contact': {
                title: 'Contact Us - JobsApply',
                description: 'Questions about uploading a CV, matching jobs, or your account? Contact the JobsApply team.',
                keywords: 'contact, support, help, customer service, job search help',
                image: 'https://www.synovae.io/assets/images/og/og-contact.png',
                type: 'website'
            },
            'register': {
                title: 'Sign Up - JobsApply',
                description: 'Create a free JobsApply account. Upload your CV, see matching jobs, and apply. Get started in a couple of minutes.',
                keywords: 'sign up, register, create account, free trial, job search registration',
                image: 'https://www.synovae.io/assets/images/og/og-default.png',
                type: 'website'
            },
            'login': {
                title: 'Login - JobsApply',
                description: 'Log in to JobsApply to pick up your CV, saved jobs, and applications.',
                keywords: 'login, sign in, account access, job search dashboard',
                image: 'https://www.synovae.io/assets/images/og/og-default.png',
                type: 'website'
            },
            'info/blog': {
                title: 'Blog - JobsApply | Job Search Tips and Career Advice',
                description: 'Discover expert job search strategies, career development tips, and insights on AI-powered recruitment. Stay updated with the latest trends in job hunting and career growth.',
                keywords: 'job search tips, career advice, resume tips, interview preparation, AI recruitment, career development, job hunting strategies, professional growth',
                image: 'https://www.synovae.io/assets/images/og/og-default.png',
                type: 'website',
                canonical: 'https://www.synovae.io/info/blog'
            },

            'info/help': {
                title: 'Help Center - JobsApply',
                description: 'Answers for uploading a CV, finding jobs, customizing applications, auto-apply, and your JobsApply account.',
                keywords: 'help center, customer support, FAQ, tutorials, troubleshooting, user guide, how to use, support docs',
                image: 'https://www.synovae.io/assets/images/og/og-default.png',
                type: 'website',
                canonical: 'https://www.synovae.io/info/help'
            },
            'info/legal/privacy': {
                title: 'Privacy Policy - JobsApply',
                description: 'How JobsApply handles your account, CV, and application data.',
                keywords: 'privacy policy, data protection, GDPR compliance, user privacy',
                canonical: 'https://www.synovae.io/info/legal/privacy',
                type: 'article'
            },
            'info/legal/terms': {
                title: 'Terms of Service - JobsApply',
                description: 'The terms for using JobsApply to upload a CV, match jobs, and send applications.',
                keywords: 'terms of service, user agreement, legal terms, terms and conditions',
                canonical: 'https://www.synovae.io/info/legal/terms',
                type: 'article'
            },
            'info/contact': {
                title: 'Contact Us - JobsApply',
                description: 'Contact JobsApply about your CV, job matches, applications, or account.',
                keywords: 'contact JobsApply, customer support, job search help, technical support',
                canonical: 'https://www.synovae.io/info/contact',
                image: 'https://www.synovae.io/assets/images/og/og-contact.png'
            },
            'dashboard': {
                title: 'Dashboard - JobsApply',
                description: 'Your JobsApply home for documents, matched jobs, and applications.',
                keywords: 'job dashboard, application tracking, job search management',
                type: 'website',
                noindex: true
            },
            'pages/applications': {
                title: 'My Applications - JobsApply',
                description: 'See applications you saved, sent, and still need to review.',
                keywords: 'job applications, application tracking, job status',
                type: 'website',
                noindex: true
            },
            'pages/documents': {
                title: 'Documents - JobsApply',
                description: 'Keep the CVs and cover letters you upload and generate on JobsApply.',
                keywords: 'CV management, resume builder, cover letter generator',
                type: 'website',
                noindex: true
            },
            'pages/jobs': {
                title: 'Find Jobs - JobsApply',
                description: 'Search jobs by title, company, and location, then apply with your CV.',
                keywords: 'job search, job listings, career opportunities',
                type: 'website',
                noindex: true
            },
            'pages/auto-apply': {
                title: 'Auto Apply - JobsApply',
                description: 'Let JobsApply apply to matching jobs for you on Premium.',
                keywords: 'auto apply, automated job application, AI job search',
                type: 'website',
                noindex: true
            },
            'pages/profile': {
                title: 'Profile - JobsApply',
                description: 'Your name, phone, location, country, and the links JobsApply uses when you apply.',
                keywords: 'profile settings, account management',
                type: 'website',
                noindex: true
            },
            'pages/subscription': {
                title: 'Subscription - JobsApply',
                description: 'See your JobsApply plan. Free includes manual applications. Basic adds CV and cover letter tools. Premium adds auto-apply.',
                keywords: 'subscription management, billing, plans',
                type: 'website',
                noindex: true
            },
        }
    };

    // Get current page
    function getCurrentPage() {
        let path = window.location.pathname;
        let parts = path.split('/').filter(Boolean);

        // Remove .html if it exists in the URL part
        let page = (parts.length > 0 ? parts.join('/') : 'index').replace(/\.html$/, '');

        return page;
    }

    // Get SEO data for current page
    function getPageSEO() {
        const currentPage = getCurrentPage();
        const pageSEO = seoConfig.pages[currentPage] || {};

        return {
            title: pageSEO.title || seoConfig.defaultTitle,
            description: pageSEO.description || seoConfig.defaultDescription,
            keywords: pageSEO.keywords || '',
            image: pageSEO.image || seoConfig.defaultImage,
            type: pageSEO.type || 'website',
            url: `${seoConfig.baseUrl}/${currentPage === 'index' ? '' : currentPage}`
        };
    }

    // Helper: Set or update meta tag by name (prevents duplicates)
    function setOrUpdateMeta(name, content) {
        let meta = document.querySelector(`meta[name="${name}"]`);
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', name);
            document.head.appendChild(meta);
        }
        meta.setAttribute('content', content);
    }

    // Helper: Set or update meta property (for Open Graph)
    function setOrUpdateMetaProperty(property, content) {
        let meta = document.querySelector(`meta[property="${property}"]`);
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('property', property);
            document.head.appendChild(meta);
        }
        meta.setAttribute('content', content);
    }

    // Helper: Set or update link tag
    function setOrUpdateLink(rel, href, type = null) {
        let link = document.querySelector(`link[rel="${rel}"]`);
        if (!link) {
            link = document.createElement('link');
            link.setAttribute('rel', rel);
            document.head.appendChild(link);
        }
        link.setAttribute('href', href);
        if (type) {
            link.setAttribute('type', type);
        }
    }

    // Legacy create functions for backward compatibility
    function createMeta(name, content, isProperty = false) {
        const meta = document.createElement('meta');
        if (isProperty) {
            meta.setAttribute('property', name);
        } else {
            meta.setAttribute('name', name);
        }
        meta.setAttribute('content', content);
        return meta;
    }

    function createLink(rel, href, type = null) {
        const link = document.createElement('link');
        link.setAttribute('rel', rel);
        link.setAttribute('href', href);
        if (type) {
            link.setAttribute('type', type);
        }
        return link;
    }

    // Inject SEO tags
    function injectSEO() {
        const seo = getPageSEO();
        const head = document.head;

        // Set page title
        document.title = seo.title;

        // Primary Meta Tags (using setOrUpdate to prevent duplicates)
        setOrUpdateMeta('title', seo.title);
        setOrUpdateMeta('description', seo.description);
        if (seo.keywords) {
            setOrUpdateMeta('keywords', seo.keywords);
        }
        setOrUpdateMeta('author', seoConfig.author);
        // Enhanced robots meta with more directives
        // Check if page should be noindexed (authenticated pages)
        const currentPage = getCurrentPage();
        const pageConfig = seoConfig.pages[currentPage] || {};
        if (pageConfig.noindex) {
            setOrUpdateMeta('robots', 'noindex, nofollow');
        } else {
            setOrUpdateMeta('robots', 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1');
        }

        // Canonical URL
        setOrUpdateLink('canonical', seo.url);

        // Open Graph / Facebook
        setOrUpdateMetaProperty('og:type', seo.type);
        setOrUpdateMetaProperty('og:url', seo.url);
        setOrUpdateMetaProperty('og:title', seo.title);
        setOrUpdateMetaProperty('og:description', seo.description);
        setOrUpdateMetaProperty('og:image', seo.image);
        setOrUpdateMetaProperty('og:image:width', '1200');
        setOrUpdateMetaProperty('og:image:height', '630');
        setOrUpdateMetaProperty('og:site_name', seoConfig.siteName);
        setOrUpdateMetaProperty('og:locale', seoConfig.locale);

        // Twitter Card
        setOrUpdateMeta('twitter:card', 'summary_large_image');
        setOrUpdateMeta('twitter:url', seo.url);
        setOrUpdateMeta('twitter:title', seo.title);
        setOrUpdateMeta('twitter:description', seo.description);
        setOrUpdateMeta('twitter:image', seo.image);
        if (seoConfig.twitterHandle) {
            setOrUpdateMeta('twitter:site', seoConfig.twitterHandle);
        }

        // Favicon - Modern approach with multiple formats
        head.appendChild(createLink('icon', '/assets/images/favicon.ico', 'image/x-icon'));
        head.appendChild(createLink('icon', '/assets/images/favicon/android-chrome-192x192.png', 'image/png'));
        head.appendChild(createLink('icon', '/assets/images/favicon/android-chrome-512x512.png', 'image/png'));
        head.appendChild(createLink('apple-touch-icon', '/assets/images/favicon/apple-touch-icon'));

        // RSS Feed and Sitemap discovery
        setOrUpdateLink('alternate', `${seoConfig.baseUrl}/api/v1/blog/feed.xml`, 'application/rss+xml');
        const sitemapLink = document.createElement('link');
        sitemapLink.rel = 'sitemap';
        sitemapLink.type = 'application/xml';
        sitemapLink.href = `${seoConfig.baseUrl}/api/v1/blog/sitemap.xml`;
        head.appendChild(sitemapLink);

        // Structured Data (JSON-LD)
        injectStructuredData(seo);
    }

    // Helper: Insert or update structured data script
    function insertStructuredData(id, data) {
        let script = document.getElementById(id);
        if (!script) {
            script = document.createElement('script');
            script.id = id;
            script.type = 'application/ld+json';
            document.head.appendChild(script);
        }
        script.textContent = JSON.stringify(data, null, 2);
    }

    // Inject Structured Data
    function injectStructuredData(seo) {
        const currentPage = getCurrentPage();

        // Enhanced Organization schema with social links and contact
        const organizationSchema = {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": seoConfig.siteName,
            "url": seoConfig.baseUrl,
            "logo": `${seoConfig.baseUrl}/assets/images/my-logo.png`,
            "description": seoConfig.defaultDescription,
            "sameAs": seoConfig.socialLinks,
            "contactPoint": {
                "@type": "ContactPoint",
                "contactType": "Customer Support",
                "email": seoConfig.contactEmail
            }
        };

        // Website schema with search action
        const websiteSchema = {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": seoConfig.siteName,
            "url": seoConfig.baseUrl,
            "potentialAction": {
                "@type": "SearchAction",
                "target": `${seoConfig.baseUrl}/dashboard?search={search_term_string}`,
                "query-input": "required name=search_term_string"
            }
        };

        // Page-specific structured data
        let pageSchema = null;

        if (currentPage === 'index') {
            pageSchema = {
                "@context": "https://schema.org",
                "@type": "WebApplication",
                "name": seoConfig.siteName,
                "url": seoConfig.baseUrl,
                "description": seo.description,
                "applicationCategory": "BusinessApplication",
                "operatingSystem": "Web",
                "offers": {
                    "@type": "Offer",
                    "price": "0",
                    "priceCurrency": "USD"
                }
            };
        } else if (currentPage === 'how-it-works') {
            // HowTo schema for how-it-works page
            pageSchema = {
                "@context": "https://schema.org",
                "@type": "HowTo",
                "name": "How to apply with JobsApply",
                "description": seo.description,
                "step": [
                    {
                        "@type": "HowToStep",
                        "name": "Upload Your CV",
                        "text": "Add a PDF, DOCX, or TXT. JobsApply reads it."
                    },
                    {
                        "@type": "HowToStep",
                        "name": "Find matching jobs",
                        "text": "Set a title, location, and salary, then browse the jobs that fit."
                    },
                    {
                        "@type": "HowToStep",
                        "name": "Customize the application",
                        "text": "Tailor the CV and cover letter for that role."
                    },
                    {
                        "@type": "HowToStep",
                        "name": "Apply",
                        "text": "Review the form and submit, or let auto-apply send it on Premium."
                    }
                ]
            };
        } else {
            pageSchema = {
                "@context": "https://schema.org",
                "@type": "WebPage",
                "name": seo.title,
                "url": seo.url,
                "description": seo.description,
                "publisher": organizationSchema
            };
        }

        // Insert all schemas (using IDs to prevent duplicates)
        insertStructuredData('organization-schema', organizationSchema);
        insertStructuredData('website-schema', websiteSchema);
        if (pageSchema) {
            insertStructuredData('page-schema', pageSchema);
        }
    }

    // Initialize SEO when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectSEO);
    } else {
        injectSEO();
    }

})();