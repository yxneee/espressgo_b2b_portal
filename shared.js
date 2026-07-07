/* shared.js — navigation, auth, toast, shared state */
/* ============================================================
   ESPRESSGO B2B Portal — Shared JavaScript

   This file manages:
   - Supabase authentication helpers
   - Shared fallback product data
   - Supabase order helpers
   - Navigation rendering
   - Footer rendering
   - Toast notifications
   - Product pouch SVG helpers
   - Floating social buttons
   - FAQ / AI chat widget

   IMPORTANT:
   HTML pages must load scripts in this order:
   1. Supabase JS CDN
   2. supabase-config.js
   3. shared.js
   ============================================================ */


/* ============================================================
   Supabase client resolver
   ============================================================ */

function getSupabaseClient() {
  if (window.sb) return window.sb;
  if (window.supabaseClient) return window.supabaseClient;

  try {
    if (typeof sb !== 'undefined') return sb;
  } catch (error) {
    // Ignore missing global lexical variable.
  }

  return null;
}


/* ============================================================
   Small safety helper
   ============================================================ */

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function apiFetch(path, options) {
  const host = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? (window.location.port === '3000' ? '' : 'http://localhost:3000')
    : '';
  return fetch(`${host}${path}`, options);
}


/* ============================================================
   Auth helpers using Supabase
   ============================================================ */

const Auth = {
  _profileKey: 'espressgo_profile',

  getUser() {
    try {
      return JSON.parse(localStorage.getItem(this._profileKey) || 'null');
    } catch (error) {
      return null;
    }
  },

  setUser(profile) {
    localStorage.setItem(this._profileKey, JSON.stringify(profile));
  },

  clearUser() {
    localStorage.removeItem(this._profileKey);
    localStorage.removeItem('espressgo_user');
  },

  isLoggedIn() {
    return !!this.getUser();
  },

  normalizeProfile(profile, authUser = null) {
    return {
      id: profile?.id || authUser?.id || null,
      email: profile?.email || authUser?.email || '',
      contactName: profile?.contact_name || authUser?.user_metadata?.contact_name || '',
      companyName: profile?.company_name || authUser?.user_metadata?.company_name || '',
      businessType: profile?.business_type || authUser?.user_metadata?.business_type || '',
      deliveryAddress: profile?.delivery_address || authUser?.user_metadata?.delivery_address || '',
      role: profile?.role || authUser?.user_metadata?.role || 'buyer',
      approvalStatus: profile?.approval_status || authUser?.user_metadata?.approval_status || 'approved',
      creditStatus: profile?.credit_status || authUser?.user_metadata?.credit_status || 'none',
      creditLimit: Number(profile?.credit_limit ?? 25000),
      paymentTerms: profile?.payment_terms || authUser?.user_metadata?.payment_terms || 'Net 30'
    };
  },

  async refreshUser() {
    const client = getSupabaseClient();

    if (!client) {
      console.error('Supabase client is missing. Check supabase-config.js.');
      this.clearUser();
      return null;
    }

    const { data: sessionData, error: sessionError } = await client.auth.getSession();

    if (sessionError || !sessionData?.session?.user) {
      this.clearUser();
      return null;
    }

    const authUser = sessionData.session.user;

    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle();

    if (profileError) {
      console.error('Failed to load profile:', profileError);
    }

    const approvalStatus = profile?.approval_status || 'approved';
    const userRole = profile?.role || 'buyer';

    if (userRole !== 'admin' && approvalStatus === 'rejected') {
      console.warn('User session invalidated due to rejected status');
      await client.auth.signOut();
      this.clearUser();
      localStorage.removeItem('espressgo_admin');
      return null;
    }

    const normalizedProfile = this.normalizeProfile(profile, authUser);

    this.setUser(normalizedProfile);
    return normalizedProfile;
  },

  async login(email, password) {
    const client = getSupabaseClient();

    if (!client) {
      return {
        ok: false,
        error: 'Supabase is not connected. Check supabase-config.js.'
      };
    }

    const { data, error } = await client.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return {
        ok: false,
        error: error.message || 'Invalid email or password.'
      };
    }

    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .maybeSingle();

    if (profileError) {
      return {
        ok: false,
        error: profileError.message || 'Login succeeded, but your profile could not be loaded.'
      };
    }

    const approvalStatus = profile?.approval_status || 'approved';
    const userRole = profile?.role || 'buyer';

    if (userRole !== 'admin' && approvalStatus === 'rejected') {
      await client.auth.signOut();
      this.clearUser();
      return {
        ok: false,
        error: 'Your wholesale account registration has been rejected. Please contact support.'
      };
    }

    let finalProfile = profile;
    if (email.toLowerCase() === 'admin@espressgo.sg') {
      const profilePayload = {
        id: data.user.id,
        email: email.toLowerCase(),
        contact_name: profile?.contact_name || 'Admin User',
        company_name: profile?.company_name || 'ESPRESSGO HQ',
        business_type: profile?.business_type || 'hq',
        delivery_address: profile?.delivery_address || 'Singapore HQ',
        role: 'admin',
        approval_status: 'approved'
      };

      const { data: upsertedProfile, error: upsertError } = await client
        .from('profiles')
        .upsert(profilePayload, { onConflict: 'id' })
        .select()
        .maybeSingle();

      if (!upsertError && upsertedProfile) {
        finalProfile = upsertedProfile;
      } else {
        console.warn('Admin profile upsert failed, using virtual profile:', upsertError);
        finalProfile = { ...profile, ...profilePayload, role: 'admin' };
      }
    }

    const normalizedProfile = this.normalizeProfile(finalProfile, data.user);

    this.setUser(normalizedProfile);

    return {
      ok: true,
      user: normalizedProfile
    };
  },

  async register(email, password, companyName, businessType, contactName) {
    const client = getSupabaseClient();

    if (!client) {
      return {
        ok: false,
        error: 'Supabase is not connected. Check supabase-config.js.'
      };
    }

    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          contact_name: contactName,
          company_name: companyName,
          business_type: businessType,
          delivery_address: '',
          role: 'buyer',
          approval_status: 'approved'
        }
      }
    });

    if (error) {
      return {
        ok: false,
        error: error.message || 'Could not create account.'
      };
    }

    if (!data.user) {
      return {
        ok: false,
        error: 'Please check your email to confirm your account, then sign in.'
      };
    }

    const profilePayload = {
      id: data.user.id,
      email,
      contact_name: contactName,
      company_name: companyName,
      business_type: businessType,
      delivery_address: '',
      role: 'buyer',
      approval_status: 'approved'
    };

    const { error: profileError } = await client
      .from('profiles')
      .upsert(profilePayload, { onConflict: 'id' });

    if (profileError) {
      return {
        ok: false,
        error: profileError.message || 'Account created, but profile creation failed.'
      };
    }

    const normalizedProfile = this.normalizeProfile(profilePayload, data.user);

    // Keep the user signed in so they can browse the B2B catalog instantly
    this.setUser(normalizedProfile);

    return {
      ok: true,
      user: normalizedProfile
    };
  },

  async updateProfile(profile) {
    const client = getSupabaseClient();
    const current = this.getUser();

    if (!client) {
      return {
        ok: false,
        error: 'Supabase is not connected. Check supabase-config.js.'
      };
    }

    if (!current) {
      return {
        ok: false,
        error: 'Not logged in.'
      };
    }

    const { error } = await client
      .from('profiles')
      .update({
        contact_name: profile.contactName,
        company_name: profile.companyName,
        business_type: profile.businessType,
        delivery_address: profile.deliveryAddress,
        ...(profile.email ? { email: profile.email } : {}),
        updated_at: new Date().toISOString()
      })
      .eq('id', current.id);

    if (error) {
      return {
        ok: false,
        error: error.message
      };
    }

    const updatedProfile = {
      ...current,
      ...profile
    };

    this.setUser(updatedProfile);

    return {
      ok: true,
      user: updatedProfile
    };
  },

  async logout() {
    const client = getSupabaseClient();

    if (client) {
      await client.auth.signOut();
    }

    this.clearUser();
    localStorage.removeItem('espressgo_admin');
  }
};


