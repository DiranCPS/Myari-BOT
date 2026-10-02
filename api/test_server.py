import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from aiohttp.test_utils import TestClient, TestServer

import server


class BlogApiStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_database_path = server.DATABASE_PATH
        self.original_session_secret = server.SESSION_SECRET
        self.original_allowed_ids = server.ALLOWED_USER_IDS
        server.DATABASE_PATH = Path(self.temp_dir.name) / "blog.sqlite3"
        server.SESSION_SECRET = "test-session-secret"
        server.ALLOWED_USER_IDS = {"1230101255045513228"}
        self.user = {"id": "1230101255045513228", "username": "test-editor"}

    def tearDown(self):
        server.DATABASE_PATH = self.original_database_path
        server.SESSION_SECRET = self.original_session_secret
        server.ALLOWED_USER_IDS = self.original_allowed_ids
        self.temp_dir.cleanup()

    def test_session_signature_and_allowlist(self):
        token = server.sign_session(self.user["id"], self.user["username"])
        request = SimpleNamespace(cookies={server.SESSION_COOKIE: token})

        self.assertEqual(server.read_session(request), self.user)

        tampered = token[:-1] + ("A" if token[-1] != "A" else "B")
        request.cookies[server.SESSION_COOKIE] = tampered
        self.assertIsNone(server.read_session(request))

        server.ALLOWED_USER_IDS.clear()
        request.cookies[server.SESSION_COOKIE] = token
        self.assertIsNone(server.read_session(request))

    def test_only_published_posts_are_public(self):
        published = {
            "slug": "server-safety",
            "title": "서버 안전하게 운영하기",
            "category": "운영",
            "excerpt": "요약",
            "content": "# 안내\n내용",
            "status": "published",
        }
        draft = {
            **published,
            "slug": "draft-post",
            "title": "임시 글",
            "status": "draft",
        }

        server.save_post(published, self.user)
        server.save_post(draft, self.user)

        public_posts = server.query_posts(False)
        editor_posts = server.query_posts(True)
        self.assertEqual([post["slug"] for post in public_posts], ["server-safety"])
        self.assertEqual(
            {post["slug"] for post in editor_posts},
            {"server-safety", "draft-post"},
        )
        self.assertIsNone(server.query_post("draft-post", False))
        self.assertEqual(server.query_post("draft-post", True)["status"], "draft")

    def test_publishing_a_draft_sets_published_timestamp(self):
        post = {
            "slug": "first-post",
            "title": "첫 글",
            "category": "",
            "excerpt": "",
            "content": "내용",
            "status": "draft",
        }
        server.save_post(post, self.user)
        post["status"] = "published"

        saved = server.save_post(post, self.user)

        self.assertIsNotNone(saved["published_at"])
        self.assertEqual(saved["status"], "published")


class BlogApiEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_database_path = server.DATABASE_PATH
        self.original_session_secret = server.SESSION_SECRET
        self.original_allowed_ids = server.ALLOWED_USER_IDS
        server.DATABASE_PATH = Path(self.temp_dir.name) / "blog.sqlite3"
        server.SESSION_SECRET = "test-session-secret"
        server.ALLOWED_USER_IDS = {"1230101255045513228"}
        self.client = TestClient(TestServer(server.create_app()))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        server.DATABASE_PATH = self.original_database_path
        server.SESSION_SECRET = self.original_session_secret
        server.ALLOWED_USER_IDS = self.original_allowed_ids
        self.temp_dir.cleanup()

    async def test_only_allowlisted_session_can_publish(self):
        response = await self.client.post(
            "/api/blog/posts",
            headers={"Origin": "https://myaribot.mcv.kr"},
            json={"slug": "first-post", "title": "첫 글", "content": "내용"},
        )
        self.assertEqual(response.status, 401)

        response = await self.client.post(
            "/api/blog/posts",
            headers={"Origin": "https://not-my-site.example"},
            json={},
        )
        self.assertEqual(response.status, 403)

        token = server.sign_session("1230101255045513228", "test-editor")
        response = await self.client.post(
            "/api/blog/posts",
            headers={
                "Origin": "https://myaribot.mcv.kr",
                "Cookie": f"{server.SESSION_COOKIE}={token}",
            },
            json={
                "slug": "first-post",
                "title": "첫 글",
                "content": "내용",
                "status": "published",
            },
        )
        self.assertEqual(response.status, 201)
        response = await self.client.get("/api/blog/posts")
        self.assertEqual(response.status, 200)
        self.assertEqual([post["slug"] for post in await response.json()], ["first-post"])

    async def test_invite_requires_allowlisted_session(self):
        response = await self.client.get("/api/invite", allow_redirects=False)
        self.assertEqual(response.status, 302)
        self.assertIn("auth_error=login_required", response.headers["Location"])

        token = server.sign_session("999999999999999999", "not-allowed")
        response = await self.client.get(
            "/api/invite",
            headers={"Cookie": f"{server.SESSION_COOKIE}={token}"},
            allow_redirects=False,
        )
        self.assertEqual(response.status, 302)
        self.assertIn("auth_error=login_required", response.headers["Location"])


if __name__ == "__main__":
    unittest.main()
