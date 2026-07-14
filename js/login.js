/* ============================================================
   login.js — ESPRESSGO B2B Login / Register / OTP / Reset / MFA / Google OAuth

   Features:
   - Email/password login
   - Buyer registration
   - Forgot password
   - Reset password
   - Email OTP login
   - Optional phone OTP login
   - Full authenticator-app MFA flow
   - Google OAuth support
   - Admin role redirect
   - MFA/AAL2 fix for password reset when MFA is enabled
   - Delivery address capture during registration

   Final intended flow:
   1. New user signs up
   2. User is signed out and returned to login page
   3. User logs in with email + password
   4. If no MFA factor exists → mfa-setup.html
   5. After MFA setup → user is signed out and returned to login
   6. User logs in again
   7. If MFA exists but not verified for this session → mfa-verify.html
   8. After MFA verification → catalog.html or admin dashboard

   Password reset with MFA:
   1. User opens password reset link
   2. User enters new password
   3. If MFA is enabled and session is not AAL2 → mfa-verify.html
   4. After MFA verification → login.html?reset=1
   5. User enters new password again
   6. Password updates successfully

   Depends on:
   - Supabase JS CDN
   - supabase-config.js
   - shared.js
   ============================================================ */


document.addEventListener('DOMContentLoaded', () => {
  initLoginPage();
});


