/* ============================================================
   account.js — Logic for account.html
   Depends on: shared.js
   Uses:
   - Auth
   - Orders
   - showToast
   - buildNav
   - buildFooter
   - escapeHTML

   Supabase version
   ============================================================ */


/* ============================================================
   Page state
   ============================================================ */

let user = null;
let myOrders = [];
let editing = false;

const creditLimit = 25000; // SGD credit limit per account


/* ============================================================
   Status colours / labels
   ============================================================ */

const statusCfg = {
  pending: {
    label: 'Pending',
    dot: '#fbbf24'
  },

  processing: {
    label: 'Processing',
    dot: '#60a5fa'
  },

  shipped: {
    label: 'Shipped',
    dot: '#a78bfa'
  },

  delivered: {
    label: 'Delivered',
    dot: '#4ade80'
  },
};


/* ============================================================
   Hero section
   ============================================================ */

/**
 * Fills in the account hub hero with:
 * - user initials
 * - company name
 * - business type
 * - email
 */
function initHero() {
  if (!user) return;

  const initials = (user.contactName || user.companyName || 'U')
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  document.getElementById('acct-avatar').textContent = initials;

  document.getElementById('acct-heading').textContent =
    user.companyName || 'My Account';

  document.getElementById('acct-sub').textContent =
    `${user.businessType || 'Buyer'} · ${user.email || ''}`;
}


/* ============================================================
   Order helpers
   ============================================================ */

/**
 * Returns orders belonging to the current user.
 */
function getMyOrders() {
  return myOrders;
}


/**
 * Sums totalAmount across an array of orders.
 */
function totalSpend(orders) {
  return orders.reduce((sum, order) => {
    return sum + Number(order.totalAmount || 0);
  }, 0);
}


/**
 * Formats order date.
 */
function formatOrderDate(dateValue) {
  if (!dateValue) return '—';

  return new Date(dateValue).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}


/* ============================================================
   Order list HTML
   ============================================================ */

/**
 * Builds the HTML for the order list.
 * Used in both:
 * - Overview tab
 * - Orders tab
 */
function orderListHTML(list, suffix = '') {
  if (!list.length) {
    return `
      <div
        style="padding:4rem 1.5rem;display:flex;flex-direction:column;align-items:center;text-align:center;">

        <div style="font-size:2.5rem;margin-bottom:.75rem;opacity:.3;">
          📦
        </div>

        <div style="color:var(--brown);margin-bottom:.35rem;">
          No orders yet
        </div>

        <p style="font-size:13px;color:var(--muted);margin-bottom:1.25rem;">
          Head to the Catalog to place your first bulk order.
        </p>

        <a href="catalog.html" class="btn-dark btn-sm">
          Browse Catalog →
        </a>

      </div>
    `;
  }

  return list.map(order => {
    const sc = statusCfg[order.status] || statusCfg.pending;
    const date = formatOrderDate(order.dateOrdered);

    return `
      <div class="order-row">

        <div
          class="order-row-header"
          onclick="toggleOrder('${order.id}', '${suffix}')"
          role="button"
          aria-expanded="false"
          id="hdr-${order.id}${suffix}">

          <div
            class="order-dot"
            style="background:${sc.dot};">
          </div>

          <div style="flex:1;min-width:0;">

            <div
              style="display:flex;align-items:center;gap:.5rem;margin-bottom:.2rem;flex-wrap:wrap;">

              <span class="order-id">
                #${escapeHTML(order.id)}
              </span>

              <span
                style="font-size:10px;padding:.15rem .45rem;border-radius:9999px;border:1px solid;background:transparent;">
                ${escapeHTML(sc.label)}
              </span>

              ${
                order.notes
                  ? `<span style="font-size:10px;color:var(--muted);">${escapeHTML(order.notes)}</span>`
                  : ''
              }

            </div>

            <div class="order-meta">
              ${escapeHTML(date)} · ${Number(order.totalCartons || 0)} ctn · ${(Number(order.totalCartons || 0) * 50).toLocaleString()} pouches
            </div>

          </div>

          <div class="order-amount">
            SGD $${Number(order.totalAmount || 0).toFixed(2)}
          </div>

          <div
            class="order-chevron"
            id="chev-${order.id}${suffix}">
            ▾
          </div>

        </div>

        <div
          class="order-detail"
          id="det-${order.id}${suffix}">

          <div class="order-items">

            <div
              style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.6rem;">
              Items
            </div>

            ${(order.items || []).map(item => `
              <div class="order-item-row">

                <span style="color:var(--brown);">
                  ${Number(item.cartons || 0)} cartons × ${escapeHTML(item.name || '')}
                </span>

                <span style="color:var(--brown-lt);">
                  SGD $${(Number(item.cartons || 0) * Number(item.pricePerCarton || 0)).toFixed(2)}
                </span>

              </div>
            `).join('')}

            <div
              style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #F0EAE4;padding-top:.6rem;margin-top:.5rem;">

              <span
                style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;">
                Total Price
              </span>

              <span style="font-weight:600;color:var(--brown);">
                SGD $${Number(order.totalAmount || 0).toFixed(2)}
              </span>

            </div>

          </div>

          <div style="display:flex;gap:.6rem;">

            <button
              onclick="handleReorder('${order.id}')"
              class="btn-dark"
              style="flex:1;justify-content:center;padding:.6rem;"
              type="button">
              ↩ Reorder
            </button>

            <button
              onclick="handleInvoice('${order.id}')"
              class="btn-ghost"
              style="padding:.6rem 1rem;"
              type="button">
              📄 Invoice
            </button>

          </div>

        </div>

      </div>
    `;
  }).join('');
}


/* ============================================================
   Order row toggling
   ============================================================ */

