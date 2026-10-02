document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) lucide.createIcons();

  const tabs = document.querySelectorAll('.tab');
  const rows = document.querySelectorAll('.command-row');
  const developerPanel = document.querySelector('#developer-panel');
  const loginButton = document.querySelector('#developer-login-button');
  const inviteLinks = document.querySelectorAll('.bot-invite-link');
  const apiBaseUrl = (document.querySelector('meta[name="bot-api-base-url"]')?.content.trim()
    || window.location.origin).replace(/\/$/, '');
  let currentUser = null;

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((item) => {
        item.classList.remove('active');
        item.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const selected = tab.dataset.tab;
      rows.forEach((row) => {
        row.style.display = selected === 'all' || row.dataset.category === selected
          ? 'grid'
          : 'none';
      });
    });
  });

  const activateInviteLinks = () => {
    inviteLinks.forEach((link) => {
      link.href = `${apiBaseUrl}/api/invite`;
      link.removeAttribute('aria-label');
      link.classList.add('is-unlocked');
    });
  };

  const deactivateInviteLinks = () => {
    inviteLinks.forEach((link) => {
      link.href = link.dataset.lockedHref || '#';
      link.setAttribute('aria-label', '허용된 Discord 계정으로 로그인 후 봇 초대');
      link.classList.remove('is-unlocked');
    });
  };

  const showLoginError = (message) => {
    if (!loginButton) return;
    loginButton.textContent = message;
    window.setTimeout(() => {
      loginButton.textContent = 'Discord 로그인';
    }, 5000);
  };

  const params = new URLSearchParams(window.location.search);
  if (params.get('auth_error') === 'not_allowed') {
    showLoginError('허용되지 않은 계정입니다');
  } else if (params.get('auth_error') === 'login_required') {
    showLoginError('Discord 로그인이 필요합니다');
  } else if (params.has('auth_error')) {
    showLoginError('Discord 로그인을 완료하지 못했습니다');
  }
  if (params.has('auth') || params.has('auth_error')) {
    params.delete('auth');
    params.delete('auth_error');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }

  loginButton?.addEventListener('click', async () => {
    if (!currentUser) {
      window.location.assign(`${apiBaseUrl}/api/auth/discord`);
      return;
    }
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`Logout failed: ${response.status}`);
      currentUser = null;
      if (developerPanel) developerPanel.hidden = true;
      deactivateInviteLinks();
      loginButton.textContent = 'Discord 로그인';
    } catch {
      showLoginError('로그아웃하지 못했습니다');
    }
  });

  inviteLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      if (link.classList.contains('is-unlocked')) return;
      event.preventDefault();
      window.location.assign(`${apiBaseUrl}/api/auth/discord`);
    });
  });

  document.querySelector('#developer-logout')?.addEventListener('click', async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`Logout failed: ${response.status}`);
      currentUser = null;
      developerPanel.hidden = true;
      deactivateInviteLinks();
      if (loginButton) {
        loginButton.textContent = 'Discord 로그인';
        loginButton.removeAttribute('title');
      }
    } catch {
      showLoginError('로그아웃하지 못했습니다');
    }
  });

  try {
    const response = await fetch(`${apiBaseUrl}/api/auth/me`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) return;
    const user = await response.json();
    if (!user.authorized) return;

    currentUser = user;
    activateInviteLinks();
    if (developerPanel) {
      developerPanel.hidden = false;
      const heading = developerPanel.querySelector('h2');
      if (heading) heading.textContent = `환영합니다, ${user.username}님.`;
    }
    if (loginButton) {
      loginButton.textContent = `${user.username} · 로그아웃`;
      loginButton.title = 'Discord 로그아웃';
    }
  } catch {
    showLoginError('로그인 서버에 연결할 수 없습니다');
  }
});
