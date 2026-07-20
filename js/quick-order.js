/* ============================================================
   quick-order.js — Logic for quick-order.html
   Depends on: shared.js
   Uses:
   - Auth
   - Products
   - Orders
   - getActiveTier
   - miniPouchSVG
   - buildNav
   - buildFooter
   - showToast

   Supabase version
   ============================================================ */


/* ============================================================
   Page state
   ============================================================ */

function safeEscape(str) {
  if (typeof escapeHTML === 'function') return escapeHTML(str);
  if (typeof window.escapeHTML === 'function') return window.escapeHTML(str);
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const db = window.sb || window.supabaseClient;

let user = null;

let active = [];
let comingSoon = [];

// Per-product quantity state: { productId: number }
let quantities = {};
let activePresetId = null;
let currentPresets = [];
let cachedUserOrders = [];


/* ============================================================
   Supabase product loading
   ============================================================ */

function normaliseProduct(row, tierRows = []) {
  return {
    id: row.id,
    sku: row.sku || "",
    name: row.name || "",
    subtitle: row.subtitle || "",
    caffeine: row.caffeine || "",
    format: row.format || "",
    shelfLife: row.shelf_life || "",
    pouchColor: row.pouch_color || "#4B2E22",
    pouchAccent: row.pouch_accent || "#C78A3B",
    labelColor: row.label_color || "#FFF7ED",
    active: row.active === true,
    comingSoonHint: row.coming_soon_hint || "Coming soon",
    imageUrl: row.image_url || "",

    tiers: tierRows.length
      ? tierRows.map(tier => ({
          min: Number(tier.min_quantity),
          max: tier.max_quantity === null ? null : Number(tier.max_quantity),
          price: Number(tier.price)
        }))
      : [
          {
            min: 1,
            max: null,
            price: 0
          }
        ]
  };
}


async function loadProductsFromSupabase() {
  if (!db) {
    throw new Error("Supabase client is not available.");
  }

  const { data: productsData, error: productsError } = await db
    .from("products")
    .select("*")
    .order("created_at", { ascending: true });

  if (productsError) {
    throw productsError;
  }

  const { data: tiersData, error: tiersError } = await db
    .from("product_tiers")
    .select("*")
    .order("min_quantity", { ascending: true });

  if (tiersError) {
    throw tiersError;
  }

  const tiersByProduct = {};

  (tiersData || []).forEach(tier => {
    if (!tiersByProduct[tier.product_id]) {
      tiersByProduct[tier.product_id] = [];
    }

    tiersByProduct[tier.product_id].push(tier);
  });

  const catalogProducts = (productsData || []).map(product => {
    return normaliseProduct(product, tiersByProduct[product.id] || []);
  });

  active = catalogProducts.filter(product => product.active);
  comingSoon = catalogProducts.filter(product => !product.active);

  console.log("Products loaded dynamically from Supabase for Quick Order:", catalogProducts);
}


function loadFallbackProducts() {
  if (typeof Products === "undefined") {
    active = [];
    comingSoon = [];
    return;
  }

  active = Products.filter(product => product.active);
  comingSoon = Products.filter(product => !product.active);

  console.warn("Using fallback Products from shared.js in Quick Order");
}


/* ============================================================
   Quantity helpers
   ============================================================ */

function getQty(id) {
  return quantities[id] || 0;
}


function setQty(id, val) {
  const n = Math.max(0, parseInt(val, 10) || 0);

  if (n <= 0) {
    delete quantities[id];
  } else {
    quantities[id] = n;
  }

  renderAll();
}

window.setQty = setQty;


/* ============================================================
   Tier progress bar calculation
   ============================================================ */

/**
 * Returns a CSS width string showing progress towards the next tier.
 * Stays at 100% once the maximum tier is reached.
 */
function tierBarWidth(product, qty) {
  if (qty === 0) return '0%';

  const activeTier = getActiveTier(product.tiers, qty);
  const idx = product.tiers.findIndex(t => t.min === activeTier.min);

  if (idx === product.tiers.length - 1) {
    return '100%';
  }

  const curr = product.tiers[idx];
  const next = product.tiers[idx + 1];

  const pct = ((qty - curr.min) / (next.min - curr.min)) * 60 + idx * 40;

  return Math.min(pct, 95) + '%';
}


/* ============================================================
   Order line helpers
   ============================================================ */

function getOrderLines() {
  return active
    .filter(p => getQty(p.id) > 0)
    .map(p => {
      const qty = getQty(p.id);
      const tier = getActiveTier(p.tiers, qty);

      return {
        p,
        qty,
        tier,
        subtotal: qty * tier.price
      };
    });
}


function getTotalCartons(lines) {
  return lines.reduce((sum, line) => sum + line.qty, 0);
}


function getTotalAmount(lines) {
  return lines.reduce((sum, line) => sum + line.subtotal, 0);
}


function getBaseAmount(lines) {
  return lines.reduce((sum, line) => {
    return sum + line.qty * line.p.tiers[0].price;
  }, 0);
}


/* ============================================================
   Product row renderer
   ============================================================ */

/**
 * Builds HTML for all product rows:
 * - active products with full ordering UI
 * - coming soon products as dimmed rows
 */
function renderProductRows() {
  const rowsEl = document.getElementById('product-rows');

  if (!rowsEl) return;

  rowsEl.innerHTML = [
    ...active.map(p => {
      const qty = getQty(p.id);
      const tier = getActiveTier(p.tiers, qty);
      const tierIdx = p.tiers.findIndex(t => t.min === tier.min);
      const nextTier = p.tiers[tierIdx + 1];
      const subtotal = qty > 0 ? qty * tier.price : 0;

      const pct = tierIdx > 0
        ? Math.round((1 - tier.price / p.tiers[0].price) * 100)
        : 0;

      return `
        <div class="product-row-card" role="listitem">

          <div class="product-row-top">

            <div
              class="product-row-icon"
              style="background:${p.pouchColor || '#C8580A'}22;">
              ${p.imageUrl
                ? `<img src="${escapeHTML(p.imageUrl)}" alt="${escapeHTML(p.name)}" class="product-row-icon-img" style="width:100%; height:100%; object-fit:contain; border-radius:8px; padding:2px; box-sizing:border-box;" />`
                : miniPouchSVG(p.pouchColor || '#C8580A', p.pouchAccent || '#8B3A00', 28)
              }
            </div>

            <div style="flex:1;min-width:0;">
              <div style="color:var(--brown);">
                ${escapeHTML(p.name)}
              </div>

              <div style="font-size:12px;color:var(--muted);">
                ${escapeHTML(p.subtitle)}
              </div>
            </div>

            <div style="text-align:right;flex-shrink:0;">
              <div style="color:var(--brown);">
                SGD $${tier.price}
                <span style="font-size:11px;color:var(--muted);">
                  /ctn
                </span>
              </div>

              ${
                pct
                  ? `<div style="font-size:10px;color:#16a34a;">−${pct}% tier</div>`
                  : ''
              }
            </div>

          </div>

          <div class="product-row-body">

            <!-- Tier progress bar -->
            <div>

              <div class="tier-strip-labels">
                ${p.tiers.map((t, i) => `
                  <span onclick="setQty('${p.id}', ${t.min})" style="${
                    i === tierIdx && qty > 0
                      ? 'color:var(--amber);font-weight:500;'
                      : ''
                  }" role="button" aria-label="Set quantity to ${t.min} cartons">
                    ${
                      t.max
                        ? `${t.min}–${t.max}`
                        : `${t.min}+`
                    } ctn
                  </span>
                `).join('')}
              </div>

              <div class="tier-strip-bar">
                <div
                  class="tier-strip-fill"
                  style="width:${tierBarWidth(p, qty)};">
                </div>
              </div>

              ${
                nextTier && qty > 0
                  ? `
                    <p class="tier-strip-hint">
                      +${nextTier.min - qty} cartons → unlock
                      <strong>$${nextTier.price}/ctn</strong>
                      (−${Math.round((1 - nextTier.price / p.tiers[0].price) * 100)}%)
                    </p>
                  `
                  : ''
              }

            </div>

            <!-- Quantity stepper -->
            <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;">

              <div class="stepper">

                <button
                  class="stepper-btn"
                  onclick="setQty('${p.id}', ${Math.max(0, qty - 1)})"
                  ${qty === 0 ? 'disabled' : ''}
                  aria-label="Decrease ${escapeHTML(p.name)} quantity">
                  −
                </button>

                <input
                  class="stepper-input"
                  type="number"
                  min="0"
                  value="${qty || ''}"
                  placeholder="0"
                  oninput="setQty('${p.id}', this.value)"
                  onchange="setQty('${p.id}', this.value)"
                  aria-label="${escapeHTML(p.name)} quantity in cartons"/>

                <button
                  class="stepper-btn"
                  onclick="setQty('${p.id}', ${qty + 1})"
                  aria-label="Increase ${escapeHTML(p.name)} quantity">
                  +
                </button>

              </div>

              <span style="font-size:12px;color:var(--muted);">
                cartons · 50 pouches each
              </span>

              ${
                qty > 0
                  ? `
                    <div class="subtotal-pill" style="margin-left:auto;">
                      <div style="color:var(--amber);">
                        SGD $${subtotal.toFixed(2)}
                      </div>

                      <div style="font-size:10px;color:var(--muted);">
                        ${(qty * 50).toLocaleString()} pouches
                      </div>
                    </div>
                  `
                  : ''
              }

            </div>

          </div>

        </div>
      `;
    }),

    ...comingSoon.map(p => `
      <div class="coming-row">

        <div class="coming-row-inner">

          <div
            class="product-row-icon"
            style="background:${p.pouchColor || '#C8580A'}22; opacity:0.5;">
            ${p.imageUrl
              ? `<img src="${escapeHTML(p.imageUrl)}" alt="${escapeHTML(p.name)}" class="product-row-icon-img" style="width:100%; height:100%; object-fit:contain; border-radius:8px; padding:2px; box-sizing:border-box;" />`
              : miniPouchSVG(p.pouchColor || '#C8580A', p.pouchAccent || '#8B3A00', 28)
            }
          </div>

          <div style="flex:1;min-width:0;">

            <div style="display:flex;align-items:center;gap:.5rem;">
              <span style="color:var(--brown);">
                ${escapeHTML(p.name)}
              </span>

              <span class="coming-tag">
                Coming Soon
              </span>
            </div>

            <div style="font-size:12px;color:var(--muted);">
              ${escapeHTML(p.comingSoonHint || 'Coming soon')}
            </div>

          </div>

          <div style="font-size:12px;color:var(--muted-lt);">
            from SGD $${p.tiers[0]?.price}/ctn
          </div>

        </div>

      </div>
    `)
  ].join('');
}