function initLoginPage() {
  let isLogin = true;
  let otpMode = 'email';
  let sentOtpMode = null;
  let sentOtpDestination = null;
  let passwordRecoveryMode = false;

  const EMAIL_OTP_MAX_LENGTH = 8;

  const $ = (id) => document.getElementById(id);


  /* ==========================================================
     Page startup
     ========================================================== */

  injectOtpAndResetPanels();
  renderDecorativePouches();

  setupLoginRegisterTabs();
  setupPasswordToggles();
  setupPasswordStrength();
  setupForgotPassword();
  setupOtpLogin();
  setupPasswordResetForm();
  setupMainAuthForm();
  setupGoogleOAuth();

  switchMode(true);

  setupAuthRedirectListener();
  setupExistingSessionRedirect();


  /* ==========================================================
     Basic helpers
     ========================================================== */

  function safeText(id, value) {
    const el = $(id);

    if (el) {
      el.textContent = value;
    }
  }


  function safeDisplay(id, value) {
    const el = $(id);

    if (el) {
      el.style.display = value;
    }
  }


  function safeDisabled(id, value) {
    const el = $(id);

    if (el) {
      el.disabled = value;
    }
  }


  function getLoginRedirectUrl() {
    return window.location.origin + window.location.pathname;
  }


  function getDefaultRedirectForProfile(profile = null) {
    if (profile && profile.role === 'admin') {
      return 'admin/admin-dashboard.html';
    }

    return 'catalog.html';
  }


  function getPendingRedirectTarget(profile = null) {
    return localStorage.getItem('redirectAfterLogin') || getDefaultRedirectForProfile(profile);
  }


  function redirectAndClear(target) {
    localStorage.removeItem('redirectAfterLogin');
    window.location.href = target;
  }


  function getReadableError(error, fallback = 'Something went wrong. Please try again.') {
    if (!error) {
      return fallback;
    }

    if (typeof error === 'string') {
      return error;
    }

    if (error instanceof Error) {
      return error.message || fallback;
    }

    if (typeof error === 'object') {
      return (
        error.message ||
        error.error_description ||
        error.error ||
        error.details ||
        error.hint ||
        JSON.stringify(error, null, 2)
      );
    }

    return String(error);
  }


  function showServerError(error) {
    const errBox = $('server-err');
    const errText = $('server-err-text');

    let readableMessage = getReadableError(
      error,
      'Something went wrong. Check Console and Network tab for the Supabase error.'
    );

    if (!readableMessage || readableMessage === '{}') {
      readableMessage = 'Something went wrong. Check Console and Network tab for the Supabase error.';
    }

    resetServerBoxStyle();

    if (errText) {
      errText.textContent = readableMessage;
    }

    if (errBox) {
      errBox.style.display = 'flex';
    } else {
      alert(readableMessage);
    }

    console.error('Auth error shown to user:', error);
  }


  function showServerInfo(message) {
    const errBox = $('server-err');
    const errText = $('server-err-text');

    if (errText) {
      errText.textContent = message;
    }

    if (errBox) {
      errBox.style.display = 'flex';
      errBox.style.borderColor = '#86efac';
      errBox.style.background = '#f0fdf4';
      errBox.style.color = '#166534';
    }

    console.info('Auth info shown to user:', message);
  }


  function resetServerBoxStyle() {
    const errBox = $('server-err');

    if (errBox) {
      errBox.style.borderColor = '';
      errBox.style.background = '';
      errBox.style.color = '';
    }
  }


  function clearServerError() {
    const errBox = $('server-err');
    const errText = $('server-err-text');

    if (errText) {
      errText.textContent = '';
    }

    if (errBox) {
      errBox.style.display = 'none';
    }

    resetServerBoxStyle();
  }


  function showInlineStatus(id, message, type = 'info') {
    const el = $(id);

    if (!el) return;

    const color =
      type === 'error'
        ? '#ef4444'
        : type === 'success'
          ? '#16a34a'
          : 'var(--muted)';

    el.textContent = message;
    el.style.display = message ? 'block' : 'none';
    el.style.color = color;
  }


  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }


  function normalizePhoneNumber(rawPhone) {
    const cleaned = String(rawPhone || '')
      .trim()
      .replace(/\s+/g, '')
      .replace(/-/g, '');

    if (cleaned.startsWith('+')) {
      return cleaned;
    }

    if (/^[89]\d{7}$/.test(cleaned)) {
      return '+65' + cleaned;
    }

    if (/^65[89]\d{7}$/.test(cleaned)) {
      return '+' + cleaned;
    }

    return cleaned;
  }


  function isValidE164Phone(phone) {
    return /^\+[1-9]\d{7,14}$/.test(phone);
  }


  function setLoading(isLoading) {
    safeDisplay('auth-label', isLoading ? 'none' : 'inline');
    safeDisplay('auth-spinner', isLoading ? 'inline-block' : 'none');
    safeDisabled('auth-submit', isLoading);
  }


  function resetSubmitButton() {
    setLoading(false);
  }


  function showErr(field, msg) {
    const err = $('err-' + field);
    const input = $('f-' + field);

    if (err) {
      err.textContent = '⚠ ' + msg;
      err.style.display = 'flex';
    }

    if (input) {
      input.classList.add('error');
    }
  }


  function clearErrors() {
    const fields = [
      'contactName',
      'companyName',
      'businessType',
      'deliveryAddress',
      'email',
      'password',
      'confirm'
    ];

    fields.forEach(field => {
      const err = $('err-' + field);
      const input = $('f-' + field);

      if (err) {
        err.style.display = 'none';
        err.textContent = '';
      }

      if (input) {
        input.classList.remove('error');
      }
    });
  }


  /* ==========================================================
     Profile repair
     ========================================================== */

  async function ensureProfileForCurrentUser(fallbackProfile = {}) {
    if (typeof sb === 'undefined') {
      throw new Error('Supabase client is missing. Check supabase-config.js.');
    }

    const { data: userData, error: userError } = await sb.auth.getUser();

    if (userError || !userData.user) {
      throw userError || new Error('No logged-in Supabase user found.');
    }

    const authUser = userData.user;
    const meta = authUser.user_metadata || {};

    const { data: existingProfile, error: selectError } = await sb
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle();

    if (selectError) {
      throw selectError;
    }

    if (existingProfile) {
      return existingProfile;
    }

    const newProfile = {
      id: authUser.id,
      email: authUser.email || fallbackProfile.email || '',
      contact_name:
        meta.contact_name ||
        fallbackProfile.contactName ||
        fallbackProfile.contact_name ||
        meta.full_name ||
        meta.name ||
        'New Buyer',
      company_name:
        meta.company_name ||
        fallbackProfile.companyName ||
        fallbackProfile.company_name ||
        'New Company',
      business_type:
        meta.business_type ||
        fallbackProfile.businessType ||
        fallbackProfile.business_type ||
        'Other',
      delivery_address:
        meta.delivery_address ||
        fallbackProfile.deliveryAddress ||
        fallbackProfile.delivery_address ||
        '',
      role:
        meta.role ||
        fallbackProfile.role ||
        'buyer'
    };

    const { data: insertedProfile, error: insertError } = await sb
      .from('profiles')
      .insert(newProfile)
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    return insertedProfile;
  }


  async function getVerifiedTotpFactor() {
    const { data, error } = await sb.auth.mfa.listFactors();

    if (error) {
      throw error;
    }

    const factors = data.totp || [];

    return factors.find(factor => factor.status === 'verified') || null;
  }


  /* ==========================================================
     MFA routing logic
     ========================================================== */

  async function continueAfterPrimaryLogin(fallbackProfile = {}) {
    await ensureProfileForCurrentUser(fallbackProfile);

    const profile = await Auth.refreshUser();

    if (!profile) {
      throw new Error('Login succeeded, but your buyer profile could not be loaded.');
    }

    const redirectTarget = getPendingRedirectTarget(profile);
    const verifiedTotpFactor = await getVerifiedTotpFactor();

    /*
      If no MFA factor exists:
      Bypass enforced setup and directly route to the intended page (e.g., catalog.html).
    */
    if (!verifiedTotpFactor) {
      redirectAndClear(redirectTarget);
      return;
    }

    /*
      User has MFA enabled:
      Check if this current session has completed MFA.
    */
    const { data: aalData, error: aalError } =
      await sb.auth.mfa.getAuthenticatorAssuranceLevel();

    if (aalError) {
      throw aalError;
    }

    if (aalData.nextLevel === 'aal2' && aalData.currentLevel !== 'aal2') {
      localStorage.setItem('redirectAfterLogin', redirectTarget);
      window.location.href = 'mfa-verify.html';
      return;
    }

    redirectAndClear(redirectTarget);
  }


  async function checkAal2BeforeSensitiveUpdate() {
    const { data: aalData, error: aalError } =
      await sb.auth.mfa.getAuthenticatorAssuranceLevel();

    if (aalError) {
      throw aalError;
    }

    if (aalData.nextLevel === 'aal2' && aalData.currentLevel !== 'aal2') {
      return false;
    }

    return true;
  }


  /* ==========================================================
     Inject OTP and reset panels
     ========================================================== */

  function injectOtpAndResetPanels() {
    const authForm = $('auth-form');

    if (!authForm) {
      console.warn('auth-form not found. OTP and reset panels were not injected.');
      return;
    }

    if (!$('otp-login-panel')) {
      authForm.insertAdjacentHTML('afterend', `
        <div
          id="otp-login-panel"
          class="card"
          style="margin-top:1rem;padding:1rem;border-radius:18px;">

          <div style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin-bottom:.75rem;">
            <div>
              <div style="font-size:13px;color:var(--brown);font-weight:600;">
                Email / Phone OTP Login
              </div>

              <div style="font-size:11px;color:var(--muted);">
                Sign in using a one-time code sent to your email or phone.
              </div>
            </div>

            <span
              style="font-size:10px;background:#FEF3E2;color:var(--amber);border:1px solid #F3D6AA;border-radius:999px;padding:.2rem .55rem;white-space:nowrap;">
              OTP Login
            </span>
          </div>

          <div
            style="display:flex;background:#EDE8E3;border-radius:14px;padding:4px;gap:4px;margin-bottom:.75rem;">

            <button
              id="otp-email-tab"
              type="button"
              class="tab-btn active"
              style="flex:1;">
              Email OTP
            </button>

            <button
              id="otp-phone-tab"
              type="button"
              class="tab-btn"
              style="flex:1;">
              Phone OTP
            </button>
          </div>

          <div class="field">
            <label id="otp-destination-label" for="otp-destination">
              Email Address
            </label>

            <input
              class="input"
              id="otp-destination"
              type="email"
              placeholder="buyer@example.com"
              autocomplete="email"/>
          </div>

          <button
            id="otp-send-btn"
            class="btn-amber btn-full"
            type="button">
            Send OTP Code
          </button>

          <div
            id="otp-verify-wrap"
            style="display:none;margin-top:1rem;">

            <div class="field">
              <label id="otp-code-label" for="otp-code">
                Email OTP Code
              </label>

              <input
                class="input"
                id="otp-code"
                inputmode="numeric"
                maxlength="8"
                placeholder="123456"
                autocomplete="one-time-code"/>
            </div>

            <button
              id="otp-verify-btn"
              class="btn-dark btn-full"
              type="button">
              Verify & Sign In
            </button>
          </div>

          <p
            id="otp-status"
            style="display:none;font-size:11px;margin-top:.65rem;">
          </p>
        </div>
      `);
    }

    if (!$('password-reset-panel')) {
      authForm.insertAdjacentHTML('afterend', `
        <div
          id="password-reset-panel"
          class="card"
          style="display:none;margin-top:1rem;padding:1rem;border-radius:18px;">

          <div style="margin-bottom:1rem;">
            <div style="font-size:15px;color:var(--brown);font-weight:600;">
              Set New Password
            </div>

            <div style="font-size:12px;color:var(--muted);">
              Enter a new password for your ESPRESSGO buyer account.
            </div>
          </div>

          <div class="field">
            <label for="new-password">
              New Password
            </label>

            <input
              class="input"
              id="new-password"
              type="password"
              placeholder="Min 8 characters"
              autocomplete="new-password"/>
          </div>

          <div class="field">
            <label for="new-password-confirm">
              Confirm New Password
            </label>

            <input
              class="input"
              id="new-password-confirm"
              type="password"
              placeholder="Repeat password"
              autocomplete="new-password"/>
          </div>

          <button
            id="save-new-password-btn"
            class="btn-dark btn-full"
            type="button">
            Update Password
          </button>

          <p
            id="reset-status"
            style="display:none;font-size:11px;margin-top:.65rem;">
          </p>
        </div>
      `);
    }
  }


  /* ==========================================================
     Auth redirect listener
     ========================================================== */

  function setupAuthRedirectListener() {
    if (typeof sb === 'undefined') {
      console.error('Supabase client is missing. Check supabase-config.js.');
      return;
    }

    const currentHash = window.location.hash || '';

    sb.auth.onAuthStateChange(async (event) => {
      console.log('Supabase auth event:', event);

      if (event === 'PASSWORD_RECOVERY') {
        passwordRecoveryMode = true;

        history.replaceState(
          null,
          '',
          window.location.origin + window.location.pathname
        );

        showPasswordResetPanel();
        return;
      }

      /*
        Signup confirmation:
        Supabase may create a session after confirmation.
        Your flow requires the user to return to login first.
      */
      if (
        event === 'SIGNED_IN' &&
        currentHash.includes('access_token') &&
        currentHash.includes('type=signup')
      ) {
        await sb.auth.signOut();

        history.replaceState(
          null,
          '',
          window.location.origin + window.location.pathname
        );

        showServerInfo('Email confirmed successfully. Please sign in to continue with MFA setup.');

        showToast(
          'Email confirmed',
          'Please sign in to continue with MFA setup.'
        );

        return;
      }

      /*
        OAuth / Magic-link / OTP callback:
        Only handle SIGNED_IN here if the page has access_token in URL.
        Normal email/password login is handled by submit form.
      */
      if (
        event === 'SIGNED_IN' &&
        currentHash.includes('access_token') &&
        !passwordRecoveryMode
      ) {
        try {
          history.replaceState(
            null,
            '',
            window.location.origin + window.location.pathname
          );

          await continueAfterPrimaryLogin();
        } catch (error) {
          console.error('Auth callback handling failed:', error);
          showServerError(error);
        }
      }
    });

    if (currentHash.includes('access_token') && !currentHash.includes('type=recovery')) {
      showServerInfo('Signing you in. Please wait…');
    }

    if (currentHash.includes('error=')) {
      const params = new URLSearchParams(currentHash.replace(/^#/, ''));
      const description =
        params.get('error_description') ||
        params.get('error') ||
        'Authentication link failed. Please request a new email.';

      showServerError(decodeURIComponent(description.replace(/\+/g, ' ')));

      history.replaceState(
        null,
        '',
        window.location.origin + window.location.pathname
      );
    }
  }


  /* ==========================================================
     Existing session redirect
     ========================================================== */

  function setupExistingSessionRedirect() {
    const currentHash = window.location.hash || '';
    const resetParams = new URLSearchParams(window.location.search);

    const returningFromMfaForReset =
      resetParams.get('reset') === '1' ||
      localStorage.getItem('passwordRecoveryAfterMfa') === 'true';

    if (returningFromMfaForReset) {
      passwordRecoveryMode = true;
      localStorage.removeItem('passwordRecoveryAfterMfa');

      history.replaceState(
        null,
        '',
        window.location.origin + window.location.pathname
      );

      showPasswordResetPanel();
      return;
    }

    if (
      currentHash.includes('type=recovery') ||
      currentHash.includes('access_token') ||
      currentHash.includes('error=')
    ) {
      return;
    }

    setTimeout(async () => {
      if (passwordRecoveryMode) return;

      try {
        const profile = await Auth.refreshUser();

        if (!profile) return;

        await continueAfterPrimaryLogin();
      } catch (error) {
        console.warn('No active session found:', error);
      }
    }, 250);
  }


  function showPasswordResetPanel() {
    safeDisplay('auth-form', 'none');
    safeDisplay('otp-login-panel', 'none');
    safeDisplay('password-reset-panel', 'block');

    const resetInput = $('new-password');

    if (resetInput) {
      setTimeout(() => resetInput.focus(), 200);
    }
  }


  /* ==========================================================
     Decorative pouches
     ========================================================== */

  function renderDecorativePouches() {
    const trio = $('pouch-trio');

    if (!trio || trio.dataset.rendered === 'true') return;

    trio.dataset.rendered = 'true';

    const pouchConfigs = [
      { rotate: -8, ty: 8, opacity: 0.45 },
      { rotate: 0, ty: 0, opacity: 0.85 },
      { rotate: 7, ty: 8, opacity: 0.45 }
    ];

    pouchConfigs.forEach((p, i) => {
      const wrapper = document.createElement('div');

      wrapper.style.cssText = `
        transform: rotate(${p.rotate}deg) translateY(${p.ty}px);
        opacity: ${p.opacity};
      `;

      wrapper.innerHTML = `
        <svg
          width="${i === 1 ? 80 : 62}"
          height="${i === 1 ? 120 : 93}"
          viewBox="0 0 36 54"
          xmlns="http://www.w3.org/2000/svg">

          <rect x="14" y="0" width="8" height="6" rx="2" fill="#8B3A00"/>
          <path d="M10 6 Q8 9 8 12 L28 12 Q28 9 26 6 Z" fill="#C8580A"/>
          <rect x="4" y="12" width="28" height="36" rx="6" fill="#C8580A"/>
          <rect x="4" y="44" width="28" height="4" rx="3" fill="#8B3A00"/>
          <rect x="7" y="16" width="22" height="26" rx="4" fill="#8B3A00" opacity="0.15"/>

          <text
            x="18"
            y="27"
            text-anchor="middle"
            font-size="4"
            font-weight="700"
            font-family="sans-serif"
            fill="#8B3A00"
            letter-spacing="0.3">
            ESPRESSGO
          </text>
        </svg>
      `;

      trio.appendChild(wrapper);
    });
  }


  /* ==========================================================
     Login/Register switch
     ========================================================== */

  function switchMode(toLogin) {
    isLogin = toLogin;

    clearServerError();

    safeDisplay('register-fields', toLogin ? 'none' : 'block');
    safeDisplay('confirm-field', toLogin ? 'none' : 'block');
    safeDisplay('strength-wrap', toLogin ? 'none' : 'block');
    safeDisplay('forgot-btn', toLogin ? 'inline' : 'none');

    safeText('form-title', toLogin ? 'Welcome back' : 'Create account');
    safeText('form-subtitle', toLogin ? 'Sign in to your wholesale account.' : 'Join the ESPRESSGO buyer network.');
    safeText('auth-label', toLogin ? 'Sign In' : 'Create Account');

    const pw = $('f-password');

    if (pw) {
      pw.autocomplete = toLogin ? 'current-password' : 'new-password';
      pw.placeholder = toLogin ? '••••••••' : 'Min 8 characters';
    }

    clearErrors();
    resetSubmitButton();
  }


  function setupLoginRegisterTabs() {
    const signInTab = $('tab-signin');
    const registerTab = $('tab-register');

    if (signInTab) {
      signInTab.addEventListener('click', () => {
        signInTab.classList.add('active');
        signInTab.setAttribute('aria-selected', 'true');

        if (registerTab) {
          registerTab.classList.remove('active');
          registerTab.setAttribute('aria-selected', 'false');
        }

        switchMode(true);
      });
    }

    if (registerTab) {
      registerTab.addEventListener('click', () => {
        registerTab.classList.add('active');
        registerTab.setAttribute('aria-selected', 'true');

        if (signInTab) {
          signInTab.classList.remove('active');
          signInTab.setAttribute('aria-selected', 'false');
        }

        switchMode(false);
      });
    }
  }


  /* ==========================================================
     Password UI
     ========================================================== */

  function setupPasswordToggles() {
    makeToggle('pw-toggle-1', 'f-password');
    makeToggle('pw-toggle-2', 'f-confirm');
  }


  function makeToggle(toggleId, inputId) {
    const toggle = $(toggleId);
    const input = $(inputId);

    if (!toggle || !input) return;

    toggle.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';

      toggle.setAttribute(
        'aria-label',
        input.type === 'password' ? 'Show password' : 'Hide password'
      );
    });
  }


  function setupPasswordStrength() {
    const passwordInput = $('f-password');

    if (!passwordInput) return;

    passwordInput.addEventListener('input', () => {
      if (isLogin) return;

      const pw = passwordInput.value;
      const len = pw.length;

      let score = 0;

      if (len >= 12) {
        score = 4;
      } else if (len >= 10) {
        score = 3;
      } else if (len >= 8) {
        score = 2;
      } else if (len > 0) {
        score = 1;
      }

      const colors = ['', '#f87171', '#fbbf24', '#facc15', '#4ade80'];
      const labels = ['', 'Too short', 'Fair', 'Good', 'Strong'];

      for (let i = 1; i <= 4; i++) {
        const seg = $('s' + i);

        if (seg) {
          seg.style.background = i <= score ? colors[score] : '#E0D5C8';
        }
      }

      safeText('strength-label', labels[score] || '');

      const strengthBar = document.querySelector('.strength-bar');

      if (strengthBar) {
        strengthBar.setAttribute('aria-valuenow', String(score));
      }
    });
  }


  /* ==========================================================
     Forgot password
     ========================================================== */

  function setupForgotPassword() {
    const forgotBtn = $('forgot-btn');

    if (!forgotBtn) return;

    forgotBtn.addEventListener('click', async () => {
      const emailInput = $('f-email');
      const email = emailInput ? emailInput.value.trim() : '';

      clearServerError();

      if (!email) {
        showServerError('Enter your email address first, then click Forgot password.');
        return;
      }

      if (!isValidEmail(email)) {
        showServerError('Enter a valid email address before requesting a password reset.');
        return;
      }

      forgotBtn.disabled = true;
      forgotBtn.textContent = 'Sending…';

      try {
        const { error } = await sb.auth.resetPasswordForEmail(email, {
          redirectTo: getLoginRedirectUrl()
        });

        if (error) {
          showServerError(error);
          return;
        }

        showToast(
          'Password reset email sent',
          'Check your inbox for the reset link.'
        );
      } catch (error) {
        console.error('Password reset failed:', error);
        showServerError(error);
      } finally {
        forgotBtn.disabled = false;
        forgotBtn.textContent = 'Forgot password?';
      }
    });
  }


  function setupPasswordResetForm() {
    const saveBtn = $('save-new-password-btn');

    if (!saveBtn) return;

    saveBtn.addEventListener('click', async () => {
      const password = $('new-password')?.value || '';
      const confirm = $('new-password-confirm')?.value || '';

      showInlineStatus('reset-status', '', 'info');

      if (password.length < 8) {
        showInlineStatus('reset-status', 'Password must be at least 8 characters.', 'error');
        return;
      }

      if (password !== confirm) {
        showInlineStatus('reset-status', 'Passwords do not match.', 'error');
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Updating…';

      try {
        const hasAal2 = await checkAal2BeforeSensitiveUpdate();

        if (!hasAal2) {
          /*
            Supabase requires AAL2 before updating password/email
            when MFA is enabled. Redirect to MFA verify first.
          */
          localStorage.setItem('passwordRecoveryAfterMfa', 'true');
          localStorage.setItem('redirectAfterLogin', 'login.html?reset=1');

          showInlineStatus(
            'reset-status',
            'MFA verification is required before updating your password. Redirecting…',
            'error'
          );

          setTimeout(() => {
            window.location.href = 'mfa-verify.html';
          }, 800);

          return;
        }

        const { error } = await sb.auth.updateUser({
          password
        });

        if (error) {
          showInlineStatus('reset-status', getReadableError(error), 'error');
          return;
        }

        await sb.auth.signOut();

        showInlineStatus(
          'reset-status',
          'Password updated successfully. Please sign in again.',
          'success'
        );

        showToast(
          'Password updated',
          'Please sign in again using your new password.'
        );

        setTimeout(() => {
          window.location.href = 'login.html';
        }, 1200);
      } catch (error) {
        console.error('Update password failed:', error);
        showInlineStatus('reset-status', getReadableError(error), 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Update Password';
      }
    });
  }


  /* ==========================================================
     OTP login
     ========================================================== */

  function setupOtpLogin() {
    const emailTab = $('otp-email-tab');
    const phoneTab = $('otp-phone-tab');
    const sendBtn = $('otp-send-btn');
    const verifyBtn = $('otp-verify-btn');
    const destinationInput = $('otp-destination');

    if (!sendBtn || !verifyBtn || !destinationInput) return;

    if (emailTab) {
      emailTab.addEventListener('click', () => {
        setOtpMode('email');
      });
    }

    if (phoneTab) {
      phoneTab.addEventListener('click', () => {
        setOtpMode('phone');
      });
    }

    sendBtn.addEventListener('click', sendOtpCode);
    verifyBtn.addEventListener('click', verifyOtpCode);

    destinationInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        sendOtpCode();
      }
    });

    const otpCode = $('otp-code');

    if (otpCode) {
      otpCode.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          verifyOtpCode();
        }
      });

      otpCode.addEventListener('input', () => {
        otpCode.value = otpCode.value.replace(/\D/g, '').slice(0, EMAIL_OTP_MAX_LENGTH);
      });
    }

    setOtpMode('email');
  }


  function setOtpMode(mode) {
    otpMode = mode;

    const emailTab = $('otp-email-tab');
    const phoneTab = $('otp-phone-tab');
    const input = $('otp-destination');
    const codeInput = $('otp-code');

    if (emailTab) {
      emailTab.classList.toggle('active', mode === 'email');
      emailTab.setAttribute('aria-selected', mode === 'email' ? 'true' : 'false');
    }

    if (phoneTab) {
      phoneTab.classList.toggle('active', mode === 'phone');
      phoneTab.setAttribute('aria-selected', mode === 'phone' ? 'true' : 'false');
    }

    safeText('otp-destination-label', mode === 'email' ? 'Email Address' : 'Phone Number');

    if (input) {
      input.value = '';
      input.type = mode === 'email' ? 'email' : 'tel';
      input.placeholder = mode === 'email' ? 'buyer@example.com' : '+6591234567';
      input.autocomplete = mode === 'email' ? 'email' : 'tel';
    }

    if (codeInput) {
      codeInput.value = '';
      codeInput.maxLength = mode === 'email' ? EMAIL_OTP_MAX_LENGTH : 8;
      codeInput.placeholder = '123456';
    }

    safeText(
      'otp-code-label',
      mode === 'email'
        ? 'Email OTP Code'
        : 'SMS OTP Code'
    );

    safeDisplay('otp-verify-wrap', 'none');
    showInlineStatus('otp-status', '', 'info');

    sentOtpMode = null;
    sentOtpDestination = null;
  }


  async function sendOtpCode() {
    const input = $('otp-destination');
    const sendBtn = $('otp-send-btn');

    if (!input || !sendBtn) return;

    let destination = input.value.trim();

    showInlineStatus('otp-status', '', 'info');

    if (otpMode === 'email') {
      if (!destination || !isValidEmail(destination)) {
        showInlineStatus('otp-status', 'Enter a valid email address.', 'error');
        return;
      }
    }

    if (otpMode === 'phone') {
      destination = normalizePhoneNumber(destination);

      if (!isValidE164Phone(destination)) {
        showInlineStatus(
          'otp-status',
          'Enter phone number in international format, e.g. +6591234567.',
          'error'
        );
        return;
      }

      input.value = destination;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';

    try {
      const payload =
        otpMode === 'email'
          ? {
              email: destination,
              options: {
                shouldCreateUser: false,
                emailRedirectTo: getLoginRedirectUrl()
              }
            }
          : {
              phone: destination,
              options: {
                shouldCreateUser: false
              }
            };

      const { error } = await sb.auth.signInWithOtp(payload);

      if (error) {
        showInlineStatus('otp-status', getReadableError(error), 'error');
        return;
      }

      sentOtpMode = otpMode;
      sentOtpDestination = destination;

      safeDisplay('otp-verify-wrap', 'block');

      showInlineStatus(
        'otp-status',
        otpMode === 'email'
          ? 'OTP sent. Check your email inbox for the code.'
          : 'OTP sent. Check your SMS messages.',
        'success'
      );

      const codeInput = $('otp-code');

      if (codeInput) {
        codeInput.value = '';
        codeInput.focus();
      }
    } catch (error) {
      console.error('Send OTP failed:', error);
      showInlineStatus('otp-status', getReadableError(error), 'error');
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send OTP Code';
    }
  }


  async function verifyOtpCode() {
    const codeInput = $('otp-code');
    const verifyBtn = $('otp-verify-btn');

    if (!codeInput || !verifyBtn) return;

    const token = codeInput.value.trim();

    showInlineStatus('otp-status', '', 'info');

    if (!sentOtpMode || !sentOtpDestination) {
      showInlineStatus('otp-status', 'Please send an OTP code first.', 'error');
      return;
    }

    if (!/^\d{6,8}$/.test(token)) {
      showInlineStatus('otp-status', 'Enter the OTP code from your inbox or SMS.', 'error');
      return;
    }

    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Verifying…';

    try {
      const payload =
        sentOtpMode === 'email'
          ? {
              email: sentOtpDestination,
              token,
              type: 'email'
            }
          : {
              phone: sentOtpDestination,
              token,
              type: 'sms'
            };

      const { error } = await sb.auth.verifyOtp(payload);

      if (error) {
        showInlineStatus('otp-status', getReadableError(error), 'error');
        return;
      }

      await continueAfterPrimaryLogin({
        email: sentOtpDestination
      });
    } catch (error) {
      console.error('Verify OTP failed:', error);
      showInlineStatus('otp-status', getReadableError(error), 'error');
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'Verify & Sign In';
    }
  }


  /* ==========================================================
     Main login/register form
     ========================================================== */

  function setupMainAuthForm() {
    const authForm = $('auth-form');

    if (!authForm) return;

    authForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      clearErrors();
      clearServerError();

      const email = $('f-email')?.value.trim() || '';
      const password = $('f-password')?.value || '';
      const confirm = $('f-confirm')?.value || '';

      const contactName = $('f-contactName')?.value.trim() || '';
      const companyName = $('f-companyName')?.value.trim() || '';
      const businessType = $('f-businessType')?.value || '';
      const deliveryAddress = $('f-deliveryAddress')?.value.trim() || '';

      let valid = true;

      if (!isLogin) {
        if (!contactName) {
          showErr('contactName', 'Contact name is required.');
          valid = false;
        }

        if (!companyName || companyName.length < 2) {
          showErr('companyName', 'Enter your company name. Minimum 2 characters.');
          valid = false;
        }

        if (!businessType) {
          showErr('businessType', 'Please select your business type.');
          valid = false;
        }

        if (!deliveryAddress || deliveryAddress.length < 8) {
          showErr('deliveryAddress', 'Enter a valid delivery address.');
          valid = false;
        }
      }

      if (!email) {
        showErr('email', 'Email address is required.');
        valid = false;
      } else if (!isValidEmail(email)) {
        showErr('email', 'Enter a valid email address.');
        valid = false;
      }

      if (!password) {
        showErr('password', 'Password is required.');
        valid = false;
      } else if (!isLogin && password.length < 8) {
        showErr('password', 'Password must be at least 8 characters.');
        valid = false;
      }

      if (!isLogin && password && confirm !== password) {
        showErr('confirm', 'Passwords do not match.');
        valid = false;
      }

      if (!valid) return;

      setLoading(true);

      try {
        if (isLogin) {
          const { error } = await sb.auth.signInWithPassword({
            email,
            password
          });

          if (error) {
            showServerError(error);
            resetSubmitButton();
            return;
          }

          await continueAfterPrimaryLogin({
            email
          });

          return;
        }

        /*
          Register new buyer account.
          Even if Supabase creates an immediate session,
          force sign out so the user returns to login page first.
        */
        const { error } = await sb.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: getLoginRedirectUrl(),
            data: {
              contact_name: contactName,
              company_name: companyName,
              business_type: businessType,
              delivery_address: deliveryAddress
            }
          }
        });

        if (error) {
          showServerError(error);
          resetSubmitButton();
          return;
        }

        await sb.auth.signOut();

        showServerInfo('Account created. Please sign in to continue with MFA setup.');

        showToast(
          'Account created',
          'Please sign in to continue with MFA setup.'
        );

        const signInTab = $('tab-signin');
        const registerTab = $('tab-register');

        if (signInTab && registerTab) {
          setTimeout(() => {
            signInTab.classList.add('active');
            signInTab.setAttribute('aria-selected', 'true');

            registerTab.classList.remove('active');
            registerTab.setAttribute('aria-selected', 'false');

            switchMode(true);

            const emailInput = $('f-email');

            if (emailInput) {
              emailInput.value = email;
            }
          }, 800);
        }

        resetSubmitButton();
      } catch (error) {
        console.error('Auth form error:', error);
        showServerError(error);
        resetSubmitButton();
      }
    });
  }


  /* ==========================================================
     Google OAuth
     Redirects back to login page so MFA routing can continue.
     ========================================================== */

  function setupGoogleOAuth() {
    const googleBtn = $('google-signin-btn');

    if (!googleBtn) return;

    googleBtn.addEventListener('click', async (event) => {
      event.preventDefault();

      clearServerError();

      if (typeof sb === 'undefined') {
        showServerError('Supabase client is missing. Check supabase-config.js.');
        return;
      }

      try {
        localStorage.setItem(
          'redirectAfterLogin',
          localStorage.getItem('redirectAfterLogin') || 'catalog.html'
        );

        const { error } = await sb.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: getLoginRedirectUrl(),
            queryParams: {
              prompt: 'select_account'
            }
          }
        });

        if (error) {
          showServerError(error);
        }
      } catch (error) {
        console.error('Google OAuth initialization failed:', error);
        showServerError(error);
      }
    });
  }
}

