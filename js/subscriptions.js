/* ============================================================
   subscriptions.js — ESPRESSGO B2B Subscription Portal Logic
   Depends on: shared.js, supabase-config.js
   ============================================================ */

const db = window.sb || window.supabaseClient;

let importedItems = [];
let isSubmitting = false;

function safeEscape(str) {
  if (typeof escapeHTML === 'function') return escapeHTML(str);
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function notify(title, message, type = "success") {
  if (typeof showToast === "function") {
    showToast(title, message, type);
  } else {
    alert(title + ": " + message);
  }
}

function getPouchColors(productId) {
  switch (productId) {
    case 'espressgo-oatmilk':
      return { pouch: '#D4956A', accent: '#8B5B3A' };
    case 'espressgo-tea':
      return { pouch: '#1A1A1A', accent: '#C78A3B' };
    case 'espressgo-matcha':
      return { pouch: '#4A7C59', accent: '#2D5E3F' };
    case 'espressgo-decaf':
      return { pouch: '#7A6A5C', accent: '#4A3D33' };
    case 'espressgo-original':
    default:
      return { pouch: '#C8580A', accent: '#8B3A00' };
  }
}

function saveSubscriptionCart() {
  sessionStorage.setItem("subscriptionCart", JSON.stringify(importedItems));
}

let productsCache = {};

async function loadProductsCache() {
  if (!db) return;
  try {
    const { data: prods } = await db.from("products").select("*");
    const { data: tiers } = await db.from("product_tiers").select("*");

    if (prods && prods.length) {
      prods.forEach(p => {
        const pTiers = tiers ? tiers.filter(t => t.product_id === p.id) : [];
        const normalized = {
          ...p,
          tiers: pTiers.length
            ? pTiers.map(t => ({ min: Number(t.min_quantity), price: Number(t.price) }))
            : [{ min: 1, price: 108 }]
        };
        productsCache[p.id] = normalized;
        if (p.sku) productsCache[p.sku] = normalized;
      });
    }
  } catch (e) {
    console.error("Failed to fetch products cache for subscriptions:", e);
  }
}

function getTierPrice(product, qty) {
  if (!product || !product.tiers || !product.tiers.length) return 108;
  const sorted = [...product.tiers].sort((a, b) => Number(b.min || 0) - Number(a.min || 0));
  const matched = sorted.find(t => qty >= Number(t.min || 1));
  return Number((matched || sorted[sorted.length - 1]).price || 108);
}

function updateQty(productId, val) {
  const n = Math.max(0, parseInt(val, 10) || 0);
  const idx = importedItems.findIndex(i => (i.product_id || i.id) === productId);

  if (idx !== -1) {
    if (n <= 0) {
      importedItems.splice(idx, 1);
    } else {
      importedItems[idx].cartons = n;
      importedItems[idx].quantity = n;
      importedItems[idx].qty = n;

      const pId = importedItems[idx].product_id || importedItems[idx].id;
      const match = productsCache[pId];
      if (match) {
        const newPrice = getTierPrice(match, n);
        importedItems[idx].price_per_carton = newPrice;
        importedItems[idx].price = newPrice;
        importedItems[idx].subtotal = n * newPrice;
      } else {
        const curPrice = Number(importedItems[idx].price_per_carton || importedItems[idx].price || 108);
        importedItems[idx].subtotal = n * curPrice;
      }
    }
    saveSubscriptionCart();
    renderSubscriptionSummary();
  }
}
window.updateQty = updateQty;

function removeSubItem(productId) {
  importedItems = importedItems.filter(i => (i.product_id || i.id) !== productId);
  saveSubscriptionCart();
  renderSubscriptionSummary();
  notify("Item Removed", "Product removed from subscription schedule.", "success");
}
window.removeSubItem = removeSubItem;

function selectFrequency(val) {
  const freqInput = document.getElementById("frequency");
  if (freqInput) freqInput.value = val;

  sessionStorage.setItem("subscriptionInterval", val);

  const cards = document.querySelectorAll(".freq-card");
  cards.forEach(card => {
    if (card.dataset.val === val) {
      card.classList.add("active");
    } else {
      card.classList.remove("active");
    }
  });

  renderSubscriptionSummary();
}
window.selectFrequency = selectFrequency;

async function renderSubscriptionSummary() {
  if (Object.keys(productsCache).length === 0 && db) {
    await loadProductsCache();
  }

  let rawData = sessionStorage.getItem("subscriptionCart");

  // Fallback: If subscriptionCart is null (not yet initialized), attempt to convert local cart from localStorage
  if (rawData === null) {
    const localCartStr = localStorage.getItem("espressgo_cart");
    if (localCartStr) {
      try {
        const localCartObj = JSON.parse(localCartStr);
        const cartEntries = Object.entries(localCartObj).filter(([_, q]) => Number(q) > 0);
        if (cartEntries.length > 0) {
          const converted = cartEntries.map(([pId, q]) => {
            const match = productsCache[pId];
            const cartons = Number(q);
            const price = match ? getTierPrice(match, cartons) : 108;
            return {
              product_id: pId,
              id: pId,
              name: match ? match.name : pId,
              cartons: cartons,
              quantity: cartons,
              qty: cartons,
              price_per_carton: price,
              price: price,
              subtotal: cartons * price,
              imageUrl: match ? match.image_url : "",
              pouchColor: match ? match.pouch_color : "#C8580A",
              pouchAccent: match ? match.pouch_accent : "#8B3A00"
            };
          });
          sessionStorage.setItem("subscriptionCart", JSON.stringify(converted));
          rawData = JSON.stringify(converted);
        }
      } catch (e) {
        console.error("Error converting localCart to subscriptionCart:", e);
      }
    }
  }

  const mainLayout = document.getElementById("sub-main-layout");
  const emptyState = document.getElementById("sub-empty-state");

  let parsedItems = [];
  try {
    parsedItems = rawData ? JSON.parse(rawData) : [];
  } catch (e) {
    parsedItems = [];
  }

  if (!parsedItems || parsedItems.length === 0) {
    importedItems = [];
    if (mainLayout) mainLayout.style.display = "none";
    if (emptyState) emptyState.style.display = "block";
    return;
  }

  if (mainLayout) mainLayout.style.display = "flex";
  if (emptyState) emptyState.style.display = "none";

  importedItems = JSON.parse(rawData).map(item => {
    const pId = item.product_id || item.id;
    const match = productsCache[pId];
    const cartons = Number(item.cartons ?? item.quantity ?? item.qty ?? 1);
    const price = match ? getTierPrice(match, cartons) : Number(item.price_per_carton ?? item.price ?? 108);

    return {
      ...item,
      product_id: pId,
      id: pId,
      name: item.name || match?.name || "ESPRESSGO Product",
      cartons: cartons,
      quantity: cartons,
      qty: cartons,
      price_per_carton: price,
      price: price,
      subtotal: cartons * price,
      imageUrl: item.imageUrl || item.image_url || match?.image_url || "",
      pouchColor: item.pouchColor || match?.pouch_color || "#C8580A",
      pouchAccent: item.pouchAccent || match?.pouch_accent || "#8B3A00"
    };
  });

  saveSubscriptionCart();

  const container = document.getElementById("subscription-items");
  if (container) {
    container.innerHTML = importedItems.map(item => {
      const pId = item.product_id || item.id || 'espressgo-original';
      const cartons = Number(item.cartons);
      const price = Number(item.price_per_carton);
      const subtotal = cartons * price;
      const colors = getPouchColors(pId);
      if (item.pouchColor) colors.pouch = item.pouchColor;
      if (item.pouchAccent) colors.accent = item.pouchAccent;

      const imgUrl = item.imageUrl || item.image_url;
      const iconHtml = imgUrl
        ? `<img src="${safeEscape(imgUrl)}" alt="${safeEscape(item.name || '')}" style="width:36px;height:42px;object-fit:contain;border-radius:6px;" />`
        : typeof miniPouchSVG === 'function'
          ? miniPouchSVG(colors.pouch, colors.accent, 26)
          : '📦';

      return `
        <div class="sub-item-row">
          <div class="sub-item-left">
            <div class="sub-item-icon" style="background:${colors.pouch}22;">
              ${iconHtml}
            </div>
            <div class="sub-item-info">
              <div class="sub-item-title">${safeEscape(item.name)}</div>
              <div class="sub-item-sub">Carton of 50 pouches · SGD $${price.toFixed(2)}/ctn</div>
            </div>
          </div>

          <div class="sub-item-right">
            <div class="sub-stepper">
              <button type="button" class="sub-stepper-btn" onclick="updateQty('${pId}', ${cartons - 1})">−</button>
              <input type="number" class="sub-stepper-input" value="${cartons}" min="1" oninput="updateQty('${pId}', this.value)" onchange="updateQty('${pId}', this.value)"/>
              <button type="button" class="sub-stepper-btn" onclick="updateQty('${pId}', ${cartons + 1})">+</button>
            </div>

            <div class="sub-item-subtotal">
              <div class="amount">SGD $${subtotal.toFixed(2)}</div>
              <div class="rate">${cartons * 50} pouches</div>
            </div>

            <button type="button" class="sub-item-remove" onclick="removeSubItem('${pId}')" title="Remove product">
              ✕
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Render Sidebar Summary
  const summaryLines = document.getElementById("sub-summary-lines");
  if (summaryLines) {
    summaryLines.innerHTML = importedItems.map(item => {
      const cartons = Number(item.cartons || 1);
      const price = Number(item.price_per_carton || item.price || 108);
      const colors = getPouchColors(item.product_id || item.id);
      if (item.pouchColor) colors.pouch = item.pouchColor;
      if (item.pouchAccent) colors.accent = item.pouchAccent;

      const imgUrl = item.imageUrl || item.image_url;
      let visualHtml = '';
      if (imgUrl) {
        visualHtml = `<img src="${safeEscape(imgUrl)}" alt="${safeEscape(item.name || '')}" style="width:24px;height:24px;object-fit:contain;border-radius:4px;" />`;
      } else if (typeof miniPouchSVG === 'function') {
        visualHtml = miniPouchSVG(colors.pouch, colors.accent, 20);
      } else {
        visualHtml = `<div class="summary-dot" style="background:${colors.pouch};"></div>`;
      }

      return `
        <div class="summary-line">
          <div class="summary-thumb" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            ${visualHtml}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:11.5px;color:var(--brown);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${safeEscape(item.name)}
            </div>
            <div style="font-size:10.5px;color:var(--muted);">
              ${cartons} ctn × SGD $${price.toFixed(2)}
            </div>
          </div>
          <span style="font-size:12px;color:var(--brown);font-weight:700;white-space:nowrap;">
            SGD $${(cartons * price).toFixed(2)}
          </span>
        </div>
      `;
    }).join('');
  }

  updateSubscriptionTotal();
}

function updateSubscriptionTotal() {
  const totalCartons = importedItems.reduce((sum, item) => sum + Number(item.cartons || 0), 0);
  const totalAmt = importedItems.reduce((sum, item) => sum + (Number(item.cartons || 0) * Number(item.price_per_carton || item.price || 0)), 0);
  const freqVal = document.getElementById("frequency")?.value || 'monthly';

  let freqLabel = 'Monthly';
  if (freqVal === 'weekly') freqLabel = 'Weekly';
  if (freqVal === 'yearly') freqLabel = 'Yearly';

  const totalEl = document.getElementById("subscription-total");
  if (totalEl) {
    totalEl.innerHTML = `
      <div class="summary-total-row">
        <span>Cartons per cycle</span>
        <span>${totalCartons}</span>
      </div>

      <div class="summary-total-row">
        <span>Total pouches</span>
        <span>${(totalCartons * 50).toLocaleString()}</span>
      </div>

      <div class="summary-total-row">
        <span>Delivery Cadence</span>
        <span style="font-weight:600;color:var(--amber);">${freqLabel}</span>
      </div>

      <div class="summary-total-row" style="font-size:14px;color:var(--brown);font-weight:700;border-top:1px solid #F0EAE4;padding-top:.5rem;margin-top:.15rem;">
        <span>Cycle Total</span>
        <span style="color:var(--amber);font-size:1.15rem;">SGD $${totalAmt.toFixed(2)}</span>
      </div>
    `;
  }

  checkCreditEligibility(totalAmt);
}

async function checkCreditEligibility(totalAmt) {
  const creditOptionLabel = document.getElementById("opt-credit-label");
  const creditBtn = document.getElementById("create-credit-subscription-btn");
  const creditWarning = document.getElementById("sub-credit-warning");
  const creditTermsTag = document.getElementById("sub-credit-terms-tag");
  const creditAvailableText = document.getElementById("sub-credit-available-text");

  if (!db) {
    if (creditOptionLabel) creditOptionLabel.style.display = "none";
    if (creditBtn) creditBtn.style.display = "none";
    return;
  }

  try {
    const { data: { user } } = await db.auth.getUser();
    if (!user) {
      if (creditOptionLabel) creditOptionLabel.style.display = "none";
      if (creditBtn) creditBtn.style.display = "none";
      if (creditWarning) creditWarning.style.display = "none";
      return;
    }

    const { data: profile } = await db
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profile && profile.credit_status === 'approved') {
      if (creditOptionLabel) creditOptionLabel.style.display = "flex";
      const terms = profile.payment_terms || "Net 30";
      const limit = Number(profile.credit_limit || 0);

      if (creditTermsTag) creditTermsTag.textContent = terms;

      let spent = 0;
      if (typeof Orders !== 'undefined' && typeof Orders.forCurrentUser === 'function') {
        const myOrders = await Orders.forCurrentUser();
        const creditOrders = (myOrders || []).filter(o => o.paymentMethod === 'credit' && o.paymentStatus === 'unpaid');
        spent = creditOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
      } else {
        const { data: myOrders } = await db
          .from("orders")
          .select("*")
          .eq("profile_id", user.id)
          .eq("payment_method", "credit")
          .eq("payment_status", "unpaid");
        spent = (myOrders || []).reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
      }

      const available = Math.max(limit - spent, 0);
      if (creditAvailableText) {
        creditAvailableText.textContent = `Available credit: SGD $${available.toFixed(2)} (${terms})`;
      }

      if (creditBtn) {
        if (totalAmt > available) {
          creditBtn.disabled = true;
          creditBtn.textContent = "Insufficient B2B Credit ⚠️";
          if (creditWarning) {
            creditWarning.style.display = "block";
            creditWarning.textContent = `⚠️ Cycle total exceeds available B2B credit of SGD $${available.toFixed(2)}`;
          }
        } else {
          creditBtn.disabled = false;
          creditBtn.textContent = `Start Subscription on B2B Credit (${terms}) →`;
          if (creditWarning) creditWarning.style.display = "none";
        }
      }

      // Check if user came with preferCreditPayment flag
      if (sessionStorage.getItem("preferCreditPayment") === "true") {
        const creditRadio = document.querySelector('input[name="sub_pay_method"][value="credit"]');
        if (creditRadio) {
          creditRadio.checked = true;
          switchPaymentMethod('credit');
        }
      }
    } else {
      if (creditOptionLabel) creditOptionLabel.style.display = "none";
      if (creditBtn) creditBtn.style.display = "none";
      if (creditWarning) creditWarning.style.display = "none";
    }
  } catch (e) {
    console.error("Credit eligibility check error:", e);
    if (creditOptionLabel) creditOptionLabel.style.display = "none";
    if (creditBtn) creditBtn.style.display = "none";
  }
}

async function createCreditSubscription() {
  if (isSubmitting) return;

  if (!importedItems || importedItems.length === 0) {
    notify("Empty Subscription", "Please select items to subscribe.", "error");
    return;
  }

  const creditBtn = document.getElementById("create-credit-subscription-btn");
  const stripeBtn = document.getElementById("create-subscription-btn");

  try {
    isSubmitting = true;
    if (creditBtn) {
      creditBtn.disabled = true;
      creditBtn.textContent = "Activating Credit Subscription... ⚡";
    }
    if (stripeBtn) stripeBtn.disabled = true;

    if (!db) {
      throw new Error("Supabase client is not initialized.");
    }

    const { data: { user }, error: userError } = await db.auth.getUser();

    if (userError || !user) {
      localStorage.setItem('redirectAfterLogin', 'subscriptions.html');
      notify("Sign In Required", "Please sign in to complete your subscription.", "error");
      setTimeout(() => window.location.href = "login.html", 1500);
      return;
    }

    const { data: profile } = await db
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (!profile || profile.credit_status !== 'approved') {
      throw new Error("Your account is not approved for B2B Credit.");
    }

    const frequency = document.getElementById("frequency")?.value || "monthly";
    const terms = profile.payment_terms || "Net 30";

    // 1. Insert Subscription Record
    const { data: subscription, error: subError } = await db
      .from("subscriptions")
      .insert({
        frequency: frequency,
        status: "active",
        user_id: user.id
      })
      .select()
      .single();

    if (subError) throw new Error("Subscription record failed: " + subError.message);

    // 2. Insert Subscription Items
    const itemsToInsert = importedItems.map(item => ({
      subscription_id: subscription.id,
      product_id: item.product_id || item.id,
      cartons: parseInt(item.cartons, 10),
      price_per_carton: parseFloat(item.price_per_carton || item.price)
    }));

    const { error: itemsError } = await db
      .from("subscription_items")
      .insert(itemsToInsert);

    if (itemsError) throw new Error("Subscription items failed: " + itemsError.message);

    // 3. Create the initial 1st delivery order on credit terms
    const totalCartons = importedItems.reduce((sum, item) => sum + Number(item.cartons || 0), 0);
    const totalAmount = importedItems.reduce((sum, item) => sum + (Number(item.cartons || 0) * Number(item.price_per_carton || item.price || 0)), 0);

    const initialOrderObj = {
      totalCartons: totalCartons,
      totalAmount: totalAmount,
      status: 'pending',
      notes: `Recurring ${frequency} Subscription Initial Delivery (Credit Terms: ${terms})`,
      paymentMethod: 'credit',
      paymentStatus: 'unpaid',
      creditTerms: terms,
      items: importedItems.map(item => ({
        productId: item.product_id || item.id,
        sku: item.sku || (item.product_id || item.id).replace(/[^a-zA-Z0-9]/g, '-').toUpperCase(),
        name: item.name,
        cartons: Number(item.cartons || 1),
        pricePerCarton: Number(item.price_per_carton || item.price)
      }))
    };

    if (typeof Orders !== 'undefined' && typeof Orders.add === 'function') {
      await Orders.add(initialOrderObj);
    } else {
      const { data: orderHeader, error: oErr } = await db
        .from("orders")
        .insert({
          profile_id: user.id,
          company: profile.company_name || 'B2B Partner',
          contact_name: profile.contact_name || user.email || 'B2B Partner',
          business_type: profile.business_type || null,
          delivery_address: profile.delivery_address || 'Singapore',
          total_cartons: totalCartons,
          total_amount: totalAmount,
          status: "pending",
          payment_method: "credit",
          payment_status: "unpaid",
          notes: initialOrderObj.notes
        })
        .select()
        .single();

      if (!oErr && orderHeader) {
        const oItems = importedItems.map(item => ({
          order_id: orderHeader.id,
          product_id: item.product_id || item.id,
          sku: item.sku || (item.product_id || item.id).replace(/[^a-zA-Z0-9]/g, '-').toUpperCase(),
          name: item.name,
          cartons: Number(item.cartons || 1),
          price_per_carton: Number(item.price_per_carton || item.price)
        }));
        await db.from("order_items").insert(oItems);
      }
    }

    sessionStorage.removeItem("subscriptionCart");
    sessionStorage.removeItem("subscriptionInterval");
    sessionStorage.removeItem("preferCreditPayment");
    localStorage.removeItem("espressgo_cart");

    notify("Subscription Activated! ⚡", "Your recurring subscription on B2B Credit terms has been set up successfully.", "success");

    setTimeout(() => {
      window.location.href = "account.html";
    }, 1500);

  } catch (err) {
    console.error("Credit Subscription Error:", err);
    notify("Subscription Failed", err.message, "error");
    if (creditBtn) {
      creditBtn.disabled = false;
      creditBtn.textContent = `Start Subscription on B2B Credit →`;
    }
    if (stripeBtn) stripeBtn.disabled = false;
  } finally {
    isSubmitting = false;
  }
}

async function createSubscription() {
  if (isSubmitting) return;

  if (!importedItems || importedItems.length === 0) {
    notify("Empty Subscription", "Please select items to subscribe.", "error");
    return;
  }

  try {
    isSubmitting = true;
    const btn = document.getElementById("create-subscription-btn");
    const creditBtn = document.getElementById("create-credit-subscription-btn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Connecting Payment... ⚡";
    }
    if (creditBtn) creditBtn.disabled = true;

    if (!db) {
      throw new Error("Supabase client is not initialized.");
    }

    // 1. Get current authenticated user
    const { data: { user }, error: userError } = await db.auth.getUser();

    if (userError || !user) {
      localStorage.setItem('redirectAfterLogin', 'subscriptions.html');
      notify("Sign In Required", "Please sign in to complete your subscription.", "error");
      setTimeout(() => window.location.href = "login.html", 1500);
      return;
    }

    const frequency = document.getElementById("frequency")?.value || "monthly";

    // 2. Insert Subscription Header
    const { data: subscription, error: subError } = await db
      .from("subscriptions")
      .insert({
        frequency: frequency,
        status: "active",
        user_id: user.id
      })
      .select()
      .single();

    if (subError) throw new Error("Subscription record failed: " + subError.message);

    // 3. Insert Subscription Items
    const itemsToInsert = importedItems.map(item => ({
      subscription_id: subscription.id,
      product_id: item.product_id || item.id,
      cartons: parseInt(item.cartons, 10),
      price_per_carton: parseFloat(item.price_per_carton || item.price)
    }));

    const { error: itemsError } = await db
      .from("subscription_items")
      .insert(itemsToInsert);

    if (itemsError) throw new Error("Subscription items failed: " + itemsError.message);

    notify("Subscription Created! ⚡", "Redirecting to secure Stripe checkout for 1st delivery...", "success");

    // 4. Fetch User Profile for Stripe
    const { data: profile } = await db
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    const formattedCart = importedItems.map(item => ({
      product_id: item.product_id || item.id,
      quantity: item.cartons
    }));

    // 5. Call Stripe checkout endpoint
    const res = await apiFetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cart: formattedCart,
        profile: profile || user,
        isSubscription: true,
        subscriptionId: subscription.id
      })
    });

    const data = await res.json();

    if (data.url) {
      sessionStorage.removeItem("subscriptionCart");
      sessionStorage.removeItem("subscriptionInterval");
      sessionStorage.removeItem("preferCreditPayment");
      localStorage.removeItem("espressgo_cart");
      window.location.href = data.url;
    } else {
      throw new Error(data.error || "Failed to launch payment checkout session.");
    }

  } catch (err) {
    console.error("Subscription Error:", err);
    notify("Subscription Failed", err.message, "error");
    const btn = document.getElementById("create-subscription-btn");
    const creditBtn = document.getElementById("create-credit-subscription-btn");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Start Subscription & Pay (Card) →";
    }
    if (creditBtn) creditBtn.disabled = false;
  } finally {
    isSubmitting = false;
  }
}

function switchPaymentMethod(method) {
  const cardLabel = document.getElementById("opt-card-label");
  const creditLabel = document.getElementById("opt-credit-label");
  const stripeBtn = document.getElementById("create-subscription-btn");
  const creditBtn = document.getElementById("create-credit-subscription-btn");
  const secText = document.getElementById("sub-security-text");

  if (method === 'credit') {
    if (cardLabel) {
      cardLabel.style.borderColor = '#E0D5C8';
      cardLabel.style.background = '#FFF';
    }
    if (creditLabel) {
      creditLabel.style.borderColor = 'var(--amber)';
      creditLabel.style.background = '#FFFBEB';
    }
    if (stripeBtn) stripeBtn.style.display = "none";
    if (creditBtn) creditBtn.style.display = "block";
    if (secText) secText.innerHTML = "📄 Zero up-front payment required. First delivery dispatches & bills to your B2B credit terms.";
  } else {
    if (cardLabel) {
      cardLabel.style.borderColor = 'var(--amber)';
      cardLabel.style.background = '#FFFBEB';
    }
    if (creditLabel) {
      creditLabel.style.borderColor = '#E0D5C8';
      creditLabel.style.background = '#FFF';
    }
    if (stripeBtn) stripeBtn.style.display = "block";
    if (creditBtn) creditBtn.style.display = "none";
    if (secText) secText.innerHTML = "🔒 Encrypted 256-bit Stripe checkout. First delivery dispatches upon order confirmation.";
  }
}
window.switchPaymentMethod = switchPaymentMethod;

document.addEventListener("DOMContentLoaded", async () => {
  if (typeof buildNav === 'function') buildNav('subscriptions');
  if (typeof buildFooter === 'function') buildFooter();

  // Preset frequency if saved in session
  const savedInterval = sessionStorage.getItem("subscriptionInterval");
  if (savedInterval) {
    selectFrequency(savedInterval);
  }

  await renderSubscriptionSummary();

  // Bind payment method radio inputs
  const payRadios = document.querySelectorAll('input[name="sub_pay_method"]');
  payRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      switchPaymentMethod(e.target.value);
    });
  });

  const createBtn = document.getElementById("create-subscription-btn");
  if (createBtn) {
    createBtn.addEventListener("click", createSubscription);
  }

  const createCreditBtn = document.getElementById("create-credit-subscription-btn");
  if (createCreditBtn) {
    createCreditBtn.addEventListener("click", createCreditSubscription);
  }
});