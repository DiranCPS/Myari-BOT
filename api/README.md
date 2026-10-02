# 무료 API 배포 안내 (Cloudflare Workers + D1)

이 구성은 Render 웹서비스와 유료 영속 디스크 대신 Cloudflare Workers와 D1을 사용합니다. 두 제품은 무료 사용량 한도 내에서 시작할 수 있습니다. Cloudflare 계정 및 사이트 도메인 등록 비용은 별도이며, 무료 한도를 넘으면 제한 또는 요금이 적용될 수 있습니다.

## 1. 필요한 것

- Cloudflare 계정
- `myaribot.mcv.kr` DNS를 관리할 수 있는 권한
- Node.js와 npm이 설치된 PC
- Discord 애플리케이션의 OAuth2 Client Secret

## 2. 도메인의 DNS 준비

Worker를 `api.myaribot.mcv.kr`로 연결하려면 `mcv.kr` DNS 영역이 Cloudflare에서 관리되어야 합니다. 도메인이 아직 다른 DNS 업체를 사용한다면 Cloudflare에 영역을 추가하고, 기존 DNS 레코드가 모두 옮겨졌는지 확인한 뒤에만 도메인 업체의 네임서버를 Cloudflare가 안내한 값으로 변경하세요. 레코드가 빠진 채 네임서버를 바꾸면 현재 홈페이지나 메일이 중단될 수 있습니다.

Cloudflare가 이미 DNS를 관리 중이라면 이 단계를 건너뛰세요.

## 3. Worker와 D1 데이터베이스 만들기

PowerShell에서 저장소의 `api` 폴더로 이동한 다음 Wrangler에 로그인합니다.

```powershell
cd C:\Users\user\Downloads\Myari-BOT\api
npx wrangler login
npx wrangler d1 create myari-blog
```

`d1 create`가 출력한 데이터베이스 ID를 `wrangler.toml`의 `database_id`에 입력하세요. 그 다음 스키마를 만들고 Worker를 배포합니다.

```powershell
npx wrangler d1 migrations apply myari-blog --remote
npx wrangler deploy
```

첫 실행 시 Wrangler가 `wrangler` 도구 설치를 확인할 수 있습니다. 안내에 동의하면 됩니다.

## 4. 비밀값 설정

Discord Developer Portal의 해당 애플리케이션에서 OAuth2 Client Secret을 준비하세요. 다음 명령을 각각 실행하고, 프롬프트에 비밀값을 입력합니다. 이 값은 저장소에 넣지 마세요.

```powershell
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put BLOG_SESSION_SECRET
```

`BLOG_SESSION_SECRET`에는 비밀번호 관리자에서 생성한 임의의 긴 문자열을 사용하세요. Discord Client Secret은 GitHub에 올리거나 채팅으로 보내지 마세요. 비밀값을 등록한 후 다시 배포합니다.

```powershell
npx wrangler deploy
```

## 5. API 도메인 연결

Cloudflare Dashboard에서 **Workers & Pages → myari-blog-api → Settings → Domains & Routes → Add → Custom Domain**으로 이동해 `api.myaribot.mcv.kr`을 추가하세요. TLS 인증서가 활성화될 때까지 기다립니다.

Discord Developer Portal의 **OAuth2 → Redirects**에도 아래 주소가 등록되어 있는지 확인하세요.

```text
https://api.myaribot.mcv.kr/api/auth/discord/callback
```

아래 주소를 열어 `{"status":"ok"}`가 보이면 API가 준비된 것입니다.

```text
https://api.myaribot.mcv.kr/healthz
```

## 6. 초대 권한 주의사항

사이트와 API는 지정된 Discord 사용자 ID 세 개만 허용하도록 설정되어 있습니다. 하지만 Discord 초대 URL을 직접 만드는 것을 막으려면 Developer Portal에서 **Public Bot**을 끄고, 허용할 계정을 애플리케이션 팀에 추가해야 합니다. 봇 초대 권한은 기존 설정대로 `Administrator`입니다. 실제 공개 전에 Discord 권한 화면에서 필요한 권한만 주는 것을 권장합니다.

## 로컬 테스트

```powershell
npm test
```
