(function () {
  'use strict';

  const SUPABASE_URL = 'https://zqiqjzxcpznhzjengfff.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxaXFqenhjcHpuaHpqZW5nZmZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NjcwNDEsImV4cCI6MjEwMzM0MzA0MX0.Xbm_rHVt8Ku7GT7YY8PLUqbd8_6sXL4dZf0V6PGs7TA';

  const body = document.body;
  const gate = document.getElementById('authGate');
  const form = document.getElementById('authForm');
  const emailInput = document.getElementById('authEmail');
  const passwordInput = document.getElementById('authPassword');
  const confirmPasswordInput = document.getElementById('authConfirmPassword');
  const nameInput = document.getElementById('authName');
  const submitButton = document.getElementById('authSubmit');
  const message = document.getElementById('authMessage');
  const signOutButton = document.getElementById('authSignOut');
  const userEmail = document.getElementById('authUserEmail');
  const workspaceName = document.getElementById('authWorkspaceName');
  const welcomeModal = document.getElementById('welcomeModal');
  const welcomeMessage = document.getElementById('welcomeMessage');
  let appliedAccessToken = null;
  let authMode = 'signin';
  let signingIn = false;
  let sessionGeneration = 0;

  function setSignInProgress(busy, label) {
    signingIn = busy;
    form.setAttribute('aria-busy', String(busy));
    submitButton.setAttribute('aria-busy', String(busy));
    submitButton.disabled = busy;
    submitButton.textContent = label || (authMode === 'create' ? 'Create account' : 'Sign in');
    document.getElementById('signInTab').disabled = busy;
    document.getElementById('createAccountTab').disabled = busy;
    emailInput.readOnly = busy;
    passwordInput.readOnly = busy;
  }

  async function requestAuth(action) {
    try { return await action(); }
    catch {
      return { data: null, error: { code: 'connection_failed', message: 'The request could not finish. Check your connection and try again.' } };
    }
  }

  function showMessage(text, type) {
    message.textContent = text;
    message.className = 'rf-auth-message' + (type ? ' ' + type : '');
  }

  function showGuest() {
    sessionGeneration++;
    window.dispatchEvent(new CustomEvent('ancalagon:auth-cleared'));
    setSignInProgress(false);
    body.classList.remove('rf-auth-pending', 'rf-authenticated', 'rf-data-loading', 'rf-auth-opening');
    body.classList.add('rf-auth-guest');
    gate.removeAttribute('aria-hidden');
    document.getElementById('rf-app').setAttribute('aria-hidden', 'true');
    document.getElementById('rf-app').removeAttribute('aria-busy');
  }

  function showApplication(session, workspace, needsWorkspaceLoad) {
    const keepSignInVisible = needsWorkspaceLoad && signingIn && body.classList.contains('rf-auth-guest');
    body.classList.toggle('rf-auth-opening', keepSignInVisible);
    body.classList.remove('rf-auth-pending', 'rf-auth-guest');
    body.classList.add('rf-authenticated');
    body.classList.toggle('rf-data-loading', Boolean(needsWorkspaceLoad));
    if (keepSignInVisible) gate.removeAttribute('aria-hidden');
    else gate.setAttribute('aria-hidden', 'true');
    document.getElementById('rf-app').setAttribute('aria-hidden', String(Boolean(needsWorkspaceLoad)));
    userEmail.textContent = session.user.email || '';
    const displayName = session.user.user_metadata?.display_name?.trim();
    const resolvedWorkspaceName = workspace?.name || 'Private workspace';
    workspaceName.textContent = displayName
      ? displayName + ' · ' + resolvedWorkspaceName
      : resolvedWorkspaceName;
  }

  window.addEventListener('ancalagon:data-ready', function () {
    if (!body.classList.contains('rf-authenticated')) return;
    const enteringFromSignIn = body.classList.contains('rf-auth-opening');
    body.classList.remove('rf-auth-opening');
    setSignInProgress(false);
    gate.setAttribute('aria-hidden', 'true');
    const app = document.getElementById('rf-app');
    app.removeAttribute('aria-hidden');
    if (enteringFromSignIn) {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      // The page remains mounted while Home refreshes its heading and job cards.
      const page = app.querySelector('.rf-page.active');
      if (page && !document.querySelector('.rf-welcome-modal:not([hidden])')) {
        page.setAttribute('tabindex', '-1');
        page.focus({ preventScroll: true });
      }
    }
  });

  async function workspaceForUser(client) {
    const { data, error } = await client
      .from('workspace_members')
      .select('workspace_id, role, workspaces(name)')
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) {const {data:deleting}=await client.rpc('get_account_deletion_status');throw new Error(deleting===true?'Account deletion is in progress. Your private workspaces are locked while cleanup finishes.':'This account does not have active beta access. Contact the administrator.');}
    const relatedWorkspace = Array.isArray(data.workspaces)
      ? data.workspaces[0]
      : data.workspaces;

    return {
      id: data.workspace_id,
      role: data.role,
      name: relatedWorkspace?.name || 'Private workspace'
    };
  }

  async function applySession(client, session) {
    if (!session) {
      if(window.ancalagonAuth?.session?.user?.id)window.ancalagonNeedsFreshPage=true;
      appliedAccessToken = null;
      window.ancalagonAuth = { client, session: null, workspace: null };
      showGuest();
      return;
    }

    if (session.access_token === appliedAccessToken && window.ancalagonAuth?.workspace) return;

    if(window.ancalagonNeedsFreshPage){window.location.reload();return;}
    const previousUser = window.ancalagonAuth?.session?.user?.id;
    if ((previousUser && previousUser !== session.user.id) || (window.ancalagonPreviousUser && window.ancalagonPreviousUser !== session.user.id)) {window.location.reload();return;}
    window.ancalagonPreviousUser=session.user.id;

    const generation = sessionGeneration;
    try {
      const workspace = await workspaceForUser(client);
      if (generation !== sessionGeneration) return;
      // getSession and the initial auth event can resolve the same session together.
      if (session.access_token === appliedAccessToken && window.ancalagonAuth?.workspace) return;
      const workspaceChanged = window.ancalagonAuth?.workspace?.id !== workspace.id;
      appliedAccessToken = session.access_token;
      window.ancalagonAuth = { client, session, workspace };
      showApplication(session, workspace, workspaceChanged);
      if (workspaceChanged) {
        window.dispatchEvent(new CustomEvent('ancalagon:auth-ready', { detail: window.ancalagonAuth }));
      }
    } catch (error) {
      if (generation !== sessionGeneration) return;
      showGuest();
      showMessage(error.message || 'Your workspace could not be loaded.', 'error');
    }
  }

  if (!window.supabase?.createClient) {
    showGuest();
    showMessage('The secure sign-in service could not load. Check your connection and refresh.', 'error');
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  window.ancalagonSupabase = client;

  function showWelcome(text, buttonText) {
    welcomeMessage.textContent = text;
    document.getElementById('welcomeContinue').textContent = buttonText || 'Enter blumr';
    welcomeModal.hidden = false;
  }

  document.getElementById('welcomeContinue').addEventListener('click', function () {
    welcomeModal.hidden = true;
  });

  const recoveryModal = document.getElementById('recoveryModal');
  const resetPasswordModal = document.getElementById('resetPasswordModal');

  document.getElementById('forgotAccess').addEventListener('click', function () {
    if (signingIn) return;
    document.getElementById('recoveryEmail').value = emailInput.value.trim();
    document.getElementById('recoveryMessage').textContent = '';
    recoveryModal.hidden = false;
  });

  document.getElementById('recoveryCancel').addEventListener('click', function () {
    recoveryModal.hidden = true;
  });

  document.getElementById('recoveryForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    const email = document.getElementById('recoveryEmail').value.trim().toLowerCase();
    const button = document.getElementById('recoverySubmit');
    const status = document.getElementById('recoveryMessage');
    button.disabled = true;
    button.textContent = 'Sending…';
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await requestAuth(() => client.auth.resetPasswordForEmail(email, { redirectTo }));
    button.disabled = false;
    button.textContent = 'Send reset link';
    status.className = 'rf-auth-message ' + (error ? 'error' : 'success');
    status.textContent = error
      ? (error.message || 'The reset link could not be sent.')
      : 'If an account exists for that email, a password-reset link has been sent.';
  });

  document.getElementById('resetPasswordForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    const password = document.getElementById('recoveryNewPassword').value;
    const confirmation = document.getElementById('recoveryConfirmPassword').value;
    const button = document.getElementById('resetPasswordSubmit');
    const status = document.getElementById('resetPasswordMessage');
    if (password !== confirmation) {
      status.className = 'rf-auth-message error';
      status.textContent = 'The passwords do not match.';
      return;
    }
    button.disabled = true;
    button.textContent = 'Saving…';
    const { error } = await requestAuth(() => client.auth.updateUser({ password }));
    button.disabled = false;
    button.textContent = 'Save new password';
    status.className = 'rf-auth-message ' + (error ? 'error' : 'success');
    status.textContent = error ? (error.message || 'Your password could not be updated.') : 'Password updated successfully.';
    if (!error) {
      document.getElementById('resetPasswordForm').reset();
      window.setTimeout(function () { resetPasswordModal.hidden = true; }, 900);
    }
  });

  function setAuthMode(mode) {
    if (signingIn) return;
    authMode = mode;
    const creating = mode === 'create';
    document.getElementById('signInTab').classList.toggle('active', !creating);
    document.getElementById('createAccountTab').classList.toggle('active', creating);
    document.getElementById('signInTab').setAttribute('aria-selected', String(!creating));
    document.getElementById('createAccountTab').setAttribute('aria-selected', String(creating));
    document.getElementById('authNameField').hidden = !creating;
    document.getElementById('authConfirmField').hidden = !creating;
    nameInput.required = creating;
    confirmPasswordInput.required = creating;
    passwordInput.autocomplete = creating ? 'new-password' : 'current-password';
    passwordInput.minLength = creating ? 12 : 1;
    submitButton.textContent = creating ? 'Create account' : 'Sign in';
    form.reset();
    showMessage(creating
      ? 'Beta access requires approval. Use your approved email and a password of at least 12 characters; then verify your email.'
      : 'Enter your existing account details.');
  }

  document.getElementById('signInTab').addEventListener('click', function () { setAuthMode('signin'); });
  document.getElementById('createAccountTab').addEventListener('click', function () { setAuthMode('create'); });
  document.querySelectorAll('[data-auth-mode]').forEach(function (link) {
    link.addEventListener('click', function (event) {
      event.preventDefault();
      if (signingIn) return;
      const mode = link.dataset.authMode === 'create' ? 'create' : 'signin';
      if (authMode !== mode) setAuthMode(mode);
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.getElementById('authAccess').scrollIntoView({ block: 'start', behavior: reducedMotion ? 'instant' : 'smooth' });
      (mode === 'create' ? nameInput : emailInput).focus({ preventScroll: true });
    });
  });


  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (submitButton.disabled) return;
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    if (!email || !password) return;

    if (authMode === 'create') {
      if(password.length<12){showMessage('Use a password with at least 12 characters.','error');return;}
      const displayName = nameInput.value.trim();
      if (!displayName) return;
      if (password !== confirmPasswordInput.value) {
        showMessage('The passwords do not match.', 'error');
        return;
      }

      submitButton.disabled = true;
      submitButton.textContent = 'Creating account…';
      showMessage('Creating your private workspace…');
      const redirectTo = window.location.origin + window.location.pathname;
      const { data, error } = await requestAuth(() => client.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName }, emailRedirectTo: redirectTo }
      }));
      submitButton.disabled = false;
      submitButton.textContent = 'Create account';

      if (error) {
        showMessage(error.code==='unexpected_failure'?'Account creation could not finish. Confirm that this email has beta approval, then try again.':error.message || 'Your account could not be created.', 'error');
        return;
      }

      form.reset();
      if (data.session) {
        showMessage('Account created. Opening your workspace…', 'success');
        showWelcome('Your account and private workspace have been created successfully.');
      } else {
        showMessage('Account created. Check your email once to confirm it, then sign in with your password.', 'success');
        showWelcome('Your account was created. Confirm your email once, then return here and sign in with your password.', 'Return to sign in');
        setAuthMode('signin');
      }
      return;
    }

    setSignInProgress(true, 'Signing in…');
    showMessage('Signing in securely…');

    const { error } = await requestAuth(() => client.auth.signInWithPassword({ email, password }));

    if (error) {
      setSignInProgress(false);
      showMessage(error.code === 'invalid_credentials' || /invalid.*credentials/i.test(error.message || '')
        ? 'The email or password is incorrect.'
        : error.message || 'Sign-in could not finish. Please try again.', 'error');
      return;
    }

    passwordInput.value = '';
    if (signingIn) {
      setSignInProgress(true, 'Opening your workspace…');
      showMessage('Getting your jobs and candidates ready…');
    }
  });

  document.getElementById('passwordForm')?.addEventListener('submit', async function (event) {
    event.preventDefault();
    const password = document.getElementById('newPassword').value;
    const confirmation = document.getElementById('confirmPassword').value;
    const button = document.getElementById('passwordSubmit');
    const status = document.getElementById('passwordMessage');

    if (password.length < 12) {
      status.textContent = 'Use at least 12 characters.';
      return;
    }
    if (password !== confirmation) {
      status.textContent = 'The passwords do not match.';
      return;
    }

    button.disabled = true;
    button.textContent = 'Saving…';
    status.textContent = 'Updating your account…';
    const { error } = await requestAuth(() => client.auth.updateUser({ password }));
    button.disabled = false;
    button.textContent = 'Set Password';

    if (error) {
      status.textContent = error.message || 'Your password could not be updated.';
      return;
    }

    document.getElementById('passwordForm').reset();
    status.textContent = 'Password saved. Use it the next time you sign in.';
  });

  document.getElementById('signOutAllDevices')?.addEventListener('click', async function () {
    const button=document.getElementById('signOutAllDevices'),status=document.getElementById('allDevicesStatus');button.disabled=true;
    try{await window.ancalagonFlush?.();const {error}=await client.auth.signOut({scope:'global'});if(error)throw error;window.location.reload();}
    catch(error){status.textContent=error.message||'Sign-out could not finish. Try again.';button.disabled=false;}
  });

  signOutButton.addEventListener('click' , async function () {
    signOutButton.disabled = true;
    try { await window.ancalagonFlush?.(); } catch (error) { console.warn('Final workspace sync failed', error); signOutButton.disabled = false; return; }
    const { error } = await requestAuth(() => client.auth.signOut());
    if (error) {
      signOutButton.disabled = false;
      const notice = document.createElement('div');
      notice.className = 'rf-toast error';
      notice.textContent = error.message || 'Sign-out could not finish. Please try again.';
      document.getElementById('toastRegion').append(notice);
      window.setTimeout(() => notice.remove(), 6000);
      return;
    }
    window.location.reload();
  });

  client.auth.onAuthStateChange(function (event, session) {
    if (event === 'PASSWORD_RECOVERY') resetPasswordModal.hidden = false;
    if (event === 'TOKEN_REFRESHED' && session && window.ancalagonAuth?.workspace) {
      appliedAccessToken = session.access_token;
      window.ancalagonAuth = { ...window.ancalagonAuth, session };
      return;
    }
    window.setTimeout(function () { applySession(client, session); }, 0);
  });

  requestAuth(() => client.auth.getSession()).then(function ({ data, error }) {
    if (error) {
      showGuest();
      showMessage(error.message || 'Your session could not be restored.', 'error');
      return;
    }
    applySession(client, data.session);
  });
})();