function toggleOrder(id, suffix = '') {
  const detail = document.getElementById('det-' + id + suffix);
  const chevron = document.getElementById('chev-' + id + suffix);
  const header = document.getElementById('hdr-' + id + suffix);

  if (!detail) return;

  const open = detail.classList.toggle('open');

  if (chevron) {
    chevron.classList.toggle('open', open);
  }

  if (header) {
    header.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
}


/* ============================================================
   Reorder
   ============================================================ */

async function handleReorder(id) {
  const existingOrder = getMyOrders().find(order => order.id === id);

  if (!existingOrder) {
    showToast('Order not found', 'Could not find the selected order.', 'error');
    return;
  }

  if (!user) {
    showToast('Please sign in', 'You need to sign in before reordering.', 'error');
    window.location.href = 'login.html';
    return;
  }

  try {
    const newOrder = await Orders.add({
      company: user.companyName,
      contactName: user.contactName || user.email,
      businessType: user.businessType,
      items: existingOrder.items || [],
      totalCartons: existingOrder.totalCartons,
      totalAmount: existingOrder.totalAmount,
      status: 'pending',
      deliveryAddress: user.deliveryAddress || existingOrder.deliveryAddress || '',
      notes: `Reorder of #${existingOrder.id}`,
    });

    myOrders = await Orders.forCurrentUser();

    showToast(
      `Reorder placed — #${newOrder.id}`,
      `${existingOrder.totalCartons} ctn · SGD $${Number(existingOrder.totalAmount || 0).toFixed(2)} · Pending`
    );

    renderAll();
  } catch (error) {
    console.error('Reorder failed:', error);

    showToast(
      'Reorder failed',
      error.message || 'Could not place reorder.',
      'error'
    );
  }
}


/* ============================================================
   PDF invoice generation
   ============================================================ */

function handleInvoice(id) {
  let order;
  if (typeof Orders !== 'undefined' && typeof Orders.getAll === 'function') {
    const history = JSON.parse(localStorage.getItem('espressgo_orders') || '[]');
    order = history.find(o => String(o.id) === String(id));
  }
  
  if (!order && typeof getMyOrders === 'function') {
    order = getMyOrders().find(o => o.id === id);
  }

  if (!order) {
    showToast('Error', 'Order details not found.', 'error');
    return;
  }

  const PDFDocument = window.PDFDocument;

  if (!PDFDocument) {
    showToast('Error', 'PDF engine failed to load. Please reload.', 'error');
    return;
  }

  try {
    const pdfChunks = [];
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40
    });

    doc.on('data', chunk => {
      pdfChunks.push(chunk);
    });

    const dateStr = typeof formatOrderDate === 'function' ? formatOrderDate(order.dateOrdered) : new Date(order.dateOrdered || Date.now()).toLocaleDateString('en-SG');
    
    const invoiceDate = order.dateOrdered ? new Date(order.dateOrdered) : new Date();
    const dueDate = new Date(invoiceDate);
    dueDate.setDate(dueDate.getDate() + 14);
    const dueDateStr = dueDate.toLocaleDateString('en-SG');

    const rightAlignX = 555;
    const gstRate = 0.09; 

    /* ── Header: Brand Block & Title ─────────────────────── */

    doc
      .rect(40, 50, 110, 24)
      .fill('#000000');

    doc
      .fillColor('#FFFFFF')
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('ESPRESSGO', 50, 57, { letterSpacing: 1 });

    doc
      .fillColor('#2B3A42')
      .font('Helvetica')
      .fontSize(16)
      .text(`Tax Invoice #  ${order.id}`, 300, 48, {
        width: 255,
        align: 'right'
      });

    doc
      .fillColor('#000000')
      .font('Helvetica')
      .fontSize(10)
      .text(`Invoice Date: ${dateStr}`, 300, 75, { width: 255, align: 'right' })
      .font('Helvetica-Bold')
      .text(`Due Date: ${dueDateStr}`, 300, 88, { width: 255, align: 'right' });

    /* ── Corporate and Client Entities Profile Section ────── */

    const sectionY = 125;

    doc
      .fillColor('#1E293B')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('BILL TO', 40, sectionY);

    const currentUser = typeof Auth !== 'undefined' ? Auth.getUser() : null;
    const companyDisplay = order.company || (currentUser ? currentUser.companyName : 'Valued B2B Customer');
    const contactDisplay = order.contactName || (currentUser ? currentUser.contactName : 'Procurement Manager');
    const addressDisplay = order.deliveryAddress || (currentUser ? currentUser.deliveryAddress : 'Singapore Deliveries');

    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(companyDisplay, 40, sectionY + 16)
      .font('Helvetica')
      .fillColor('#334155')
      .text(`Attn: ${contactDisplay}`, 40, sectionY + 29)
      .text(addressDisplay, 40, sectionY + 42, { width: 220 })
      .text('GST Reg No: [Customer GST Reg No]', 40, sectionY + 65);

    doc
      .fillColor('#1E293B')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('ESPRESSGO', 320, sectionY);

    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#334155')
      .text('180 Ang Mo Kio Avenue 8, Singapore 569830', 320, sectionY + 16, { width: 235 })
      .text('GST Reg No: [GST Reg No]', 320, sectionY + 42);

    /* ── 5-Column Data Table Header Grid Structure ────────── */

    let tableY = 225;
    const colWidths = { desc: 210, qty: 60, price: 75, sub: 80, gst: 90 };
    const colX = {
      desc: 40,
      qty: 40 + colWidths.desc,
      price: 40 + colWidths.desc + colWidths.qty,
      sub: 40 + colWidths.desc + colWidths.qty + colWidths.price,
      gst: 40 + colWidths.desc + colWidths.qty + colWidths.price + colWidths.sub
    };

    doc
      .rect(40, tableY, 515, 22)
      .fill('#E2E8F0');

    doc
      .moveTo(40, tableY)
      .lineTo(rightAlignX, tableY)
      .lineWidth(0.5)
      .strokeColor('#CBD5E1')
      .stroke();

    doc
      .fillColor('#334155')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('DESCRIPTION', colX.desc + 10, tableY + 7)
      .text('QTY', colX.qty, tableY + 7, { width: colWidths.qty, align: 'center' })
      .text('UNIT PRICE', colX.price, tableY + 7, { width: colWidths.price, align: 'center' })
      .text('SUBTOTAL', colX.sub, tableY + 7, { width: colWidths.sub, align: 'center' })
      .text('GST', colX.gst, tableY + 7, { width: colWidths.gst - 10, align: 'center' });

    doc
      .moveTo(40, tableY + 22)
      .lineTo(rightAlignX, tableY + 22)
      .stroke();

    /* ── Line-Items Render Loop (Strict counts only) ─────── */

    let currentY = tableY + 22;
    let computedSubtotal = 0;
    const itemsArray = order.items || [];

    itemsArray.forEach(item => {
      const cartons = Number(item.cartons || 0);
      const pricePerCarton = Number(item.pricePerCarton || 0);
      const lineSubtotal = cartons * pricePerCarton;
      const lineGst = lineSubtotal * gstRate;
      
      computedSubtotal += lineSubtotal;

      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#000000')
        .text(item.name ? String(item.name).toUpperCase() : 'PRODUCT COMPONENT', colX.desc + 10, currentY + 8, { width: colWidths.desc - 15 })
        .text(String(cartons), colX.qty, currentY + 8, { width: colWidths.qty, align: 'center' })
        .text(pricePerCarton.toFixed(2), colX.price, currentY + 8, { width: colWidths.price, align: 'center' })
        .text(lineSubtotal.toFixed(2), colX.sub, currentY + 8, { width: colWidths.sub, align: 'center' })
        .text(`${lineGst.toFixed(2)} (9%)`, colX.gst, currentY + 8, { width: colWidths.gst - 10, align: 'center' });

      currentY += 28;

      doc
        .moveTo(40, currentY)
        .lineTo(rightAlignX, currentY)
        .lineWidth(0.5)
        .strokeColor('#CBD5E1')
        .stroke();
    });

    // Trace the internal structural column matrix divider lines based on actual item list length
    [colX.qty, colX.price, colX.sub, colX.gst].forEach(xVal => {
      doc.moveTo(xVal, tableY).lineTo(xVal, currentY).stroke();
    });

    // Outer framing vertical boundary trace line commands
    doc.moveTo(40, tableY).lineTo(40, currentY).stroke();
    doc.moveTo(rightAlignX, tableY).lineTo(rightAlignX, currentY).stroke();

    /* ── Financial Ledger Checkout Totals Calculation Block ── */

    currentY += 15;
    const calculatedGst = computedSubtotal * gstRate;
    const finalGrandTotalDue = computedSubtotal + calculatedGst;

    const summaryLabelX = 320;
    const summaryValX = 460;
    const summaryValWidth = 95;

    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#000000')
      .text('SUBTOTAL', summaryLabelX, currentY, { width: 130, align: 'right' })
      .text(`$${computedSubtotal.toFixed(2)}`, summaryValX, currentY, { width: summaryValWidth, align: 'right' });

    currentY += 16;

    doc
      .text('GST @ 9%', summaryLabelX, currentY, { width: 130, align: 'right' })
      .text(`$${calculatedGst.toFixed(2)}`, summaryValX, currentY, { width: summaryValWidth, align: 'right' });

    currentY += 16;

    doc
      .font('Helvetica-Bold')
      .text('Amount Due', summaryLabelX, currentY, { width: 130, align: 'right' })
      .text(`$${finalGrandTotalDue.toFixed(2)}`, summaryValX, currentY, { width: summaryValWidth, align: 'right' });

    /* ── Bottom Section: Remittance Instructions & Legal Border Box ── */

    currentY += 35;

    doc
      .rect(40, currentY, 250, 160)
      .lineWidth(0.75)
      .strokeColor('#000000')
      .stroke();

    doc
      .fillColor('#000000')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('DBS', 48, currentY + 10)
      .font('Helvetica')
      .text('Bank Code: 7171', 48, currentY + 22)
      .text('Branch Code: 123', 48, currentY + 34)
      .text('Bank account number:  123-4-567890', 48, currentY + 46)
      .fontSize(8)
      .text('Payment must be made within 30 days using the account number given above.', 48, currentY + 68, { width: 235 })
      .text('3% discount applied for new customer if payment is made 10 days before the credit period ends.', 48, currentY + 110, { width: 235 });

    doc
      .font('Helvetica')
      .fontSize(10)
      .text('[other payment methods]', 305, currentY + 70);

    /* ── Output Pipeline Compilation Execution Loop ── */

    doc.on('end', () => {
      const blob = new Blob(pdfChunks, { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      const downloadLink = document.createElement('a');
      downloadLink.href = url;
      downloadLink.download = `Tax_Invoice_${order.id}.pdf`;

      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);

      URL.revokeObjectURL(url);

      if (typeof showToast === 'function') {
        showToast('Invoice downloaded', `Saved Tax Invoice #${order.id} successfully.`, 'success');
      }
    });

    doc.end();
  } catch (error) {
    console.error('Invoice generation failed:', error);
    if (typeof showToast === 'function') {
      showToast('Invoice failed', error.message || 'Could not generate invoice.', 'error');
    }
  }
}


