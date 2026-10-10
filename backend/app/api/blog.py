# backend/app/api/blog.py
"""
Blog API endpoints
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from typing import List, Optional
from app.schemas.blog import (
    BlogPostCreate,
    BlogPostUpdate,
    BlogPostResponse,
    BlogPostSummary,
    BlogPostListResponse,
    CategoryResponse,
    TagResponse,
    BlogSearchRequest
)
from app.models.blog import BlogStatus, BlogAuthor
from app.services.core.blog_service import BlogService
from app.database import get_database
from app.api.deps import require_admin
from app.dependencies import get_current_user
from motor.motor_asyncio import AsyncIOMotorDatabase
from bson import ObjectId




router = APIRouter()


async def get_blog_service(db: AsyncIOMotorDatabase = Depends(get_database)) -> BlogService:
    """Dependency to get blog service"""
    service = BlogService(db)
    # await service.ensure_indexes() # REMOVED: Performance bottleneck to run on every request
    return service


@router.get("/stats")
async def get_blog_stats(
    current_user: dict = Depends(require_admin),
    blog_service: BlogService = Depends(get_blog_service)
):
    """
    Get blog statistics (Admin only)
    """
    return await blog_service.get_blog_stats()

@router.post("/posts", response_model=BlogPostResponse, status_code=status.HTTP_201_CREATED)
async def create_blog_post(
    post_data: BlogPostCreate,
    current_user: dict = Depends(require_admin),
    blog_service: BlogService = Depends(get_blog_service)
):
    """
    Create a new blog post (Admin only)
    """
    # Create author from current user
    profile = current_user.get('profile') or {}
    author = BlogAuthor(
        user_id=str(current_user["_id"]),
        name=f"{current_user.get('first_name', '')} {current_user.get('last_name', '')}".strip() or current_user.get('email', 'Admin'),
        avatar_url=None,  # Could be added to user profile
        bio=profile.get('bio')
    )
    
    post = await blog_service.create_post(post_data, author)
    return post


@router.get("/posts", response_model=BlogPostListResponse)
async def list_blog_posts(
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=50),
    status: Optional[str] = None,
    categories: Optional[str] = Query(None, description="Comma-separated categories"),
    tags: Optional[str] = Query(None, description="Comma-separated tags"),
    search: Optional[str] = None,
    sort_by: Optional[str] = Query("published_at", regex="^(published_at|views|created_at)$"),
    current_user: Optional[dict] = Depends(get_current_user),
    blog_service: BlogService = Depends(get_blog_service)
):
    """
    List blog posts with filtering and pagination
    
    - Public users can only see published posts
    - Admins can see all posts
    """
    # Debug logging
    print(f"List Blog Posts Request: status={status}, user={current_user.get('_id') if current_user else 'None'}")
    if current_user:
        print(f"User Role: {current_user.get('role')}")

    # Parse comma-separated values
    category_list = categories.split(",") if categories else None
    tag_list = tags.split(",") if tags else None
    
    # Check if user is admin
    is_admin = False
    if current_user and str(current_user.get("role")) == "admin":
        is_admin = True
        print("User identified as ADMIN")
    
    # Handle status
    final_status = None
    if status:
        # If status is passed, try to use it
        try:
            # Map "all" or empty string to None (All)
            if status.lower() in ["all", ""]:
                final_status = None
            else:
                final_status = BlogStatus(status)
        except ValueError:
            # If invalid status passed, ignore check? Or 400?
            # For admin friendliness, let's just default to None if admin, or Published if public?
            # To be safe, if public, ignore invalid status -> Published.
            pass
            
    # Defaulting Logic
    if not is_admin:
        # Non-admin users can ONLY see published posts
        final_status = BlogStatus.PUBLISHED
    elif is_admin and final_status is None and status is None:
        # Admin, no status specified -> See ALL (None)
        final_status = None
        
    print(f"Final Status Filter: {final_status}")

    posts = await blog_service.list_posts(
        page=page,
        size=size,
        status=final_status,
        categories=category_list,
        tags=tag_list,
        search_query=search,
        sort_by=sort_by
    )
    
    return posts


@router.get("/posts/{slug}", response_model=BlogPostResponse)
async def get_blog_post(
    slug: str,
    blog_service: BlogService = Depends(get_blog_service)
):
    """
    Get a single blog post by slug or ID
    
    Increments view count if fetched by slug (public view)
    """
    # Try to fetch by ID first if it looks like an ObjectId
    if ObjectId.is_valid(slug):
        post = await blog_service.get_post_by_id(slug)
        if post:
            return post

    post = await blog_service.get_post_by_slug(slug, increment_views=True)
    
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Blog post not found"
        )
    
    # Only show published posts to public
    if post.status != BlogStatus.PUBLISHED:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Blog post not found"
        )
    
    return post


@router.put("/posts/{post_id}", response_model=BlogPostResponse)
async def update_blog_post(
    post_id: str,
    update_data: BlogPostUpdate,
    current_user: dict = Depends(require_admin),
    blog_service: BlogService = Depends(get_blog_service)
):
    """
    Update a blog post (Admin only)
    """
    post = await blog_service.update_post(post_id, update_data)
    
    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Blog post not found"
        )
    
    return post


@router.delete("/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_blog_post(
    post_id: str,
    current_user: dict = Depends(require_admin),
    blog_service: BlogService = Depends(get_blog_service)
):
    """
    Delete a blog post (Admin only)
    """
    success = await blog_service.delete_post(post_id)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Blog post not found"
        )
    
    return None


@router.get("/categories", response_model=List[CategoryResponse])
async def get_categories(
    blog_service: BlogService = Depends(get_blog_service)
):
    """
    Get all blog categories with post counts
    """
    return await blog_service.get_categories()


@router.get("/tags", response_model=List[TagResponse])
async def get_tags(
    blog_service: BlogService = Depends(get_blog_service)
):
    """
    Get all blog tags with post counts
    """
    return await blog_service.get_tags()


@router.get("/posts/{post_id}/related", response_model=List[BlogPostSummary])
async def get_related_posts(
    post_id: str,
    limit: int = Query(3, ge=1, le=10),
    blog_service: BlogService = Depends(get_blog_service)
):
    """
    Get related blog posts
    """
    return await blog_service.get_related_posts(post_id, limit)


@router.get("/sitemap.xml")
async def get_sitemap(
    blog_service: BlogService = Depends(get_blog_service)
):
    """
    Generate XML sitemap for SEO
    """
    from fastapi.responses import Response
    
    posts = await blog_service.list_posts(
        page=1,
        size=1000,  # Get all posts
        status=BlogStatus.PUBLISHED
    )
    
    # Generate XML
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    
    for post in posts.posts:
        xml += '  <url>\n'
        xml += f'    <loc>https://www.synovae.io/info/blog-post?slug={post.slug}</loc>\n'
        if post.published_at:
            xml += f'    <lastmod>{post.published_at.strftime("%Y-%m-%d")}</lastmod>\n'
        xml += '    <changefreq>weekly</changefreq>\n'
        xml += '    <priority>0.7</priority>\n'
        xml += '  </url>\n'
    
    xml += '</urlset>'
    
    return Response(content=xml, media_type="application/xml")


@router.get("/feed.xml")
async def get_rss_feed(
    blog_service: BlogService = Depends(get_blog_service)
):
    """
    Generate RSS feed
    """
    from fastapi.responses import Response
    
    posts = await blog_service.list_posts(
        page=1,
        size=20,  # Latest 20 posts
        status=BlogStatus.PUBLISHED
    )
    
    # Generate RSS XML
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    xml += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n'
    xml += '  <channel>\n'
    xml += '    <title>JobsApply Blog</title>\n'
    xml += '    <link>https://www.synovae.io/info/blog</link>\n'
    xml += '    <description>AI-Powered Job Application Platform - Blog</description>\n'
    xml += '    <language>en-us</language>\n'
    xml += '    <atom:link href="https://www.synovae.io/api/v1/blog/feed.xml" rel="self" type="application/rss+xml" />\n'
    
    for post in posts.posts:
        xml += '    <item>\n'
        xml += f'      <title>{post.title}</title>\n'
        xml += f'      <link>https://www.synovae.io/info/blog-post?slug={post.slug}</link>\n'
        xml += f'      <description>{post.excerpt or ""}</description>\n'
        if post.published_at:
            xml += f'      <pubDate>{post.published_at.strftime("%a, %d %b %Y %H:%M:%S +0000")}</pubDate>\n'
        xml += f'      <guid>https://www.synovae.io/info/blog-post?slug={post.slug}</guid>\n'
        xml += '    </item>\n'
    
    xml += '  </channel>\n'
    xml += '</rss>'
    
    return Response(content=xml, media_type="application/xml")
