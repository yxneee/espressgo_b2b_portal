/* ============================================================
   login.js — Logic for login.html
   Depends on: shared.js (Auth, Products, pouchSVG, showToast)
   Supabase version
   ============================================================ */

   
   /* ============================================================
   Redirect if already logged in (Safe B2B Profile Bypass)
   ============================================================ */
(async function checkExistingSession() {
  try {
    // 1. Grab the active authenticated user session token directly
    const { data: { user }, error: authError } = await sb.auth.getUser();
    if (authError || !user) return; // Not logged in yet, safe to stay on login screen

    // 2. Query the database table directly for profile details
    const { data: dbProfile, error: dbError } = await sb
      .from('profiles')
      .select('role, company_name, business_type, delivery_address')
      .eq('id', user.id)
      .maybeSingle();

    if (dbError) throw dbError;

    if (dbProfile) {
      if (dbProfile.role === 'admin') {
        window.location.replace('admin/admin-dashboard.html');
        return;
      }
      
      // Only skip the login page if their business profile details are fully filled out!
      if (dbProfile.company_name && dbProfile.business_type && dbProfile.delivery_address) {
        console.log("Profile complete. Skipping login screen directly to catalog...");
        
        if (typeof Auth !== 'undefined' && typeof Auth.refreshUser === 'function') {
          await Auth.refreshUser();
        }
        window.location.replace('catalog.html');
      }
    }
  } catch (error) {
    console.error('Session check validation failed:', error);
  }
})();

/* ============================================================
   Decorative pouch trio on the brand panel
   ============================================================ */

const pouchConfigs = [
  { rotate: -8, ty: 8, opacity: 0.45 },
  { rotate:  0, ty: 0, opacity: 0.85 },
  { rotate:  7, ty: 8, opacity: 0.45 },
];

const trio = document.getElementById('pouch-trio');

if (trio) {
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

        <rect
          x="14"
          y="0"
          width="8"
          height="6"
          rx="2"
          fill="#8B3A00"/>

        <path
          d="M10 6 Q8 9 8 12 L28 12 Q28 9 26 6 Z"
          fill="#C8580A"/>

        <rect
          x="4"
          y="12"
          width="28"
          height="36"
          rx="6"
          fill="#C8580A"/>

        <rect
          x="4"
          y="44"
          width="28"
          height="4"
          rx="3"
          fill="#8B3A00"/>

        <rect
          x="7"
          y="16"
          width="22"
          height="26"
          rx="4"
          fill="#8B3A00"
          opacity="0.15"/>

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


/* ============================================================
   Tab state: Sign In vs Register
   ============================================================ */

let isLogin = true;


/**
 * Switches the form between Sign In and Register mode.
 */
function switchMode(toLogin) {
  isLogin = toLogin;

  document.getElementById('register-fields').style.display = toLogin ? 'none' : 'block';
  document.getElementById('confirm-field').style.display = toLogin ? 'none' : 'block';
  document.getElementById('strength-wrap').style.display = toLogin ? 'none' : 'block';
  document.getElementById('forgot-btn').style.display = toLogin ? 'inline' : 'none';

  document.getElementById('form-title').textContent = toLogin
    ? 'Welcome back'
    : 'Create account';

  document.getElementById('form-subtitle').textContent = toLogin
    ? 'Sign in to your wholesale account.'
    : 'Join the ESPRESSGO buyer network.';

  document.getElementById('auth-label').textContent = toLogin
    ? 'Sign In'
    : 'Create Account';

  document.getElementById('f-password').autocomplete = toLogin
    ? 'current-password'
    : 'new-password';

  document.getElementById('f-password').placeholder = toLogin
    ? '••••••••'
    : 'Min 8 characters';

  document.getElementById('server-err').style.display = 'none';

  clearErrors();
  resetSubmitButton();
}


/* ============================================================
   Tab button event listeners
   ============================================================ */

document.getElementById('tab-signin').addEventListener('click', () => {
  document.getElementById('tab-signin').classList.add('active');
  document.getElementById('tab-signin').setAttribute('aria-selected', 'true');

  document.getElementById('tab-register').classList.remove('active');
  document.getElementById('tab-register').setAttribute('aria-selected', 'false');

  switchMode(true);
});

document.getElementById('tab-register').addEventListener('click', () => {
  document.getElementById('tab-register').classList.add('active');
  document.getElementById('tab-register').setAttribute('aria-selected', 'true');

  document.getElementById('tab-signin').classList.remove('active');
  document.getElementById('tab-signin').setAttribute('aria-selected', 'false');

  switchMode(false);
});


/* ============================================================
   Password show/hide toggle
   ============================================================ */

function makeToggle(toggleId, inputId) {
  const toggle = document.getElementById(toggleId);
  const input = document.getElementById(inputId);

  if (!toggle || !input) return;

  toggle.addEventListener('click', () => {
    input.type = input.type === 'password' ? 'text' : 'password';

    toggle.setAttribute(
      'aria-label',
      input.type === 'password' ? 'Show password' : 'Hide password'
    );
  });
}

makeToggle('pw-toggle-1', 'f-password');
makeToggle('pw-toggle-2', 'f-confirm');


/* ============================================================
   Password strength indicator
   ============================================================ */

document.getElementById('f-password').addEventListener('input', () => {
  if (isLogin) return;

  const pw = document.getElementById('f-password').value;
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
    const seg = document.getElementById('s' + i);

    if (seg) {
      seg.style.background = i <= score ? colors[score] : '#E0D5C8';
    }
  }

  document.getElementById('strength-label').textContent = labels[score] || '';

  const strengthBar = document.querySelector('.strength-bar');

  if (strengthBar) {
    strengthBar.setAttribute('aria-valuenow', String(score));
  }
});