/* ============================================================
   Overview tab renderer
   ============================================================ */

function renderOverview() {
  const orders = getMyOrders();

  const spend = totalSpend(orders);
  const pending = orders.filter(order =>
    order.status === 'pending' ||
    order.status === 'processing'
  ).length;

  const isApproved = user.creditStatus === 'approved';
  const creditOrders = orders.filter(o => o.paymentMethod === 'credit' && o.paymentStatus === 'unpaid');
  const creditSpend = creditOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
  const limitVal = user.creditLimit || 25000;
  const creditUsed = Math.min((creditSpend / limitVal) * 100, 100);

  const nextStatus = orders.find(order => order.status === 'shipped')
    ? 'In Transit'
    : orders.find(order => order.status === 'processing')
      ? 'Being Prepared'
      : '—';

  let creditWidgetHTML = '';
  if (isApproved) {
    creditWidgetHTML = `
      <div
        class="kpi-card"
        style="flex-direction:column;gap:.75rem;">

        <div style="display:flex;align-items:center;gap:.75rem;">

          <div
            class="kpi-icon"
            style="background:#FEF3E2;">
            💳
          </div>

          <div>
            <div class="kpi-label">Credit Available</div>

            <div style="color:var(--brown);">
              SGD $${Math.max(limitVal - creditSpend, 0).toLocaleString()}
            </div>
          </div>

        </div>

        <div class="credit-bar">
          <div
            class="credit-fill"
            style="width:${creditUsed}%;background:var(--amber);">
          </div>
        </div>

        <div
          style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted-lt);">
          <span>Used $${creditSpend.toLocaleString()}</span>
          <span>Limit $${limitVal.toLocaleString()}</span>
        </div>

      </div>
    `;
  } else {
    creditWidgetHTML = `
      <div
        class="kpi-card"
        style="flex-direction:column;gap:.5rem;justify-content:center;">

        <div style="display:flex;align-items:center;gap:.75rem;">

          <div
            class="kpi-icon"
            style="background:#FEF3E2;">
            💳
          </div>

          <div>
            <div class="kpi-label">B2B Credit Terms</div>

            <div style="color:var(--brown);font-weight:500;font-size:0.95rem;">
              ${user.creditStatus === 'applied' ? '⏳ Pending Review' : user.creditStatus === 'rejected' ? '❌ Rejected' : '💡 Not Enabled'}
            </div>
          </div>

        </div>
        
        <div style="font-size:10px;color:var(--muted);margin-top:0.25rem;">
          ${user.creditStatus === 'applied' ? 'Your application is under evaluation.' : user.creditStatus === 'rejected' ? 'Credit terms not available.' : 'Apply in the Billing tab.'}
        </div>

      </div>
    `;
  }

  document.getElementById('panel-overview').innerHTML = `
    <div class="kpi-grid">

      <div class="kpi-card">

        <div
          class="kpi-icon"
          style="background:#EEF2FF;">
          🛍️
        </div>

        <div>
          <div class="kpi-label">Total Orders</div>

          <div class="kpi-num">
            ${orders.length}
          </div>

          <div class="kpi-sub">
            SGD $${spend.toLocaleString()} lifetime
          </div>

          ${
            pending > 0
              ? `
                <span
                  style="font-size:10px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;padding:2px 8px;border-radius:9999px;display:inline-block;margin-top:.35rem;">
                  ${pending} active
                </span>
              `
              : ''
          }
        </div>

      </div>

      <div class="kpi-card">

        <div
          class="kpi-icon"
          style="background:#EFF6FF;">
          🚚
        </div>

        <div>
          <div class="kpi-label">Next Delivery</div>

          <div
            class="kpi-num"
            style="font-size:1rem;">
            ${nextStatus}
          </div>

          <div class="kpi-sub">
            Est. 3–5 business days
          </div>
        </div>

      </div>

      ${creditWidgetHTML}

    </div>

    <div
      class="card"
      style="margin-bottom:1rem;">

      <div
        style="padding:1rem 1.5rem;border-bottom:1px solid #F0EAE4;display:flex;align-items:center;justify-content:space-between;">

        <h2 style="font-size:1rem;color:var(--brown);">
          Recent Orders
        </h2>

        <button
          onclick="switchTab('orders')"
          style="font-size:12px;color:var(--amber);background:none;border:none;cursor:pointer;"
          type="button">
          View all →
        </button>

      </div>

      ${orderListHTML(orders.slice(0, 3), '-ov')}

    </div>

    <div
      style="display:grid;grid-template-columns:repeat(2,1fr);gap:.75rem;">

      <button
        onclick="switchTab('profile')"
        class="quick-link"
        type="button">

        <div style="display:flex;align-items:center;gap:.75rem;">

          <div
            style="width:36px;height:36px;background:#FEF3E2;border-radius:10px;display:flex;align-items:center;justify-content:center;">
            👤
          </div>

          <div style="text-align:left;">

            <div style="font-size:13px;color:var(--brown);">
              Business Profile
            </div>

            <div style="font-size:11px;color:var(--muted);">
              ${escapeHTML(user.companyName || 'Company')}
            </div>

          </div>

        </div>

        <span style="color:var(--muted-lt);">
          ›
        </span>

      </button>

      <button
        onclick="switchTab('billing')"
        class="quick-link"
        type="button">

        <div style="display:flex;align-items:center;gap:.75rem;">

          <div
            style="width:36px;height:36px;background:#EFF6FF;border-radius:10px;display:flex;align-items:center;justify-content:center;">
            💳
          </div>

          <div style="text-align:left;">

            <div style="font-size:13px;color:var(--brown);">
              Billing &amp; Address
            </div>

            <div style="font-size:11px;color:var(--muted);">
              ${
                user.creditStatus === 'approved'
                  ? `${user.paymentTerms} · SGD $${(user.creditLimit || 25000).toLocaleString()} limit`
                  : user.creditStatus === 'applied'
                    ? 'Credit terms pending review'
                    : user.creditStatus === 'rejected'
                      ? 'Credit application rejected'
                      : 'Apply for B2B Credit Terms'
              }
            </div>

          </div>

        </div>

        <span style="color:var(--muted-lt);">
          ›
        </span>

      </button>

    </div>
  `;
}


