document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) lucide.createIcons();

  const supabaseClient = window.myariSupabase;
  const grid = document.querySelector('#post-grid');
  const reader = document.querySelector('#post-reader');
  const editor = document.querySelector('#post-editor');
  const notice = document.querySelector('#blog-notice');
  const loginButton = document.querySelector('#blog-login');
  const logoutButton = document.querySelector('#blog-logout');
  const newPostButton = document.querySelector('#new-post');
  const form = document.querySelector('#post-form');
  const postsBySlug = new Map();
  let isAuthorized = false;
  let editingSlug = null;

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);

  const renderMarkdown = (source) => {
    const lines = escapeHtml(source).split(/\r?\n/);
    const output = [];
    let inList = false;
    let inCode = false;
    let codeLines = [];
    const inline = (line) => line
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
    const endList = () => {
      if (inList) output.push('</ul>');
      inList = false;
    };

    for (const line of lines) {
      if (line.startsWith('```')) {
        endList();
        if (inCode) {
          output.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
          codeLines = [];
          inCode = false;
        } else {
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        codeLines.push(line);
        continue;
      }
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        endList();
        const level = heading[1].length;
        output.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      } else if (/^[-*]\s+/.test(line)) {
        if (!inList) output.push('<ul>');
        inList = true;
        output.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
      } else if (/^&gt;\s?/.test(line)) {
        endList();
        output.push(`<blockquote>${inline(line.replace(/^&gt;\s?/, ''))}</blockquote>`);
      } else if (line.trim()) {
        endList();
        output.push(`<p>${inline(line)}</p>`);
      } else {
        endList();
      }
    }
    endList();
    if (inCode) output.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
    return output.join('\n');
  };

  const formatDate = (date) => {
    if (!date) return '임시 저장';
    const parsed = new Date(date);
    return Number.isNaN(parsed.valueOf()) ? '' : new Intl.DateTimeFormat('ko-KR').format(parsed);
  };

  const setNotice = (message = '') => {
    notice.textContent = message;
  };

  const renderPostList = (posts) => {
    postsBySlug.clear();
    for (const post of posts) postsBySlug.set(post.slug, post);
    if (!posts.length) {
      grid.innerHTML = '<div class="empty-posts"><i data-lucide="notebook-tabs"></i><h3>아직 게시물이 없습니다.</h3><p>새로운 소식과 서버 운영 팁을 준비하고 있어요.</p></div>';
      if (window.lucide) lucide.createIcons();
      return;
    }
    grid.innerHTML = posts.map((post) => `
      <article class="post-card">
        <div class="post-meta"><span class="post-category">${escapeHtml(post.category || '이야기')}</span><span>${escapeHtml(formatDate(post.published_at || post.updated_at))}</span>${post.status === 'draft' ? '<span class="post-draft">임시 저장</span>' : ''}</div>
        <h3>${escapeHtml(post.title)}</h3>
        <p>${escapeHtml(post.excerpt || '')}</p>
        <div class="post-card-actions">
          <button class="post-open" type="button" data-open-post="${escapeHtml(post.slug)}">글 읽기 <i data-lucide="arrow-up-right"></i></button>
          ${isAuthorized ? `<button class="post-edit" type="button" data-edit-post="${escapeHtml(post.slug)}">수정</button>` : ''}
        </div>
      </article>`).join('');
    if (window.lucide) lucide.createIcons();
  };

  const loadPosts = async () => {
    if (!supabaseClient) {
      grid.innerHTML = '<div class="empty-posts"><i data-lucide="settings"></i><h3>블로그 연결 설정이 필요합니다.</h3><p>사이트 관리자가 Supabase 설정을 완료해야 게시물을 표시할 수 있어요.</p></div>';
      if (window.lucide) lucide.createIcons();
      setNotice('Supabase 프로젝트 연결 전입니다.');
      return;
    }
    try {
      const { data: posts, error } = await supabaseClient
        .from('posts')
        .select('*')
        .order('published_at', { ascending: false, nullsFirst: false })
        .order('updated_at', { ascending: false });
      if (error) throw error;
      renderPostList(posts);
      setNotice('');
    } catch {
      grid.innerHTML = '<div class="empty-posts"><i data-lucide="wifi-off"></i><h3>게시물을 불러오지 못했습니다.</h3><p>Supabase 프로젝트 연결을 확인한 뒤 다시 시도해주세요.</p><button class="post-open" id="retry-posts" type="button">다시 시도 <i data-lucide="rotate-cw"></i></button></div>';
      if (window.lucide) lucide.createIcons();
      setNotice('게시물을 불러오지 못했습니다. Supabase 설정을 확인해주세요.');
    }
  };

  const openPost = async (slug) => {
    try {
      let post = postsBySlug.get(slug);
      if (!post) {
        const { data, error } = await supabaseClient
          .from('posts')
          .select('*')
          .eq('slug', slug)
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('게시물을 찾을 수 없습니다.');
        post = data;
      }
      grid.hidden = true;
      editor.hidden = true;
      reader.hidden = false;
      reader.innerHTML = `
        <button class="reader-back" type="button" id="reader-back">← 게시물 목록</button>
        <div class="post-meta reader-meta"><span class="post-category">${escapeHtml(post.category || '이야기')}</span><span>${escapeHtml(formatDate(post.published_at || post.updated_at))}</span>${post.status === 'draft' ? '<span class="post-draft">임시 저장</span>' : ''}</div>
        <h1>${escapeHtml(post.title)}</h1>
        ${post.excerpt ? `<p class="reader-excerpt">${escapeHtml(post.excerpt)}</p>` : ''}
        <div class="reader-content">${renderMarkdown(post.content)}</div>`;
      reader.querySelector('#reader-back').addEventListener('click', closeReader);
      history.replaceState({}, '', `${location.pathname}?post=${encodeURIComponent(slug)}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setNotice(error.message || '게시물을 열지 못했습니다.');
    }
  };

  const closeReader = () => {
    reader.hidden = true;
    grid.hidden = false;
    const url = new URL(window.location.href);
    url.searchParams.delete('post');
    history.replaceState({}, '', `${url.pathname}${url.search}`);
  };

  const openEditor = (post = null) => {
    editingSlug = post?.slug || null;
    document.querySelector('#editor-title').textContent = post ? '게시물 수정' : '새 글 작성';
    form.elements.title.value = post?.title || '';
    form.elements.slug.value = post?.slug || '';
    form.elements.slug.readOnly = Boolean(post);
    form.elements.category.value = post?.category || '';
    form.elements.excerpt.value = post?.excerpt || '';
    form.elements.content.value = post?.content || '';
    form.elements.status.value = post?.status || 'published';
    reader.hidden = true;
    grid.hidden = true;
    editor.hidden = false;
    setNotice('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    form.elements.title.focus();
  };

  const closeEditor = () => {
    editor.hidden = true;
    grid.hidden = false;
    editingSlug = null;
    form.reset();
    form.elements.slug.readOnly = false;
  };

  grid.addEventListener('click', (event) => {
    if (event.target.closest('#retry-posts')) {
      loadPosts();
      return;
    }
    const openButton = event.target.closest('[data-open-post]');
    if (openButton) openPost(openButton.dataset.openPost);
    const editButton = event.target.closest('[data-edit-post]');
    if (editButton) openEditor(postsBySlug.get(editButton.dataset.editPost));
  });

  loginButton.addEventListener('click', () => {
    if (!supabaseClient) {
      setNotice('Supabase 프로젝트 연결 전입니다.');
      return;
    }
    supabaseClient.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        scopes: 'identify',
        redirectTo: `${window.location.origin}/blog/`,
      },
    }).then(({ error }) => {
      if (error) setNotice('Discord 로그인을 시작하지 못했습니다.');
    });
  });
  logoutButton.addEventListener('click', async () => {
    if (!supabaseClient) return;
    try {
      const { error } = await supabaseClient.auth.signOut();
      if (error) throw error;
      location.reload();
    } catch {
      setNotice('로그아웃하지 못했습니다.');
    }
  });
  newPostButton.addEventListener('click', () => openEditor());
  document.querySelector('#cancel-edit').addEventListener('click', closeEditor);
  form.elements.title.addEventListener('input', () => {
    if (editingSlug || form.elements.slug.value) return;
    form.elements.slug.value = `post-${Date.now().toString(36)}`;
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.querySelector('#save-post');
    button.disabled = true;
    setNotice('저장 중...');
    const post = {
      title: form.elements.title.value.trim(),
      slug: form.elements.slug.value.trim(),
      category: form.elements.category.value.trim(),
      excerpt: form.elements.excerpt.value.trim(),
      content: form.elements.content.value,
      status: form.elements.status.value,
    };
    try {
      if (!supabaseClient) throw new Error('Supabase 프로젝트 연결 전입니다.');
      const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error('Discord 로그인이 필요합니다.');
      const username = user.user_metadata?.full_name
        || user.user_metadata?.name
        || user.user_metadata?.user_name
        || 'Discord 사용자';
      const postWithAuthor = { ...post, author_id: user.id, author_name: username };
      const saveQuery = editingSlug
        ? supabaseClient.from('posts').update(postWithAuthor).eq('slug', editingSlug)
        : supabaseClient.from('posts').insert(postWithAuthor);
      const { error } = await saveQuery;
      if (error) throw error;
      closeEditor();
      await loadPosts();
      setNotice('게시물을 저장했습니다.');
    } catch (error) {
      setNotice(error.message || '게시물을 저장하지 못했습니다.');
    } finally {
      button.disabled = false;
    }
  });

  document.querySelectorAll('.blog-user, #blog-logout').forEach((element) => { element.hidden = true; });

  const updateEditor = async (session) => {
    isAuthorized = false;
    const user = session?.user || null;
    document.querySelector('#blog-user').hidden = true;
    loginButton.hidden = false;
    logoutButton.hidden = true;
    newPostButton.hidden = true;
    if (!user || !supabaseClient) return;

    const { data: authorized, error } = await supabaseClient.rpc('is_site_editor');
    if (error) throw error;
    if (!authorized) {
      setNotice('허용 목록에 등록된 Discord 계정만 글을 작성할 수 있습니다.');
      await supabaseClient.auth.signOut();
      return;
    }
    isAuthorized = true;
    const username = user.user_metadata?.full_name
      || user.user_metadata?.name
      || user.user_metadata?.user_name
      || 'Discord 사용자';
    document.querySelector('#blog-user').textContent = username;
    document.querySelector('#blog-user').hidden = false;
    loginButton.hidden = true;
    logoutButton.hidden = false;
    newPostButton.hidden = false;
  };

  if (supabaseClient) {
    try {
      const { data: { session }, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      await updateEditor(session);
    } catch {
      setNotice('로그인 상태를 확인하지 못했습니다.');
    }
    supabaseClient.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => {
        updateEditor(session).catch(() => setNotice('로그인 권한을 확인하지 못했습니다.'));
      }, 0);
    });
  }

  await loadPosts();
  const postSlug = new URLSearchParams(location.search).get('post');
  if (postSlug) await openPost(postSlug);

  const params = new URLSearchParams(location.search);
  if (params.get('auth_error') === 'not_allowed') {
    setNotice('허용 목록에 등록된 Discord 계정만 글을 작성하고 봇을 초대할 수 있습니다.');
  } else if (params.get('auth_error') === 'login_required') {
    setNotice('글 작성과 봇 초대에는 Discord 로그인이 필요합니다.');
  } else if (params.has('auth_error')) {
    setNotice('Discord 로그인을 완료하지 못했습니다. 다시 시도해주세요.');
  }
  if (params.has('auth_error') || params.has('auth')) {
    params.delete('auth_error');
    params.delete('auth');
    const query = params.toString();
    history.replaceState({}, '', `${location.pathname}${query ? `?${query}` : ''}`);
  }
});