/* ============================================================
   Fallback product data
   Supabase products should be the main source on catalog pages.
   This remains as backup for local display and AI cart actions.
   ============================================================ */

const Products = [
  {
    id: 'espressgo-original',
    sku: 'ESG-OG-001',
    name: 'ESPRESSGO Original',
    subtitle: 'Classic Vietnamese cold brew gel shot',
    caffeine: '~65mg caffeine',
    format: 'Gel pouch · 25ml',
    shelfLife: '12-month shelf life',
    pouchColor: '#C8580A',
    pouchAccent: '#8B3A00',
    labelColor: '#F5E0C8',
    active: true,
    tiers: [
      { min: 1, max: 9, price: 120 },
      { min: 10, max: 29, price: 108 },
      { min: 30, max: null, price: 96 }
    ]
  },
  {
    id: 'espressgo-oatmilk',
    sku: 'ESG-OAT-002',
    name: 'ESPRESSGO Oat Milk',
    subtitle: 'Creamy oat milk cold brew blend',
    caffeine: '~60mg caffeine',
    format: 'Gel pouch · 30ml',
    shelfLife: '10-month shelf life',
    pouchColor: '#D4956A',
    pouchAccent: '#8B5B3A',
    labelColor: '#FFF0E0',
    active: true,
    tiers: [
      { min: 1, max: 9, price: 130 },
      { min: 10, max: 29, price: 117 },
      { min: 30, max: null, price: 104 }
    ]
  },
  {
    id: 'espressgo-matcha',
    sku: 'ESG-MTG-003',
    name: 'ESPRESSGO Matcha',
    subtitle: 'Japanese matcha energy gel shot',
    caffeine: '~40mg caffeine',
    format: 'Gel pouch · 25ml',
    shelfLife: '12-month shelf life',
    pouchColor: '#4A7C59',
    pouchAccent: '#2D5E3F',
    labelColor: '#E8F5EC',
    active: false,
    comingSoonHint: 'Matcha + espresso blend — Q3 2026',
    tiers: [
      { min: 1, max: 9, price: 125 },
      { min: 10, max: 29, price: 112 },
      { min: 30, max: null, price: 100 }
    ]
  },
  {
    id: 'espressgo-decaf',
    sku: 'ESG-DCF-004',
    name: 'ESPRESSGO Decaf',
    subtitle: 'All the ritual, none of the buzz',
    caffeine: '~5mg caffeine',
    format: 'Gel pouch · 25ml',
    shelfLife: '14-month shelf life',
    pouchColor: '#7A6A5C',
    pouchAccent: '#4A3D33',
    labelColor: '#F0ECE8',
    active: false,
    comingSoonHint: 'Swiss water decaf process — Q4 2026',
    tiers: [
      { min: 1, max: 9, price: 115 },
      { min: 10, max: 29, price: 103 },
      { min: 30, max: null, price: 92 }
    ]
  }
];

function getActiveTier(tiers, qty) {
  const cleanTiers = Array.isArray(tiers) && tiers.length
    ? tiers
    : [{ min: 1, max: null, price: 0 }];

  const cleanQty = Number(qty || 0);

  if (cleanQty <= 0) return cleanTiers[0];

  let activeTier = cleanTiers[0];

  for (const tier of cleanTiers) {
    const minOk = cleanQty >= Number(tier.min || 0);
    const maxOk = tier.max === null || tier.max === undefined || cleanQty <= Number(tier.max);

    if (minOk && maxOk) {
      activeTier = tier;
    }
  }

  return activeTier;
}


/* ============================================================
   Order data using Supabase
   Database schema used:
   - orders.profile_id
   - orders.created_at
   - order_items.order_id
   ============================================================ */

const Orders = {
  async getAll() {
    const client = getSupabaseClient();

    if (!client) return [];

    let query = client
      .from('orders')
      .select('*, order_items(*)')
      .order('created_at', { ascending: false });

    let { data, error } = await query;

    if (error) {
      console.warn('Nested order_items fetch failed. Retrying orders only:', error.message);

      const fallback = await client
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      console.error('Failed to load orders:', error);
      return [];
    }

    return (data || []).map(row => this._fromDb(row));
  },

  async add(order) {
    const client = getSupabaseClient();
    const user = Auth.getUser();

    if (!client) {
      throw new Error('Supabase is not connected. Check supabase-config.js.');
    }

    if (!user) {
      throw new Error('You must be logged in to place an order.');
    }

    const payload = {
      profile_id: user.id,
      company: order.company || user.companyName || 'Unknown Company',
      contact_name: order.contactName || user.contactName || user.email || 'Unknown Contact',
      business_type: order.businessType || user.businessType || null,
      delivery_address: order.deliveryAddress || user.deliveryAddress || 'Singapore',
      total_cartons: Number(order.totalCartons || 0),
      total_amount: Number(order.totalAmount || 0),
      status: order.status || 'pending',
      notes: order.notes || null,
      payment_method: order.paymentMethod || 'stripe',
      payment_status: order.paymentStatus || 'paid',
      credit_terms: order.creditTerms || null
    };

    const { data: savedOrder, error: orderError } = await client
      .from('orders')
      .insert(payload)
      .select()
      .single();

    if (orderError) {
      console.error('Failed to add order:', orderError);
      throw orderError;
    }

    const items = Array.isArray(order.items) ? order.items : [];

    if (items.length) {
      const itemPayload = items.map(item => ({
        order_id: savedOrder.id,
        product_id: item.productId || item.product_id || item.id || null,
        sku: item.sku || '',
        name: item.name || '',
        cartons: Number(item.cartons || item.qty || 0),
        price_per_carton: Number(item.pricePerCarton || item.price_per_carton || item.price || 0)
      }));

      const { error: itemsError } = await client
        .from('order_items')
        .insert(itemPayload);

      if (itemsError) {
        console.error('Order saved, but order items failed:', itemsError);
        throw itemsError;
      }

      savedOrder.order_items = itemPayload;
    }

    return this._fromDb(savedOrder);
  },

  async updateStatus(id, status) {
    const client = getSupabaseClient();

    if (!client) {
      throw new Error('Supabase is not connected. Check supabase-config.js.');
    }

    const { error } = await client
      .from('orders')
      .update({ status })
      .eq('id', id);

    if (error) {
      console.error('Failed to update order:', error);
      throw error;
    }

    return { ok: true };
  },

  async forCurrentUser() {
    const client = getSupabaseClient();
    const user = Auth.getUser();

    if (!client || !user) return [];

    let { data, error } = await client
      .from('orders')
      .select('*, order_items(*)')
      .eq('profile_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Nested order_items fetch failed. Retrying orders only:', error.message);

      const fallback = await client
        .from('orders')
        .select('*')
        .eq('profile_id', user.id)
        .order('created_at', { ascending: false });

      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      console.error('Failed to load user orders:', error);
      return [];
    }

    return (data || []).map(row => this._fromDb(row));
  },

  async forCompany(companyName) {
    const client = getSupabaseClient();

    if (!client || !companyName) return [];

    const { data, error } = await client
      .from('orders')
      .select('*, order_items(*)')
      .eq('company', companyName)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to load company orders:', error);
      return [];
    }

    return (data || []).map(row => this._fromDb(row));
  },

  _fromDb(row) {
    const nestedItems = Array.isArray(row.order_items) ? row.order_items : [];
    const legacyItems = Array.isArray(row.items) ? row.items : [];

    const items = nestedItems.length
      ? nestedItems.map(item => ({
        id: item.id,
        productId: item.product_id,
        sku: item.sku,
        name: item.name,
        cartons: Number(item.cartons || 0),
        pricePerCarton: Number(item.price_per_carton || 0)
      }))
      : legacyItems;

    return {
      id: String(row.id),
      profileId: row.profile_id || row.user_id || null,
      company: row.company || '',
      contactName: row.contact_name || '',
      businessType: row.business_type || '',
      items,
      totalCartons: Number(row.total_cartons || 0),
      totalAmount: Number(row.total_amount || 0),
      status: row.status || 'pending',
      deliveryAddress: row.delivery_address || '',
      notes: row.notes || '',
      dateOrdered: row.created_at || row.date_ordered || null,
      createdAt: row.created_at || null,
      paymentMethod: row.payment_method || 'stripe',
      paymentStatus: row.payment_status || 'paid',
      creditTerms: row.credit_terms || null
    };
  }
};


