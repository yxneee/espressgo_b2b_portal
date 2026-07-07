/* ============================================================
   admin-dashboard.js — Supabase admin dashboard
   Depends on:
   - ../supabase-config.js
   - ../shared.js

   Uses:
   - Auth
   - Orders
   - Products
   - showToast
   - escapeHTML

   This file:
   - Checks admin login
   - Loads orders from Supabase
   - Loads profiles from Supabase
   - Loads feedback from Supabase
   - Updates order fulfilment status
   ============================================================ */


/* ============================================================
   Page state
   ============================================================ */

let currentAdmin = null;

let adminOrders = [];
let adminProfiles = [];
let adminFeedback = [];
let adminProducts = [];
let adminProductTiers = [];
let adminFaqCategories = [];
let adminFaqs = [];


/* ============================================================
   DOM helpers
   ============================================================ */

function setAdminLoading(isLoading) {
  const loadingEl = document.getElementById('admin-loading');
  const contentEl = document.getElementById('admin-content');

  if (loadingEl) {
    loadingEl.style.display = isLoading ? 'block' : 'none';
  }

  if (contentEl) {
    contentEl.style.display = isLoading ? 'none' : 'block';
  }
}


/* ============================================================
   Admin auth guard
   ============================================================ */

async function requireAdmin() {
  const profile = await Auth.refreshUser();

  if (!profile || profile.role !== 'admin') {
    localStorage.removeItem('espressgo_admin');
    window.location.href = '../login.html';
    return null;
  }

  localStorage.setItem('espressgo_admin', 'true');

  currentAdmin = profile;

  const adminEmailLabel = document.getElementById('admin-email-label');

  if (adminEmailLabel) {
    adminEmailLabel.textContent = profile.email || 'Admin';
  }

  return profile;
}


/* ============================================================
   Admin logout
   ============================================================ */

async function adminLogout() {
  localStorage.removeItem('espressgo_admin');

  await Auth.logout();

  window.location.href = '../login.html';
}

window.adminLogout = adminLogout;


/* ============================================================
   Panel navigation
   ============================================================ */

function showPanel(name, btn) {
  document.querySelectorAll('.panel').forEach(panel => {
    panel.classList.remove('active');
  });

  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.classList.remove('active');
  });

  const selectedPanel = document.getElementById('panel-' + name);

  if (selectedPanel) {
    selectedPanel.classList.add('active');
  }

  if (btn) {
    btn.classList.add('active');
  }
}

window.showPanel = showPanel;


/* ============================================================
   Status badge styles
   ============================================================ */

const statusStyles = {
  pending: {
    bg: '#fffbeb',
    border: '#fde68a',
    color: '#92400e',
    dot: '🟡'
  },

  processing: {
    bg: '#eff6ff',
    border: '#bfdbfe',
    color: '#1d4ed8',
    dot: '🔵'
  },

  shipped: {
    bg: '#f5f3ff',
    border: '#ddd6fe',
    color: '#5b21b6',
    dot: '🟣'
  },

  delivered: {
    bg: '#f0fdf4',
    border: '#bbf7d0',
    color: '#15803d',
    dot: '🟢'
  }
};


/**
 * Returns HTML status pill for order status.
 */
function statusPill(status) {
  const cleanStatus = status || 'pending';
  const style = statusStyles[cleanStatus] || statusStyles.pending;

  const label =
    cleanStatus.charAt(0).toUpperCase() + cleanStatus.slice(1);

  return `
    <span
      class="status-pill"
      style="
        background:${style.bg};
        border-color:${style.border};
        color:${style.color};
      ">
      ${style.dot} ${escapeHTML(label)}
    </span>
  `;
}


/**
 * Status progression.
 */
const nextStatuses = {
  pending: 'processing',
  processing: 'shipped',
  shipped: 'delivered',
  delivered: 'delivered'
};


/* ============================================================
   Load Supabase data
   ============================================================ */

async function loadAdminData() {
  try {
    adminOrders = await Orders.getAll();
  } catch (error) {
    console.error('Failed to load orders:', error);
    adminOrders = [];
    showToast('Could not load orders', error.message || 'Check admin role/RLS permissions.', 'error');
  }

  try {
    const { data: profiles, error: profileError } = await sb
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (profileError) throw profileError;
    adminProfiles = profiles || [];
  } catch (error) {
    console.error('Failed to load profiles:', error);
    adminProfiles = [];
    showToast('Could not load users', error.message || 'Check admin role/RLS permissions.', 'error');
  }

  try {
    const { data: feedback, error: feedbackError } = await sb
      .from('feedback')
      .select('*')
      .order('created_at', { ascending: false });

    if (feedbackError) throw feedbackError;
    adminFeedback = feedback || [];
  } catch (error) {
    console.error('Failed to load feedback:', error);
    adminFeedback = [];
    showToast('Could not load feedback', error.message || 'Check admin role/RLS permissions.', 'error');
  }

  try {
    const { data: productsData, error: prodError } = await sb
      .from('products')
      .select('*')
      .order('created_at', { ascending: true });

    if (prodError) throw prodError;
    adminProducts = productsData || [];
  } catch (error) {
    console.error('Failed to load products:', error);
    adminProducts = [];
    showToast('Could not load products', error.message || 'Check RLS permissions.', 'error');
  }

  try {
    const { data: tiersData, error: tiersError } = await sb
      .from('product_tiers')
      .select('*')
      .order('min_quantity', { ascending: true });

    if (tiersError) throw tiersError;
    adminProductTiers = tiersData || [];
  } catch (error) {
    console.error('Failed to load product tiers:', error);
    adminProductTiers = [];
  }

  try {
    const { data: catData, error: catError } = await sb
      .from('faq_categories')
      .select('*')
      .order('display_order', { ascending: true });

    if (catError) throw catError;
    adminFaqCategories = catData || [];
  } catch (error) {
    console.error('Failed to load FAQ categories:', error);
    adminFaqCategories = [];
  }

  try {
    const { data: faqData, error: faqError } = await sb
      .from('faqs')
      .select('*, faq_categories(name)')
      .order('display_order', { ascending: true });

    if (faqError) throw faqError;
    adminFaqs = faqData || [];
  } catch (error) {
    console.error('Failed to load FAQs:', error);
    adminFaqs = [];
  }
}

/* ============================================================
   Refresh admin data
   ============================================================ */

async function refreshAdminData() {
  setAdminLoading(true);
  await loadAdminData();

  renderDashboard();
  renderOrders();
  renderUsers();
  renderProducts();
  renderFeedback();
  renderFaqs();
  loadAdminSubscriptions();

  setAdminLoading(false);
  showToast('Dashboard refreshed', 'Latest Supabase data loaded.');
}

window.refreshAdminData = refreshAdminData;

/* ============================================================
   Dashboard panel
   ============================================================ */

