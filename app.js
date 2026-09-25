document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();

  const tabs = document.querySelectorAll('.tab');
  const rows = document.querySelectorAll('.command-row');
  const loginModal = document.querySelector('#login-modal');
  const loginForm = document.querySelector('#login-form');
  const setupForm = document.querySelector('#account-setup-form');
  const setupKeyInput = document.querySelector('#account-setup-key');
  const setupError = document.querySelector('#account-setup-error');
  const generatedCredentials = document.querySelector('#generated-credentials');
  const generatedDeveloperId = document.querySelector('#generated-developer-id');
  const generatedDeveloperPassword = document.querySelector('#generated-developer-password');
  const developerIdInput = document.querySelector('#developer-id');
  const passwordInput = document.querySelector('#developer-password');
  const loginError = document.querySelector('#login-error');
  const developerPanel = document.querySelector('#developer-panel');
  const inviteLinks = document.querySelectorAll('.bot-invite-link');
  const configuredApiUrl = document.querySelector('meta[name="bot-api-base-url"]')?.content.trim();
  const apiBaseUrl = (configuredApiUrl || window.location.origin).replace(/\/$/, '');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((item) => item.classList.remove('active'));
      tab.classList.add('active');
      const selected = tab.dataset.tab;
      rows.forEach((row) => {
        const visible = selected === 'all'
          || row.dataset.category === selected;
        row.style.display = visible ? 'grid' : 'none';
      });
    });
  });

  const closeLogin = () => {
    loginModal.hidden = true;
    loginError.textContent = '';
    setupError.textContent = '';
    developerIdInput.value = '';
    passwordInput.value = '';
    setupKeyInput.value = '';
    generatedDeveloperId.textContent = '';
    generatedDeveloperPassword.textContent = '';
    loginForm.hidden = false;
    setupForm.hidden = true;
    generatedCredentials.hidden = true;
    document.querySelector('#open-account-setup').hidden = false;
  };

  const openLogin = () => {
    loginModal.hidden = false;
    developerIdInput.focus();
  };

  const activateInviteLinks = () => {
    inviteLinks.forEach((link) => {
      link.href = link.dataset.inviteUrl;
      link.removeAttribute('aria-label');
      link.classList.add('is-unlocked');
    });
  };

  const deactivateInviteLinks = () => {
    inviteLinks.forEach((link) => {
      link.href = link.dataset.lockedHref || '#';
      link.setAttribute('aria-label', '개발자 로그인 후 봇 초대');
      link.classList.remove('is-unlocked');
    });
  };

  document.querySelector('#developer-login-button').addEventListener('click', openLogin);
  document.querySelector('#open-account-setup').addEventListener('click', () => {
    loginForm.hidden = true;
    document.querySelector('#open-account-setup').hidden = true;
    setupForm.hidden = false;
    setupKeyInput.focus();
  });
  document.querySelector('#back-to-login').addEventListener('click', () => {
    setupForm.hidden = true;
    loginForm.hidden = false;
    document.querySelector('#open-account-setup').hidden = false;
    setupError.textContent = '';
    setupKeyInput.value = '';
    developerIdInput.focus();
  });
  setupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = setupForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    setupError.textContent = '계정 생성 중...';
    try {
      const response = await fetch(`${apiBaseUrl}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setup_key: setupKeyInput.value }),
      });
      const result = await response.json();
      if (!response.ok) {
        setupError.textContent = response.status === 429
          ? '시도 횟수가 초과되었습니다. 잠시 후 다시 시도해주세요.'
          : response.status === 503
            ? '계정 생성 기능이 서버에 설정되지 않았습니다.'
            : response.status === 403
              ? '초기 설정 키가 올바르지 않습니다.'
              : '계정을 생성하지 못했습니다. 서버 상태를 확인해주세요.';
        return;
      }
      generatedDeveloperId.textContent = result.developer_id;
      generatedDeveloperPassword.textContent = result.password;
      setupKeyInput.value = '';
      setupForm.hidden = true;
      generatedCredentials.hidden = false;
    } catch {
      setupError.textContent = '인증 서버에 연결할 수 없습니다. API 주소와 서버 상태를 확인해주세요.';
    } finally {
      submitButton.disabled = false;
    }
  });
  document.querySelector('#copy-credentials').addEventListener('click', async () => {
    const copyStatus = document.querySelector('#copy-status');
    try {
      await navigator.clipboard.writeText(
        `개발자 ID: ${generatedDeveloperId.textContent}\n비밀번호: ${generatedDeveloperPassword.textContent}`,
      );
      copyStatus.textContent = '계정 정보를 복사했습니다.';
    } catch {
      copyStatus.textContent = '복사할 수 없습니다. 화면에 표시된 정보를 직접 저장해주세요.';
    }
  });
  document.querySelector('#login-with-generated').addEventListener('click', () => {
    developerIdInput.value = generatedDeveloperId.textContent;
    passwordInput.value = generatedDeveloperPassword.textContent;
    generatedCredentials.hidden = true;
    loginForm.hidden = false;
    loginForm.requestSubmit();
  });
  inviteLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      if (!link.classList.contains('is-unlocked')) {
        event.preventDefault();
        openLogin();
      }
    });
  });
  document.querySelector('#close-login').addEventListener('click', closeLogin);
  loginModal.addEventListener('click', (event) => {
    if (event.target === loginModal) closeLogin();
  });
  document.querySelector('#toggle-password').addEventListener('click', (event) => {
    const button = event.currentTarget;
    passwordInput.type = passwordInput.type === 'password' ? 'text' : 'password';
    button.setAttribute('aria-label', passwordInput.type === 'password' ? '비밀번호 표시' : '비밀번호 숨기기');
  });
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = loginForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    loginError.textContent = '로그인 확인 중...';
    try {
      const response = await fetch(`${apiBaseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          developer_id: developerIdInput.value.trim(),
          password: passwordInput.value,
        }),
      });
      if (!response.ok) {
        loginError.textContent = response.status === 429
          ? '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.'
          : response.status === 503
            ? '개발자 계정이 아직 발급되지 않았습니다.'
            : '개발자 ID 또는 비밀번호가 올바르지 않습니다.';
        return;
      }
      activateInviteLinks();
      closeLogin();
      developerPanel.hidden = false;
      developerPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      loginError.textContent = '인증 서버에 연결할 수 없습니다. API 주소와 서버 상태를 확인해주세요.';
    } finally {
      submitButton.disabled = false;
    }
  });
  document.querySelector('#developer-logout').addEventListener('click', () => {
    developerPanel.hidden = true;
    deactivateInviteLinks();
  });
});
