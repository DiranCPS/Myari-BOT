document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) lucide.createIcons();

  const tabs = document.querySelectorAll('.tab');
  const rows = document.querySelectorAll('.command-row');
  const developerPanel = document.querySelector('#developer-panel');
  const loginButton = document.querySelector('#developer-login-button');
  const inviteLinks = document.querySelectorAll('.bot-invite-link');
  const supabaseClient = window.myariSupabase;
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

  const inviteUrl = new URL('https://discord.com/oauth2/authorize');
  inviteUrl.search = new URLSearchParams({
    client_id: '1538335436341252096',
    permissions: '8',
    scope: 'bot applications.commands',
  }).toString();

  const activateInviteLinks = () => {
    inviteLinks.forEach((link) => {
      link.href = inviteUrl.toString();
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
      if (loginButton.textContent === message) loginButton.textContent = 'Discord 로그인';
    }, 5000);
  };

  const startLogin = async () => {
    if (!supabaseClient) {
      showLoginError('로그인 설정이 필요합니다');
      return;
    }
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        scopes: 'identify',
        redirectTo: `${window.location.origin}/blog/`,
      },
    });
    if (error) showLoginError('Discord 로그인을 시작하지 못했습니다');
  };

  const setCurrentUser = async (session) => {
    currentUser = null;
    deactivateInviteLinks();
    if (developerPanel) developerPanel.hidden = true;
    if (loginButton) {
      loginButton.textContent = 'Discord 로그인';
      loginButton.removeAttribute('title');
    }
    if (!session?.user || !supabaseClient) return;

    const { data: isEditor, error } = await supabaseClient.rpc('is_site_editor');
    if (error) throw error;
    if (!isEditor) {
      await supabaseClient.auth.signOut();
      showLoginError('허용되지 않은 계정입니다');
      return;
    }

    currentUser = session.user;
    const username = session.user.user_metadata?.full_name
      || session.user.user_metadata?.name
      || session.user.user_metadata?.user_name
      || 'Discord 사용자';
    activateInviteLinks();
    if (developerPanel) {
      developerPanel.hidden = false;
      const heading = developerPanel.querySelector('h2');
      if (heading) heading.textContent = `환영합니다, ${username}님.`;
    }
    if (loginButton) {
      loginButton.textContent = `${username} · 로그아웃`;
      loginButton.title = 'Discord 로그아웃';
    }
  };

  const logout = async () => {
    if (!supabaseClient) return;
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    await setCurrentUser(null);
  };

  const params = new URLSearchParams(window.location.search);
  if (params.get('auth_error') === 'not_allowed') {
    showLoginError('허용되지 않은 계정입니다');
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
      await startLogin();
      return;
    }
    try {
      await logout();
    } catch {
      showLoginError('로그아웃하지 못했습니다');
    }
  });

  inviteLinks.forEach((link) => {
    link.addEventListener('click', async (event) => {
      if (currentUser) return;
      event.preventDefault();
      await startLogin();
    });
  });

  document.querySelector('#developer-logout')?.addEventListener('click', async () => {
    try {
      await logout();
    } catch {
      showLoginError('로그아웃하지 못했습니다');
    }
  });

  if (!supabaseClient) {
    showLoginError('로그인 설정이 필요합니다');
    return;
  }

  try {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    await setCurrentUser(session);
  } catch {
    showLoginError('로그인 상태를 확인하지 못했습니다');
  }

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => {
      setCurrentUser(session).catch(() => showLoginError('로그인 권한을 확인하지 못했습니다'));
    }, 0);
  });
});