function renderDashboard() {
  const all = adminOrders;
  const total = all.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
  const pending = all.filter(order => order.status === 'pending').length;
  const feedbackCount = adminFeedback.length;

  const dateEl = document.getElementById('dash-date');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('en-SG', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  const statRow = document.getElementById('stat-row');
  if (statRow) {
    statRow.innerHTML = [
      ['📦', 'Total Orders', all.length, 'all time'],
      ['💰', 'Revenue', 'SGD $' + total.toFixed(2), 'gross'],
      ['⏳', 'Pending', pending, 'awaiting'],
      ['⭐', 'Feedback', feedbackCount, 'messages']
    ].map(([icon, label, value, sub]) => `
      <div class="stat-mini">
        <div class="stat-mini-label">${icon} ${escapeHTML(label)}</div>
        <div class="stat-mini-val">${escapeHTML(value)}</div>
        <div class="stat-mini-sub">${escapeHTML(sub)}</div>
      </div>
    `).join('');
  }

  const body = document.getElementById('dash-orders-body');
  if (!body) return;

  body.innerHTML = all.slice(0, 10).map(order => `
    <tr>
      <td style="color:var(--brown);font-weight:500;">#${escapeHTML(order.id)}</td>
      <td>${escapeHTML(order.company || '—')}</td>
      <td>${Number(order.totalCartons || 0)}</td>
      <td>SGD $${Number(order.totalAmount || 0).toFixed(2)}</td>
      <td>${statusPill(order.status)}</td>
      <td>${order.dateOrdered ? new Date(order.dateOrdered).toLocaleDateString('en-SG') : '—'}</td>
    </tr>
  `).join('') || `
    <tr>
      <td colspan="6" style="text-align:center;padding:2rem;color:var(--muted-lt);">No orders yet</td>
    </tr>
  `;
}

/* ============================================================
   Orders fulfilment panel
   ============================================================ */

function renderOrders() {
  filterOrdersTable();
}

function filterOrdersTable() {
  const tbody = document.getElementById('orders-body');
  if (!tbody) return;

  const searchQuery = (document.getElementById('orders-search')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('orders-filter-status')?.value || 'all';

  let filtered = adminOrders;

  if (statusFilter !== 'all') {
    filtered = filtered.filter(o => o.status === statusFilter);
  }

  if (searchQuery) {
    filtered = filtered.filter(o => 
      o.id.toLowerCase().includes(searchQuery) ||
      (o.company || '').toLowerCase().includes(searchQuery) ||
      (o.contactName || '').toLowerCase().includes(searchQuery)
    );
  }

  tbody.innerHTML = filtered.map(order => `
    <tr style="cursor:pointer;" onclick="openOrderDetailsModal('${escapeHTML(order.id)}')">
      <td style="color:var(--brown);font-weight:500;">#${escapeHTML(order.id)}</td>
      <td>${escapeHTML(order.company || '—')}</td>
      <td>${escapeHTML(order.businessType || '—')}</td>
      <td>${Number(order.totalCartons || 0)}</td>
      <td>SGD $${Number(order.totalAmount || 0).toFixed(2)}</td>
      <td>${statusPill(order.status)}</td>
      <td onclick="event.stopPropagation()">
        ${
          order.status !== 'delivered'
            ? `
              <button
                onclick="advanceOrder('${escapeHTML(order.id)}')"
                class="btn-amber btn-sm"
                type="button">
                → ${escapeHTML(nextStatuses[order.status] || 'processing')}
              </button>
            `
            : `
              <span style="color:var(--muted-lt);font-size:12px;">✓ Done</span>
            `
        }
      </td>
    </tr>
  `).join('') || `
    <tr>
      <td colspan="7" style="text-align:center;padding:2rem;color:var(--muted-lt);">No matching orders found</td>
    </tr>
  `;
}

async function openOrderDetailsModal(orderId) {
  const order = adminOrders.find(o => String(o.id) === String(orderId));
  if (!order) return;

  document.getElementById('details-modal-title').textContent = `Order Details — #${order.id}`;
  document.getElementById('details-company').textContent = order.company || '—';
  document.getElementById('details-contact').textContent = order.contactName || '—';
  document.getElementById('details-biz-type').textContent = order.businessType || '—';
  document.getElementById('details-address').textContent = order.deliveryAddress || '—';
  document.getElementById('details-status').innerHTML = statusPill(order.status);
  document.getElementById('details-date').textContent = order.dateOrdered ? new Date(order.dateOrdered).toLocaleString('en-SG') : '—';
  document.getElementById('details-notes').textContent = order.notes || 'No special notes.';
  document.getElementById('details-total-price').textContent = `SGD $${Number(order.totalAmount || 0).toFixed(2)}`;

  // Payment details
  const methodText = order.paymentMethod === 'credit' ? `Credit (${escapeHTML(order.creditTerms || 'Net 30')})` : 'Pay Online (Card)';
  const statusText = order.paymentStatus === 'paid' ? 'Paid ✅' : 'Unpaid ❌';
  document.getElementById('details-payment-method').innerHTML = `<span style="font-weight:600;color:var(--brown);">${methodText}</span>`;
  document.getElementById('details-payment-status').innerHTML = `<span class="status-pill" style="background:${order.paymentStatus === 'paid' ? '#f0fdf4;border-color:#bbf7d0;color:#15803d;' : '#fef2f2;border-color:#fecaca;color:#b91c1c;'}">${statusText}</span>`;

  // Action to mark credit order as paid
  const actionContainer = document.getElementById('details-credit-action-container');
  if (actionContainer) {
    if (order.paymentMethod === 'credit' && order.paymentStatus === 'unpaid') {
      actionContainer.innerHTML = `
        <button onclick="markOrderAsPaid('${order.id}')" class="btn-amber btn-sm" type="button" style="border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;">
          Mark as Paid
        </button>
      `;
    } else {
      actionContainer.innerHTML = '';
    }
  }

  const tbody = document.getElementById('details-items-body');
  if (tbody) {
    if (order.items && order.items.length > 0) {
      tbody.innerHTML = order.items.map(item => `
        <tr>
          <td style="color:var(--brown);">${escapeHTML(item.name || '—')}</td>
          <td>${escapeHTML(item.sku || '—')}</td>
          <td style="text-align:center;">${item.cartons || item.qty || 0}</td>
          <td style="text-align:right;">SGD $${Number(item.pricePerCarton || item.price || 0).toFixed(2)}</td>
          <td style="text-align:right;">SGD $${(Number(item.cartons || item.qty || 0) * Number(item.pricePerCarton || item.price || 0)).toFixed(2)}</td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted-lt);">No item breakdown.</td></tr>`;
    }
  }

  document.getElementById('order-details-modal').classList.add('open');
}

function closeOrderDetailsModal() {
  document.getElementById('order-details-modal').classList.remove('open');
}

async function advanceOrder(id) {
  const order = adminOrders.find(o => String(o.id) === String(id));
  if (!order) {
    showToast('Order not found', 'Could not find selected order.', 'error');
    return;
  }

  const oldStatus = order.status || 'pending';
  const newStatus = nextStatuses[oldStatus] || oldStatus;

  if (oldStatus === 'delivered') {
    showToast('Already delivered', `Order #${id} is already complete.`);
    return;
  }

  try {
    await Orders.updateStatus(id, newStatus);
    order.status = newStatus;

    renderOrders();
    renderDashboard();
    showToast('Order updated', `#${id} → ${newStatus}`);
  } catch (error) {
    console.error('Failed to update order status:', error);
    showToast('Update failed', error.message || 'Could not update order status.', 'error');
  }
}

window.advanceOrder = advanceOrder;
window.filterOrdersTable = filterOrdersTable;
window.openOrderDetailsModal = openOrderDetailsModal;
window.closeOrderDetailsModal = closeOrderDetailsModal;

/* ============================================================
   Users panel
   ============================================================ */

function renderUsers() {
  filterUsersTable();
  filterBillingUsersTable();
}

function filterUsersTable() {
  const tbody = document.getElementById('users-body');
  if (!tbody) return;

  const searchQuery = (document.getElementById('users-search')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('users-filter-status')?.value || 'all';

  let filtered = adminProfiles;

  if (statusFilter !== 'all') {
    filtered = filtered.filter(p => (p.approval_status || 'approved') === statusFilter);
  }

  if (searchQuery) {
    filtered = filtered.filter(p => 
      (p.email || '').toLowerCase().includes(searchQuery) ||
      (p.company_name || '').toLowerCase().includes(searchQuery)
    );
  }

  tbody.innerHTML = filtered.map(profile => {
    const role = profile.role || 'buyer';
    const regStatus = profile.approval_status || 'approved';

    let statusBadge = '';
    if (regStatus === 'approved') {
      statusBadge = `<span class="status-pill" style="background:#f0fdf4;border-color:#bbf7d0;color:#15803d;">✅ Approved</span>`;
    } else if (regStatus === 'rejected') {
      statusBadge = `<span class="status-pill" style="background:#fef2f2;border-color:#fecaca;color:#b91c1c;">❌ Rejected</span>`;
    } else {
      statusBadge = `<span class="status-pill" style="background:#fffbeb;border-color:#fde68a;color:#92400e;">🟡 Pending</span>`;
    }

    let actions = '';
    if (role !== 'admin') {
      if (regStatus === 'pending') {
        actions = `
          <button class="btn-ghost btn-sm" onclick="setUserApproval('${profile.id}', 'approved')" style="color:#15803d;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:6px;padding:3px 8px;cursor:pointer;margin-right:4px;">Approve Account</button>
          <button class="btn-ghost btn-sm" onclick="setUserApproval('${profile.id}', 'rejected')" style="color:#b91c1c;border:1px solid #fecaca;background:#fef2f2;border-radius:6px;padding:3px 8px;cursor:pointer;">Reject Account</button>
        `;
      } else if (regStatus === 'approved') {
        actions = `
          <button class="btn-ghost btn-sm" onclick="setUserApproval('${profile.id}', 'rejected')" style="color:#b91c1c;border:1px solid #fecaca;background:#fef2f2;border-radius:6px;padding:3px 8px;cursor:pointer;">Reject Account</button>
        `;
      } else {
        actions = `
          <button class="btn-ghost btn-sm" onclick="setUserApproval('${profile.id}', 'approved')" style="color:#15803d;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:6px;padding:3px 8px;cursor:pointer;">Approve Account</button>
        `;
      }
    } else {
      actions = `<span style="color:var(--muted-lt);font-size:12px;">🛡 Host</span>`;
    }

    return `
      <tr>
        <td>${escapeHTML(profile.email || '—')}</td>
        <td>${escapeHTML(profile.company_name || '—')}</td>
        <td>${escapeHTML(profile.business_type || '—')}</td>
        <td style="text-transform: capitalize;">${escapeHTML(role)}</td>
        <td>${role === 'admin' ? '<span class="status-pill" style="background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;">🛡 Admin</span>' : statusBadge}</td>
        <td style="text-align:right;white-space:nowrap;">${actions}</td>
      </tr>
    `;
  }).join('') || `
    <tr>
      <td colspan="6" style="text-align:center;padding:2rem;color:var(--muted-lt);">No registered users found</td>
    </tr>
  `;
}

function filterBillingUsersTable() {
  const tbody = document.getElementById('billing-users-body');
  if (!tbody) return;

  const searchQuery = (document.getElementById('billing-users-search')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('billing-users-filter-status')?.value || 'all';

  let filtered = adminProfiles;

  // Filter out admins from the billing list since admins don't have credit accounts
  filtered = filtered.filter(p => p.role !== 'admin');

  if (statusFilter !== 'all') {
    filtered = filtered.filter(p => (p.credit_status || 'none') === statusFilter);
  }

  if (searchQuery) {
    filtered = filtered.filter(p => 
      (p.email || '').toLowerCase().includes(searchQuery) ||
      (p.company_name || '').toLowerCase().includes(searchQuery) ||
      (p.contact_name || '').toLowerCase().includes(searchQuery)
    );
  }

  tbody.innerHTML = filtered.map(profile => {
    const creditStatus = profile.credit_status || 'none';
    const limit = profile.credit_limit || 25000;
    const terms = profile.payment_terms || 'Net 30';

    let creditBadge = '';
    if (creditStatus === 'approved') {
      creditBadge = `<span class="status-pill" style="background:#f0fdf4;border-color:#bbf7d0;color:#15803d;">✅ Approved</span>`;
    } else if (creditStatus === 'applied') {
      creditBadge = `<span class="status-pill" style="background:#fffbeb;border-color:#fde68a;color:#92400e;">⏳ Applied</span>`;
    } else if (creditStatus === 'rejected') {
      creditBadge = `<span class="status-pill" style="background:#fef2f2;border-color:#fecaca;color:#b91c1c;">❌ Rejected</span>`;
    } else {
      creditBadge = `<span class="status-pill" style="background:#FAF8F5;border-color:#EDE8E3;color:var(--muted);">💡 Not Applied</span>`;
    }

    let actions = '';
    if (creditStatus === 'applied') {
      actions = `
        <button class="btn-ghost btn-sm" onclick="openCreditApprovalModal('${profile.id}', '${escapeHTML(profile.company_name || 'Buyer')}', ${limit}, '${escapeHTML(terms)}')" style="color:#D4850A;border:1px solid #fde68a;background:#fffbeb;border-radius:6px;padding:3px 8px;cursor:pointer;margin-right:4px;">Approve Credit</button>
        <button class="btn-ghost btn-sm" onclick="setUserCredit('${profile.id}', 'rejected')" style="color:#b91c1c;border:1px solid #fecaca;background:#fef2f2;border-radius:6px;padding:3px 8px;cursor:pointer;">Reject Credit</button>
      `;
    } else if (creditStatus === 'approved') {
      actions = `
        <button class="btn-ghost btn-sm" onclick="openCreditApprovalModal('${profile.id}', '${escapeHTML(profile.company_name || 'Buyer')}', ${limit}, '${escapeHTML(terms)}')" style="color:#D4850A;border:1px solid #fde68a;background:#fffbeb;border-radius:6px;padding:3px 8px;cursor:pointer;margin-right:4px;">Edit Credit</button>
        <button class="btn-ghost btn-sm" onclick="setUserCredit('${profile.id}', 'rejected')" style="color:#b91c1c;border:1px solid #fecaca;background:#fef2f2;border-radius:6px;padding:3px 8px;cursor:pointer;">Revoke Credit</button>
      `;
    } else {
      actions = `
        <button class="btn-ghost btn-sm" onclick="openCreditApprovalModal('${profile.id}', '${escapeHTML(profile.company_name || 'Buyer')}', ${limit}, '${escapeHTML(terms)}')" style="color:var(--muted);border:1px solid #EDE8E3;border-radius:6px;padding:3px 8px;cursor:pointer;">Grant Credit</button>
      `;
    }

    return `
      <tr>
        <td>${escapeHTML(profile.company_name || '—')}</td>
        <td>${escapeHTML(profile.contact_name || '—')}</td>
        <td>${escapeHTML(profile.email || '—')}</td>
        <td>${creditBadge}</td>
        <td>SGD $${limit.toLocaleString()}</td>
        <td>${escapeHTML(terms)}</td>
        <td style="text-align:right;white-space:nowrap;">${actions}</td>
      </tr>
    `;
  }).join('') || `
    <tr>
      <td colspan="7" style="text-align:center;padding:2rem;color:var(--muted-lt);">No B2B credit accounts found</td>
    </tr>
  `;
}
window.filterBillingUsersTable = filterBillingUsersTable;

async function setUserApproval(userId, status) {
  try {
    const { error } = await sb
      .from('profiles')
      .update({ approval_status: status, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (error) throw error;

    showToast(status === 'approved' ? 'User Approved' : 'User Rejected', `Account updated to ${status}.`);
    
    const profileToUpdate = adminProfiles.find(p => p.id === userId);
    if (profileToUpdate) profileToUpdate.approval_status = status;

    renderUsers();
  } catch (error) {
    console.error('Failed to update user approval:', error);
    showToast('Update Failed', error.message || 'Could not update user approval.', 'error');
  }
}

window.filterUsersTable = filterUsersTable;
window.setUserApproval = setUserApproval;

/* ============================================================
   Products panel
   ============================================================ */

function renderProducts() {
  const tbody = document.getElementById('products-body');
  if (!tbody) return;

  tbody.innerHTML = adminProducts.map(product => {
    const tiers = adminProductTiers.filter(t => t.product_id === product.id)
      .sort((a, b) => a.min_quantity - b.min_quantity);

    const tier1 = tiers[0] ? `SGD $${Number(tiers[0].price).toFixed(2)}` : '—';
    const tier2 = tiers[1] ? `SGD $${Number(tiers[1].price).toFixed(2)}` : '—';
    const tier3 = tiers[2] ? `SGD $${Number(tiers[2].price).toFixed(2)}` : '—';

    const stock = product.stock_cartons ?? 0;
    let stockBadge = `${stock} ctn`;
    if (stock === 0) {
      stockBadge = `<span class="danger-badge">🚨 Out of stock</span>`;
    } else if (stock < 10) {
      stockBadge = `<span class="warning-badge">⚠️ Low stock (${stock})</span>`;
    }

    let visualHtml = '';
    if (product.image_url) {
      visualHtml = `<img src="${escapeHTML(product.image_url)}" style="width:36px;height:54px;object-fit:contain;border-radius:4px;border:1px solid #EDE8E3;"/>`;
    } else {
      visualHtml = `<div style="transform:scale(0.85);transform-origin:left center;">${miniPouchSVG(product.pouch_color || '#C8580A', product.pouch_accent || '#8B3A00', 20)}</div>`;
    }

    return `
      <tr>
        <td style="font-size:11px;color:var(--muted);">${escapeHTML(product.sku || '—')}</td>
        <td>${visualHtml}</td>
        <td style="color:var(--brown);font-weight:500;">
          ${escapeHTML(product.name || '—')}
          <div style="font-size:10px;color:var(--muted);font-weight:400;margin-top:2px;">${escapeHTML(product.subtitle || '')}</div>
        </td>
        <td>${stockBadge}</td>
        <td>${tier1}</td>
        <td>${tier2}</td>
        <td>${tier3}</td>
        <td>
          ${
            product.active
              ? `<span class="status-pill" style="background:#f0fdf4;border-color:#bbf7d0;color:#15803d;">✅ Active</span>`
              : `<span class="status-pill" style="background:#f5f3ff;border-color:#ddd6fe;color:#5b21b6;">🔒 Coming Soon</span>`
          }
        </td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn-ghost btn-sm" onclick="openEditProductModal('${product.id}')" style="margin-right:4px;">Edit Details</button>
          <button class="btn-ghost btn-sm" onclick="openEditTiersModal('${product.id}')" style="margin-right:4px;">Edit Pricing</button>
          <button class="btn-ghost btn-sm" onclick="deleteProduct('${product.id}')" style="color:#ef4444;">Remove</button>
        </td>
      </tr>
    `;
  }).join('') || `
    <tr>
      <td colspan="9" style="text-align:center;padding:2rem;color:var(--muted-lt);">No products in catalog</td>
    </tr>
  `;
}

function openAddProductModal() {
  document.getElementById('product-modal-title').textContent = "Add Product";
  document.getElementById('edit-product-id').value = "";
  document.getElementById('prod-id').disabled = false;
  document.getElementById('prod-id').value = "";
  document.getElementById('prod-sku').value = "";
  document.getElementById('prod-name').value = "";
  document.getElementById('prod-subtitle').value = "";
  document.getElementById('prod-caffeine').value = "";
  document.getElementById('prod-format').value = "";
  document.getElementById('prod-shelflife').value = "";
  document.getElementById('prod-stock').value = "0";
  document.getElementById('prod-active').value = "true";
  document.getElementById('prod-hint').value = "";
  document.getElementById('prod-imageurl').value = "";
  document.getElementById('prod-image-file').value = "";
  document.getElementById('prod-color-pouch').value = "#C8580A";
  document.getElementById('prod-color-accent').value = "#8B3A00";
  document.getElementById('prod-color-label').value = "#F5E0C8";

  document.getElementById('product-edit-modal').classList.add('open');
}

function openEditProductModal(productId) {
  const prod = adminProducts.find(p => p.id === productId);
  if (!prod) return;

  document.getElementById('product-modal-title').textContent = "Edit Product Details";
  document.getElementById('edit-product-id').value = prod.id;
  document.getElementById('prod-id').disabled = true;
  document.getElementById('prod-id').value = prod.id;
  document.getElementById('prod-sku').value = prod.sku || "";
  document.getElementById('prod-name').value = prod.name || "";
  document.getElementById('prod-subtitle').value = prod.subtitle || "";
  document.getElementById('prod-caffeine').value = prod.caffeine || "";
  document.getElementById('prod-format').value = prod.format || "";
  document.getElementById('prod-shelflife').value = prod.shelf_life || "";
  document.getElementById('prod-stock').value = prod.stock_cartons ?? 0;
  document.getElementById('prod-active').value = String(prod.active ?? true);
  document.getElementById('prod-hint').value = prod.coming_soon_hint || "";
  document.getElementById('prod-imageurl').value = prod.image_url || "";
  document.getElementById('prod-image-file').value = "";
  document.getElementById('prod-color-pouch').value = prod.pouch_color || "#C8580A";
  document.getElementById('prod-color-accent').value = prod.pouch_accent || "#8B3A00";
  document.getElementById('prod-color-label').value = prod.label_color || "#F5E0C8";

  document.getElementById('product-edit-modal').classList.add('open');
}

function closeProductModal() {
  document.getElementById('product-edit-modal').classList.remove('open');
}

async function handleProductImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  showToast("Uploading image...", "Please wait.", "info");

  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
    const filePath = `products/${fileName}`;

    const { data, error } = await sb.storage
      .from('product-images')
      .upload(filePath, file, { cacheControl: '3600', upsert: true });

    if (error) throw error;

    const { data: publicUrlData } = sb.storage
      .from('product-images')
      .getPublicUrl(filePath);

    if (publicUrlData?.publicUrl) {
      document.getElementById('prod-imageurl').value = publicUrlData.publicUrl;
      showToast("Upload complete!", "Image URL loaded.");
    }
  } catch (error) {
    console.warn("Storage bucket upload failed, using Base64 fallback:", error.message);
    const reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('prod-imageurl').value = e.target.result;
      showToast("Conversion applied!", "Asset converted successfully.");
    };
    reader.readAsDataURL(file);
  }
}

async function saveProductForm(event) {
  event.preventDefault();

  const editId = document.getElementById('edit-product-id').value;
  const prodId = document.getElementById('prod-id').value.trim();
  const sku = document.getElementById('prod-sku').value.trim();
  const name = document.getElementById('prod-name').value.trim();
  const subtitle = document.getElementById('prod-subtitle').value.trim();
  const caffeine = document.getElementById('prod-caffeine').value.trim();
  const format = document.getElementById('prod-format').value.trim();
  const shelfLife = document.getElementById('prod-shelflife').value.trim();
  const stock = parseInt(document.getElementById('prod-stock').value, 10) || 0;
  const active = document.getElementById('prod-active').value === 'true';
  const hint = document.getElementById('prod-hint').value.trim();
  const imageUrl = document.getElementById('prod-imageurl').value.trim();
  const pouchColor = document.getElementById('prod-color-pouch').value;
  const pouchAccent = document.getElementById('prod-color-accent').value;
  const labelColor = document.getElementById('prod-color-label').value;

  const payload = {
    sku,
    name,
    subtitle,
    caffeine,
    format,
    shelf_life: shelfLife,
    stock_cartons: stock,
    active,
    coming_soon_hint: hint,
    image_url: imageUrl || null,
    pouch_color: pouchColor,
    pouch_accent: pouchAccent,
    label_color: labelColor
  };

  try {
    if (editId) {
      const { error } = await sb
        .from('products')
        .update(payload)
        .eq('id', editId);

      if (error) throw error;
      showToast("Product updated", `${name} details saved.`);
    } else {
      const { error } = await sb
        .from('products')
        .insert({ ...payload, id: prodId });

      if (error) throw error;

      const defaultTiers = [
        { product_id: prodId, min_quantity: 1, max_quantity: 9, price: 120 },
        { product_id: prodId, min_quantity: 10, max_quantity: 29, price: 108 },
        { product_id: prodId, min_quantity: 30, max_quantity: null, price: 96 }
      ];
      await sb.from('product_tiers').insert(defaultTiers);

      showToast("Product created", `${name} added to catalog with standard pricing tiers.`);
    }

    closeProductModal();
    refreshAdminData();
  } catch (error) {
    console.error('Failed to save product:', error);
    showToast('Save Failed', error.message || 'Could not save product.', 'error');
  }
}

async function deleteProduct(productId) {
  if (!confirm(`Are you sure you want to delete product "${productId}"? This deletes pricing tiers too.`)) return;

  try {
    await sb.from('product_tiers').delete().eq('product_id', productId);
    const { error } = await sb.from('products').delete().eq('id', productId);
    if (error) throw error;

    showToast("Product deleted", "Catalog refreshed.");
    refreshAdminData();
  } catch (error) {
    console.error('Failed to delete product:', error);
    showToast('Delete Failed', error.message || 'Could not delete product.', 'error');
  }
}

let currentEditingTiers = [];

function openEditTiersModal(productId) {
  const prod = adminProducts.find(p => p.id === productId);
  if (!prod) return;

  document.getElementById('tiers-modal-product-name').textContent = prod.name;
  document.getElementById('tiers-product-id').value = prod.id;

  currentEditingTiers = adminProductTiers.filter(t => t.product_id === productId)
    .sort((a, b) => a.min_quantity - b.min_quantity)
    .map(t => ({
      id: t.id,
      min: t.min_quantity,
      max: t.max_quantity,
      price: t.price
    }));

  renderTiersEditor();
  document.getElementById('product-tiers-modal').classList.add('open');
}

function closeProductTiersModal() {
  document.getElementById('product-tiers-modal').classList.remove('open');
}

function renderTiersEditor() {
  const tbody = document.getElementById('tiers-body-editor');
  if (!tbody) return;

  tbody.innerHTML = currentEditingTiers.map((tier, idx) => `
    <tr>
      <td style="text-align:center;">
        <input type="number" min="1" value="${tier.min}" onchange="updateTierVal(${idx}, 'min', this.value)" style="width:65px;padding:0.25rem;font-size:12px;border:1px solid #EDE8E3;border-radius:4px;text-align:center;"/>
      </td>
      <td style="text-align:center;">
        <input type="number" min="1" placeholder="+" value="${tier.max ?? ''}" onchange="updateTierVal(${idx}, 'max', this.value)" style="width:65px;padding:0.25rem;font-size:12px;border:1px solid #EDE8E3;border-radius:4px;text-align:center;"/>
      </td>
      <td style="text-align:right;">
        <input type="number" min="0" step="0.01" value="${Number(tier.price).toFixed(2)}" onchange="updateTierVal(${idx}, 'price', this.value)" style="width:85px;padding:0.25rem;font-size:12px;border:1px solid #EDE8E3;border-radius:4px;text-align:right;"/>
      </td>
      <td style="text-align:center;">
        <button type="button" onclick="removeTierRow(${idx})" style="color:#ef4444;border:none;background:none;cursor:pointer;font-size:16px;">&times;</button>
      </td>
    </tr>
  `).join('');
}

function updateTierVal(idx, key, val) {
  if (key === 'min') {
    currentEditingTiers[idx].min = parseInt(val, 10) || 1;
  } else if (key === 'max') {
    currentEditingTiers[idx].max = val === "" ? null : (parseInt(val, 10) || null);
  } else if (key === 'price') {
    currentEditingTiers[idx].price = parseFloat(val) || 0;
  }
}

function removeTierRow(idx) {
  currentEditingTiers.splice(idx, 1);
  renderTiersEditor();
}

function addNewTierRow() {
  const lastTier = currentEditingTiers[currentEditingTiers.length - 1];
  const nextMin = lastTier ? (lastTier.max ? lastTier.max + 1 : lastTier.min + 1) : 1;
  currentEditingTiers.push({
    min: nextMin,
    max: null,
    price: 100
  });
  renderTiersEditor();
}

async function saveProductTiers() {
  const productId = document.getElementById('tiers-product-id').value;
  if (!productId) return;

  for (let i = 0; i < currentEditingTiers.length; i++) {
    const tier = currentEditingTiers[i];
    if (tier.max !== null && tier.min > tier.max) {
      alert(`Invalid range at tier ${i+1}: Min Qty cannot exceed Max Qty.`);
      return;
    }
  }

  showToast("Saving tiers...", "Please wait.", "info");

  try {
    await sb.from('product_tiers').delete().eq('product_id', productId);

    if (currentEditingTiers.length > 0) {
      const inserts = currentEditingTiers.map(t => ({
        product_id: productId,
        min_quantity: t.min,
        max_quantity: t.max,
        price: t.price
      }));

      const { error } = await sb.from('product_tiers').insert(inserts);
      if (error) throw error;
    }

    showToast("Pricing tiers saved", "Wholesale tier grid updated.");
    closeProductTiersModal();
    refreshAdminData();
  } catch (error) {
    console.error('Failed to save tiers:', error);
    showToast('Save Failed', error.message || 'Could not save pricing tiers.', 'error');
  }
}

window.openAddProductModal = openAddProductModal;
window.openEditProductModal = openEditProductModal;
window.closeProductModal = closeProductModal;
window.handleProductImageUpload = handleProductImageUpload;
window.saveProductForm = saveProductForm;
window.deleteProduct = deleteProduct;
window.openEditTiersModal = openEditTiersModal;
window.closeProductTiersModal = closeProductTiersModal;
window.addNewTierRow = addNewTierRow;
window.removeTierRow = removeTierRow;
window.updateTierVal = updateTierVal;
window.saveProductTiers = saveProductTiers;

/* ============================================================
   Feedback panel
   ============================================================ */

function renderFeedback() {
  filterFeedbackTable();
}

function filterFeedbackTable() {
  const tbody = document.getElementById('feedback-body');
  if (!tbody) return;

  const searchQuery = (document.getElementById('feedback-search')?.value || '').toLowerCase().trim();
  const topicFilter = document.getElementById('feedback-filter-topic')?.value || 'all';
  const statusFilter = document.getElementById('feedback-filter-status')?.value || 'all';

  let filtered = adminFeedback;

  if (statusFilter !== 'all') {
    filtered = filtered.filter(f => (f.status || 'new') === statusFilter);
  }

  if (topicFilter !== 'all') {
    filtered = filtered.filter(f => (f.topic || '').toLowerCase() === topicFilter);
  }

  if (searchQuery) {
    filtered = filtered.filter(f => 
      (f.name || '').toLowerCase().includes(searchQuery) ||
      (f.email || '').toLowerCase().includes(searchQuery) ||
      (f.message || '').toLowerCase().includes(searchQuery)
    );
  }

  tbody.innerHTML = filtered.map(feedback => {
    const topic = feedback.topic || 'other';
    const message = feedback.message || '';
    const status = feedback.status || 'new';

    let statusHtml = '';
    if (status === 'resolved') {
      statusHtml = `<span class="status-pill" style="background:#f0fdf4;border-color:#bbf7d0;color:#15803d;">Resolved</span>`;
    } else {
      statusHtml = `<span class="status-pill" style="background:#fffbeb;border-color:#fde68a;color:#92400e;">New</span>`;
    }

    let actionButton = '';
    if (status !== 'resolved') {
      actionButton = `
        <button class="btn-ghost btn-sm" onclick="setFeedbackStatus('${feedback.id}', 'resolved')" style="color:#15803d;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:6px;padding:3px 8px;cursor:pointer;">Resolve</button>
      `;
    } else {
      actionButton = `
        <button class="btn-ghost btn-sm" onclick="setFeedbackStatus('${feedback.id}', 'new')" style="color:#b45309;border:1px solid #fde68a;background:#fffbeb;border-radius:6px;padding:3px 8px;cursor:pointer;">Mark New</button>
      `;
    }

    return `
      <tr>
        <td style="color:var(--brown);font-weight:500;">${escapeHTML(feedback.name || '—')}</td>
        <td>${escapeHTML(feedback.email || '—')}</td>
        <td style="text-transform: capitalize;">
          <span style="font-size:11px;padding:2px 6px;background:#FAF8F5;border:1px solid #EDE8E3;border-radius:6px;color:var(--muted);">${escapeHTML(topic)}</span>
        </td>
        <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHTML(message)}">
          ${escapeHTML(message)}
        </td>
        <td>${feedback.created_at ? new Date(feedback.created_at).toLocaleDateString('en-SG') : '—'}</td>
        <td>${statusHtml}</td>
        <td style="text-align:right;">${actionButton}</td>
      </tr>
    `;
  }).join('') || `
    <tr>
      <td colspan="7" style="text-align:center;padding:2rem;color:var(--muted-lt);">No enquiries found</td>
    </tr>
  `;
}

async function setFeedbackStatus(feedbackId, status) {
  try {
    const { error } = await sb
      .from('feedback')
      .update({ status })
      .eq('id', feedbackId);

    if (error) throw error;

    showToast("Feedback updated", `Status updated to ${status}.`);
    
    const fb = adminFeedback.find(f => f.id === feedbackId);
    if (fb) fb.status = status;

    renderFeedback();
    renderDashboard();
  } catch (error) {
    console.error('Failed to update feedback status:', error);
    showToast('Failed to update status', error.message, 'error');
  }
}

window.filterFeedbackTable = filterFeedbackTable;
window.setFeedbackStatus = setFeedbackStatus;

/* ============================================================
   FAQ panel
   ============================================================ */

function renderFaqs() {
  renderFaqCategories();
  renderFaqList();
}

function renderFaqCategories() {
  const tbody = document.getElementById('faq-categories-body');
  if (!tbody) return;

  tbody.innerHTML = adminFaqCategories.map(cat => `
    <tr>
      <td style="color:var(--brown);font-weight:500;">
        ${escapeHTML(cat.name)}
        <span style="font-size:10px;color:var(--muted);font-weight:400;display:block;">Display Order: ${cat.display_order}</span>
      </td>
      <td style="text-align:right; white-space:nowrap;">
        <button class="btn-ghost btn-sm" onclick="openEditCategoryModal('${cat.id}')" style="margin-right:4px;">Edit</button>
        <button class="btn-ghost btn-sm" onclick="deleteCategory('${cat.id}')" style="color:#ef4444;">Delete</button>
      </td>
    </tr>
  `).join('') || `
    <tr>
      <td colspan="2" style="text-align:center;padding:1.5rem;color:var(--muted-lt);font-size:12px;">No categories found</td>
    </tr>
  `;
}

function renderFaqList() {
  const tbody = document.getElementById('faqs-body');
  if (!tbody) return;

  tbody.innerHTML = adminFaqs.map(faq => {
    const catName = faq.faq_categories?.name || 'General';
    const previewAnswer = faq.answer.length > 40 ? faq.answer.substring(0, 40) + '...' : faq.answer;

    return `
      <tr>
        <td>
          <span style="font-size:11px;padding:2px 6px;background:#FAF8F5;border:1px solid #EDE8E3;border-radius:6px;color:var(--muted);">${escapeHTML(catName)}</span>
        </td>
        <td style="color:var(--brown);font-weight:500;">${escapeHTML(faq.question)}</td>
        <td style="color:var(--muted);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHTML(faq.answer)}">
          ${escapeHTML(previewAnswer)}
        </td>
        <td>
          ${
            faq.is_active
              ? `<span class="status-pill" style="background:#f0fdf4;border-color:#bbf7d0;color:#15803d;">Active</span>`
              : `<span class="status-pill" style="background:#fffbeb;border-color:#fde68a;color:#92400e;">Inactive</span>`
          }
        </td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn-ghost btn-sm" onclick="openEditFaqModal('${faq.id}')" style="margin-right:4px;">Edit</button>
          <button class="btn-ghost btn-sm" onclick="deleteFaq('${faq.id}')" style="color:#ef4444;">Remove</button>
        </td>
      </tr>
    `;
  }).join('') || `
    <tr>
      <td colspan="5" style="text-align:center;padding:2rem;color:var(--muted-lt);">No FAQs created yet</td>
    </tr>
  `;
}

function openAddCategoryModal() {
  document.getElementById('faq-category-modal-title').textContent = "Add Category";
  document.getElementById('edit-category-id').value = "";
  document.getElementById('cat-name').value = "";
  document.getElementById('cat-order').value = "0";
  document.getElementById('faq-category-modal').classList.add('open');
}

function openEditCategoryModal(catId) {
  const cat = adminFaqCategories.find(c => c.id === catId);
  if (!cat) return;

  document.getElementById('faq-category-modal-title').textContent = "Edit Category";
  document.getElementById('edit-category-id').value = cat.id;
  document.getElementById('cat-name').value = cat.name;
  document.getElementById('cat-order').value = cat.display_order;
  document.getElementById('faq-category-modal').classList.add('open');
}

function closeCategoryModal() {
  document.getElementById('faq-category-modal').classList.remove('open');
}

async function saveCategoryForm(event) {
  event.preventDefault();

  const editId = document.getElementById('edit-category-id').value;
  const name = document.getElementById('cat-name').value.trim();
  const order = parseInt(document.getElementById('cat-order').value, 10) || 0;

  try {
    if (editId) {
      const { error } = await sb
        .from('faq_categories')
        .update({ name, display_order: order })
        .eq('id', editId);
      if (error) throw error;
      showToast("Category updated", `Successfully updated "${name}".`);
    } else {
      const { error } = await sb
        .from('faq_categories')
        .insert({ name, display_order: order });
      if (error) throw error;
      showToast("Category created", `Successfully created category "${name}".`);
    }

    closeCategoryModal();
    refreshAdminData();
  } catch (error) {
    console.error('Failed to save category:', error);
    showToast('Save Failed', error.message || 'Could not save category.', 'error');
  }
}

async function deleteCategory(catId) {
  if (!confirm("Are you sure you want to delete this FAQ category? All FAQs inside it will also be deleted.")) return;
  
  try {
    const { error } = await sb.from('faq_categories').delete().eq('id', catId);
    if (error) throw error;

    showToast("Category removed", "Category and linked FAQs deleted.");
    refreshAdminData();
  } catch (error) {
    console.error('Failed to delete category:', error);
    showToast('Delete Failed', error.message || 'Could not delete category.', 'error');
  }
}

function openAddFaqModal() {
  document.getElementById('faq-item-modal-title').textContent = "Add FAQ Q&A";
  document.getElementById('edit-faq-id').value = "";
  document.getElementById('faq-question').value = "";
  document.getElementById('faq-answer').value = "";
  document.getElementById('faq-order').value = "0";
  document.getElementById('faq-active').value = "true";

  populateCategoryDropdown();
  document.getElementById('faq-item-modal').classList.add('open');
}

function openEditFaqModal(faqId) {
  const faq = adminFaqs.find(f => f.id === faqId);
  if (!faq) return;

  document.getElementById('faq-item-modal-title').textContent = "Edit FAQ Q&A";
  document.getElementById('edit-faq-id').value = faq.id;
  document.getElementById('faq-question').value = faq.question;
  document.getElementById('faq-answer').value = faq.answer;
  document.getElementById('faq-order').value = faq.display_order;
  document.getElementById('faq-active').value = String(faq.is_active ?? true);

  populateCategoryDropdown(faq.category_id);
  document.getElementById('faq-item-modal').classList.add('open');
}

function closeFaqModal() {
  document.getElementById('faq-item-modal').classList.remove('open');
}

function populateCategoryDropdown(selectedId = null) {
  const select = document.getElementById('faq-cat-id');
  if (!select) return;

  if (adminFaqCategories.length === 0) {
    select.innerHTML = `<option value="">(No categories exist, add one first!)</option>`;
    return;
  }

  select.innerHTML = adminFaqCategories.map(cat => `
    <option value="${cat.id}" ${cat.id === selectedId ? 'selected' : ''}>${escapeHTML(cat.name)}</option>
  `).join('');
}

async function saveFaqForm(event) {
  event.preventDefault();

  const editId = document.getElementById('edit-faq-id').value;
  const categoryId = document.getElementById('faq-cat-id').value;
  const question = document.getElementById('faq-question').value.trim();
  const answer = document.getElementById('faq-answer').value.trim();
  const order = parseInt(document.getElementById('faq-order').value, 10) || 0;
  const active = document.getElementById('faq-active').value === 'true';

  if (!categoryId) {
    alert("Please select or create an FAQ Category first.");
    return;
  }

  const payload = {
    category_id: categoryId,
    question,
    answer,
    display_order: order,
    is_active: active
  };

  try {
    if (editId) {
      const { error } = await sb
        .from('faqs')
        .update(payload)
        .eq('id', editId);
      if (error) throw error;
      showToast("FAQ updated", "Q&A details saved.");
    } else {
      const { error } = await sb
        .from('faqs')
        .insert(payload);
      if (error) throw error;
      showToast("FAQ created", "Q&A added successfully.");
    }

    closeFaqModal();
    refreshAdminData();
  } catch (error) {
    console.error('Failed to save FAQ:', error);
    showToast('Save Failed', error.message || 'Could not save FAQ.', 'error');
  }
}

async function deleteFaq(faqId) {
  if (!confirm("Are you sure you want to remove this FAQ question?")) return;
  try {
    const { error } = await sb.from('faqs').delete().eq('id', faqId);
    if (error) throw error;

    showToast("FAQ removed", "Q&A deleted successfully.");
    refreshAdminData();
  } catch (error) {
    console.error('Failed to delete FAQ:', error);
    showToast('Delete Failed', error.message || 'Could not delete FAQ.', 'error');
  }
}

window.renderFaqs = renderFaqs;
window.renderFaqCategories = renderFaqCategories;
window.renderFaqList = renderFaqList;
window.openAddCategoryModal = openAddCategoryModal;
window.openEditCategoryModal = openEditCategoryModal;
window.closeCategoryModal = closeCategoryModal;
window.saveCategoryForm = saveCategoryForm;
window.deleteCategory = deleteCategory;
window.openAddFaqModal = openAddFaqModal;
window.openEditFaqModal = openEditFaqModal;
window.closeFaqModal = closeFaqModal;
window.saveFaqForm = saveFaqForm;
window.deleteFaq = deleteFaq;

/* ============================================================
   Subscriptions Management & Ship Now action
   ============================================================ */

async function loadAdminSubscriptions() {
  try {
    const { data, error } = await sb
      .from("subscriptions")
      .select(`
        id,
        created_at,
        frequency,
        status,
        profiles(company_name),
        subscription_items(
          id,
          cartons,
          price_per_carton,
          product_id,
          products (
            id,
            name,
            sku
          )
        )
      `);

    if (error) throw error;
    renderAdminSubscriptions(data || []);
  } catch (err) {
    console.error("Subscription load failed:", err);
  }
}

function renderAdminSubscriptions(data) {
  const container = document.getElementById("adminSubscriptions");
  if (!container) return;

  if (!data.length) {
    container.innerHTML = `
      <div class="subscription-empty">
        No active subscriptions
      </div>
    `;
    return;
  }

  container.innerHTML = data.map(sub => {
    const items = sub.subscription_items || [];
    const itemsHtml = items.map(item => `
      <tr>
        <td class="inv-product">
          <div class="name">${item.products?.name || item.product_id}</div>
          <div class="sku">${item.products?.sku || ""}</div>
        </td>
        <td class="inv-center">${item.cartons}</td>
        <td class="inv-right">$${Number(item.price_per_carton).toFixed(2)}</td>
        <td class="inv-right">$${(item.cartons * item.price_per_carton).toFixed(2)}</td>
      </tr>
    `).join("");

    const total = items.reduce((sum, item) => sum + (item.cartons * Number(item.price_per_carton || 0)), 0);

    return `
      <div class="invoice-card">
        <div class="invoice-header">
          <div>
            <div class="company">${sub.profiles?.company_name || "Unknown Company"}</div>
            <div class="meta">
              Subscription #${sub.id.slice(0, 8)} • ${sub.frequency} • ${new Date(sub.created_at).toLocaleDateString()}
            </div>
          </div>
          <div class="status ${sub.status}">${sub.status}</div>
        </div>

        <table class="invoice-table">
          <thead>
            <tr>
              <th>Product</th>
              <th class="inv-center">Cartons</th>
              <th class="inv-right">Unit Price</th>
              <th class="inv-right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div class="invoice-footer">
          <div class="total">Total: SGD $${total.toFixed(2)}</div>
          <button onclick="shipNow('${sub.id}')">⚡ Ship Now</button>
        </div>
      </div>
    `;
  }).join("");
}

async function shipNow(subId) {
  try {
    showToast("Processing Refill...", "Generating B2B order from subscription items.", "info");

    const { data: sub, error: subError } = await sb
      .from("subscriptions")
      .select(`
        id,
        user_id,
        profiles(id, company_name, contact_name, business_type, delivery_address, email),
        subscription_items(
          id,
          cartons,
          price_per_carton,
          product_id,
          products (
            id,
            name,
            sku
          )
        )
      `)
      .eq("id", subId)
      .single();

    if (subError) throw subError;

    const profile = sub.profiles;
    const items = sub.subscription_items || [];

    if (items.length === 0) {
      showToast("Shipment Failed", "This subscription has no items to ship.", "error");
      return;
    }

    const totalCartons = items.reduce((sum, item) => sum + item.cartons, 0);
    const totalAmount = items.reduce((sum, item) => sum + (item.cartons * item.price_per_carton), 0);

    const orderPayload = {
      profile_id: profile.id,
      company: profile.company_name || 'Wholesale Subscriber',
      contact_name: profile.contact_name || profile.email || 'Subscriber',
      business_type: profile.business_type || 'B2B',
      delivery_address: profile.delivery_address || 'Singapore',
      total_cartons: totalCartons,
      total_amount: totalAmount,
      status: "pending",
      notes: `Subscription refill for #${subId.slice(0, 8)}`
    };

    const { data: savedOrder, error: orderError } = await sb
      .from('orders')
      .insert(orderPayload)
      .select()
      .single();

    if (orderError) throw orderError;

    const orderItemsPayload = items.map(item => ({
      order_id: savedOrder.id,
      product_id: item.product_id,
      sku: item.products?.sku || '',
      name: item.products?.name || '',
      cartons: item.cartons,
      price_per_carton: item.price_per_carton
    }));

    const { error: itemsError } = await sb
      .from('order_items')
      .insert(orderItemsPayload);

    if (itemsError) throw itemsError;

    showToast("Refill Order Created", `Order #${savedOrder.id} generated successfully from subscription.`);
    refreshAdminData();
  } catch (err) {
    console.error("Subscription shipping failed:", err);
    showToast("Shipment Failed", err.message || "Could not generate subscription order.", "error");
  }
}

window.shipNow = shipNow;

/* ============================================================
   Initialise admin dashboard
   ============================================================ */

async function initAdminDashboard() {
  setAdminLoading(true);
  const admin = await requireAdmin();
  if (!admin) return;

  await loadAdminData();

  renderDashboard();
  renderOrders();
  renderUsers();
  renderProducts();
  renderFeedback();
  renderFaqs();
  loadAdminSubscriptions();

  setAdminLoading(false);
}

// --- B2B Credit Term Admin Actions ---
async function markOrderAsPaid(orderId) {
  if (!confirm(`Are you sure you want to mark Order #${orderId} as Paid?`)) return;

  try {
    const { error } = await sb
      .from('orders')
      .update({ payment_status: 'paid' })
      .eq('id', orderId);

    if (error) throw error;

    showToast('Payment Updated', `Order #${orderId} marked as paid.`);
    
    // Update local state
    const localOrder = adminOrders.find(o => String(o.id) === String(orderId));
    if (localOrder) localOrder.paymentStatus = 'paid';

    // Reopen modal to update UI and refresh list
    closeOrderDetailsModal();
    openOrderDetailsModal(orderId);
    renderOrders();
    renderDashboard();
  } catch (error) {
    console.error('Failed to mark order as paid:', error);
    showToast('Update Failed', error.message || 'Could not update payment status.', 'error');
  }
}

function openCreditApprovalModal(userId, companyName, currentLimit = 25000, currentTerms = 'Net 30') {
  document.getElementById('credit-user-id').value = userId;
  document.getElementById('credit-company-name').value = companyName;
  document.getElementById('credit-limit-input').value = currentLimit;
  document.getElementById('credit-terms-input').value = currentTerms;
  
  document.getElementById('credit-approval-modal').classList.add('open');
}

function closeCreditModal() {
  document.getElementById('credit-approval-modal').classList.remove('open');
}

async function saveCreditApproval(event) {
  event.preventDefault();
  
  const userId = document.getElementById('credit-user-id').value;
  const limit = Number(document.getElementById('credit-limit-input').value);
  const terms = document.getElementById('credit-terms-input').value;
  
  try {
    await setUserCredit(userId, 'approved', limit, terms);
    closeCreditModal();
  } catch (error) {
    console.error("Failed to save credit approval:", error);
  }
}

async function setUserCredit(userId, status, limit = 25000, terms = 'Net 30') {
  try {
    const payload = {
      credit_status: status,
      updated_at: new Date().toISOString()
    };
    
    if (status === 'approved') {
      payload.credit_limit = limit;
      payload.payment_terms = terms;
    }
    
    const { error } = await sb
      .from('profiles')
      .update(payload)
      .eq('id', userId);

    if (error) throw error;

    showToast(status === 'approved' ? 'Credit Approved' : 'Credit Status Updated', `Account credit updated to ${status}.`);
    
    const profileToUpdate = adminProfiles.find(p => p.id === userId);
    if (profileToUpdate) {
      profileToUpdate.credit_status = status;
      if (status === 'approved') {
        profileToUpdate.credit_limit = limit;
        profileToUpdate.payment_terms = terms;
      }
    }

    renderUsers();
  } catch (error) {
    console.error('Failed to update credit terms:', error);
    showToast('Update Failed', error.message || 'Could not update user credit terms.', 'error');
    throw error;
  }
}

window.markOrderAsPaid = markOrderAsPaid;
window.openCreditApprovalModal = openCreditApprovalModal;
window.closeCreditModal = closeCreditModal;
window.saveCreditApproval = saveCreditApproval;
window.setUserCredit = setUserCredit;

initAdminDashboard();