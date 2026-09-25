document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();

  const tabs = document.querySelectorAll('.tab');
  const rows = document.querySelectorAll('.command-row');
  const loginModal = document.querySelector('#login-modal');
  const loginForm = document.querySelector('#login-form');
  const developerIdInput = document.querySelector('#developer-id');
  const passwordInput = document.querySelector('#developer-password');
  const loginError = document.querySelector('#login-error');
  const developerPanel = document.querySelector('#developer-panel');
  const inviteLinks = document.querySelectorAll('.bot-invite-link');
  const testDeveloperId = 'developer';
  const testPassword = 'dev2026!';

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
    developerIdInput.value = '';
    passwordInput.value = '';
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

  document.querySelector('#developer-login-button').addEventListener('click', openLogin);
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
  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (developerIdInput.value.trim() !== testDeveloperId || passwordInput.value !== testPassword) {
      loginError.textContent = '개발자 ID 또는 비밀번호가 올바르지 않습니다.';
      passwordInput.focus();
      return;
    }
    activateInviteLinks();
    closeLogin();
    developerPanel.hidden = false;
    developerPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  document.querySelector('#developer-logout').addEventListener('click', () => {
    developerPanel.hidden = true;
  });
});