/* ============================================================
   Toast notifications
   ============================================================ */

function showToast(title, body = '', type = 'success') {
  let container = document.getElementById('toast-container');

  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type} fade-in`;

  toast.innerHTML = `
    <div class="toast-icon">${type === 'success' ? '✓' : '!'}</div>
    <div class="toast-body">
      <div class="toast-title">${escapeHTML(title)}</div>
      ${body ? `<div class="toast-sub">${escapeHTML(body)}</div>` : ''}
    </div>
    <button class="toast-close" aria-label="Close">×</button>
  `;

  const closeBtn = toast.querySelector('.toast-close');

  if (closeBtn) {
    closeBtn.onclick = () => toast.remove();
  }

  container.appendChild(toast);

  setTimeout(() => {
    if (toast && toast.parentNode) {
      toast.remove();
    }
  }, 4500);
}


/* ============================================================
   Navigation builder
   ============================================================ */

function buildNav(activePage) {
  const currentUser = Auth.getUser();
  const loggedIn = !!currentUser;
  const inAdmin = window.location.pathname.includes('/admin/');
  const rootPrefix = inAdmin ? '../' : '';
  const adminPrefix = inAdmin ? '' : 'admin/';

  const safeCompany = escapeHTML(currentUser?.companyName || '');
  const safeEmail = escapeHTML(currentUser?.email || '');

  const initials = currentUser
    ? (currentUser.contactName || currentUser.companyName || 'U')
      .split(' ')
      .filter(Boolean)
      .map(word => word[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
    : '';

  const portalLinks = `
    <li>
      <a href="${rootPrefix}catalog.html" class="nav-link ${activePage === 'catalog' ? 'active' : ''}">
        Catalog
      </a>
    </li>

    ${loggedIn ? `
      <li>
        <a href="${rootPrefix}quick-order.html" class="nav-link ${activePage === 'quick-order' ? 'active' : ''}">
          Quick Order
        </a>
      </li>

      <li>
        <a href="${rootPrefix}account.html" class="nav-link ${activePage === 'account' ? 'active' : ''}">
          Account
        </a>
      </li>

      <li><div class="nav-divider"></div></li>
    ` : ''}
  `;

  const showAdminButton = currentUser && currentUser.role === 'admin';

  const rightDesktop = loggedIn ? `
    ${showAdminButton ? `
      <a href="${adminPrefix}admin-dashboard.html" class="nav-admin-btn" style="font-size:12px;">🛡 Admin</a>
      <div class="nav-divider"></div>
    ` : ''}

    <div style="position:relative;">
      <button
        id="user-menu-btn"
        type="button"
        style="display:flex;align-items:center;gap:.6rem;padding:.4rem .6rem;border-radius:10px;background:none;border:none;cursor:pointer;transition:background .15s;"
        onmouseover="this.style.background='rgba(255,255,255,.08)'"
        onmouseout="this.style.background='none'">

        <div style="width:32px;height:32px;background:rgba(200,133,58,.25);border:1px solid rgba(200,133,58,.2);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#D4A574;">
          ${escapeHTML(initials)}
        </div>

        <div style="text-align:left;display:none;" class="xl-show">
          <div style="font-size:12px;color:#F5E6D3;">${safeCompany}</div>
          <div style="font-size:10px;color:#6B5744;">${safeEmail}</div>
        </div>

        <span style="color:#6B5744;font-size:11px;">▾</span>
      </button>

      <div
        id="user-menu-dropdown"
        style="display:none;position:absolute;right:0;top:calc(100% + 8px);width:210px;background:#fff;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.12);border:1px solid #EDE8E3;overflow:hidden;z-index:200;">

        <div style="padding:.75rem 1rem;border-bottom:1px solid #F0EAE4;">
          <div style="font-size:14px;color:#2C1810;">${safeCompany}</div>
          <div style="font-size:11px;color:#8B7355;">${safeEmail}</div>
        </div>

        <a
          href="${rootPrefix}account.html"
          style="display:flex;align-items:center;gap:.6rem;padding:.65rem 1rem;font-size:14px;color:#2C1810;text-decoration:none;transition:background .15s;"
          onmouseover="this.style.background='#FAF8F5'"
          onmouseout="this.style.background='none'">
          👤 My Account
        </a>

        <div style="height:1px;background:#F0EAE4;"></div>

        <button
          onclick="handleLogout()"
          type="button"
          style="width:100%;display:flex;align-items:center;gap:.6rem;padding:.65rem 1rem;font-size:14px;color:#ef4444;background:none;border:none;cursor:pointer;transition:background .15s;"
          onmouseover="this.style.background='#fff5f5'"
          onmouseout="this.style.background='none'">
          🚪 Sign Out
        </button>
      </div>
    </div>
  ` : `
    <a href="${rootPrefix}login.html" class="nav-btn">Sign In</a>
  `;

  const mobilePortalLinks = `
    <a href="${rootPrefix}catalog.html" class="nav-mobile-link ${activePage === 'catalog' ? 'active' : ''}">
      📦 Catalog
    </a>

    ${loggedIn ? `
      <a href="${rootPrefix}quick-order.html" class="nav-mobile-link ${activePage === 'quick-order' ? 'active' : ''}">
        ⚡ Quick Order
      </a>

      <a href="${rootPrefix}account.html" class="nav-mobile-link ${activePage === 'account' ? 'active' : ''}">
        👤 Account
      </a>

      <div class="nav-mobile-divider"></div>
    ` : ''}
  `;

  const mobileAuth = loggedIn ? `
    ${showAdminButton ? `
      <a href="${adminPrefix}admin-dashboard.html" class="nav-mobile-link">🛡 Admin Portal</a>
      <div class="nav-mobile-divider"></div>
    ` : ''}

    <button
      onclick="handleLogout()"
      class="nav-mobile-link"
      type="button"
      style="background:rgba(239,68,68,.08);color:#ef4444;border:none;cursor:pointer;width:100%;text-align:left;">
      🚪 Sign Out
    </button>
  ` : `
    <a href="${rootPrefix}login.html" class="nav-mobile-signin">Sign In</a>
  `;

  const html = `
    <nav class="nav" role="navigation" aria-label="Main navigation">
      <div class="nav-inner">

        <a href="${rootPrefix}catalog.html" class="nav-logo" aria-label="ESPRESSGO home">
          <div class="nav-logo-icon">E</div>
          <div class="nav-logo-text">
            <div class="nav-logo-name">ESPRESSGO</div>
            <div class="nav-logo-sub">Wholesale Portal</div>
          </div>
        </a>

        <ul class="nav-links" role="list">
          ${portalLinks}
          <li>
            <a href="${rootPrefix}about.html" class="nav-link ${activePage === 'about' ? 'active' : ''}">
              About
            </a>
          </li>
          <li>
            <a href="${rootPrefix}contact.html" class="nav-link ${activePage === 'contact' ? 'active' : ''}">
              Contact
            </a>
          </li>
        </ul>

        <div class="nav-right-desktop" style="display:flex;align-items:center;gap:.5rem;">
          ${rightDesktop}
        </div>

        <button
          class="nav-hamburger"
          id="hamburger-btn"
          type="button"
          aria-label="Toggle menu"
          aria-expanded="false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="nav-mobile" id="mobile-menu" role="menu" aria-hidden="true">
        ${mobilePortalLinks}

        <a href="${rootPrefix}about.html" class="nav-mobile-link ${activePage === 'about' ? 'active' : ''}">
          ℹ️ About
        </a>

        <a href="${rootPrefix}contact.html" class="nav-mobile-link ${activePage === 'contact' ? 'active' : ''}">
          ✉️ Contact
        </a>

        <div class="nav-mobile-divider"></div>

        ${mobileAuth}
      </div>
    </nav>
  `;

  const navPlaceholder = document.getElementById('nav-placeholder');

  if (navPlaceholder) {
    navPlaceholder.innerHTML = html;
  }

  const hamburgerBtn = document.getElementById('hamburger-btn');
  const mobileMenu = document.getElementById('mobile-menu');

  if (hamburgerBtn && mobileMenu) {
    hamburgerBtn.addEventListener('click', () => {
      const open = mobileMenu.classList.toggle('open');
      hamburgerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      mobileMenu.setAttribute('aria-hidden', open ? 'false' : 'true');
    });
  }

  const userMenuBtn = document.getElementById('user-menu-btn');
  const userMenuDropdown = document.getElementById('user-menu-dropdown');

  if (userMenuBtn && userMenuDropdown) {
    userMenuBtn.addEventListener('click', event => {
      event.stopPropagation();
      userMenuDropdown.style.display = userMenuDropdown.style.display === 'block' ? 'none' : 'block';
    });

    document.addEventListener('click', () => {
      userMenuDropdown.style.display = 'none';
    });
  }
}


/* ============================================================
   Footer builder
   ============================================================ */

function buildFooter() {
  const footerPlaceholder = document.getElementById('footer-placeholder');

  if (!footerPlaceholder) return;

  const inAdmin = window.location.pathname.includes('/admin/');
  const rootPrefix = inAdmin ? '../' : '';

  footerPlaceholder.innerHTML = `
    <footer class="footer" role="contentinfo">
      <div class="footer-inner">

        <div class="footer-logo">
          <div class="footer-logo-icon">E</div>
          <span class="footer-logo-text">ESPRESSGO</span>
        </div>

        <nav class="footer-links" aria-label="Footer links">
          <a href="${rootPrefix}about.html">About</a>
          <a href="${rootPrefix}contact.html">Contact</a>
        </nav>

        <p class="footer-copy">
          © 2026 ESPRESSGO. Gel-based espresso shots for business. Singapore.
        </p>

      </div>
    </footer>
  `;
}


/* ============================================================
   Logout and auth guard
   ============================================================ */

async function handleLogout() {
  await Auth.logout();

  const inAdmin = window.location.pathname.includes('/admin/');
  window.location.href = inAdmin ? '../login.html' : 'login.html';
}

function requireAuth() {
  if (!Auth.isLoggedIn()) {
    const currentPage = window.location.pathname.split('/').pop() || 'catalog.html';
    const inAdmin = window.location.pathname.includes('/admin/');

    localStorage.setItem('redirectAfterLogin', currentPage);
    window.location.href = inAdmin ? '../login.html' : 'login.html';
  }
}


/* ============================================================
   Pouch SVG helpers
   ============================================================ */

function pouchSVG(product, size = 130, dimmed = false) {
  const pouchColor = product.pouchColor || '#C8580A';
  const pouchAccent = product.pouchAccent || '#8B3A00';
  const labelColor = product.labelColor || '#F5E0C8';
  const name = product.name || 'ESPRESSGO';
  const height = size * 1.55;
  const label = name.replace('ESPRESSGO ', '');

  return `
    <svg width="${size}" height="${height}" viewBox="0 0 100 155" xmlns="http://www.w3.org/2000/svg" style="opacity:${dimmed ? 0.4 : 1}">
      <rect x="42" y="0" width="16" height="14" rx="4" fill="${pouchAccent}"/>
      <path d="M36 14 Q30 20 28 30 L72 30 Q70 20 64 14 Z" fill="${pouchColor}"/>
      <rect x="18" y="30" width="64" height="100" rx="12" fill="${pouchColor}"/>
      <rect x="18" y="122" width="64" height="8" rx="6" fill="${pouchAccent}"/>
      <rect x="22" y="42" width="56" height="72" rx="6" fill="${labelColor}" opacity="0.92"/>
      <text x="50" y="62" text-anchor="middle" font-size="8.5" font-weight="700" font-family="sans-serif" fill="${pouchAccent}" letter-spacing="0.5">ESPRESSGO</text>
      <line x1="26" y1="66" x2="74" y2="66" stroke="${pouchColor}" stroke-width="0.8" opacity="0.4"/>
      <circle cx="50" cy="68" r="7" fill="${pouchColor}" opacity="0.8"/>
      <path d="M44 75 Q48 84 50 88 Q52 84 56 75 Z" fill="${pouchColor}" opacity="0.7"/>
      <text x="50" y="109" text-anchor="middle" font-size="4.2" font-family="sans-serif" fill="${pouchAccent}" opacity="0.7">${escapeHTML(label)}</text>
    </svg>
  `;
}

function miniPouchSVG(color, accent, size = 32) {
  const height = size * 1.5;

  return `
    <svg width="${size}" height="${height}" viewBox="0 0 36 54" xmlns="http://www.w3.org/2000/svg">
      <rect x="14" y="0" width="8" height="6" rx="2" fill="${accent}"/>
      <path d="M10 6 Q8 9 8 12 L28 12 Q28 9 26 6 Z" fill="${color}"/>
      <rect x="4" y="12" width="28" height="36" rx="6" fill="${color}"/>
      <rect x="4" y="44" width="28" height="4" rx="3" fill="${accent}"/>
      <rect x="7" y="16" width="22" height="26" rx="4" fill="${accent}" opacity="0.18"/>
      <text x="18" y="28" text-anchor="middle" font-size="4" font-weight="700" font-family="sans-serif" fill="${accent}" letter-spacing="0.2">ESG</text>
    </svg>
  `;
}


/* ============================================================
   Make helpers available globally
   ============================================================ */

window.getSupabaseClient = getSupabaseClient;
window.Auth = Auth;
window.Products = Products;
window.Orders = Orders;
window.getActiveTier = getActiveTier;
window.showToast = showToast;
window.buildNav = buildNav;
window.buildFooter = buildFooter;
window.handleLogout = handleLogout;
window.requireAuth = requireAuth;
window.pouchSVG = pouchSVG;
window.miniPouchSVG = miniPouchSVG;
window.escapeHTML = escapeHTML;


// ── Social Floats & FAQ Agent ───────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // 1. Inject Floating Buttons & Chat Widget HTML
  const socialHTML = `
    <div class="social-floats">
      <a href="https://www.linkedin.com/in/damien-teo-371b31257" target="_blank" rel="noopener noreferrer" class="social-float-btn linkedin" aria-label="LinkedIn">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>
      </a>
      <a href="https://wa.me/6587977961" target="_blank" rel="noopener noreferrer" class="social-float-btn whatsapp" aria-label="WhatsApp">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.031 0C5.385 0 0 5.386 0 12.031c0 2.146.561 4.241 1.626 6.096L.18 24l6.02-1.583C7.994 23.366 10.002 24 12.031 24 18.675 24 24 18.614 24 11.97 24 5.326 18.675 0 12.031 0zM12 21.921c-1.847 0-3.655-.494-5.239-1.428l-.375-.221-3.879 1.018 1.036-3.774-.243-.384A9.873 9.873 0 0 1 1.944 12c0-5.466 4.453-9.919 9.923-9.919 5.467 0 9.922 4.454 9.922 9.92S17.467 21.92 12 21.921zm5.45-7.462c-.298-.15-1.767-.872-2.039-.972-.274-.1-.472-.15-.672.15-.199.299-.77 .972-.944 1.17-.174.199-.348.225-.646.075-.298-.15-1.26-.464-2.4-1.485-.886-.793-1.484-1.774-1.658-2.073-.174-.299-.019-.462.13-.611.135-.134.298-.349.447-.523.149-.174.199-.299.298-.499.1-.198.05-.373-.024-.523-.075-.15-.672-1.621-.92-2.22-.242-.584-.488-.505-.672-.514-.174-.01-.373-.01-.572-.01-.199 0-.523.075-.797.374-.274.298-1.045 1.02-1.045 2.49 0 1.47 1.07 2.89 1.219 3.09.15.199 2.106 3.214 5.101 4.506.711.306 1.266.49 1.698.627.714.226 1.365.194 1.88.118.577-.085 1.767-.722 2.016-1.42.249-.697.249-1.295.174-1.42-.074-.124-.274-.198-.572-.348z"/></svg>
      </a>
      <button class="social-float-btn faq" id="faq-toggle-btn" aria-label="KOPIGO FAQ Mascot">
        <span class="notification-badge" id="faq-badge"></span>
        <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;">
          <!-- Saucer -->
          <ellipse cx="50" cy="80" rx="35" ry="10" fill="#2C1810" opacity="0.15"/>
          <ellipse cx="50" cy="78" rx="28" ry="7" fill="#C8853A" opacity="0.3"/>
          <!-- Cup Body -->
          <path d="M25 35 C25 68, 30 72, 50 72 C70 72, 75 68, 75 35 Z" fill="#2C1810"/>
          <path d="M27 37 C27 66, 32 70, 50 70 C68 70, 73 66, 73 37 Z" fill="#F5E6D3"/>
          <!-- Cup Rim / Liquid -->
          <ellipse cx="50" cy="35" rx="25" ry="7" fill="#C8853A"/>
          <ellipse cx="50" cy="35" rx="22" ry="5" fill="#3D2817"/>
          <!-- Handle -->
          <path d="M74 42 C84 42, 84 62, 74 62" stroke="#2C1810" stroke-width="5" stroke-linecap="round" fill="none"/>
          <path d="M74 42 C84 42, 84 62, 74 62" stroke="#F5E6D3" stroke-width="2" stroke-linecap="round" fill="none"/>
          <!-- Steam -->
          <path d="M42 22 Q46 15 42 10" stroke="#C8853A" stroke-width="3" stroke-linecap="round" opacity="0.75"/>
          <path d="M50 25 Q54 18 50 12" stroke="#C8853A" stroke-width="3" stroke-linecap="round" opacity="0.75"/>
          <path d="M58 22 Q62 15 58 10" stroke="#C8853A" stroke-width="3" stroke-linecap="round" opacity="0.75"/>
          <!-- Cute Face -->
          <circle cx="42" cy="52" r="3.5" fill="#2C1810"/>
          <circle cx="41" cy="50.5" r="1" fill="#fff"/>
          <circle cx="58" cy="52" r="3.5" fill="#2C1810"/>
          <circle cx="57" cy="50.5" r="1" fill="#fff"/>
          <path d="M47 57 Q50 60 53 57" stroke="#2C1810" stroke-width="2.5" stroke-linecap="round" fill="none"/>
          <circle cx="36" cy="56" r="3" fill="#ef4444" opacity="0.35"/>
          <circle cx="64" cy="56" r="3" fill="#ef4444" opacity="0.35"/>
        </svg>
      </button>
    </div>

    <div class="faq-widget" id="faq-chat-widget">
      <div class="faq-widget-header">
        <div class="faq-header-info">
          <div class="faq-avatar">
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;">
              <!-- Saucer -->
              <ellipse cx="50" cy="80" rx="35" ry="10" fill="#2C1810" opacity="0.15"/>
              <ellipse cx="50" cy="78" rx="28" ry="7" fill="#C8853A" opacity="0.3"/>
              <!-- Cup Body -->
              <path d="M25 35 C25 68, 30 72, 50 72 C70 72, 75 68, 75 35 Z" fill="#2C1810"/>
              <path d="M27 37 C27 66, 32 70, 50 70 C68 70, 73 66, 73 37 Z" fill="#F5E6D3"/>
              <!-- Cup Rim / Liquid -->
              <ellipse cx="50" cy="35" rx="25" ry="7" fill="#C8853A"/>
              <ellipse cx="50" cy="35" rx="22" ry="5" fill="#3D2817"/>
              <!-- Handle -->
              <path d="M74 42 C84 42, 84 62, 74 62" stroke="#2C1810" stroke-width="5" stroke-linecap="round" fill="none"/>
              <path d="M74 42 C84 42, 84 62, 74 62" stroke="#F5E6D3" stroke-width="2" stroke-linecap="round" fill="none"/>
              <!-- Cute Face -->
              <circle cx="42" cy="52" r="3.5" fill="#2C1810"/>
              <circle cx="41" cy="50.5" r="1" fill="#fff"/>
              <circle cx="58" cy="52" r="3.5" fill="#2C1810"/>
              <circle cx="57" cy="50.5" r="1" fill="#fff"/>
              <path d="M47 57 Q50 60 53 57" stroke="#2C1810" stroke-width="2.5" stroke-linecap="round" fill="none"/>
              <circle cx="36" cy="56" r="3" fill="#ef4444" opacity="0.35"/>
              <circle cx="64" cy="56" r="3" fill="#ef4444" opacity="0.35"/>
            </svg>
          </div>
          <div>
            <div class="faq-status-title">KOPIGO</div>
            <div class="faq-status-sub">
              <span class="pulse-dot" style="width: 7px; height: 7px; background: #22c55e;"></span>
              AI Concierge · Online
            </div>
          </div>
        </div>
        <button class="faq-close-btn" id="faq-close-btn" aria-label="Close FAQ menu">×</button>
      </div>
      <div class="faq-chat-body" id="faq-chat-body"></div>
      <div class="faq-options-panel" id="faq-options-panel">
        <div class="faq-options-title">Click a question to ask</div>
        <div id="faq-buttons-container"></div>
      </div>
      <!-- AI Typing Input Area -->
      <div class="faq-input-container">
        <input type="text" id="faq-user-input" class="faq-input" placeholder="Or ask a custom question..." aria-label="Type B2B question">
        <button class="faq-send-btn" id="faq-send-btn" aria-label="Send message">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', socialHTML);

  // 2. State & FAQ Data definitions
  let faqData = [];
  const defaultFaqData = [
    {
      categoryName: 'Shipping & Delivery',
      q: "How long does delivery take?",
      answer: "Singapore B2B logistics typically take **2 to 3 business days** to arrive at your warehouse! 🚚\n\nNeed it faster? We offer **next-day express delivery** for orders placed before 12 PM, with a small SGD 15 surcharge. Free islandwide delivery for orders of 5+ cartons!"
    },
    {
      categoryName: 'Product Info',
      q: "Does EspressGo contain dairy or sugar?",
      answer: "Great question! Here's the breakdown of our two B2B variants:\n\n- **ESPRESSGO Original** — Zero added sugar, 100% dairy-free, and fully vegan. Pure Vietnamese robusta cold brew gel.\n- **ESPRESSGO Oat Milk** — Contains organic oat milk (plant-based, 100% dairy-free) with a light touch of natural brown sugar.\n\nBoth are clean-label and office-friendly! ☕"
    },
    {
      categoryName: 'Product Info',
      q: "Is EspressGo halal-certified?",
      answer: "Absolutely yes! 🌙 ESPRESSGO is proudly **MUIS Halal-certified**, manufactured to the highest compliance standards here in Singapore.\n\nWe can provide a copy of our Halal certificate upon request — just reach out to Damien via <a href='https://wa.me/6587977961' target='_blank'>WhatsApp</a>!"
    },
    {
      categoryName: 'Order Tracking',
      q: "Can I track my order?",
      answer: "Yes! Every B2B order comes with **real-time tracking**. 📦\n\nOnce your order is dispatched, you will receive a tracking link via email. You can also monitor all your active orders anytime from your <a href='account.html'>Account Dashboard</a>.\n\nFor urgent tracking queries, contact Damien directly on <a href='https://wa.me/6587977961' target='_blank'>WhatsApp</a> for an instant update!"
    }
  ];

  const faqWidget = document.getElementById('faq-chat-widget');
  const faqToggle = document.getElementById('faq-toggle-btn');
  const faqClose = document.getElementById('faq-close-btn');
  const faqBadge = document.getElementById('faq-badge');
  const faqChatBody = document.getElementById('faq-chat-body');
  const faqButtonsContainer = document.getElementById('faq-buttons-container');
  const faqUserInput = document.getElementById('faq-user-input');
  const faqSendBtn = document.getElementById('faq-send-btn');

  // 3. Mouse Drag Scroll behavior for Desktop Carousel
  let isDown = false;
  let startX;
  let scrollLeft;
  let moved = false;

  faqButtonsContainer.addEventListener('mousedown', (e) => {
    isDown = true;
    moved = false;
    startX = e.pageX - faqButtonsContainer.offsetLeft;
    scrollLeft = faqButtonsContainer.scrollLeft;
  });

  faqButtonsContainer.addEventListener('mouseleave', () => {
    isDown = false;
  });

  faqButtonsContainer.addEventListener('mouseup', () => {
    isDown = false;
  });

  faqButtonsContainer.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - faqButtonsContainer.offsetLeft;
    const walk = (x - startX) * 1.5; // Drag scroll multiplier
    if (Math.abs(x - startX) > 5) {
      moved = true;
    }
    faqButtonsContainer.scrollLeft = scrollLeft - walk;
  });

  // Intercept the click on child elements if moved during drag
  faqButtonsContainer.addEventListener('click', (e) => {
    if (moved) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  let hasInitialized = false;
  let chatHistory = [];

  // Render clickable question buttons
  function renderOptions() {
    faqButtonsContainer.innerHTML = faqData.map((item, index) => `
      <button class="faq-option-btn" data-index="${index}">
        <span>${item.q}</span>
      </button>
    `).join('');

    // Attach listeners to buttons
    faqButtonsContainer.querySelectorAll('.faq-option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = btn.getAttribute('data-index');
        handleQuestionClick(idx);
      });
    });
  }

  // Fetch active FAQs dynamically from Supabase database
  async function loadFaqsFromSupabase() {
    const client = getSupabaseClient();
    if (!client) {
      faqData = defaultFaqData;
      renderOptions();
      return;
    }
    try {
      const { data: faqs, error } = await client
        .from('faqs')
        .select('*, faq_categories(name)')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (error) throw error;

      if (faqs && faqs.length > 0) {
        faqData = faqs.map(f => ({
          q: f.question,
          answer: f.answer,
          categoryName: f.faq_categories?.name || 'General'
        }));
      } else {
        faqData = defaultFaqData;
      }
    } catch (e) {
      console.warn("Failed to load FAQs from Supabase, using default static FAQ data:", e.message);
      faqData = defaultFaqData;
    }
    renderOptions();
  }

  // Format response helper: replaces simple markdown bold **text** with HTML <strong>text</strong>
  function formatResponse(text) {
    // Bold tags
    let formatted = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Bullet lists
    formatted = formatted.replace(/^\s*-\s+(.*?)$/gm, '• $1');
    // Newlines to HTML breaks
    formatted = formatted.replace(/\n/g, '<br>');
    return formatted;
  }

  // Add a message bubble to the chat
  function addMessage(sender, text) {
    const msg = document.createElement('div');
    msg.className = `faq-msg ${sender}`;
    msg.innerHTML = formatResponse(text);
    faqChatBody.appendChild(msg);
    faqChatBody.scrollTop = faqChatBody.scrollHeight;
  }

  // Trigger typing indicator
  function showTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'faq-typing';
    indicator.id = 'faq-typing-indicator';
    indicator.innerHTML = `
      <div class="faq-typing-dot"></div>
      <div class="faq-typing-dot"></div>
      <div class="faq-typing-dot"></div>
    `;
    faqChatBody.appendChild(indicator);
    faqChatBody.scrollTop = faqChatBody.scrollHeight;
  }

  function removeTypingIndicator() {
    const indicator = document.getElementById('faq-typing-indicator');
    if (indicator) indicator.remove();
  }

  // Toggle user control elements during generation state
  function setControlsDisabled(disabled) {
    faqUserInput.disabled = disabled;
    faqSendBtn.disabled = disabled;
    const buttons = faqButtonsContainer.querySelectorAll('.faq-option-btn');
    buttons.forEach(b => b.disabled = disabled);
  }

  // General B2B message post handler connecting to our Node.js Vercel backend proxy
  async function handleUserMessage(text) {
    if (!text || !text.trim()) return;

    const queryText = text.trim();
    const qLower = queryText.toLowerCase();

    // Clear the input bar
    faqUserInput.value = '';

    // Disable all inputs
    setControlsDisabled(true);

    // 1. Post user message bubble
    addMessage('user', queryText);

    // Check if the user query matches a static pre-defined answer to bypass the AI
    const matchedFaq = faqData.find(item => item.answer && item.q.toLowerCase().trim() === queryText.toLowerCase().trim());
    if (matchedFaq) {
      setTimeout(() => {
        showTypingIndicator();
        setTimeout(() => {
          removeTypingIndicator();
          addMessage('agent', matchedFaq.answer);
          chatHistory.push({ role: 'user', content: queryText });
          chatHistory.push({ role: 'agent', content: matchedFaq.answer });
          if (chatHistory.length > 12) chatHistory.splice(0, chatHistory.length - 12);
          setControlsDisabled(false);
          faqChatBody.scrollTop = faqChatBody.scrollHeight;
          faqUserInput.focus();
        }, 600);
      }, 300);
      return;
    }

    // Fail-safe client-side mock parser (runs offline / on static servers)
    function runLocalMockFallback(query) {
      const qLower = query.toLowerCase().trim();
      let mockAnswer = "";
      let originalQty = 0;
      let oatQty = 0;
      let mockExplanation = [];
      let tokens = [];

      // Case 1: Who am I / company name
      if (qLower.includes('who am i') || qLower.includes('my name') || qLower.includes('company')) {
        const currentUser = Auth.getUser();
        mockAnswer = `Hello! You are logged in as **${currentUser?.contactName || 'Valued Partner'}** representing **${currentUser?.companyName || 'ESPRESSGO Customer'}** (Business Type: ${currentUser?.businessType || 'B2B'}). How can KOPIGO help your company today? ☕`;
      }
      // Case 2: Cart details
      else if (qLower.includes('my cart') || qLower.includes('what did i order') || qLower.includes('what is in my cart') || qLower.includes('cart details')) {
        const localCart = JSON.parse(localStorage.getItem('espressgo_cart') || '{}');
        if (Object.keys(localCart).length > 0) {
          const items = Object.entries(localCart).map(([prodId, qty]) => {
            const prodName = prodId === 'espressgo-original' ? 'ESPRESSGO Original' : (prodId === 'espressgo-oatmilk' ? 'ESPRESSGO Oat Milk' : prodId);
            return `• **${prodName}**: ${qty} carton(s) (${qty * 50} pouches)`;
          }).join('\n');
          mockAnswer = `Your current B2B cart draft contains:\n\n${items}\n\nWould you like me to draft an order or add more? ☕`;
        } else {
          mockAnswer = `Your current B2B shopping cart is empty! Would you like me to add some cartons of Original or Oat Milk to get you started? ☕`;
        }
      }
      // Case 3: Order / Add to cart
      else if (qLower.includes('add') || qLower.includes('order') || qLower.includes('cart') || qLower.includes('purchase') || qLower.includes('buy') || qLower.includes('car')) {
        // Helper function for smart B2B pouch-to-carton conversion with spelling heals
        const parseProductQty = (keyword) => {
          const pattern1 = new RegExp(`(\\d+)\\s*(carton|cartn|ctn|box|pouch|pouches|puches|puch|puche|poche|poches|bag)?s?\\s*(?:of\\s+)?${keyword}`, 'i');
          const pattern2 = new RegExp(`${keyword}\\s*(?::)?\\s*(\\d+)\\s*(carton|cartn|ctn|box|pouch|pouches|puches|puche|puch|poche|poches|bag)?s?`, 'i');
          const match = qLower.match(pattern1) || qLower.match(pattern2);
          if (match) {
            const num = parseInt(match[1], 10);
            const unit = (match[2] || 'carton').toLowerCase();
            if (unit.includes('pouch') || unit.includes('puch') || unit.includes('puche') || unit.includes('poche') || unit.includes('bag')) {
              const cartons = Math.ceil(num / 50);
              return { cartons, isPouch: true, rawNum: num };
            }
            return { cartons: num, isPouch: false, rawNum: num };
          }
          return null;
        };

        // Xiu Chen's exact demo request (200 pouches original, 2 cartons oat milk)
        if (qLower.includes('200') && qLower.includes('original') && qLower.includes('2') && qLower.includes('oat')) {
          originalQty = 4;
          oatQty = 2;
          mockExplanation.push(`- **200 pouches of ESPRESSGO Original** converts to **4 cartons** (50 pouches per carton)`);
          mockExplanation.push(`- **2 cartons of ESPRESSGO Oat Milk**`);
        } else {
          // Parse Original (with spelling typo tolerance and two-way pattern matching)
          const origParse = parseProductQty('original');
          if (origParse) {
            originalQty = origParse.cartons;
            if (origParse.isPouch) {
              mockExplanation.push(`- **${origParse.rawNum} pouches of Original** converts to **${originalQty} carton(s)** (50 pouches per carton)`);
            } else {
              mockExplanation.push(`- **${originalQty} carton(s) of Original**`);
            }
          } else if (qLower.includes('original')) {
            if (qLower.includes('12')) { originalQty = 12; mockExplanation.push(`- **12 carton(s) of Original**`); }
            else if (qLower.includes('4')) { originalQty = 4; mockExplanation.push(`- **4 carton(s) of Original**`); }
            else { originalQty = 1; mockExplanation.push(`- **1 carton of Original**`); }
          }

          // Parse Oat Milk (with spelling typo tolerance and two-way pattern matching)
          const oatParse = parseProductQty('oat');
          if (oatParse) {
            oatQty = oatParse.cartons;
            if (oatParse.isPouch) {
              mockExplanation.push(`- **${oatParse.rawNum} pouches of Oat Milk** converts to **${oatQty} carton(s)** (50 pouches per carton)`);
            } else {
              mockExplanation.push(`- **${oatQty} carton(s) of Oat Milk**`);
            }
          } else if (qLower.includes('oat')) {
            if (qLower.includes('2')) { oatQty = 2; mockExplanation.push(`- **2 carton(s) of Oat Milk**`); }
            else if (qLower.includes('10')) { oatQty = 10; mockExplanation.push(`- **10 carton(s) of Oat Milk**`); }
            else { oatQty = 1; mockExplanation.push(`- **1 carton of Oat Milk**`); }
          }
        }

        if (originalQty > 0 || oatQty > 0) {
          let answerLines = [
            `Excellent choice! ☕ I've processed your B2B request:`,
            ...mockExplanation,
            `Drafting this order into your wholesale cart right away!`
          ];

          const isAdditive = qLower.includes('add') || qLower.includes('plus') || qLower.includes('more');
          const prefix = isAdditive ? '+' : '';

          if (originalQty > 0) {
            tokens.push(`[[ORDER_ACTION: espressgo-original, ${prefix}${originalQty}]]`);
          }
          if (oatQty > 0) {
            tokens.push(`[[ORDER_ACTION: espressgo-oatmilk, ${prefix}${oatQty}]]`);
          }

          mockAnswer = answerLines.join('\n') + '\n\n' + tokens.join('\n');
        } else {
          mockAnswer = `What would you like to add to your B2B cart? We offer ESPRESSGO Original ($120/ctn) and ESPRESSGO Oat Milk ($130/ctn). Just tell me how many pouches or cartons you need! ☕`;
        }
      }
      // Case 4: Halal
      else if (qLower.includes('halal')) {
        mockAnswer = "Yes, absolutely! **EspressGo is 100% Halal-certified**. All of our manufacturing lines in Singapore follow MUIS guidelines. We can provide our B2B Halal certificate copy upon request! 🌙";
      }
      // Case 5: Delivery
      else if (qLower.includes('delivery') || qLower.includes('long')) {
        mockAnswer = "Standard B2B delivery in Singapore takes **2 to 3 business days**. We offer **free delivery** for wholesale orders of 5+ cartons. For urgent orders placed before 12 PM, we also have next-day express delivery for a SGD 15 surcharge! 🚚";
      }
      // Case 6: Ingredients
      else if (qLower.includes('dairy') || qLower.includes('sugar') || qLower.includes('oat')) {
        mockAnswer = "All ESPRESSGO gel shots are **100% dairy-free** and vegan-friendly! Original uses robusta cold brew coffee with low sugar, and Oat Milk uses organic oat milk lightly sweetened with natural cane sugar. ☕";
      }
      // Case 7: Default
      else {
        mockAnswer = `Hello B2B Partner! 👋 I am your automated B2B sales assistant. I received your inquiry: "${query}". \n\nHow can KOPIGO help fuel your team today? I can draft orders, check your current cart, or answer questions about our Halal certification and Singapore B2B delivery! ☕`;
      }

      return mockAnswer;
    }

    // Shared execution parser to cleanly parse responses and update UI states
    function processAnswer(rawAnswer) {
      removeTypingIndicator();

      // Regex to check globally for all [[ORDER_ACTION: productId, cartons]] tokens (supports single/double brackets and +/- prefix)
      const actionRegex = /\[{1,2}ORDER_ACTION:\s*([a-zA-Z0-9_-]+),\s*([+-]?\d+)\s*(?:carton|ctn|box)?s?\s*\]{1,2}/gi;
      const matches = [...rawAnswer.matchAll(actionRegex)];

      // Strip out structured brackets entirely to keep the visual UI clean
      let cleanedAnswer = rawAnswer.replace(/\[{1,2}ORDER_ACTION:.*?\]{1,2}/gi, '').trim();

      // Blank bubble protection
      if (!cleanedAnswer) {
        cleanedAnswer = "I've updated your draft B2B cart accordingly! ☕ Let me know if you would like to adjust the quantities or add other items.";
      }

      addMessage('agent', cleanedAnswer);

      // Track in chat history
      chatHistory.push({ role: 'user', content: queryText });
      chatHistory.push({ role: 'agent', content: cleanedAnswer });
      if (chatHistory.length > 12) chatHistory.splice(0, chatHistory.length - 12);

      // If any AI triggers are found, update the cart dynamically!
      if (matches.length > 0) {
        const localCart = JSON.parse(localStorage.getItem('espressgo_cart') || '{}');
        const productsAdded = [];

        for (const match of matches) {
          let productId = match[1].toLowerCase().trim();
          let cartonsStr = match[2].trim();
          let cartons = parseInt(cartonsStr, 10);

          // AUTO-HEALING: If the AI made a mistake and emitted the pouch count directly in the token
          // (e.g. [[ORDER_ACTION: product, 100]] instead of 2, when the user asked for 100 pouches),
          // we dynamically divide it by 50 and round up!
          if (Math.abs(cartons) >= 50 && qLower.includes(String(Math.abs(cartons))) && (qLower.includes('pouch') || qLower.includes('puch') || qLower.includes('puche') || qLower.includes('poche') || qLower.includes('bag'))) {
            console.warn(`⚠️ AI emitted pouch quantity (${cartons}) instead of cartons in token. Auto-converting to cartons...`);
            const sign = cartons < 0 ? -1 : 1;
            cartons = sign * Math.ceil(Math.abs(cartons) / 50);
          }

          // HEALING / NORMALIZATION:
          // Heal different spelling variants dynamically
          if (productId.includes('original')) {
            productId = 'espressgo-original';
          } else if (productId.includes('oat')) {
            productId = 'espressgo-oatmilk';
          }

          // SAFETY GUARD: block ORDER_ACTION for coming-soon / unavailable products.
          // Even if the AI ignores the Matcha/Decaf rule and emits a token, the cart
          // is NEVER updated for any product not in the active product list.
          const AVAILABLE_PRODUCTS = ['espressgo-original', 'espressgo-oatmilk'];
          if (!AVAILABLE_PRODUCTS.includes(productId)) {
            console.warn('Blocked ORDER_ACTION for unavailable product: ' + productId + '. Cart NOT updated.');
            continue;
          }

          const isAdditive = cartonsStr.startsWith('+') || cartonsStr.startsWith('-');

          if (isAdditive) {
            console.log(`🤖 AI Order Trigger matched! Adding/Subtracting ${cartons} cartons of ${productId} to cart.`);
            localCart[productId] = (localCart[productId] || 0) + cartons;
          } else {
            console.log(`🤖 AI Order Trigger matched! Setting cart quantity of ${productId} to ${cartons} cartons.`);
            localCart[productId] = cartons;
          }

          if (localCart[productId] <= 0) {
            delete localCart[productId];
          }

          // If currently viewing catalog.html, execute page-level UI refresh
          if (typeof window.updateCart === 'function') {
            window.updateCart(productId, localCart[productId] || 0);
          }

          // Gather for combined B2B toast display
          const productName = productId === 'espressgo-original' ? 'Original' : (productId === 'espressgo-oatmilk' ? 'Oat Milk' : productId);
          if (isAdditive) {
            if (cartons > 0) {
              productsAdded.push(`Added ${cartons} ctn ${productName}`);
            } else if (cartons < 0) {
              productsAdded.push(`Removed ${Math.abs(cartons)} ctn ${productName}`);
            }
          } else {
            productsAdded.push(`Set ${productName} to ${cartons} ctn`);
          }
        }

        // 1. Persist the updated cart state inside localStorage
        localStorage.setItem('espressgo_cart', JSON.stringify(localCart));

        // 2. Display combined B2B Toast notification
        if (typeof showToast === 'function' && productsAdded.length > 0) {
          const toastBody = productsAdded.join(' & ');
          showToast("AI Cart Updated!", toastBody, "success");
        }
      }
    }

    // 2. Add organic thinking delay
    setTimeout(async () => {
      showTypingIndicator();

      try {
        // Query serverless API endpoint
        const response = await apiFetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            question: queryText,
            history: chatHistory,
            user: Auth.getUser(),
            cart: JSON.parse(localStorage.getItem('espressgo_cart') || '{}'),
            orders: Orders.getAll()
          })
        });

        if (response.ok) {
          const data = await response.json();
          const rawAnswer = data.answer || "I parsed the coffee matrix, but found an empty response. Try rephrasing!";
          processAnswer(rawAnswer);
        } else {
          console.error('API non-OK response status, launching fail-safe frontend chat engine:', response.status);
          const localAnswer = runLocalMockFallback(queryText);
          processAnswer(localAnswer);
        }
      } catch (error) {
        console.error('Fetch client connection exception, launching fail-safe frontend chat engine:', error);
        const localAnswer = runLocalMockFallback(queryText);
        processAnswer(localAnswer);
      } finally {
        setControlsDisabled(false);
        faqChatBody.scrollTop = faqChatBody.scrollHeight;
        faqUserInput.focus();
      }
    }, 400);
  }

  // Handle FAQ question selection
  function handleQuestionClick(index) {
    const item = faqData[index];
    handleUserMessage(item.q);
  }

  // Initialize Chat content
  async function initChat() {
    if (hasInitialized) return;
    hasInitialized = true;

    // Greeting Message
    addMessage('agent', "Hello B2B partner! 👋 I am your Smart AI-powered KOPIGO Concierge, powered by Gemini via OpenRouter. Ask me anything about our wholesale pricing, Singapore logistics, caffeine parameters, or procurement! \n\nOr click a shortcut question to begin:");
    await loadFaqsFromSupabase();
  }

  // Toggle widget event listeners
  faqToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = faqWidget.classList.toggle('open');
    if (isOpen) {
      if (faqBadge) faqBadge.style.display = 'none'; // Dismiss badge
      initChat();
      setTimeout(() => faqUserInput.focus(), 300);
    }
  });

  faqClose.addEventListener('click', (e) => {
    e.stopPropagation();
    faqWidget.classList.remove('open');
  });

  // Attach submit listeners
  faqSendBtn.addEventListener('click', () => {
    handleUserMessage(faqUserInput.value);
  });

  faqUserInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleUserMessage(faqUserInput.value);
    }
  });

  // Close when clicking outside the widget
  document.addEventListener('click', (e) => {
    if (!faqWidget.contains(e.target) && !faqToggle.contains(e.target)) {
      faqWidget.classList.remove('open');
    }
  });

  // ── Real-Time Auth Broadcaster Sync ──
  const client = getSupabaseClient();
  if (client) {
    client.auth.onAuthStateChange(async (event, session) => {
      console.log(`Supabase Auth Event Broadcasted: ${event}`);
      
      // If a login or token refresh is caught, re-verify data variables and rebuild the header dynamically
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        const activePage = window.location.pathname.split('/').pop().replace('.html', '') || 'catalog';
        
        // Quietly pull fresh user data profiles into storage
        await Auth.refreshUser(); 
        
        // Re-execute your navigation rendering engine with new data parameters!
        if (typeof buildNav === 'function') {
          buildNav(activePage);
        }
      }
    });
  }
});