/* ============================================================
   Forgot password button
   ============================================================ */

document.getElementById('forgot-btn').addEventListener('click', async () => {
  const email = document.getElementById('f-email').value.trim();

  if (!email) {
    showServerError('Enter your email address first, then click Forgot password.');
    return;
  }

  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/login.html'
    });

    if (error) {
      showServerError(error.message || 'Could not send password reset email.');
      return;
    }

    showToast(
      'Password reset email sent',
      'Check your inbox for the reset link.'
    );
  } catch (error) {
    console.error('Password reset failed:', error);
    showServerError('Could not send password reset email.');
  }
});


/* ============================================================
   Validation helpers
   ============================================================ */

function showErr(field, msg) {
  const el = document.getElementById('err-' + field);

  if (!el) return;

  el.textContent = '⚠ ' + msg;
  el.style.display = 'flex';

  const input = document.getElementById('f-' + field);

  if (input) {
    input.classList.add('error');
  }
}


function clearErrors() {
  const fields = [
    'contactName',
    'companyName',
    'businessType',
    'email',
    'password',
    'confirm'
  ];

  fields.forEach(field => {
    const err = document.getElementById('err-' + field);

    if (err) {
      err.style.display = 'none';
      err.textContent = '';
    }

    const input = document.getElementById('f-' + field);

    if (input) {
      input.classList.remove('error');
    }
  });
}


function showServerError(message) {
  document.getElementById('server-err-text').textContent = message;
  document.getElementById('server-err').style.display = 'flex';
}


function clearServerError() {
  document.getElementById('server-err-text').textContent = '';
  document.getElementById('server-err').style.display = 'none';
}


function setLoading(isLoading) {
  document.getElementById('auth-label').style.display = isLoading ? 'none' : 'inline';
  document.getElementById('auth-spinner').style.display = isLoading ? 'inline-block' : 'none';
  document.getElementById('auth-submit').disabled = isLoading;
}


function resetSubmitButton() {
  setLoading(false);
}


/* ============================================================
   Email validation helper
   ============================================================ */

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}


/* ============================================================
   Form submit handler
   ============================================================ */

document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  clearErrors();
  clearServerError();

  const email = document.getElementById('f-email').value.trim();
  const password = document.getElementById('f-password').value;
  const confirm = document.getElementById('f-confirm').value;

  const contactName = document.getElementById('f-contactName')?.value.trim() || '';
  const companyName = document.getElementById('f-companyName')?.value.trim() || '';
  const businessType = document.getElementById('f-businessType')?.value || '';

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

  let result;

  try {
    if (isLogin) {
      result = await Auth.login(email, password);
    } else {
      result = await Auth.register(
        email,
        password,
        companyName,
        businessType,
        contactName
      );
    }
  } catch (error) {
    console.error('Auth error:', error);

    result = {
      ok: false,
      error: error.message || 'Something went wrong. Please try again.'
    };
  }

  if (result.ok) {
    if (!isLogin) {
      showToast(
        'Registration successful!',
        'Welcome to ESPRESSGO! Redirecting to catalog...',
        'success'
      );
    }

    let redirectTo = localStorage.getItem('redirectAfterLogin');
    localStorage.removeItem('redirectAfterLogin');

    if (result.user && result.user.role === 'admin') {
      redirectTo = 'admin/admin-dashboard.html';
    } else if (!redirectTo) {
      redirectTo = 'catalog.html';
    }

    setTimeout(() => {
      window.location.href = redirectTo;
    }, 1200);
    return;
  }

  showServerError(result.error || 'Something went wrong. Please try again.');
  resetSubmitButton();
});


/* ============================================================
   Initialise in Sign In mode
   ============================================================ */

switchMode(true);

/* ============================================================
   Google OAuth Event Handler
   ============================================================ */

// Need to add page to continue registration (to fill up info for profile table)
// fix that after login, it will bring to home page with login button still visible insteaed of profile pic
// recheck the allowed google accounts since is testing status

const googleBtn = document.getElementById('google-signin-btn');
if (googleBtn) {
  googleBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const targetRedirect = isLocalhost 
        ? window.location.origin + '/espresgo_b2b_portal/catalog.html' 
        : window.location.origin + '/catalog.html';

      const { data, error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: targetRedirect,

          // Prompt to select Google account, remove if want to allow it to remember previous login
          // and allow to log straight in
          queryParams: { prompt: 'select_account' }
        }
      });
      if (error) throw error;
    } catch (error) {
      console.error('Google OAuth initialization failed:', error);
    }
  });
}