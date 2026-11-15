# 홈페이지 파일 업로드 설정

개발자 패널에서 Discord 채널 ID와 파일을 선택하면 브라우저가 파일을 R2로 직접 전송합니다. 업로드가 끝나면 봇이 해당 채널에 다운로드 링크를 올립니다. 최대 크기는 10 GiB입니다. 링크는 72시간 유효하며 Cloudflare Worker가 완료 시각으로부터 72시간 지난 파일을 15분 간격으로 삭제합니다.

## Cloudflare 설정

1. Cloudflare에서 비공개 R2 버킷 myari-uploads를 만듭니다. R2 무료 구간은 10 GB-month 저장량입니다. 초과 사용은 요금이 붙습니다.
2. 버킷용 R2 S3 Access Key ID와 Secret Access Key를 만듭니다.
3. worker 폴더에서 다음을 실행하고 각 질문에 값을 넣습니다.

```powershell
npm install
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put R2_BUCKET_NAME
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put BOT_API_URL
npx wrangler secret put BOT_API_SECRET
npx wrangler deploy
```

BOT_API_URL은 봇의 공개 HTTPS 주소 끝에 /api/file-upload/complete를 붙인 주소입니다. BOT_API_SECRET은 봇 .env와 Worker secret에 같은 임의 비밀 문자열을 설정해야 합니다. 비밀 값을 GitHub 파일에 올리지 마세요.

4. R2 버킷 CORS에 Allowed origin https://myaribot.mcv.kr, method PUT, allowed headers *, exposed header ETag를 설정합니다.
5. Worker 배포 주소를 supabase-config.js의 myariUploadApiUrl에 넣고 GitHub Pages를 배포합니다.
6. R2 bucket lifecycle에서 미완료 multipart 업로드를 하루 뒤 중단하도록 설정합니다. Worker cron은 완료된 파일을 약 15분 간격으로 검사해 72시간 후 삭제합니다.

## 동작 범위와 조건

- 업로드는 기존 Discord 로그인 후 is_site_editor() 허용 목록에 있는 사이트 계정만 사용할 수 있습니다.
- 홈페이지에 채널 ID 입력란이 있습니다. 봇이 해당 채널에 메시지를 보낼 수 있어야 합니다.
- 봇 호스팅에서 API 포트를 인터넷의 HTTPS 주소로 연결해야 Worker가 Discord 알림을 보낼 수 있습니다.
- 다운로드 URL은 가진 사람 누구나 72시간 동안 열 수 있습니다.
- 사이트는 GitHub Pages에 유지되고 업로드 API/보관은 Cloudflare Worker와 R2가 담당합니다.