/* ============================================================
   Order summary sidebar renderer
   ============================================================ */

/**
 * Rebuilds the sidebar summary with current quantities and totals.
 */
function renderSummary() {
  const lines = getOrderLines();

  const hasLines = lines.length > 0;
  const totalCtn = getTotalCartons(lines);
  const totalAmt = getTotalAmount(lines);
  const baseAmt = getBaseAmount(lines);
  const savings = baseAmt - totalAmt;

  const emptySummary = document.getElementById('empty-summary');
  const placeOrderBtn = document.getElementById('place-order-btn');
  const useCreditBtn = document.getElementById('use-credit-btn');
  const clearAllBtn = document.getElementById('clear-all-btn');
  const summaryLines = document.getElementById('summary-lines');
  const summaryTotals = document.getElementById('summary-totals');

  if (!emptySummary || !placeOrderBtn || !clearAllBtn || !summaryLines || !summaryTotals) {
    return;
  }

  emptySummary.style.display = hasLines ? 'none' : 'block';
  placeOrderBtn.disabled = !hasLines;
  placeOrderBtn.textContent = "Pay Online (Card) →";
  clearAllBtn.disabled = !hasLines;
  if (useCreditBtn) {
    useCreditBtn.disabled = !hasLines;
  }

  if (hasLines) {
    summaryLines.innerHTML = lines.map(({ p, qty, tier, subtotal }) => {
      const imgUrl = p.imageUrl || p.image_url;
      let visualHtml = '';
      if (imgUrl) {
        visualHtml = `<img src="${safeEscape(imgUrl)}" alt="${safeEscape(p.name || '')}" style="width:24px;height:24px;object-fit:contain;border-radius:4px;" />`;
      } else if (typeof miniPouchSVG === 'function') {
        visualHtml = miniPouchSVG(p.pouchColor || '#C8580A', p.pouchAccent || '#8B3A00', 20);
      } else {
        visualHtml = `<div class="summary-dot" style="background:${p.pouchColor || '#C8580A'};"></div>`;
      }

      return `
        <div class="summary-line">

          <div class="summary-thumb" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            ${visualHtml}
          </div>

          <div style="flex:1;min-width:0;">

            <div
              style="font-size:11.5px;font-weight:600;color:var(--brown);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${escapeHTML(p.name)}
            </div>

            <div style="font-size:10.5px;color:var(--muted);">
              ${qty} ctn × SGD $${tier.price}
            </div>

          </div>

          <span style="font-size:12px;font-weight:700;color:var(--brown);white-space:nowrap;">
            SGD $${subtotal.toFixed(2)}
          </span>

        </div>
      `;
    }).join('');

    summaryTotals.style.display = 'flex';

    summaryTotals.innerHTML = `
      <div class="summary-total-row">
        <span>Cartons</span>
        <span>${totalCtn}</span>
      </div>

      <div class="summary-total-row">
        <span>Pouches</span>
        <span>${(totalCtn * 50).toLocaleString()}</span>
      </div>

      ${
        savings > 0
          ? `
            <div class="savings-row">
              <span>✨ Volume savings</span>
              <span>−SGD $${savings.toFixed(2)}</span>
            </div>
          `
          : ''
      }

      <div
        class="summary-total-row"
        style="font-size:14px;color:var(--brown);border-top:1px solid #F0EAE4;padding-top:.5rem;margin-top:.15rem;">

        <span>Total</span>

        <span style="color:var(--amber);font-size:1.1rem;">
          SGD $${totalAmt.toFixed(2)}
        </span>

      </div>
    `;
  } else {
    summaryLines.innerHTML = '';
    summaryTotals.style.display = 'none';
  }

  // --- B2B Credit Limit Check & Payment Options ---
  const creditWarning = document.getElementById("quick-order-credit-warning");
 
  if (useCreditBtn && creditWarning) {
    if (user && user.creditStatus === 'approved') {
      useCreditBtn.style.display = "block";
      
      const spent = window.userSpentCredit || 0;
      const available = Math.max(user.creditLimit - spent, 0);
      
      if (totalAmt > available) {
        useCreditBtn.disabled = true;
        useCreditBtn.textContent = "Insufficient Credit ⚠️";
        creditWarning.style.display = "block";
        creditWarning.textContent = `⚠️ Exceeds available credit of SGD $${available.toFixed(2)}`;
      } else {
        useCreditBtn.disabled = !hasLines;
        useCreditBtn.textContent = `Use B2B Credit (${user.paymentTerms}) →`;
        creditWarning.style.display = "none";
      }
    } else {
      useCreditBtn.style.display = "none";
      creditWarning.style.display = "none";
    }
  }
}


