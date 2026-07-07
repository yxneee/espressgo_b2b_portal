/* ============================================================
   mfa-setup.js — ESPRESSGO Authenticator App MFA Setup

   Final intended flow:
   - User must be logged in to access this page
   - User scans QR code
   - User verifies authenticator code
   - MFA becomes enabled
   - User is automatically signed out
   - User returns to login page
   - Next login will require mfa-verify.html

   Depends on:
   - supabase-config.js
   - shared.js
   ============================================================ */


let currentUser = null;
let currentFactorId = null;


document.addEventListener('DOMContentLoaded', () => {
  initMfaSetupPage();
});


async function initMfaSetupPage() {
  buildNav('account');
  buildFooter();

  bindEvents();

  try {
    currentUser = await Auth.refreshUser();

    if (!currentUser) {
      localStorage.setItem('redirectAfterLogin', 'mfa-setup.html');
      window.location.href = 'login.html';
      return;
    }

    await renderMfaStatus();
  } catch (error) {
    console.error('MFA setup init failed:', error);
    showAlert(getReadableError(error), 'error');
  }
}


function bindEvents() {
  const startBtn = document.getElementById('start-enroll-btn');
  const verifyBtn = document.getElementById('verify-enroll-btn');
  const copyBtn = document.getElementById('copy-secret-btn');
  const codeInput = document.getElementById('mfa-code');

  if (startBtn) {
    startBtn.addEventListener('click', startEnrollment);
  }

  if (verifyBtn) {
    verifyBtn.addEventListener('click', verifyEnrollment);
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', copySecret);
  }

  if (codeInput) {
    codeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        verifyEnrollment();
      }
    });

    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
    });
  }
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


function setLoading(buttonId, isLoading, loadingText, normalText) {
  const btn = document.getElementById(buttonId);

  if (!btn) return;

  btn.disabled = isLoading;
  btn.textContent = isLoading ? loadingText : normalText;
}


async function getVerifiedTotpFactor() {
  const { data, error } = await sb.auth.mfa.listFactors();

  if (error) {
    throw error;
  }

  const factors = data.totp || [];

  return factors.find(factor => factor.status === 'verified') || null;
}


async function renderMfaStatus() {
  const badge = document.getElementById('mfa-aal-badge');
  const existingBox = document.getElementById('existing-factor-box');
  const startBtn = document.getElementById('start-enroll-btn');

  const { data: aalData, error: aalError } =
    await sb.auth.mfa.getAuthenticatorAssuranceLevel();

  if (aalError) {
    throw aalError;
  }

  if (badge) {
    badge.textContent =
      aalData.currentLevel === 'aal2'
        ? 'MFA verified'
        : 'Password login only';
  }

  const verifiedTotpFactor = await getVerifiedTotpFactor();

  if (verifiedTotpFactor) {
    if (existingBox) {
      existingBox.style.display = 'block';
      existingBox.textContent =
        'MFA is already enabled for this account. Sign out and sign in again to test the MFA verification flow.';
    }

    if (startBtn) {
      startBtn.textContent = 'Add Another MFA Factor';
    }
  } else {
    if (existingBox) {
      existingBox.style.display = 'none';
    }

    if (startBtn) {
      startBtn.textContent = 'Start MFA Setup';
    }
  }
}


async function startEnrollment() {
  clearAlert();

  setLoading('start-enroll-btn', true, 'Creating QR Code…', 'Start MFA Setup');

  try {
    const { data, error } = await sb.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'ESPRESSGO Authenticator'
    });

    if (error) {
      throw error;
    }

    currentFactorId = data.id;

    const qrImg = document.getElementById('qr-code-img');
    const qrPlaceholder = document.getElementById('qr-placeholder');
    const secretInput = document.getElementById('manual-secret');
    const enrollPanel = document.getElementById('enroll-panel');
    const codeInput = document.getElementById('mfa-code');

    if (qrImg) {
      qrImg.src = data.totp.qr_code;
      qrImg.style.display = 'block';
    }

    if (qrPlaceholder) {
      qrPlaceholder.style.display = 'none';
    }

    if (secretInput) {
      secretInput.value = data.totp.secret || '';
    }

    if (enrollPanel) {
      enrollPanel.style.display = 'block';
    }

    showAlert(
      'QR code generated. Scan it using your authenticator app, then enter the 6-digit code.',
      'success'
    );

    if (codeInput) {
      setTimeout(() => codeInput.focus(), 250);
    }
  } catch (error) {
    console.error('MFA enrollment failed:', error);
    showAlert(getReadableError(error), 'error');
  } finally {
    setLoading('start-enroll-btn', false, 'Creating QR Code…', 'Start MFA Setup');

    try {
      await renderMfaStatus();
    } catch (error) {
      console.warn('Could not refresh MFA status:', error);
    }
  }
}


async function verifyEnrollment() {
  clearAlert();

  const codeInput = document.getElementById('mfa-code');
  const code = codeInput ? codeInput.value.trim() : '';

  if (!currentFactorId) {
    showAlert('Start MFA setup first so a QR code can be generated.', 'error');
    return;
  }

  if (!/^\d{6}$/.test(code)) {
    showAlert('Enter the 6-digit code from your authenticator app.', 'error');
    return;
  }

  setLoading('verify-enroll-btn', true, 'Verifying…', 'Verify & Enable MFA');

  try {
    const { data, error } = await sb.auth.mfa.challengeAndVerify({
      factorId: currentFactorId,
      code
    });

    if (error) {
      throw error;
    }

    console.log('MFA enrollment verified:', data);

    showAlert(
      'MFA has been enabled successfully. You will be signed out and asked to log in again.',
      'success'
    );

    showToast(
      'MFA enabled',
      'Please sign in again to complete the MFA verification flow.'
    );

    currentFactorId = null;

    const enrollPanel = document.getElementById('enroll-panel');

    if (enrollPanel) {
      enrollPanel.style.display = 'none';
    }

    await renderMfaStatus();

    /*
      Important:
      After setup, sign out automatically.
      This forces the next login to go:
      login.html → mfa-verify.html → catalog.html
    */
    setTimeout(async () => {
      try {
        const redirectTarget =
          localStorage.getItem('redirectAfterMfaSetup') ||
          localStorage.getItem('redirectAfterLogin') ||
          'catalog.html';

        localStorage.setItem('redirectAfterLogin', redirectTarget);
        localStorage.removeItem('redirectAfterMfaSetup');

        await Auth.logout();

        window.location.href = 'login.html';
      } catch (error) {
        console.error('Auto logout after MFA setup failed:', error);
        window.location.href = 'login.html';
      }
    }, 1500);
  } catch (error) {
    console.error('MFA verify enrollment failed:', error);
    showAlert(getReadableError(error), 'error');
  } finally {
    setLoading('verify-enroll-btn', false, 'Verifying…', 'Verify & Enable MFA');
  }
}


async function copySecret() {
  const secretInput = document.getElementById('manual-secret');

  if (!secretInput || !secretInput.value) {
    showAlert('No secret available to copy yet.', 'error');
    return;
  }

  try {
    await navigator.clipboard.writeText(secretInput.value);

    showToast(
      'Secret copied',
      'Paste it into your authenticator app if QR scanning does not work.'
    );
  } catch (error) {
    console.error('Copy secret failed:', error);

    secretInput.select();
    document.execCommand('copy');

    showToast(
      'Secret copied',
      'Paste it into your authenticator app if QR scanning does not work.'
    );
  }
}