/* ============================================================
   Orders tab renderer
   ============================================================ */

function renderOrders() {
  const orders = getMyOrders();

  document.getElementById('panel-orders').innerHTML = `
    <div class="card">

      <div
        style="padding:1rem 1.5rem;border-bottom:1px solid #F0EAE4;display:flex;align-items:center;justify-content:space-between;">

        <div style="display:flex;align-items:center;gap:.75rem;">

          <div
            style="width:32px;height:32px;background:#F5F0EB;border-radius:10px;display:flex;align-items:center;justify-content:center;">
            📦
          </div>

          <div>
            <h2 style="font-size:1rem;color:var(--brown);">
              Order History
            </h2>

            <p style="font-size:11px;color:var(--muted);">
              ${orders.length} order${orders.length !== 1 ? 's' : ''}
            </p>
          </div>

        </div>

        <a
          href="catalog.html"
          style="font-size:12px;color:var(--amber);">
          + New Order
        </a>

      </div>

      ${orderListHTML(orders)}

    </div>
  `;
}


/* ============================================================
   Profile tab renderer
   ============================================================ */

function renderProfile() {
  const u = user || Auth.getUser();

  if (!u) return;

  const viewHTML = `
    <div class="card">

      <div
        style="padding:1rem 1.5rem;border-bottom:1px solid #F0EAE4;display:flex;align-items:center;justify-content:space-between;">

        <div style="display:flex;align-items:center;gap:.75rem;">

          <div
            style="width:32px;height:32px;background:#FEF3E2;border-radius:10px;display:flex;align-items:center;justify-content:center;">
            👤
          </div>

          <h2 style="font-size:1rem;color:var(--brown);">
            Business Profile
          </h2>

        </div>

        <div style="display:flex;gap:.5rem;align-items:center;">
          <a
            href="mfa-setup.html"
            class="btn-ghost btn-sm"
            style="text-decoration:none;display:inline-flex;align-items:center;"
            role="button">
            🔒 Setup 2FA
          </a>

          <button
            onclick="startEdit()"
            class="btn-ghost btn-sm"
            type="button">
            ✏️ Edit
          </button>
        </div>
      </div>

      <div style="padding:1.5rem;">

        <div class="profile-grid">

          ${[
            ['Contact Name', u.contactName || '—'],
            ['Email', u.email || '—', 'Contact support to change'],
            ['Company Name', u.companyName || '—'],
            ['Business Type', u.businessType || '—']
          ].map(([label, value, note]) => `
            <div>

              <div class="profile-field-label">
                ${escapeHTML(label)}
              </div>

              <div class="profile-field-value">
                ${escapeHTML(value)}
              </div>

              ${
                note
                  ? `<div class="profile-field-note">${escapeHTML(note)}</div>`
                  : ''
              }

            </div>
          `).join('')}

          <div style="grid-column:1/-1;">

            <div class="profile-field-label">
              Delivery Address
            </div>

            <div class="profile-field-value">
              ${
                u.deliveryAddress
                  ? escapeHTML(u.deliveryAddress)
                  : '<span style="color:var(--muted-lt);font-style:italic;">Not set — click Edit to add</span>'
              }
            </div>

          </div>

        </div>

      </div>

    </div>
  `;

  const businessTypes = [
    'Office Manager',
    'Gym Operator',
    'Event Organiser',
    'Café Distributor',
    'Convenience Store',
    'Other'
  ];

  const editHTML = `
    <div class="card">

      <div
        style="padding:1rem 1.5rem;border-bottom:1px solid #F0EAE4;display:flex;align-items:center;justify-content:space-between;">

        <div style="display:flex;align-items:center;gap:.75rem;">

          <div
            style="width:32px;height:32px;background:#FEF3E2;border-radius:10px;display:flex;align-items:center;justify-content:center;">
            👤
          </div>

          <h2 style="font-size:1rem;color:var(--brown);">
            Business Profile
          </h2>

        </div>

        <div style="display:flex;gap:.5rem;">

          <button
            onclick="cancelEdit()"
            class="btn-ghost btn-sm"
            type="button">
            × Cancel
          </button>

          <button
            onclick="saveProfile()"
            class="btn-dark btn-sm"
            type="button">
            💾 Save
          </button>

        </div>

      </div>

      <div style="padding:1.5rem;">

        <div
          id="profile-err"
          style="display:none;"
          class="server-err"
          role="alert">
        </div>

        <div
          style="display:grid;grid-template-columns:repeat(2,1fr);gap:1rem;">

          <div class="field">

            <label for="p-contactName">
              Contact Name
            </label>

            <input
              class="input"
              id="p-contactName"
              value="${escapeHTML(u.contactName || '')}"
              placeholder="Jane Tan"/>

          </div>

          <div class="field">

            <label for="p-email">
              Email Address
            </label>

            <input
              class="input"
              id="p-email"
              type="email"
              value="${escapeHTML(u.email || '')}"
              placeholder="you@company.com"
              autocomplete="email"/>

            <p style="font-size:10px;color:var(--muted-lt);margin-top:4px;">
              A confirmation link will be sent to your new email address if changed.
            </p>

          </div>

          <div class="field">

            <label for="p-companyName">
              Company Name
            </label>

            <input
              class="input"
              id="p-companyName"
              value="${escapeHTML(u.companyName || '')}"
              placeholder="Your Company Pte. Ltd."/>

          </div>

          <div class="field">

            <label for="p-businessType">
              Business Type
            </label>

            <select
              class="input"
              id="p-businessType">

              <option value="">
                Select type…
              </option>

              ${businessTypes.map(type => `
                <option
                  value="${escapeHTML(type)}"
                  ${u.businessType === type ? 'selected' : ''}>
                  ${escapeHTML(type)}
                </option>
              `).join('')}

            </select>

          </div>

        </div>

        <div class="field">

          <label for="p-address">
            Delivery Address
            <span style="color:var(--muted-lt);">
              (Singapore)
            </span>
          </label>

          <textarea
            class="input"
            id="p-address"
            rows="2"
            style="resize:none;"
            placeholder="10 Anson Road, #22-01, Singapore 079903">${escapeHTML(u.deliveryAddress || '')}</textarea>

        </div>

      </div>

    </div>
  `;

  document.getElementById('panel-profile').innerHTML =
    editing ? editHTML : viewHTML;
}