/* ============================================================
   Render all
   ============================================================ */

function renderAll() {
  renderProductRows();
  renderSummary();
}


/* ============================================================
   Action buttons event binding (Stripe, Credit, Clear)
   ============================================================ */
function bindActionButtons() {
  const placeBtn = document.getElementById('place-order-btn');
  if (placeBtn && !placeBtn.dataset.bound) {
    placeBtn.dataset.bound = 'true';
    placeBtn.addEventListener('click', async () => {
      const creditBtn = document.getElementById('use-credit-btn');
      const lines = getOrderLines();

      if (!lines.length) {
        showToast('No items selected', 'Enter quantities before placing an order.', 'error');
        return;
      }

      placeBtn.disabled = true;
      placeBtn.textContent = 'Connecting...';
      if (creditBtn) creditBtn.disabled = true;

      try {
        const refreshedUser = await Auth.refreshUser();
        if (!refreshedUser) {
          localStorage.setItem('redirectAfterLogin', 'quick-order.html');
          window.location.href = 'login.html';
          return;
        }

        const formattedCart = Object.entries(quantities).map(([productId, quantity]) => ({
          product_id: productId,
          quantity: quantity
        }));

        console.log("Quick Order - Sending to Stripe:", formattedCart);

        const res = await apiFetch('/api/create-checkout-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            cart: formattedCart,
            profile: refreshedUser
          })
        });

        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
        } else {
          throw new Error(data.error || "Failed to create payment session");
        }

      } catch (error) {
        console.error('Quick Order Stripe Error:', error);
        showToast('Order failed', error.message, 'error');
      } finally {
        if (placeBtn) {
          placeBtn.disabled = false;
          placeBtn.textContent = 'Pay Online (Card) →';
        }
        if (creditBtn) creditBtn.disabled = false;
      }
    });
  }

  const creditBtn = document.getElementById('use-credit-btn');
  if (creditBtn && !creditBtn.dataset.bound) {
    creditBtn.dataset.bound = 'true';
    creditBtn.addEventListener('click', async () => {
      const placeBtn = document.getElementById('place-order-btn');
      const lines = getOrderLines();

      if (!lines.length) {
        showToast('No items selected', 'Enter quantities before placing an order.', 'error');
        return;
      }

      creditBtn.disabled = true;
      creditBtn.textContent = 'Placing Order...';
      if (placeBtn) placeBtn.disabled = true;

      try {
        const refreshedUser = await Auth.refreshUser();
        if (!refreshedUser) {
          localStorage.setItem('redirectAfterLogin', 'quick-order.html');
          window.location.href = 'login.html';
          return;
        }

        const orderObj = {
          totalCartons: getTotalCartons(lines),
          totalAmount: getTotalAmount(lines),
          status: 'pending',
          notes: `Paid via B2B Credit Terms (${refreshedUser.paymentTerms})`,
          paymentMethod: 'credit',
          paymentStatus: 'unpaid',
          creditTerms: refreshedUser.paymentTerms,
          items: lines.map(line => ({
            productId: line.p.id,
            sku: line.p.sku,
            name: line.p.name,
            cartons: line.qty,
            pricePerCarton: line.tier.price
          }))
        };

        const savedOrder = await Orders.add(orderObj);
        console.log("Quick Order saved on credit terms:", savedOrder);

        quantities = {};
        renderAll();

        showToast('Order Placed', 'Your B2B Credit order has been submitted successfully.', 'success');
        
        setTimeout(() => {
          window.location.href = 'account.html';
        }, 2000);

      } catch (error) {
        console.error('Quick Order Credit Error:', error);
        showToast('Order failed', error.message, 'error');
      } finally {
        if (creditBtn) {
          creditBtn.disabled = false;
          creditBtn.textContent = `Use B2B Credit (${user ? user.paymentTerms : 'Net 30'}) →`;
        }
        if (placeBtn) placeBtn.disabled = false;
      }
    });
  }

  const clearBtn = document.getElementById('clear-all-btn');
  if (clearBtn && !clearBtn.dataset.bound) {
    clearBtn.dataset.bound = 'true';
    clearBtn.addEventListener('click', () => {
      quantities = {};
      renderAll();
    });
  }
}

