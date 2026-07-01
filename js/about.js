/* ============================================================
   about.js — Logic for about.html
   Depends on: shared.js
   Uses:
   - buildNav
   - buildFooter

   Supabase version:
   This page does not write/read database data, but it loads Supabase
   through the HTML so shared.js can refresh nav/auth state correctly.
   ============================================================ */


/* ============================================================
   Page initialisation
   ============================================================ */

async function initAboutPage() {
  try {
    // Refresh Supabase session if user is already logged in.
    // This keeps the navigation accurate across pages.
    await Auth.refreshUser();
  } catch (error) {
    console.warn('No active Supabase session found:', error);
  }

  buildNav('about');
  buildFooter();

  initCounters();
  initSegmentTabs();
}

initAboutPage();


/* ============================================================
   Animated stat counters
   ============================================================ */

/**
 * Animates a number element from 0 to target number.
 *
 * @param {HTMLElement} el - Element to update
 * @param {number} to - Target number
 * @param {string} suffix - Text appended after number
 */
function animateCounter(el, to, suffix) {
  let value = 0;

  // Keep animation smooth even when target is 0.
  if (to === 0) {
    el.textContent = '0' + suffix;
    return;
  }

  const steps = 40;
  const step = to / steps;

  const timer = setInterval(() => {
    value += step;

    if (value >= to) {
      el.textContent = to + suffix;
      clearInterval(timer);
      return;
    }

    el.textContent = Math.floor(value) + suffix;
  }, 30);
}


/**
 * Sets up IntersectionObserver so counters animate only when visible.
 */
function initCounters() {
  const counterIds = ['stat-1', 'stat-12', 'stat-0', 'stat-100'];

  const counterObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;

      counterObserver.unobserve(entry.target);

      const target = entry.target;

      if (target.id === 'stat-1') {
        animateCounter(target, 1, '');
      }

      if (target.id === 'stat-12') {
        animateCounter(target, 12, 'mo');
      }

      if (target.id === 'stat-0') {
        animateCounter(target, 0, '');
      }

      if (target.id === 'stat-100') {
        animateCounter(target, 100, '%');
      }
    });
  }, {
    threshold: 0.3
  });

  counterIds.forEach(id => {
    const el = document.getElementById(id);

    if (el) {
      counterObserver.observe(el);
    }
  });
}


/* ============================================================
   Customer segment tabs
   ============================================================ */

const segData = {
  offices: {
    icon: '🏢',
    headline: 'Fuel your team instantly',
    points: [
      'No machine noise or mess',
      'Pantry-friendly storage',
      'Bulk pricing from 50 units'
    ],
  },

  gyms: {
    icon: '🏋️',
    headline: 'Pre-workout, pocket-sized',
    points: [
      'Spill-proof pouch format',
      'No fridge needed',
      'Ideal for member packs'
    ],
  },

  events: {
    icon: '📅',
    headline: 'Easy to distribute at scale',
    points: [
      'Individually packed',
      'Lightweight & portable',
      'Custom quantity orders'
    ],
  },

  retail: {
    icon: '🏪',
    headline: 'Impulse-friendly format',
    points: [
      'Shelf-stable ambient storage',
      'Compact SKU footprint',
      'Suitable for pilot retail packs'
    ],
  },
};


/**
 * Initialises segment tab click behaviour.
 */
function initSegmentTabs() {
  const buttons = document.querySelectorAll('.seg-tab');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedSegment = btn.dataset.seg;
      const data = segData[selectedSegment];

      if (!data) return;

      // Deactivate all tabs
      buttons.forEach(tab => {
        tab.classList.remove('active');
        tab.setAttribute('aria-selected', 'false');
      });

      // Activate selected tab
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      // Update panel content
      const iconEl = document.getElementById('seg-icon');
      const headlineEl = document.getElementById('seg-headline');
      const pointsEl = document.getElementById('seg-points');
      const panelEl = document.getElementById('seg-panel');

      if (iconEl) {
        iconEl.textContent = data.icon;
      }

      if (headlineEl) {
        headlineEl.textContent = data.headline;
      }

      if (pointsEl) {
        pointsEl.innerHTML = data.points
          .map(point => `<span class="seg-point">${escapeHTML(point)}</span>`)
          .join('');
      }

      // Replay fade-in animation by forcing a reflow
      if (panelEl) {
        panelEl.classList.remove('fade-in');

        // Force reflow
        void panelEl.offsetWidth;

        panelEl.classList.add('fade-in');
      }
    });
  });
}
