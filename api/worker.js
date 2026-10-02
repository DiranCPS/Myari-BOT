const SESSION_COOKIE = 'myari_blog_session';
const STATE_COOKIE = 'myari_discord_oauth_state';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;
const MAX_REQUEST_BYTES = 256 * 1024;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const allowedUsers = (env) => new Set(
  (env.SITE_ALLOWED_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^\d+$/.test(id)),
);

const allowedOrigins = (env) => new Set(
  (env.SITE_ALLOWED_ORIGINS || 'https://myaribot.mcv.kr')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean),
);

const encodeBase64Url = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const decodeBase64Url = (value) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const constantTimeEqual = (left, right) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

const cookieValue = (request, name) => {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return '';
};

const cookieHeader = (env, name, value, maxAge) => {
  const attributes = [
    `${name}=${value}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ];
  if (env.COOKIE_DOMAIN) attributes.push(`Domain=${env.COOKIE_DOMAIN}`);
  return attributes.join('; ');
};

const jsonResponse = (data, status = 200, extraHeaders = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  },
});

const redirect = (url, headers = {}) => {
  const responseHeaders = headers instanceof Headers ? headers : new Headers(headers);
  responseHeaders.set('Location', url);
  return new Response(null, { status: 302, headers: responseHeaders });
};

const frontendUrl = (env) => (env.FRONTEND_URL || 'https://myaribot.mcv.kr').replace(/\/$/, '');

const frontendError = (env, error, headers = {}) => redirect(
  `${frontendUrl(env)}/blog/?auth_error=${encodeURIComponent(error)}`,
  headers,
);

const sessionKey = async (secret) => crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(secret),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign', 'verify'],
);

export const signSession = async (userId, username, secret, now = Date.now()) => {
  const payload = new TextEncoder().encode(JSON.stringify({
    id: userId,
    username,
    exp: Math.floor(now / 1000) + SESSION_MAX_AGE,
  }));
  const encoded = encodeBase64Url(payload);
  const signature = await crypto.subtle.sign(
    'HMAC',
    await sessionKey(secret),
    new TextEncoder().encode(encoded),
  );
  return `${encoded}.${encodeBase64Url(new Uint8Array(signature))}`;
};

export const readSession = async (request, env, now = Date.now()) => {
  if (!env.BLOG_SESSION_SECRET) return null;
  const token = cookieValue(request, SESSION_COOKIE);
  const separator = token.indexOf('.');
  if (separator < 1) return null;
  const encoded = token.slice(0, separator);
  const suppliedSignature = token.slice(separator + 1);
  try {
    const key = await sessionKey(env.BLOG_SESSION_SECRET);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      decodeBase64Url(suppliedSignature),
      new TextEncoder().encode(encoded),
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encoded)));
    const id = String(payload.id);
    if (
      !Number.isFinite(payload.exp)
      || payload.exp <= Math.floor(now / 1000)
      || !allowedUsers(env).has(id)
    ) return null;
    return { id, username: String(payload.username || 'Discord 사용자') };
  } catch {
    return null;
  }
};

export const validatePost = (data, expectedSlug = null) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const { slug, title, content } = data;
  const category = data.category ?? '';
  const excerpt = data.excerpt ?? '';
  const status = data.status ?? 'published';
  if (
    typeof slug !== 'string'
    || slug.length > 80
    || !SLUG_PATTERN.test(slug)
    || (expectedSlug !== null && slug !== expectedSlug)
    || typeof title !== 'string'
    || !title.trim()
    || title.length > 120
    || typeof category !== 'string'
    || category.length > 40
    || typeof excerpt !== 'string'
    || excerpt.length > 300
    || typeof content !== 'string'
    || !content.trim()
    || content.length > 50000
    || !['draft', 'published'].includes(status)
  ) return null;
  return {
    slug,
    title: title.trim(),
    category: category.trim(),
    excerpt: excerpt.trim(),
    content,
    status,
  };
};

const postFromRow = (row) => row || null;

const queryPosts = async (env, includeDrafts) => {
  const query = includeDrafts
    ? 'SELECT * FROM posts ORDER BY COALESCE(published_at, updated_at) DESC'
    : "SELECT * FROM posts WHERE status = 'published' ORDER BY published_at DESC";
  const { results } = await env.DB.prepare(query).all();
  return results;
};

const queryPost = async (env, slug, includeDrafts) => {
  const row = await env.DB.prepare(
    "SELECT * FROM posts WHERE slug = ? AND (status = 'published' OR ? = 1)",
  ).bind(slug, includeDrafts ? 1 : 0).first();
  return postFromRow(row);
};

const savePost = async (env, data, user) => {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  await env.DB.prepare(`
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
      published_at = CASE
        WHEN excluded.status = 'published' THEN COALESCE(posts.published_at, excluded.published_at)
        ELSE NULL
      END
  `).bind(
    data.slug,
    data.title,
    data.category,
    data.excerpt,
    data.content,
    data.status,
    user.id,
    user.username,
    now,
    now,
    data.status === 'published' ? now : null,
  ).run();
  return queryPost(env, data.slug, true);
};

const beginDiscordLogin = (request, env) => {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.DISCORD_REDIRECT_URI) {
    return new Response('discord_oauth_not_configured', { status: 503 });
  }
  if (!env.BLOG_SESSION_SECRET || !allowedUsers(env).size) {
    return new Response('blog_auth_not_configured', { status: 503 });
  }
  const stateBytes = crypto.getRandomValues(new Uint8Array(32));
  const state = encodeBase64Url(stateBytes);
  const authorize = new URL('https://discord.com/oauth2/authorize');
  authorize.search = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
    state,
  }).toString();
  return redirect(authorize.toString(), {
    'Set-Cookie': cookieHeader(env, STATE_COOKIE, state, 600),
    'Cache-Control': 'no-store',
  });
};

const completeDiscordLogin = async (request, env) => {
  const fail = (error) => frontendError(env, error, {
    'Set-Cookie': cookieHeader(env, STATE_COOKIE, '', 0),
    'Cache-Control': 'no-store',
  });
  const url = new URL(request.url);
  const state = cookieValue(request, STATE_COOKIE);
  const suppliedState = url.searchParams.get('state') || '';
  if (!state || !suppliedState || !constantTimeEqual(state, suppliedState)) {
    return fail('oauth_state');
  }
  if (url.searchParams.has('error')) return fail('oauth_cancelled');
  const code = url.searchParams.get('code');
  if (!code || !env.DISCORD_CLIENT_SECRET || !env.DISCORD_REDIRECT_URI) {
    return fail('oauth_not_configured');
  }

  try {
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: env.DISCORD_REDIRECT_URI,
      }),
    });
    if (!tokenResponse.ok) return fail('oauth_exchange');
    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) return fail('oauth_exchange');

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userResponse.ok) return fail('oauth_profile');
    const discordUser = await userResponse.json();
    const userId = String(discordUser.id || '');
    if (!allowedUsers(env).has(userId)) return fail('not_allowed');

    const username = String(discordUser.global_name || discordUser.username || 'Discord 사용자').slice(0, 100);
    const token = await signSession(userId, username, env.BLOG_SESSION_SECRET);
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', cookieHeader(env, SESSION_COOKIE, token, SESSION_MAX_AGE));
    headers.append('Set-Cookie', cookieHeader(env, STATE_COOKIE, '', 0));
    return redirect(`${frontendUrl(env)}/blog/?auth=success`, headers);
  } catch (error) {
    console.error('Discord OAuth request failed', error);
    return fail('oauth_unavailable');
  }
};

const checkOrigin = (request, env) => (
  allowedOrigins(env).has((request.headers.get('Origin') || '').replace(/\/$/, ''))
);

const handleApi = async (request, env, pathname) => {
  const url = new URL(request.url);
  if (pathname === '/healthz' && request.method === 'GET') {
    return jsonResponse({ status: 'ok' });
  }
  if (pathname === '/api/auth/discord' && request.method === 'GET') {
    return beginDiscordLogin(request, env);
  }
  if (pathname === '/api/auth/discord/callback' && request.method === 'GET') {
    return completeDiscordLogin(request, env);
  }
  if (pathname === '/api/auth/me' && request.method === 'GET') {
    const user = await readSession(request, env);
    return jsonResponse(user
      ? { authorized: true, id: user.id, username: user.username }
      : { authorized: false });
  }
  if (pathname === '/api/invite' && request.method === 'GET') {
    if (!await readSession(request, env)) {
      return redirect(`${frontendUrl(env)}/blog/?auth_error=login_required`);
    }
    const invite = new URL('https://discord.com/oauth2/authorize');
    invite.search = new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      permissions: '8',
      scope: 'bot applications.commands',
    }).toString();
    return redirect(invite.toString());
  }
  if (pathname === '/api/auth/logout' && request.method === 'POST') {
    if (!checkOrigin(request, env)) return new Response('invalid_origin', { status: 403 });
    return jsonResponse({ status: 'ok' }, 200, {
      'Set-Cookie': cookieHeader(env, SESSION_COOKIE, '', 0),
    });
  }

  const postsCollection = pathname === '/api/blog/posts';
  const postMatch = pathname.match(/^\/api\/blog\/posts\/([^/]+)$/);
  if (postsCollection && request.method === 'GET') {
    const user = await readSession(request, env);
    return jsonResponse(await queryPosts(env, Boolean(user)));
  }
  if (postMatch && request.method === 'GET') {
    let slug;
    try {
      slug = decodeURIComponent(postMatch[1]);
    } catch {
      return new Response('invalid_slug', { status: 400 });
    }
    const post = await queryPost(env, slug, Boolean(await readSession(request, env)));
    return post ? jsonResponse(post) : new Response('post_not_found', { status: 404 });
  }
  if ((postsCollection && request.method === 'POST') || (postMatch && request.method === 'PUT')) {
    if (!checkOrigin(request, env)) return new Response('invalid_origin', { status: 403 });
    const user = await readSession(request, env);
    if (!user) return new Response('login_required', { status: 401 });
    const declaredSize = Number(request.headers.get('Content-Length') || 0);
    if (declaredSize > MAX_REQUEST_BYTES) return new Response('request_too_large', { status: 413 });
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
      return new Response('request_too_large', { status: 413 });
    }
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response('invalid_json', { status: 400 });
    }
    let expectedSlug = null;
    try {
      if (postMatch) expectedSlug = decodeURIComponent(postMatch[1]);
    } catch {
      return new Response('invalid_slug', { status: 400 });
    }
    const data = validatePost(payload, expectedSlug);
    if (!data) return new Response('invalid_post', { status: 400 });
    const post = await savePost(env, data, user);
    return jsonResponse(post, postsCollection ? 201 : 200);
  }
  return new Response('not_found', { status: 404 });
};

const withCors = (request, env, response) => {
  const origin = (request.headers.get('Origin') || '').replace(/\/$/, '');
  if (!allowedOrigins(env).has(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Vary', 'Origin');
  return new Response(response.body, { status: response.status, headers });
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let response;
    if (request.method === 'OPTIONS') {
      response = new Response(null, { status: 204 });
    } else {
      try {
        response = await handleApi(request, env, url.pathname);
      } catch (error) {
        console.error('API request failed', error);
        response = new Response('internal_error', { status: 500 });
      }
    }
    return withCors(request, env, response);
  },
};