/* ============================================================
   Profile edit controls
   ============================================================ */

function startEdit() {
  editing = true;
  renderProfile();
}


function cancelEdit() {
  editing = false;
  renderProfile();
}


async function saveProfile() {
  const contactName = document.getElementById('p-contactName').value.trim();
  const companyName = document.getElementById('p-companyName').value.trim();
  const businessType = document.getElementById('p-businessType').value;
  const deliveryAddress = document.getElementById('p-address').value.trim();
  const newEmail    = (document.getElementById('p-email')?.value || '').trim();
  const errEl = document.getElementById('profile-err');

  errEl.textContent = '';
  errEl.style.display = 'none';

  if (!contactName) {
    errEl.textContent = '⚠️ Contact name is required.';
    errEl.style.display = 'flex';
    return;
  }

  if (companyName.length < 2) {
    errEl.textContent = '⚠️ Company name must be at least 2 characters.';
    errEl.style.display = 'flex';
    return;
  }

  if (!businessType) {
    errEl.textContent = '⚠️ Please select a business type.';
    errEl.style.display = 'flex';
    return;
  }

  // ── Email validation ──────────────────────────────────────
  if (!newEmail) {
    errEl.textContent = '⚠️ Email address is required.';
    errEl.style.display = 'flex';
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    errEl.textContent = '⚠️ Please enter a valid email address.';
    errEl.style.display = 'flex';
    return;
  }

  const currentUser   = user || Auth.getUser();
  const emailChanged  = newEmail.toLowerCase() !== (currentUser?.email || '').toLowerCase();

  if (emailChanged) {
    const client = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;

    if (client) {
      // Uniqueness check against profiles table
      const { data: existingProfile } = await client
        .from('profiles')
        .select('id')
        .eq('email', newEmail.toLowerCase())
        .maybeSingle();

      if (existingProfile) {
        errEl.textContent = '⚠️ This email address is already registered to another account.';
        errEl.style.display = 'flex';
        return;
      }

      // Update email via Supabase Auth (sends confirmation to new address)
      const { error: emailError } = await client.auth.updateUser({ email: newEmail });

      if (emailError) {
        errEl.textContent = '⚠️ ' + (emailError.message || 'Could not update email address.');
        errEl.style.display = 'flex';
        return;
      }
    }
  }

  // ── Save remaining profile fields (+ email in profiles table) ─
  const result = await Auth.updateProfile({
    contactName,
    companyName,
    businessType,
    deliveryAddress,
    email: newEmail
  });

  if (!result.ok) {
    errEl.textContent = '⚠️ ' + result.error;
    errEl.style.display = 'flex';
    return;
  }

  user = Auth.getUser();
  editing = false;

  const toastMsg = emailChanged
    ? 'Check your new inbox for a confirmation link.'
    : 'Your account details have been saved.';

  showToast('Profile updated', toastMsg);

  buildNav('account');
  initHero();
  renderAll();
}


