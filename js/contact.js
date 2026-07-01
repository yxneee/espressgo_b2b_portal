/* ============================================================
   contact.js — Logic for contact.html
   Depends on: shared.js
   Uses:
   - buildNav
   - buildFooter
   - showToast
   - sb Supabase client

   Supabase version
   ============================================================ */


/* ============================================================
   Page initialisation
   ============================================================ */

buildNav('contact');
buildFooter();


/* ============================================================
   Copy email to clipboard
   ============================================================ */

const copyBtn = document.getElementById('copy-email-btn');
const copyIcon = document.getElementById('copy-icon');

if (copyBtn && copyIcon) {
  copyBtn.addEventListener('click', async () => {
    const email = 'hello@espressgo.sg';

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(email);
      } else {
        // Fallback method for localhost / older browsers
        const textarea = document.createElement('textarea');

        textarea.value = email;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';

        document.body.appendChild(textarea);

        textarea.focus();
        textarea.select();

        document.execCommand('copy');

        document.body.removeChild(textarea);
      }

      copyIcon.textContent = '✅';

      showToast(
        'Email copied',
        'hello@espressgo.sg copied to clipboard.'
      );

      setTimeout(() => {
        copyIcon.textContent = '📋';
      }, 2000);
    } catch (error) {
      console.error('Copy email failed:', error);

      showToast(
        'Copy failed',
        'Please copy the email manually.',
        'error'
      );
    }
  });
}


/* ============================================================
   Topic tabs
   ============================================================ */

const placeholders = {
  wholesale: 'Tell us your order volume, frequency, and delivery needs…',
  feedback: 'Share your experience with our product or service…',
  partnership: 'Describe your business and the opportunity you have in mind…',
  other: 'What can we help you with?',
};

let activeTopic = 'wholesale';

document.querySelectorAll('.topic-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.topic-tab').forEach(tab => {
      tab.classList.remove('active');
      tab.setAttribute('aria-selected', 'false');
    });

    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');

    activeTopic = btn.dataset.topic || 'other';

    const messageInput = document.getElementById('c-message');

    if (messageInput) {
      messageInput.placeholder = placeholders[activeTopic] || placeholders.other;
    }
  });
});


/* ============================================================
   Character counter for message textarea
   ============================================================ */

const msgEl = document.getElementById('c-message');
const countEl = document.getElementById('char-count');

if (msgEl && countEl) {
  msgEl.addEventListener('input', () => {
    const count = msgEl.value.length;

    countEl.textContent = count + '/500';

    // Turn amber when within 50 characters of the limit
    countEl.classList.toggle('warn', count > 450);
  });
}


/* ============================================================
   Validation helpers
   ============================================================ */

function showErr(field, msg) {
  const errEl = document.getElementById('err-' + field);
  const inputEl = document.getElementById('c-' + field);

  if (errEl) {
    errEl.textContent = '⚠ ' + msg;
    errEl.style.display = 'flex';
  }

  if (inputEl) {
    inputEl.classList.add('error');
  }
}


function clearErr(field) {
  const errEl = document.getElementById('err-' + field);
  const inputEl = document.getElementById('c-' + field);

  if (errEl) {
    errEl.textContent = '';
    errEl.style.display = 'none';
  }

  if (inputEl) {
    inputEl.classList.remove('error');
  }
}


function clearAllErrors() {
  ['name', 'email', 'message'].forEach(clearErr);
}


function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}


/* ============================================================
   Submit button helpers
   ============================================================ */

function setSubmitLoading(isLoading) {
  const label = document.getElementById('submit-label');
  const spinner = document.getElementById('submit-spinner');
  const btn = document.getElementById('submit-btn');

  if (label) {
    label.style.display = isLoading ? 'none' : 'inline';
  }

  if (spinner) {
    spinner.style.display = isLoading ? 'inline-block' : 'none';
  }

  if (btn) {
    btn.disabled = isLoading;
  }
}


/* ============================================================
   Contact form submit
   ============================================================ */

const form = document.getElementById('contact-form');

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('c-name').value.trim();
    const email = document.getElementById('c-email').value.trim();
    const message = msgEl.value.trim();

    clearAllErrors();

    let ok = true;

    if (!name) {
      showErr('name', 'Required');
      ok = false;
    }

    if (!email) {
      showErr('email', 'Required');
      ok = false;
    } else if (!isValidEmail(email)) {
      showErr('email', 'Invalid email');
      ok = false;
    }

    if (!message) {
      showErr('message', 'Required');
      ok = false;
    }

    if (!ok) return;

    setSubmitLoading(true);

    try {
      const { error } = await sb
        .from('feedback')
        .insert({
          name,
          email,
          topic: activeTopic,
          message
        });

      if (error) {
        console.error('Supabase feedback insert failed:', error);

        showErr(
          'message',
          error.message || 'Could not send message. Please try again.'
        );

        setSubmitLoading(false);
        return;
      }

      document.getElementById('form-state').style.display = 'none';
      document.getElementById('success-email').textContent = email;
      document.getElementById('success-state').style.display = 'flex';

      showToast(
        'Message sent',
        'Your enquiry has been submitted successfully.'
      );
    } catch (error) {
      console.error('Contact form submit failed:', error);

      showErr(
        'message',
        error.message || 'Could not send message. Please try again.'
      );

      setSubmitLoading(false);
    }
  });
}


/* ============================================================
   Send another message button
   ============================================================ */

const sendAnotherBtn = document.getElementById('send-another-btn');

if (sendAnotherBtn) {
  sendAnotherBtn.addEventListener('click', () => {
    document.getElementById('success-state').style.display = 'none';
    document.getElementById('form-state').style.display = 'block';

    form.reset();

    clearAllErrors();

    countEl.textContent = '0/500';
    countEl.classList.remove('warn');

    activeTopic = 'wholesale';

    document.querySelectorAll('.topic-tab').forEach(tab => {
      tab.classList.remove('active');
      tab.setAttribute('aria-selected', 'false');
    });

    const wholesaleTab = document.querySelector('[data-topic="wholesale"]');

    if (wholesaleTab) {
      wholesaleTab.classList.add('active');
      wholesaleTab.setAttribute('aria-selected', 'true');
    }

    msgEl.placeholder = placeholders.wholesale;

    setSubmitLoading(false);
  });
}