/* ============================================================
   Page initialisation
   ============================================================ */

async function initQuickOrderPage() {
  bindActionButtons();

  // Load fallback products synchronously first so page is NEVER empty
  loadFallbackProducts();
  renderAll();
  renderRecentOrders([]);

  const refreshedUser = await Auth.refreshUser();

  if (!refreshedUser) {
    localStorage.setItem('redirectAfterLogin', 'quick-order.html');
    window.location.href = 'login.html';
    return;
  }

  user = refreshedUser;

  let userOrders = [];
  window.userSpentCredit = 0;
  try {
    userOrders = await Orders.forCurrentUser();
    if (user && user.creditStatus === 'approved' && userOrders) {
      const creditOrders = userOrders.filter(o => o.paymentMethod === 'credit' && o.paymentStatus === 'unpaid');
      window.userSpentCredit = creditOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
    }
  } catch (e) {
    console.warn("Failed to load user orders:", e);
  }

  if (typeof buildNav === 'function') buildNav('quick-order');
  if (typeof buildFooter === 'function') buildFooter();

  try {
    await loadProductsFromSupabase();
  } catch (error) {
    console.error("Failed to load products from Supabase for Quick Order:", error.message);
    loadFallbackProducts();
  }

  renderAll();
  renderRecentOrders(userOrders);
  bindActionButtons();
}

