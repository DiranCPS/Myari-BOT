import test from 'node:test';
import assert from 'node:assert/strict';

import worker, { readSession, signSession, validatePost } from './worker.js';

const env = {
  BLOG_SESSION_SECRET: 'a-long-test-secret',
  SITE_ALLOWED_USER_IDS: '1230101255045513228',
  SITE_ALLOWED_ORIGINS: 'https://myaribot.mcv.kr',
};

test('accepts a signed session for an allow-listed Discord user', async () => {
  const token = await signSession('1230101255045513228', 'test-editor', env.BLOG_SESSION_SECRET);
  const request = new Request('https://api.myaribot.mcv.kr/api/auth/me', {
    headers: { Cookie: `myari_blog_session=${token}` },
  });

  assert.deepEqual(await readSession(request, env), {
    id: '1230101255045513228',
    username: 'test-editor',
  });
});

test('rejects modified, expired, and non-allow-listed sessions', async () => {
  const token = await signSession('1230101255045513228', 'test-editor', env.BLOG_SESSION_SECRET, 0);
  const expiredRequest = new Request('https://api.myaribot.mcv.kr/', {
    headers: { Cookie: `myari_blog_session=${token}` },
  });
  assert.equal(await readSession(expiredRequest, env, 8 * 24 * 60 * 60 * 1000), null);

  const tamperedRequest = new Request('https://api.myaribot.mcv.kr/', {
    headers: { Cookie: `myari_blog_session=${token.slice(0, -1)}A` },
  });
  assert.equal(await readSession(tamperedRequest, env, 1000), null);

  const otherUserToken = await signSession('999999999999999999', 'other', env.BLOG_SESSION_SECRET);
  const otherUserRequest = new Request('https://api.myaribot.mcv.kr/', {
    headers: { Cookie: `myari_blog_session=${otherUserToken}` },
  });
  assert.equal(await readSession(otherUserRequest, env), null);
});

test('validates blog post fields and update slug consistency', () => {
  const post = {
    slug: 'first-post',
    title: ' 첫 글 ',
    category: ' 소식 ',
    excerpt: '요약',
    content: '본문',
    status: 'draft',
  };
  assert.deepEqual(validatePost(post), {
    ...post,
    title: '첫 글',
    category: '소식',
  });
  assert.equal(validatePost({ ...post, slug: 'not a slug' }), null);
  assert.equal(validatePost(post, 'another-slug'), null);
  assert.equal(validatePost({ ...post, content: '' }), null);
});

test('health check works without database configuration', async () => {
  const response = await worker.fetch(
    new Request('https://api.myaribot.mcv.kr/healthz'),
    env,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('blocks blog writes without a valid editor session and origin', async () => {
  const body = JSON.stringify({
    slug: 'first-post',
    title: '첫 글',
    content: '본문',
  });
  const noSession = await worker.fetch(new Request('https://api.myaribot.mcv.kr/api/blog/posts', {
    method: 'POST',
    headers: {
      Origin: 'https://myaribot.mcv.kr',
      'Content-Type': 'application/json',
    },
    body,
  }), env);
  assert.equal(noSession.status, 401);

  const badOrigin = await worker.fetch(new Request('https://api.myaribot.mcv.kr/api/blog/posts', {
    method: 'POST',
    headers: {
      Origin: 'https://attacker.example',
      'Content-Type': 'application/json',
    },
    body,
  }), env);
  assert.equal(badOrigin.status, 403);
});
