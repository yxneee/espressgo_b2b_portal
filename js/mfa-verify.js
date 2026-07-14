/* ============================================================
   mfa-verify.js — ESPRESSGO MFA Verification Page

   Purpose:
   - Runs after email/password login if MFA is required
   - Finds verified TOTP factor
   - Verifies 6-digit authenticator code
   - Redirects to original page or catalog.html

   Depends on:
   - supabase-config.js
   - shared.js
   ============================================================ */


document.addEventListener('DOMContentLoaded', () => {
  initMfaVerifyPage();
});


async function initMfaVerifyPage() {
  bindEvents();

  try {
    const { data: sessionData, error: sessionError } = await sb.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }

    if (!sessionData.session) {
      localStorage.setItem('redirectAfterLogin', 'catalog.html');
      window.location.href = 'login.html';
      return;
    }

    const { data: aalData, error: aalError } =
      await sb.auth.mfa.getAuthenticatorAssuranceLevel();

    if (aalError) {
      throw aalError;
    }

    if (aalData.currentLevel === 'aal2') {
      window.location.href = getRedirectTarget();
      return;
    }

    if (aalData.nextLevel !== 'aal2') {
      showAlert(
        'MFA is not required for this account. Redirecting…',
        'success'
      );

      setTimeout(() => {
        window.location.href = getRedirectTarget();
      }, 700);

      return;
    }

    const factor = await getVerifiedTotpFactor();

    if (!factor) {
  showAlert(
    'No verified authenticator app factor was found. Redirecting to Catalog…',
    'error'
  );

  setTimeout(() => {
    window.location.href = 'catalog.html'; // Changed from mfa-setup.html
  }, 1500);

  return;
}

    const input = document.getElementById('mfa-code');

    if (input) {
      input.focus();
    }
  } catch (error) {
    console.error('MFA verify init failed:', error);
    showAlert(getReadableError(error), 'error');
  }
}


function bindEvents() {
  const verifyBtn = document.getElementById('verify-mfa-btn');
  const signoutBtn = document.getElementById('signout-btn');
  const codeInput = document.getElementById('mfa-code');

  if (verifyBtn) {
    verifyBtn.addEventListener('click', verifyMfaCode);
  }

  if (signoutBtn) {
    signoutBtn.addEventListener('click', async () => {
      await Auth.logout();
      window.location.href = 'login.html';
    });
  }

  if (codeInput) {
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
    });

    codeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        verifyMfaCode();
      }
    });
  }
}


function getRedirectTarget() {
  const redirectTo = localStorage.getItem('redirectAfterLogin') || 'catalog.html';
  localStorage.removeItem('redirectAfterLogin');
  return redirectTo;
}


function getReadableError(error) {
  if (!error) {
    return 'Something went wrong. Please try again.';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message || 'Something went wrong. Please try again.';
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


function showAlert(message, type = 'info') {
  const alert = document.getElementById('mfa-alert');

  if (!alert) return;

  alert.textContent = message;
  alert.style.display = 'block';

  if (type === 'success') {
    alert.style.background = '#F0FDF4';
    alert.style.border = '1px solid #BBF7D0';
    alert.style.color = '#166534';
  } else if (type === 'error') {
    alert.style.background = '#FEF2F2';
    alert.style.border = '1px solid #FECACA';
    alert.style.color = '#B91C1C';
  } else {
    alert.style.background = '#FEF3E2';
    alert.style.border = '1px solid #F3D6AA';
    alert.style.color = 'var(--brown)';
  }
}


function clearAlert() {
  const alert = document.getElementById('mfa-alert');

  if (!alert) return;

  alert.textContent = '';
  alert.style.display = 'none';
}


function setLoading(isLoading) {
  const btn = document.getElementById('verify-mfa-btn');

  if (!btn) return;

  btn.disabled = isLoading;
  btn.textContent = isLoading ? 'Verifying…' : 'Verify & Continue';
}


async function getVerifiedTotpFactor() {
  const { data, error } = await sb.auth.mfa.listFactors();

  if (error) {
    throw error;
  }

  const factors = data.totp || [];

  return factors.find(factor => factor.status === 'verified') || null;
}


async function verifyMfaCode() {
  clearAlert();

  const input = document.getElementById('mfa-code');
  const code = input ? input.value.trim() : '';

  if (!/^\d{6}$/.test(code)) {
    showAlert('Enter the 6-digit code from your authenticator app.', 'error');
    return;
  }

  setLoading(true);

  try {
    const factor = await getVerifiedTotpFactor();

    if (!factor) {
  showAlert(
    'No verified authenticator app factor was found. Redirecting to Catalog…',
    'error'
  );

  setTimeout(() => {
    window.location.href = 'catalog.html'; // Changed from mfa-setup.html
  }, 1500);

  return;
}

    const { data, error } = await sb.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code
    });

    if (error) {
      throw error;
    }

    console.log('MFA login verified:', data);

    await Auth.refreshUser();

    showAlert('MFA verified. Redirecting…', 'success');

    setTimeout(() => {
      window.location.href = getRedirectTarget();
    }, 500);
  } catch (error) {
    console.error('MFA verification failed:', error);
    showAlert(getReadableError(error), 'error');
  } finally {
    setLoading(false);
  }
}