function renderRecentOrders(myOrders = null) {
  if (myOrders !== null && Array.isArray(myOrders)) {
    cachedUserOrders = myOrders;
  } else {
    myOrders = cachedUserOrders;
  }

  const pastContainer = document.getElementById('past-orders-list');
  const pastWrapper = document.getElementById('past-orders-container');
  const presetContainer = document.getElementById('standard-presets-list');

  if (!presetContainer) return;

  const pastPresets = [];
  const standardPresets = [];

  // Add Past User Orders if available (Max 2 as requested)
  if (myOrders && myOrders.length > 0) {
    myOrders.slice(0, 2).forEach((ord) => {
      const itemsSummary = (ord.items || []).map(i => {
        const cartons = i.cartons || i.qty || 0;
        const name = i.name || (i.productId === 'espressgo-oatmilk' || i.product_id === 'espressgo-oatmilk' ? 'Oat Milk' : 'Original');
        return `${cartons} ctn ${name}`;
      }).join(', ');

      const cartObj = {};
      (ord.items || []).forEach(i => {
        const pid = i.productId || i.product_id;
        if (pid) cartObj[pid] = Number(i.cartons || i.qty || 0);
      });

      const orderIdStr = String(ord.id);
      pastPresets.push({
        id: `order-${ord.id}`,
        name: `📋 Past Order #${orderIdStr.length > 8 ? orderIdStr.slice(0, 8) : orderIdStr}`,
        tag: 'Past Order',
        cart: cartObj,
        summary: itemsSummary || 'Previous order configuration',
        badge: `SGD $${Number(ord.totalAmount || 0).toFixed(2)}`
      });
    });
  }

  // Always include standard quick presets
  standardPresets.push({
    id: 'preset-weekly',
    name: '⚡ Standard Restock',
    tag: 'Preset',
    cart: { 'espressgo-original': 10, 'espressgo-oatmilk': 10 },
    summary: '10 ctn Original + 10 ctn Oat Milk',
    badge: '20 Cartons'
  });

  standardPresets.push({
    id: 'preset-bulk',
    name: '📦 Tier 3 Max Bulk',
    tag: 'Preset',
    cart: { 'espressgo-original': 30, 'espressgo-oatmilk': 30 },
    summary: '30 ctn Original + 30 ctn Oat Milk (Max Tier Rate)',
    badge: '60 Cartons'
  });

  currentPresets = [...pastPresets, ...standardPresets];

  // Render Past Orders
  if (pastPresets.length > 0 && pastContainer && pastWrapper) {
    pastWrapper.style.display = 'block';
    pastContainer.innerHTML = pastPresets.map(p => renderPresetCardHtml(p)).join('');
  } else if (pastWrapper) {
    pastWrapper.style.display = 'none';
  }

  // Render Standard Presets
  presetContainer.innerHTML = standardPresets.map(p => renderPresetCardHtml(p)).join('');
}

