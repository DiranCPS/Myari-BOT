# Discord 로그인과 블로그 연결 (Supabase)

Supabase가 Discord OAuth 로그인, 세션, 게시물 데이터베이스를 관리합니다. Supabase 무료 사용량에서 시작할 수 있으며, 무료 플랜의 한도와 비활성 프로젝트 정책은 바뀔 수 있습니다. 사이트는 GitHub Pages에 그대로 배포됩니다.

## 1. Supabase 프로젝트 만들기

1. [Supabase](https://supabase.com)에 로그인하고 새 프로젝트를 만듭니다.
2. 프로젝트 생성 후 **SQL Editor**에서 `supabase/schema.sql` 전체를 실행합니다. 이 스크립트는 게시물 테이블과 권한 정책을 만들고, 허용 Discord ID 세 개를 등록합니다.
3. **Project Settings → API**에서 Project URL과 `anon`/publishable key를 복사해 `supabase-config.js`의 빈 문자열 두 곳에 입력합니다. 이 anon 키는 브라우저에 공개되는 키입니다. 보안을 담당하는 것은 SQL의 RLS 정책이므로 `service_role` 키는 절대 브라우저 파일에 넣지 마세요.

## 2. Discord 로그인 제공자 연결

1. Supabase에서 **Authentication → Providers → Discord**를 열고 Discord provider를 켭니다.
2. Supabase 화면에 표시된 Callback URL을 복사합니다. 일반적으로 다음 모양입니다.
   `https://<project-ref>.supabase.co/auth/v1/callback`
3. [Discord Developer Portal](https://discord.com/developers/applications)의 해당 애플리케이션에서 **OAuth2 → General → Redirects**에 그 Callback URL을 등록합니다.
4. Discord의 Client ID와 Client Secret을 Supabase Discord provider 설정에 입력하고 저장합니다. Secret은 Supabase 대시보드에만 입력하고 GitHub나 채팅에 올리지 마세요.
5. Supabase의 **Authentication → URL Configuration**에서 Site URL을 `https://myaribot.mcv.kr`로 설정하고 Redirect URLs에 `https://myaribot.mcv.kr/**`를 추가합니다.

## 3. 사이트 배포 및 확인

`supabase-config.js`를 저장소에 커밋·푸시하면 GitHub Pages에 반영됩니다. 로그인한 뒤 허용 목록에 없는 계정은 편집 권한이 부여되지 않습니다. 게시물의 초안 열람과 생성·수정은 데이터베이스 RLS 정책으로 제한합니다.

초대 링크 버튼은 허용된 계정의 브라우저에서만 열리도록 잠겨 있습니다. 그러나 Discord 초대 주소 자체를 완전히 비공개로 만들 수는 없습니다. 다른 사람이 주소를 직접 구성해 초대하는 것을 막으려면 Discord Developer Portal에서 **Public Bot**을 끄고 허용 사용자를 애플리케이션 팀에 추가하세요. 현재 초대 권한은 `Administrator`이므로, 공개 전에 Discord의 Bot Permissions에서 꼭 필요한 권한만 선택하는 것을 권장합니다.

## 허용 사용자 변경

Supabase SQL Editor에서 다음처럼 허용 ID를 추가하거나 삭제합니다.

```sql
INSERT INTO public.site_allowed_discord_users (discord_user_id)
VALUES ('DISCORD_USER_ID')
ON CONFLICT DO NOTHING;

DELETE FROM public.site_allowed_discord_users
WHERE discord_user_id = 'DISCORD_USER_ID';
```

웹페이지의 로그인 버튼은 UI 편의용 잠금일 뿐입니다. 글 작성 권한은 항상 RLS 정책이 서버에서 검사합니다.
