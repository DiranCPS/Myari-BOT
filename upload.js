document.addEventListener("DOMContentLoaded", async () => {
  const panel = document.querySelector("#file-upload-tool");
  if (!panel) return;
  const client = window.myariSupabase;
  const status = panel.querySelector("#file-upload-status");
  const button = panel.querySelector("#file-upload-submit");
  const progress = panel.querySelector("#file-upload-progress");
  const input = panel.querySelector("#file-upload-input");
  const channelInput = panel.querySelector("#file-upload-channel");

  const show = (message, isError = false) => {
    status.textContent = message;
    status.dataset.error = isError ? "true" : "false";
  };

  async function getEditorSession() {
    if (!client) return null;
    let { data, error } = await client.auth.getSession();
    if (error || !data.session) return null;
    if (data.session.expires_at && data.session.expires_at < Math.floor(Date.now() / 1000) + 90) {
      const refreshed = await client.auth.refreshSession();
      data = refreshed.data;
      if (refreshed.error || !data.session) return null;
    }
    const { data: allowed, error: roleError } = await client.rpc("is_site_editor");
    return roleError || !allowed ? null : data.session;
  }

  try {
    const session = await getEditorSession();
    panel.hidden = !session;
  } catch {
    panel.hidden = true;
  }
  client?.auth.onAuthStateChange(() => {
    window.setTimeout(async () => {
      panel.hidden = !(await getEditorSession());
    }, 0);
  });

  async function api(action, payload, token) {
    if (!window.myariUploadApiUrl) throw new Error("업로드 서버 설정이 아직 완료되지 않았습니다.");
    const response = await fetch(window.myariUploadApiUrl.replace(/\/$/, ""), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ action, ...payload }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "요청에 실패했습니다.");
    return body;
  }

  button?.addEventListener("click", async () => {
    const file = input.files?.[0];
    const channelId = channelInput.value.trim();
    const maxSize = 10 * 1024 * 1024 * 1024;
    if (!file) return show("업로드할 파일을 선택해주세요.", true);
    if (file.size < 1 || file.size > maxSize) return show("파일은 0보다 크고 10GB 이하여야 합니다.", true);
    if (!/^\d{17,20}$/.test(channelId)) return show("Discord 채널 ID를 숫자로 입력해주세요.", true);
    button.disabled = true;
    progress.value = 0;
    let session = null;
    try {
      const auth = await getEditorSession();
      if (!auth) throw new Error("Discord 로그인 권한을 확인해주세요.");
      session = await api("start", { filename: file.name, size: file.size, channel_id: channelId }, auth.access_token);
      const partSize = session.partSize;
      const count = Math.ceil(file.size / partSize);
      const parts = [];
      for (let partNumber = 1; partNumber <= count; partNumber++) {
        const authNow = await getEditorSession();
        if (!authNow) throw new Error("로그인이 만료됐습니다. 다시 로그인해주세요.");
        const signed = await api("sign-part", {
          key: session.key, upload_id: session.uploadId, part_number: partNumber,
        }, authNow.access_token);
        const begin = (partNumber - 1) * partSize;
        const end = Math.min(begin + partSize, file.size);
        const response = await fetch(signed.url, {
          method: "PUT",
          body: file.slice(begin, end),
        });
        if (!response.ok) throw new Error("파일 조각 업로드 실패 (" + response.status + ")");
        const etag = response.headers.get("ETag");
        if (!etag) throw new Error("R2 CORS에서 ETag 응답 헤더를 허용해야 합니다.");
        parts.push({ etag });
        progress.value = Math.round((end / file.size) * 100);
        show("업로드 중… " + progress.value + "%");
      }
      const finalAuth = await getEditorSession();
      if (!finalAuth) throw new Error("로그인이 만료됐습니다. 다시 로그인해주세요.");
      await api("complete", {
        key: session.key,
        upload_id: session.uploadId,
        filename: file.name,
        size: file.size,
        channel_id: channelId,
        parts,
      }, finalAuth.access_token);
      show("완료! Discord 채널에 3일 동안 유효한 다운로드 링크를 게시했습니다.");
      input.value = "";
    } catch (error) {
      if (session?.key && session?.uploadId) {
        try {
          const auth = await getEditorSession();
          if (auth) await api("abort", { key: session.key, upload_id: session.uploadId }, auth.access_token);
        } catch {}
      }
      show(error.message || "업로드에 실패했습니다.", true);
    } finally {
      button.disabled = false;
    }
  });
});