function renderPresetCardHtml(p) {
  const isActive = activePresetId === p.id;
  const isPast = p.tag === 'Past Order';

  return `
    <div class="preset-card ${isActive ? 'active' : ''}" onclick="applyOrderPreset('${safeEscape(p.id)}')" style="background:${isActive ? '#FFF7ED' : (isPast ? '#FAF6F0' : '#FAF8F5')};border:2px solid ${isActive ? 'var(--amber)' : '#EDE8E3'};border-radius:14px;padding:0.9rem 1.1rem;cursor:pointer;transition:all 0.2s;position:relative;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem;">
        <div style="font-size:12.5px;font-weight:700;color:var(--brown);">${safeEscape(p.name)}</div>
        <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:12px;background:${isActive ? 'var(--amber)' : (isPast ? '#E5D6C5' : '#E0D5C8')};color:${isActive ? '#FFF' : 'var(--brown)'};">${safeEscape(p.badge)}</span>
      </div>
      <div style="font-size:11.5px;color:var(--brown-lt);line-height:1.35;">${safeEscape(p.summary)}</div>
      <div style="margin-top:0.6rem;font-size:11px;font-weight:600;color:${isActive ? 'var(--amber)' : 'var(--brown-lt)'};display:flex;align-items:center;gap:0.3rem;">
        ${isActive ? '✅ Loaded below — adjust quantities below if needed' : '👉 Click to load into section below'}
      </div>
    </div>
  `;
}

function applyOrderPreset(presetId) {
  const preset = currentPresets.find(p => p.id === presetId);
  if (!preset) return;

  activePresetId = presetId;
  quantities = { ...preset.cart };
  renderAll();
  renderRecentOrders();
  if (typeof showToast === 'function') {
    showToast("Preset Loaded! ⚡", "Quantities updated in the adjustable section below.", "success");
  }
}
window.applyOrderPreset = applyOrderPreset;

initQuickOrderPage();