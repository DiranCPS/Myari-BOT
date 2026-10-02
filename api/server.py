import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

from aiohttp import ClientError, ClientSession, ClientTimeout, web


FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://myaribot.mcv.kr").rstrip("/")
DISCORD_CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "1538335436341252096")
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "")
DISCORD_REDIRECT_URI = os.environ.get("DISCORD_REDIRECT_URI", "")
SESSION_SECRET = os.environ.get("BLOG_SESSION_SECRET", "")
COOKIE_DOMAIN = os.environ.get("COOKIE_DOMAIN", ".myaribot.mcv.kr").strip() or None
DATABASE_PATH = Path(os.environ.get(
    "BLOG_DATABASE_PATH",
    str(Path(__file__).resolve().parent / "blog.sqlite3"),
))
PORT = int(os.environ.get("PORT", os.environ.get("BOT_API_PORT", "10000")))
SESSION_COOKIE = "myari_blog_session"
STATE_COOKIE = "myari_discord_oauth_state"
SESSION_MAX_AGE = 7 * 24 * 60 * 60
MAX_REQUEST_BYTES = 256 * 1024
ALLOWED_ORIGINS = {
    origin.strip().rstrip("/")
    for origin in os.environ.get(
        "SITE_ALLOWED_ORIGINS",
        "https://myaribot.mcv.kr",
    ).split(",")
    if origin.strip()
}
ALLOWED_USER_IDS = {
    item.strip()
    for item in os.environ.get(
        "SITE_ALLOWED_USER_IDS",
        "1230101255045513228,1462059321860034593,1501946308729245952",
    ).split(",")
    if item.strip().isdecimal()
}
SLUG_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def encode_part(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def sign_session(user_id, username):
    payload = json.dumps({
        "id": user_id,
        "username": username,
        "exp": int(datetime.now(timezone.utc).timestamp()) + SESSION_MAX_AGE,
    }, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    encoded = encode_part(payload)
    signature = hmac.new(SESSION_SECRET.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest()
    return f"{encoded}.{encode_part(signature)}"


def read_session(request):
    if not SESSION_SECRET:
        return None
    token = request.cookies.get(SESSION_COOKIE, "")
    try:
        encoded, supplied_signature = token.split(".", 1)
        expected_signature = encode_part(hmac.new(
            SESSION_SECRET.encode("utf-8"),
            encoded.encode("ascii"),
            hashlib.sha256,
        ).digest())
        if not hmac.compare_digest(supplied_signature, expected_signature):
            return None
        payload_bytes = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        payload = json.loads(payload_bytes)
        user_id = str(payload["id"])
        if (
            int(payload["exp"]) <= int(datetime.now(timezone.utc).timestamp())
            or user_id not in ALLOWED_USER_IDS
        ):
            return None
        return {"id": user_id, "username": str(payload.get("username", "Discord 사용자"))}
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return None


def set_cookie(response, name, value, max_age):
    response.set_cookie(
        name,
        value,
        max_age=max_age,
        path="/",
        domain=COOKIE_DOMAIN,
        secure=True,
        httponly=True,
        samesite="Lax",
    )


def clear_cookie(response, name):
    response.del_cookie(
        name,
        path="/",
        domain=COOKIE_DOMAIN,
        secure=True,
        httponly=True,
        samesite="Lax",
    )


def redirect_frontend(error=None, success=False):
    if error:
        return web.HTTPFound(f"{FRONTEND_URL}/blog/?auth_error={error}")
    if success:
        return web.HTTPFound(f"{FRONTEND_URL}/blog/?auth=success")
    return web.HTTPFound(f"{FRONTEND_URL}/")


def require_site_origin(request):
    origin = request.headers.get("Origin", "").rstrip("/")
    return origin in ALLOWED_ORIGINS


def open_database():
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("""
        CREATE TABLE IF NOT EXISTS posts (
            slug TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT '',
            excerpt TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
            author_id TEXT NOT NULL,
            author_name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            published_at TEXT
        )
    """)
    connection.commit()
    return connection


@contextmanager
def database_connection():
    connection = open_database()
    try:
        yield connection
    finally:
        connection.close()


def post_dict(row):
    return dict(row)


def query_posts(include_drafts):
    with database_connection() as connection:
        if include_drafts:
            rows = connection.execute(
                "SELECT * FROM posts ORDER BY COALESCE(published_at, updated_at) DESC"
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT * FROM posts WHERE status = 'published' ORDER BY published_at DESC"
            ).fetchall()
    return [post_dict(row) for row in rows]


def query_post(slug, include_drafts):
    with database_connection() as connection:
        row = connection.execute(
            "SELECT * FROM posts WHERE slug = ? AND (status = 'published' OR ?)",
            (slug, int(include_drafts)),
        ).fetchone()
    return post_dict(row) if row else None


def save_post(data, user):
    now = utc_now()
    with database_connection() as connection:
        existing = connection.execute(
            "SELECT created_at, published_at FROM posts WHERE slug = ?",
            (data["slug"],),
        ).fetchone()
        created_at = existing["created_at"] if existing else now
        published_at = None
        if data["status"] == "published":
            published_at = existing["published_at"] if existing and existing["published_at"] else now
        connection.execute("""
            INSERT INTO posts (
                slug, title, category, excerpt, content, status,
                author_id, author_name, created_at, updated_at, published_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(slug) DO UPDATE SET
                title = excluded.title,
                category = excluded.category,
                excerpt = excluded.excerpt,
                content = excluded.content,
                status = excluded.status,
                author_id = excluded.author_id,
                author_name = excluded.author_name,
                updated_at = excluded.updated_at,
                published_at = excluded.published_at
        """, (
            data["slug"], data["title"], data["category"], data["excerpt"],
            data["content"], data["status"], user["id"], user["username"],
            created_at, now, published_at,
        ))
        connection.commit()
    return query_post(data["slug"], True)


async def parse_post_payload(request, expected_slug=None):
    try:
        data = await request.json()
    except (json.JSONDecodeError, web.HTTPException):
        raise web.HTTPBadRequest(text="invalid_json")
    if not isinstance(data, dict):
        raise web.HTTPBadRequest(text="invalid_post")

    slug = data.get("slug")
    title = data.get("title")
    category = data.get("category", "")
    excerpt = data.get("excerpt", "")
    content = data.get("content")
    status = data.get("status", "published")
    if (
        not isinstance(slug, str)
        or len(slug) > 80
        or not SLUG_PATTERN.fullmatch(slug)
        or (expected_slug is not None and slug != expected_slug)
    ):
        raise web.HTTPBadRequest(text="invalid_slug")
    if not isinstance(title, str) or not title.strip() or len(title) > 120:
        raise web.HTTPBadRequest(text="invalid_title")
    if not isinstance(category, str) or len(category) > 40:
        raise web.HTTPBadRequest(text="invalid_category")
    if not isinstance(excerpt, str) or len(excerpt) > 300:
        raise web.HTTPBadRequest(text="invalid_excerpt")
    if not isinstance(content, str) or not content.strip() or len(content) > 50000:
        raise web.HTTPBadRequest(text="invalid_content")
    if status not in ("draft", "published"):
        raise web.HTTPBadRequest(text="invalid_status")
    return {
        "slug": slug,
        "title": title.strip(),
        "category": category.strip(),
        "excerpt": excerpt.strip(),
        "content": content,
        "status": status,
    }


async def health(request):
    return web.json_response({"status": "ok"})


async def begin_discord_login(request):
    if not DISCORD_CLIENT_ID or not DISCORD_CLIENT_SECRET or not DISCORD_REDIRECT_URI:
        raise web.HTTPServiceUnavailable(text="discord_oauth_not_configured")
    if not SESSION_SECRET:
        raise web.HTTPServiceUnavailable(text="blog_session_secret_not_configured")
    if not ALLOWED_USER_IDS:
        raise web.HTTPServiceUnavailable(text="site_allowlist_not_configured")
    state = secrets.token_urlsafe(32)
    response = web.HTTPFound(
        "https://discord.com/oauth2/authorize?"
        + urlencode({
            "client_id": DISCORD_CLIENT_ID,
            "redirect_uri": DISCORD_REDIRECT_URI,
            "response_type": "code",
            "scope": "identify",
            "state": state,
        })
    )
    set_cookie(response, STATE_COOKIE, state, 600)
    response.headers["Cache-Control"] = "no-store"
    return response


async def invite_bot(request):
    if not read_session(request):
        return redirect_frontend(error="login_required")
    return web.HTTPFound(
        "https://discord.com/oauth2/authorize?"
        + urlencode({
            "client_id": DISCORD_CLIENT_ID,
            "permissions": "8",
            "scope": "bot applications.commands",
        })
    )


async def complete_discord_login(request):
    state = request.cookies.get(STATE_COOKIE, "")
    supplied_state = request.query.get("state", "")
    if not state or not supplied_state or not hmac.compare_digest(state, supplied_state):
        response = redirect_frontend(error="oauth_state")
        clear_cookie(response, STATE_COOKIE)
        return response
    if request.query.get("error"):
        response = redirect_frontend(error="oauth_cancelled")
        clear_cookie(response, STATE_COOKIE)
        return response
    code = request.query.get("code", "")
    if not code or not DISCORD_CLIENT_SECRET or not DISCORD_REDIRECT_URI or not SESSION_SECRET:
        response = redirect_frontend(error="oauth_not_configured")
        clear_cookie(response, STATE_COOKIE)
        return response

    timeout = ClientTimeout(total=12)
    try:
        async with ClientSession(timeout=timeout) as session:
            async with session.post(
                "https://discord.com/api/oauth2/token",
                data={
                    "client_id": DISCORD_CLIENT_ID,
                    "client_secret": DISCORD_CLIENT_SECRET,
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": DISCORD_REDIRECT_URI,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            ) as token_response:
                if token_response.status != 200:
                    response = redirect_frontend(error="oauth_exchange")
                    clear_cookie(response, STATE_COOKIE)
                    return response
                token_data = await token_response.json()

            async with session.get(
                "https://discord.com/api/users/@me",
                headers={"Authorization": f"Bearer {token_data['access_token']}"},
            ) as user_response:
                if user_response.status != 200:
                    response = redirect_frontend(error="oauth_profile")
                    clear_cookie(response, STATE_COOKIE)
                    return response
                discord_user = await user_response.json()
    except (ClientError, asyncio.TimeoutError, KeyError, ValueError):
        response = redirect_frontend(error="oauth_unavailable")
        clear_cookie(response, STATE_COOKIE)
        return response

    user_id = str(discord_user.get("id", ""))
    if user_id not in ALLOWED_USER_IDS:
        response = redirect_frontend(error="not_allowed")
        clear_cookie(response, STATE_COOKIE)
        return response

    username = str(discord_user.get("global_name") or discord_user.get("username") or "Discord 사용자")[:100]
    response = redirect_frontend(success=True)
    set_cookie(response, SESSION_COOKIE, sign_session(user_id, username), SESSION_MAX_AGE)
    clear_cookie(response, STATE_COOKIE)
    response.headers["Cache-Control"] = "no-store"
    return response


async def current_user(request):
    user = read_session(request)
    if not user:
        return web.json_response({"authorized": False}, headers={"Cache-Control": "no-store"})
    return web.json_response({
        "authorized": True,
        "id": user["id"],
        "username": user["username"],
    }, headers={"Cache-Control": "no-store"})


async def logout(request):
    if not require_site_origin(request):
        raise web.HTTPForbidden(text="invalid_origin")
    response = web.json_response({"status": "ok"})
    clear_cookie(response, SESSION_COOKIE)
    response.headers["Cache-Control"] = "no-store"
    return response


async def list_posts(request):
    user = read_session(request)
    posts = await asyncio.to_thread(query_posts, bool(user))
    return web.json_response(posts, headers={"Cache-Control": "no-store"})


async def get_post(request):
    post = await asyncio.to_thread(
        query_post,
        request.match_info["slug"],
        bool(read_session(request)),
    )
    if not post:
        raise web.HTTPNotFound(text="post_not_found")
    return web.json_response(post, headers={"Cache-Control": "no-store"})


async def create_post(request):
    if not require_site_origin(request):
        raise web.HTTPForbidden(text="invalid_origin")
    user = read_session(request)
    if not user:
        raise web.HTTPUnauthorized(text="login_required")
    data = await parse_post_payload(request)
    post = await asyncio.to_thread(save_post, data, user)
    return web.json_response(post, status=201, headers={"Cache-Control": "no-store"})


async def update_post(request):
    if not require_site_origin(request):
        raise web.HTTPForbidden(text="invalid_origin")
    user = read_session(request)
    if not user:
        raise web.HTTPUnauthorized(text="login_required")
    slug = request.match_info["slug"]
    data = await parse_post_payload(request, expected_slug=slug)
    post = await asyncio.to_thread(save_post, data, user)
    return web.json_response(post, headers={"Cache-Control": "no-store"})


@web.middleware
async def cors_middleware(request, handler):
    if request.method == "OPTIONS":
        response = web.Response(status=204)
    else:
        try:
            response = await handler(request)
        except web.HTTPException as error:
            response = error
    origin = request.headers.get("Origin", "").rstrip("/")
    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Vary"] = "Origin"
    return response


def create_app():
    app = web.Application(
        middlewares=[cors_middleware],
        client_max_size=MAX_REQUEST_BYTES,
    )
    app.router.add_get("/healthz", health)
    app.router.add_get("/api/auth/discord", begin_discord_login)
    app.router.add_get("/api/auth/discord/callback", complete_discord_login)
    app.router.add_get("/api/auth/me", current_user)
    app.router.add_get("/api/invite", invite_bot)
    app.router.add_post("/api/auth/logout", logout)
    app.router.add_get("/api/blog/posts", list_posts)
    app.router.add_post("/api/blog/posts", create_post)
    app.router.add_get("/api/blog/posts/{slug}", get_post)
    app.router.add_put("/api/blog/posts/{slug}", update_post)
    return app


if __name__ == "__main__":
    web.run_app(create_app(), host="0.0.0.0", port=PORT)
