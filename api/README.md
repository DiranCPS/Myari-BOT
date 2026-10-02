# Myari blog API

This service handles Discord OAuth, the allow-listed editor session, and blog
post storage. It is separate from the static GitHub Pages site.

## Render setup

1. In Render, create a Blueprint from this GitHub repository and apply
   `render.yaml`. The service uses a persistent disk for the SQLite blog
   database; Render charges for the paid web-service plan and persistent disk.
2. Add `api.myaribot.mcv.kr` as a custom domain for the web service. Create the
   DNS record Render asks for and wait for TLS to become active. The custom
   subdomain keeps the API and GitHub Pages site same-site for secure cookies.
3. In the Discord Developer Portal for the bot application, add this exact
   OAuth2 redirect URL:
   `https://api.myaribot.mcv.kr/api/auth/discord/callback`
4. Copy the OAuth2 client secret into Render's `DISCORD_CLIENT_SECRET`
   environment variable. Never put it in this repository or send it in chat.
5. Wait for `/healthz` to return `{"status":"ok"}`. The frontend is configured
   to use `https://api.myaribot.mcv.kr`.
6. To prevent bypassing the site's invite check by manually reconstructing a
   Discord bot authorization link, turn off **Public Bot** in the Discord
   Developer Portal and add each permitted inviter to the application's team.

The Discord user IDs in `SITE_ALLOWED_USER_IDS` are the only accounts allowed
to unlock the bot invite and create, edit, or publish posts. Keep the list in
Render's environment settings when changing access.

## Local run

Install `requirements.txt`, then set `DISCORD_CLIENT_SECRET`,
`DISCORD_REDIRECT_URI`, and a long random `BLOG_SESSION_SECRET`. Configure the
Discord OAuth redirect URL to match the callback address used for local
testing, and set `COOKIE_DOMAIN` to an empty value when using localhost.