/* ============================================================
   Billing tab renderer
   ============================================================ */

function renderBilling() {
  const orders = getMyOrders();
  const u = user || Auth.getUser();

  // Credit calculation
  const creditOrders = orders.filter(o => o.paymentMethod === 'credit' && o.paymentStatus === 'unpaid');
  const creditSpend = creditOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
  const limit = u.creditLimit || 25000;
  const available = Math.max(limit - creditSpend, 0);
  const used = Math.min((creditSpend / limit) * 100, 100);

  const barColor = used > 80
    ? '#f87171'
    : used > 50
      ? '#fbbf24'
      : 'var(--amber)';

  let creditSectionHTML = '';

  if (u.creditStatus === 'none') {
    creditSectionHTML = `
      <div class="card" style="padding:2rem 1.5rem; text-align:center;">
        <div style="font-size:2rem; margin-bottom:.5rem;">💳</div>
        <h3 style="color:var(--brown); margin-bottom:.5rem; font-size:1.1rem;">Instant B2B Credit Issuance</h3>
        <p style="font-size:12px; color:var(--muted); margin-bottom:1.25rem; line-height:1.4; max-width: 480px; margin-left: auto; margin-right: auto;">
          Get credit terms of Net 30 or Net 60 to place wholesale orders instantly and pay later. Application approval takes minutes.
        </p>
        <button onclick="applyForCredit()" class="btn-dark btn-sm" id="apply-credit-btn" style="padding: 8px 16px;">
          Apply for Credit Terms
        </button>
      </div>
    `;
  } else if (u.creditStatus === 'applied') {
    creditSectionHTML = `
      <div class="card" style="padding:2rem 1.5rem; text-align:center;">
        <div style="font-size:2rem; margin-bottom:.5rem;">⏳</div>
        <h3 style="color:var(--brown); margin-bottom:.5rem; font-size:1.1rem;">Application Pending Review</h3>
        <p style="font-size:12px; color:var(--muted); line-height:1.4; max-width: 480px; margin-left: auto; margin-right: auto;">
          Your corporate credit terms application is currently under evaluation. Our finance team will confirm and approve your limit shortly.
        </p>
      </div>
    `;
  } else if (u.creditStatus === 'rejected') {
    creditSectionHTML = `
      <div class="card" style="padding:2rem 1.5rem; text-align:center;">
        <div style="font-size:2rem; margin-bottom:.5rem;">❌</div>
        <h3 style="color:var(--brown); margin-bottom:.5rem; font-size:1.1rem;">Credit Application Declined</h3>
        <p style="font-size:12px; color:var(--muted); margin-bottom:1.25rem; line-height:1.4; max-width: 480px; margin-left: auto; margin-right: auto;">
          We cannot offer credit terms for your account at this time. You can still order through our standard card checkout.
        </p>
        <button onclick="applyForCredit()" class="btn-ghost btn-sm" id="apply-credit-btn" style="border: 1px solid var(--muted-lt); padding: 6px 12px; border-radius: 6px;">
          Re-apply for Credit Terms
        </button>
      </div>
    `;
  } else if (u.creditStatus === 'approved') {
    creditSectionHTML = `
      <div class="card" style="padding:1.5rem;">
        <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1.25rem;">
          <div style="width:36px;height:36px;background:#FEF3E2;border-radius:10px;display:flex;align-items:center;justify-content:center;">
            💳
          </div>
          <h3 style="color:var(--brown);">Payment Terms</h3>
        </div>

        ${[
          ['Payment Terms', u.paymentTerms || 'Net 30', false],
          ['Credit Limit', `SGD $${limit.toLocaleString()}`, false],
          ['Available Credit', `SGD $${available.toLocaleString()}`, true],
          ['Unpaid Credit Balance', `SGD $${creditSpend.toLocaleString()}`, false]
        ].map(([label, value, green]) => `
          <div class="billing-row">
            <span style="color:var(--brown-lt);">${escapeHTML(label)}</span>
            <span style="${green ? 'color:#16a34a;' : 'color:var(--brown);'}">
              ${escapeHTML(value)}
            </span>
          </div>
        `).join('')}

        <div style="margin-top:1rem;">
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-bottom:.35rem;">
            <span>Credit utilisation</span>
            <span>${Math.round(used)}%</span>
          </div>
          <div class="credit-bar">
            <div class="credit-fill" style="width:${used}%;background:${barColor};"></div>
          </div>
        </div>
      </div>
    `;
  }

  document.getElementById('panel-billing').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:1rem;">
      ${creditSectionHTML}

      <div
        class="card"
        style="padding:1.5rem;">

        <div
          style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">

          <div style="display:flex;align-items:center;gap:.75rem;">

            <div
              style="width:36px;height:36px;background:#EFF6FF;border-radius:10px;display:flex;align-items:center;justify-content:center;">
              📍
            </div>

            <h3 style="color:var(--brown);">
              Delivery Address
            </h3>

          </div>

          <button
            onclick="switchTab('profile');startEdit();"
            style="font-size:12px;color:var(--amber);background:none;border:none;cursor:pointer;"
            type="button">
            ✏️ Edit
          </button>

        </div>

        <div
          style="background:#FAF8F5;border:1px solid #F0EAE4;border-radius:12px;padding:1rem;font-size:13px;color:var(--brown-lt);">

          ${
            u.companyName
              ? `<div style="color:var(--brown);margin-bottom:.25rem;">${escapeHTML(u.companyName)}</div>`
              : ''
          }

          ${
            u.deliveryAddress
              ? escapeHTML(u.deliveryAddress)
              : '<span style="color:var(--muted-lt);font-style:italic;">No address saved yet.</span>'
          }

        </div>

      </div>

    </div>
  `;
}


/* ============================================================
   Render all panels
   ============================================================ */

function renderAll() {
  renderOverview();
  renderOrders();
  renderProfile();
  renderBilling();

  const count = getMyOrders().length;
  const badge = document.getElementById('order-count-badge');

  if (badge) {
    badge.textContent = count > 0 ? count : '';
  }
}


/* ============================================================
   Tab switching
   ============================================================ */

function switchTab(name) {
  ['overview', 'orders', 'profile', 'billing', 'subscriptions'].forEach(tab => {
    const panel = document.getElementById('panel-' + tab);
    const btn = document.getElementById('tab-' + tab);

    if (panel) {
      panel.style.display = tab === name ? 'block' : 'none';
    }

    if (btn) {
      btn.classList.toggle('active', tab === name);
      btn.setAttribute('aria-selected', tab === name ? 'true' : 'false');
    }
  });
}


/* ============================================================
   Wire tab buttons
   ============================================================ */

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab);
  });
});


/* ============================================================
   Loading display
   ============================================================ */

function setAccountLoading(isLoading) {
  const loading = document.getElementById('account-loading');
  const panels = document.getElementById('account-panels');

  if (loading) {
    loading.style.display = isLoading ? 'block' : 'none';
  }

  if (panels) {
    panels.style.display = isLoading ? 'none' : 'block';
  }
}

/* ============================================================
   Initialise page
   ============================================================ */

async function initAccountPage() {
  buildNav('account');
  buildFooter();

  setAccountLoading(true);

  const refreshedUser = await Auth.refreshUser();

  if (!refreshedUser) {
    localStorage.setItem('redirectAfterLogin', 'account.html');
    window.location.href = 'login.html';
    return;
  }

  user = refreshedUser;

  try {
    myOrders = await Orders.forCurrentUser();
  } catch (error) {
    console.error('Failed to load orders:', error);

    showToast(
      'Could not load orders',
      'Please refresh the page or try again later.',
      'error'
    );

    myOrders = [];
  }

  initHero();
  renderAll();
  loadSubscriptions();
  switchTab('overview');

  setAccountLoading(false);
}

async function loadSubscriptions() {
  // 1. Use 'sb' (your Supabase connection name)
  // 2. Use 'user_id' (to match your SQL schema)
  const { data, error } = await sb
    .from("subscriptions")
    .select(`
      *,
      subscription_items (*)
    `)
    .eq("user_id", user.id) 
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Subscription Load Error:", error);
    return;
  }

  console.log("Subscriptions found:", data); // Check your console for this!
  renderSubscriptions(data || []);
}

function renderSubscriptions(subscriptions) {
  const container = document.getElementById("subscriptionsList");

  if (!subscriptions.length) {
    container.innerHTML = `
      <div style="padding:4rem 1.5rem;display:flex;flex-direction:column;align-items:center;text-align:center;">
        <div style="font-size:2.5rem;margin-bottom:.75rem;opacity:.3;">🔄</div>
        <div style="color:var(--brown);margin-bottom:.35rem;">No active subscriptions</div>
        <p style="font-size:13px;color:var(--muted);margin-bottom:1.25rem;">Set up a recurring order in the catalog to save time.</p>
        <a href="catalog.html" class="btn-dark btn-sm">Browse Catalog →</a>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="card">
      <div style="padding:1rem 1.5rem;border-bottom:1px solid #F0EAE4;display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:.75rem;">
          <div style="width:32px;height:32px;background:#F5F0EB;border-radius:10px;display:flex;align-items:center;justify-content:center;">🔄</div>
          <div>
            <h2 style="font-size:1rem;color:var(--brown);">Recurring Deliveries</h2>
            <p style="font-size:11px;color:var(--muted);">${subscriptions.length} subscription${subscriptions.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>

      ${subscriptions.map(sub => {
        const isActive = sub.status === 'active';
        const dotColor = isActive ? '#4ade80' : '#fbbf24'; // Matches your Order dots
        const date = new Date(sub.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
        
        // Calculate total amount for the subscription
        const totalAmount = (sub.subscription_items || []).reduce((sum, item) => sum + (item.cartons * item.price_per_carton), 0);

        return `
          <div class="order-row">
            <div class="order-row-header" onclick="toggleSubscriptionDetail('${sub.id}')" role="button" id="sub-hdr-${sub.id}">
              <div class="order-dot" style="background:${dotColor};"></div>
              
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.2rem;flex-wrap:wrap;">
                  <span class="order-id" style="text-transform: capitalize;">${sub.frequency} Delivery</span>
                  <span class="order-badge" style="background:transparent; border: 1px solid #F0EAE4; color: var(--brown-lt);">
                    ${sub.status.toUpperCase()}
                  </span>
                </div>
                <div class="order-meta">
                  #${sub.id.slice(0,8).toUpperCase()} · Started ${date}
                </div>
              </div>

              <div class="order-amount">
                SGD $${totalAmount.toFixed(2)}
              </div>

              <div class="order-chevron" id="sub-chev-${sub.id}">▾</div>
            </div>

            <div class="order-detail" id="sub-det-${sub.id}" style="display:none; padding: 0 1.5rem 1.25rem;">
              <div class="order-items">
                <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.6rem;">Subscription Items</div>
                
                ${(sub.subscription_items || []).map(item => `
                  <div class="order-item-row">
                    <span style="color:var(--brown);">
                      ${item.cartons} cartons × ${item.name || 'Product'}
                    </span>
                    <span style="color:var(--brown-lt);">
                      SGD $${(item.cartons * item.price_per_carton).toFixed(2)}
                    </span>
                  </div>
                `).join('')}
              </div>

              <div style="display:flex;gap:.6rem;">
                <button onclick="toggleSubscription('${sub.id}', '${sub.status}')" class="btn-dark" style="flex:1;justify-content:center;padding:.6rem;">
                  ${isActive ? '⏸ Pause Subscription' : '▶️ Resume Subscription'}
                </button>
                <button onclick="cancelSubscription('${sub.id}')" class="btn-ghost" style="padding:.6rem 1rem; color: #ef4444;">
                  ✕ Cancel
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// Add this helper to handle the expansion (matches your toggleOrder logic)
function toggleSubscriptionDetail(id) {
  const detail = document.getElementById('sub-det-' + id);
  const chevron = document.getElementById('sub-chev-' + id);
  
  if (!detail) return;
  
  const isHidden = detail.style.display === 'none';
  detail.style.display = isHidden ? 'block' : 'none';
  
  if (chevron) {
    chevron.classList.toggle('open', isHidden);
  }
}

async function toggleSubscription(id, currentStatus) {
  const newStatus = currentStatus === "active" ? "paused" : "active";

  const { error } = await sb
    .from("subscriptions")
    .update({ status: newStatus })
    .eq("id", id);

  if (error) {
    showToast("Error", error.message, "error");
  } else {
    loadSubscriptions();
  }
}

async function cancelSubscription(id) {
  if (!confirm("Are you sure you want to cancel this subscription?")) return;

  const { error } = await sb
    .from("subscriptions")
    .update({ status: "cancelled" })
    .eq("id", id);

  if (error) {
    showToast("Error", error.message, "error");
  } else {
    showToast("Cancelled", "Subscription stopped.");
    loadSubscriptions();
  }
}

async function applyForCredit() {
  const btn = document.getElementById('apply-credit-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Applying...';
  }

  try {
    const { error } = await sb
      .from('profiles')
      .update({
        credit_status: 'applied',
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);

    if (error) throw error;

    showToast('Application Submitted', 'Your credit application is now pending review.');
    user.creditStatus = 'applied';
    
    // Refresh user state
    const refreshed = await Auth.refreshUser();
    if (refreshed) user = refreshed;
    renderAll();
  } catch (err) {
    console.error("Failed to submit B2B credit application:", err);
    showToast('Application Failed', err.message || 'Could not submit application.', 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Apply for Credit Terms';
    }
  }
}
window.applyForCredit = applyForCredit;

initAccountPage();