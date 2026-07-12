/* ============================================================
   catalog.js — Logic for catalog.html

   ESPRESSGO Supabase Version

   Depends on:
   - supabase-config.js
   - shared.js

   Uses:
   - sb / supabaseClient
   - Auth
   - Products fallback
   - getActiveTier
   - pouchSVG
   - showToast
   - buildNav
   - buildFooter
   ============================================================ */


/* ============================================================
   Safety checks
   ============================================================ */

const db = window.sb || window.supabaseClient;

if (!db) {
  console.error(
    "Supabase client not found. Make sure supabase-config.js is loaded before catalog.js."
  );
}


/* ============================================================
   Page state
   ============================================================ */

let user = null;

// Cart state: maps productId → quantity in cartons
let cart = JSON.parse(localStorage.getItem("espressgo_cart") || "{}");

// Products loaded from Supabase
let catalogProducts = [];
let active = [];
let comingSoon = [];


/* ============================================================
   Helper fallbacks
   ============================================================ */

function safeEscape(value) {
  if (typeof escapeHTML === "function") {
    return escapeHTML(value || "");
  }

  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function safeToast(title, message = "", type = "success") {
  if (typeof showToast === "function") {
    showToast(title, message, type);
  } else {
    console.log(title, message, type);
  }
}


function safeGetActiveTier(tiers, qty) {
  if (typeof getActiveTier === "function") {
    return getActiveTier(tiers, qty);
  }

  const sorted = [...(tiers || [])].sort((a, b) => a.min - b.min);

  return (
    sorted.find(tier => {
      const minOk = qty >= tier.min;
      const maxOk = tier.max === null || tier.max === undefined || qty <= tier.max;
      return minOk && maxOk;
    }) ||
    sorted[0] || {
      min: 1,
      max: null,
      price: 0
    }
  );
}


/* ============================================================
   Cart persistence helpers
   ============================================================ */

function saveCart() {
  localStorage.setItem("espressgo_cart", JSON.stringify(cart));
}


function clearCart() {
  cart = {};
  saveCart();
}


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

  catalogProducts = (productsData || []).map(product => {
    return normaliseProduct(product, tiersByProduct[product.id] || []);
  });

  active = catalogProducts.filter(product => product.active);
  comingSoon = catalogProducts.filter(product => !product.active);

  console.log("Products loaded from Supabase:", catalogProducts);
}


function loadFallbackProducts() {
  if (typeof Products === "undefined") {
    catalogProducts = [];
    active = [];
    comingSoon = [];
    return;
  }

  catalogProducts = Products;
  active = Products.filter(product => product.active);
  comingSoon = Products.filter(product => !product.active);

  console.warn("Using fallback Products from shared.js");
}


/* ============================================================
   Product card renderer
   ============================================================ */

function getProductDetailHTML(product) {
  const name = (product.name || '').toLowerCase();
  const id = (product.id || '').toLowerCase();
  
  let ingredients = '';
  let nutrition = '';
  let benefits = '';

  if (name.includes('original') || name.includes('classic') || id.includes('original')) {
    ingredients = 'Arabica Soluble Coffee, Erythritol, Konnyaku Jelly, Monk Fruit Extract.';
    nutrition = 'Energy: 12 kcal · Carbs: 10g · Sugar: 0g · Fat: 0g · Caffeine: ~70mg';
    benefits = 'Retort-sterilised for a 9-month shelf life. Squeeze directly from the pocket-sized pouch. Zero sugar & vegan-friendly.';
  } else if (name.includes('oat') || id.includes('oat')) {
    ingredients = 'Arabica Soluble Coffee, Oat Milk Powder, Erythritol, Konnyaku Jelly, Monk Fruit Extract.';
    nutrition = 'Energy: 28 kcal · Carbs: 12g · Sugar: 1g · Fat: 0.5g · Caffeine: ~60mg';
    benefits = 'Rich, creamy oat milk blend. Retort-sterilised for a 10-month shelf life. No dairy, lactose-free, and vegan-friendly.';
  } else if (name.includes('matcha') || id.includes('matcha')) {
    ingredients = 'Japanese Uji Matcha, Green Tea Extract, Erythritol, Konnyaku Jelly, Monk Fruit.';
    nutrition = 'Energy: 15 kcal · Carbs: 9g · Sugar: 0g · Fat: 0g · Caffeine: ~40mg';
    benefits = 'L-Theanine & caffeine combo for calm, focused energy. Pocket-sized pouch, squeeze directly.';
  } else if (name.includes('decaf') || id.includes('decaf')) {
    ingredients = 'Swiss Water Decaf Soluble Arabica Coffee, Erythritol, Konnyaku Jelly, Monk Fruit.';
    nutrition = 'Energy: 10 kcal · Carbs: 10g · Sugar: 0g · Fat: 0g · Caffeine: ~5mg';
    benefits = 'Decaffeinated using 100% chemical-free Swiss Water process. Safe for late-night coffee rituals.';
  } else {
    return '';
  }

  return `
    <div class="drawer-content">
      <div class="drawer-section">
        <strong class="drawer-section-title">🌱 Ingredients</strong>
        <p class="drawer-section-body">${ingredients}</p>
      </div>
      <div class="drawer-section">
        <strong class="drawer-section-title">📊 Nutrition (Per 50g)</strong>
        <p class="drawer-section-body">${nutrition}</p>
      </div>
      <div class="drawer-section full-width">
        <strong class="drawer-section-title">💡 Key Benefits</strong>
        <p class="drawer-section-body">${benefits}</p>
      </div>
    </div>
  `;
}

function toggleProductDetails(productId) {
  const detailsDiv = document.getElementById(`details-${productId}`);
  const chevron = document.getElementById(`chevron-${productId}`);
  if (!detailsDiv || !chevron) return;

  if (detailsDiv.style.maxHeight === '0px' || !detailsDiv.style.maxHeight) {
    detailsDiv.style.maxHeight = `${detailsDiv.scrollHeight}px`;
    chevron.textContent = '▲';
  } else {
    detailsDiv.style.maxHeight = '0px';
    chevron.textContent = '▼';
  }
}
window.toggleProductDetails = toggleProductDetails;

function renderProductCard(product) {
  const qty = cart[product.id] || 0;
  const activeTier = safeGetActiveTier(product.tiers, qty);
  const activeTierIdx = product.tiers.findIndex(tier => tier.min === activeTier.min);

  const productImage = product.imageUrl
    ? `<img src="${safeEscape(product.imageUrl)}" alt="${safeEscape(product.name)}" class="product-image-img" style="width:100%; height:100%; object-fit:contain; padding:1.5rem; box-sizing:border-box;" />`
    : (typeof pouchSVG === "function"
      ? pouchSVG(product, 120)
      : `<div style="font-size:3rem;">☕</div>`);

  const minPrice = Number(product.tiers[product.tiers.length - 1]?.price || 0).toFixed(2);
  const maxPrice = Number(product.tiers[0]?.price || 0).toFixed(2);
  const priceDisplay = minPrice === maxPrice 
    ? `SGD $${maxPrice}` 
    : `SGD $${minPrice} - $${maxPrice}`;

  return `
    <div class="product-card" role="listitem">

      <div
        class="product-image"
        style="
          background: linear-gradient(
            160deg,
            ${product.pouchAccent}EE,
            ${product.pouchColor}CC
          );
        ">
        <span class="product-badge">Case of 50 Pouches</span>
        ${productImage}
      </div>

      <div class="product-content">

        <div class="product-header-inline">
          <div class="product-name">
            ${safeEscape(product.name)}
          </div>
          <div class="product-sku-badge">
            SKU: ${safeEscape(product.sku)}
          </div>
        </div>

        <div class="product-price">
          ${priceDisplay}
          <span>/ carton</span>
        </div>

        <div class="product-description">
          ${safeEscape(product.subtitle)}
        </div>

        <div class="specs">
          ${[
            product.caffeine ? `⚡ ${product.caffeine}` : null,
            product.format ? `📦 ${product.format}` : null,
            product.shelfLife ? `🕐 ${product.shelfLife}` : null
          ].filter(Boolean).map(spec => `
            <span class="spec">${safeEscape(spec)}</span>
          `).join("")}
        </div>

        <!-- Expandable details block -->
        <div style="margin-top:0.25rem;">
          <button type="button" class="details-toggle-btn" onclick="toggleProductDetails('${product.id}')">
            <span>View Pouch Details</span>
            <span class="chevron" id="chevron-${product.id}">▼</span>
          </button>
          
          <div id="details-${product.id}" class="details-drawer">
            ${getProductDetailHTML(product)}
          </div>
        </div>

        <div class="tier-section">
          <p class="tier-title">
            Volume Pricing
          </p>

          <div class="tier-grid">
            ${product.tiers.map((tier, index) => {
              const isActive = index === activeTierIdx && qty > 0;

              const firstPrice = Number(product.tiers[0]?.price || 0);
              const tierPrice = Number(tier.price || 0);

              const pct =
                index > 0 && firstPrice > 0
                  ? Math.round((1 - tierPrice / firstPrice) * 100)
                  : null;

              return `
                <div class="tier-cell ${isActive ? "active" : ""}" onclick="updateCart('${product.id}', ${tier.min})" role="button" aria-label="Select pricing tier starting at ${tier.min} cartons">
                  <div class="tier-price">
                    SGD $${tierPrice.toFixed(2)}
                  </div>

                  <div class="tier-range">
                    ${
                      tier.max
                        ? `${tier.min}-${tier.max} ctn`
                        : `${tier.min}+ ctn`
                    }
                  </div>

                  ${
                    pct
                      ? `<div class="tier-pct">-${pct}%</div>`
                      : ""
                  }
                </div>
              `;
            }).join("")}
          </div>
        </div>

        <div class="product-actions">

          <div class="stepper">

            <button
              class="stepper-btn"
              onclick="updateCart('${product.id}', ${Math.max(0, qty - 1)})"
              ${qty === 0 ? "disabled" : ""}
              aria-label="Decrease ${safeEscape(product.name)} quantity">
              −
            </button>

            <input
              class="stepper-input"
              type="number"
              min="0"
              value="${qty || ""}"
              placeholder="0"
              aria-label="${safeEscape(product.name)} quantity in cartons"
              onchange="updateCart(
                '${product.id}',
                Math.max(0, parseInt(this.value) || 0)
              )"
            />

            <button
              class="stepper-btn"
              onclick="updateCart('${product.id}', ${qty + 1})"
              aria-label="Increase ${safeEscape(product.name)} quantity">
              +
            </button>

          </div>

          ${
            qty > 0
              ? `
                <div class="subtotal-badge">
                  <div class="subtotal-price">
                    SGD $${(Number(activeTier.price || 0) * qty).toFixed(2)}
                  </div>

                  <div class="subtotal-pouches">
                    ${(qty * 50).toLocaleString()} pouches
                  </div>
                </div>
              `
              : ""
          }

        </div>

      </div>
    </div>
  `;
}


/* ============================================================
   Render active products
   ============================================================ */

function renderAll() {
  const list = document.getElementById("products-list");

  if (!list) return;

  if (!active.length) {
    list.innerHTML = `
      <div class="card" style="padding:2rem;text-align:center;">
        <h3 style="color:var(--brown);margin-bottom:.5rem;">
          No active products found
        </h3>
        <p style="color:var(--muted);font-size:.9rem;">
          Add products in Supabase, then refresh this page.
        </p>
      </div>
    `;
    return;
  }

  list.innerHTML = active.map(renderProductCard).join("");
}


/* ============================================================
   Cart management
   ============================================================ */

function updateCart(id, qty) {
  const cleanQty = Math.max(0, parseInt(qty) || 0);

  if (cleanQty <= 0) {
    delete cart[id];
  } else {
    cart[id] = cleanQty;
  }

  saveCart();
  renderAll();
  updateCheckoutBar();
}

window.updateCart = updateCart;


function totalCartons() {
  return Object.values(cart).reduce((sum, qty) => {
    return sum + Number(qty || 0);
  }, 0);
}


function totalPrice() {
  return Object.entries(cart).reduce((sum, [id, qty]) => {
    const product = active.find(item => item.id === id);

    if (!product) return sum;

    const tier = safeGetActiveTier(product.tiers, qty);

    return sum + Number(tier.price || 0) * Number(qty || 0);
  }, 0);
}


function updateCheckoutBar() {
  const count = totalCartons();
  const bar = document.getElementById("checkout-bar");

  if (!bar) return;

  if (count > 0) {
    bar.classList.add("visible");

    const countBadge = document.getElementById("cart-count-badge");
    const summaryText = document.getElementById("cart-summary-text");
    const totalText = document.getElementById("cart-total-text");

    if (countBadge) {
      countBadge.textContent = count;
    }

    if (summaryText) {
      summaryText.textContent =
        `${count} carton${count !== 1 ? "s" : ""} · ${(count * 50).toLocaleString()} pouches`;
    }

    if (totalText) {
      totalText.textContent =
        `SGD $${totalPrice().toFixed(2)} total`;
    }
  } else {
    bar.classList.remove("visible");
  }
}


/* ============================================================
   Coming soon section
   ============================================================ */

function renderComingSoon() {
  const section = document.getElementById("coming-soon-section");
  const grid = document.getElementById("coming-grid");

  if (!section || !grid) return;

  if (comingSoon.length <= 0) {
    section.style.display = "none";
    return;
  }

  section.style.display = "block";

  grid.innerHTML = comingSoon.map(product => {
    const image = product.imageUrl
      ? `<img src="${safeEscape(product.imageUrl)}" alt="${safeEscape(product.name)}" class="coming-img-asset" style="width:100%; height:100%; object-fit:contain; padding:0.5rem; box-sizing:border-box; opacity:0.45;" />`
      : (typeof pouchSVG === "function"
        ? pouchSVG(product, 72, true)
        : `<div style="font-size:2rem;">☕</div>`);

    return `
      <div class="coming-card">

        <div
          class="coming-img"
          style="
            background: linear-gradient(
              145deg,
              ${product.pouchAccent}BB,
              ${product.pouchColor}88
            );
          ">

          ${image}

          <div class="coming-soon-badge">
            🔒 Soon
          </div>
        </div>

        <div class="coming-body">
          <div class="coming-name">
            ${safeEscape(product.name)}
          </div>

          <p class="coming-hint">
            ${safeEscape(product.comingSoonHint || "Coming soon")}
          </p>
        </div>

      </div>
    `;
  }).join("");
}


/* ============================================================
   Checkout modal
   ============================================================ */

const modal = document.getElementById("checkout-modal");


function getOrderLines() {
  return active
    .filter(product => (cart[product.id] || 0) > 0)
    .map(product => {
      const qty = Number(cart[product.id] || 0);
      const tier = safeGetActiveTier(product.tiers, qty);

      return {
        p: product,
        qty,
        tier,
        subtotal: qty * Number(tier.price || 0)
      };
    });
}


async function getCurrentSupabaseUser() {
  if (!db) return null;

  const { data, error } = await db.auth.getUser();

  if (error) {
    console.warn("No Supabase auth user:", error.message);
    return null;
  }

  return data?.user || null;
}


async function getCurrentProfile() {
  const authUser = await getCurrentSupabaseUser();

  // FIX: If there is no authenticated Supabase user session, 
  // exit immediately and return null so public visitors can browse!
  if (!authUser) {
    return null;
  }

  const { data: profile, error } = await db
    .from("profiles")
    .select("*")
    .eq("id", authUser.id)
    .single();

  if (error) {
    console.warn("Could not load profile. Falling back to auth user:", error.message);

    return {
      id: authUser.id,
      email: authUser.email,
      contactName: authUser.user_metadata?.contact_name || authUser.email,
      companyName: authUser.user_metadata?.company_name || "",
      businessType: authUser.user_metadata?.business_type || "",
      deliveryAddress: authUser.user_metadata?.delivery_address || "Singapore",
      creditStatus: "none",
      creditLimit: 0,
      paymentTerms: "Net 30"
    };
  }

  return {
    id: profile.id,
    email: profile.email || authUser.email,
    contactName: profile.contact_name || authUser.email,
    companyName: profile.company_name || "",
    businessType: profile.business_type || "",
    deliveryAddress: profile.delivery_address || "Singapore",
    role: profile.role || "buyer",
    creditStatus: profile.credit_status || "none",
    creditLimit: Number(profile.credit_limit ?? 0),
    paymentTerms: profile.payment_terms || "Net 30"
  };
}


function openModal() {
  if (!modal) return;

  const lines = getOrderLines();

  if (!lines.length) {
    safeToast(
      "Cart is empty",
      "Please add at least one product before checkout.",
      "error"
    );
    return;
  }

  const modalItems = document.getElementById("modal-items");
  const modalTotals = document.getElementById("modal-totals");
  const deliveryText = document.getElementById("delivery-text");

  if (modalItems) {
    modalItems.innerHTML = lines.map(({ p, qty, tier, subtotal }) => `
      <div class="modal-item" role="listitem">

        <div
          class="modal-item-color"
          style="background:${p.pouchColor};">
        </div>

        <div>
          <div class="modal-item-name">
            ${safeEscape(p.name)}
          </div>

          <div class="modal-item-detail">
            ${qty} ctn × SGD $${Number(tier.price || 0).toFixed(2)}
          </div>
        </div>

        <div class="modal-item-total">
          SGD $${subtotal.toFixed(2)}
        </div>

      </div>
    `).join("");
  }

  const tc = totalCartons();
  const tp = totalPrice();

  if (modalTotals) {
    modalTotals.innerHTML = `
      <div class="modal-total-row">
        <span>Cartons</span>
        <span>${tc}</span>
      </div>

      <div class="modal-total-row">
        <span>Pouches</span>
        <span>${(tc * 50).toLocaleString()}</span>
      </div>

      <div class="modal-total-row main">
        <span>Order total</span>
        <span style="color:var(--amber);font-size:1.2rem;">
          SGD $${tp.toFixed(2)}
        </span>
      </div>
    `;
  }

  if (deliveryText) {
    deliveryText.textContent =
      `Delivering to: ${user?.deliveryAddress || "Your registered address"}`;
  }

  // --- B2B Credit Terms Button Configuration ---
  const stripeBtn = document.getElementById("modal-place-stripe");
  const creditBtn = document.getElementById("modal-place-credit");
  const creditWarning = document.getElementById("modal-credit-warning");

  if (stripeBtn && creditBtn && creditWarning) {
    if (user && user.creditStatus === 'approved') {
      creditBtn.style.display = "block";
      creditBtn.textContent = `Use B2B Credit (${user.paymentTerms}) →`;
      
      (async () => {
        let spent = 0;
        try {
          const myOrders = await Orders.forCurrentUser();
          const creditOrders = myOrders.filter(o => o.paymentMethod === 'credit' && o.paymentStatus === 'unpaid');
          spent = creditOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
        } catch (e) {
          console.error("Failed to load user orders for credit limit check:", e);
        }
        
        const available = Math.max(user.creditLimit - spent, 0);
        if (tp > available) {
          creditBtn.disabled = true;
          creditBtn.textContent = "Insufficient B2B Credit ⚠️";
          creditWarning.style.display = "block";
          creditWarning.textContent = `⚠️ Order total exceeds available B2B credit of SGD $${available.toFixed(2)}`;
        } else {
          creditBtn.disabled = false;
          creditBtn.textContent = `Use B2B Credit (${user.paymentTerms}) →`;
          creditWarning.style.display = "none";
        }
      })();
    } else {
      creditBtn.style.display = "none";
      creditWarning.style.display = "none";
    }
  }

  modal.classList.add("open");
}


function closeModal() {
  if (!modal) return;
  modal.classList.remove("open");
}


/* ============================================================
   Supabase order submission
   ============================================================ */

async function saveOrderToSupabase(currentUser, lines) {
  if (!db) {
    throw new Error("Supabase client is not available.");
  }

  const orderPayload = {
    profile_id: currentUser.id || null,
    company: currentUser.companyName || "Unknown Company",
    contact_name: currentUser.contactName || currentUser.email || "Unknown Contact",
    business_type: currentUser.businessType || null,
    delivery_address: currentUser.deliveryAddress || "Singapore",
    total_cartons: totalCartons(),
    total_amount: totalPrice(),
    status: "pending",
    notes: null
  };

  const { data: order, error: orderError } = await db
    .from("orders")
    .insert(orderPayload)
    .select()
    .single();

  if (orderError) {
    throw orderError;
  }

  const orderItemsPayload = lines.map(({ p, qty, tier }) => ({
    order_id: order.id,
    product_id: p.id,
    sku: p.sku,
    name: p.name,
    cartons: qty,
    price_per_carton: Number(tier.price || 0)
  }));

  const { error: itemsError } = await db
    .from("order_items")
    .insert(orderItemsPayload);

  if (itemsError) {
    throw itemsError;
  }

  return order;
}


/* ============================================================
   Checkout button handlers
   ============================================================ */

function bindCheckoutButtons() {
  const clearCartBtn = document.getElementById("clear-cart-btn");
  const checkoutBtn = document.getElementById("checkout-btn");
  const modalCloseBtn = document.getElementById("modal-close");
  const modalBackBtn = document.getElementById("modal-back");
  const modalPlaceBtn = document.getElementById("modal-place");

  if (clearCartBtn) {
    clearCartBtn.addEventListener("click", () => {
      clearCart();
      renderAll();
      updateCheckoutBar();
    });
  }

  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", async () => {
      user = await getCurrentProfile();

      if (!user) {
        localStorage.setItem("redirectAfterLogin", "catalog.html");

        safeToast("Please sign in to continue checkout.", "", "error");

        setTimeout(() => {
          window.location.href = "login.html";
        }, 600);

        return;
      }

      openModal();
    });
  }

  if (modalCloseBtn) {
    modalCloseBtn.addEventListener("click", closeModal);
  }

  if (modalBackBtn) {
    modalBackBtn.addEventListener("click", closeModal);
  }

  const modalPlaceStripeBtn = document.getElementById("modal-place-stripe");
  const modalPlaceCreditBtn = document.getElementById("modal-place-credit");

  if (modal) {
    modal.addEventListener("click", event => {
      if (event.target === modal) {
        closeModal();
      }
    });
  }

  // Stripe Card checkout
  if (modalPlaceStripeBtn) {
    modalPlaceStripeBtn.addEventListener("click", async () => {
      modalPlaceStripeBtn.disabled = true;
      modalPlaceStripeBtn.textContent = "Connecting...";
      if (modalPlaceCreditBtn) modalPlaceCreditBtn.disabled = true;

      try {
        const currentUser = await getCurrentProfile();
        if (!currentUser) {
          safeToast("Please sign in first.", "", "error");
          window.location.href = "login.html";
          return;
        }

        const lines = getOrderLines();
        const recurring = document.getElementById("recurringOrder").checked;
        const interval = document.getElementById("deliveryInterval").value;

        if (recurring) {
          console.log("Recurring order detected. Redirecting to subscription setup...");
          
          sessionStorage.setItem("subscriptionCart", JSON.stringify(
            lines.map(line => ({
              product_id: line.p.id,
              name: line.p.name,
              cartons: line.qty,
              price_per_carton: line.tier.price,
              subtotal: line.subtotal
            }))
          ));
          
          sessionStorage.setItem("subscriptionInterval", interval);
          window.location.href = "subscriptions.html";
          return; 
        }

        const formattedCart = Object.entries(cart).map(([productId, quantity]) => ({
          product_id: productId,
          quantity: quantity
        }));

        const res = await apiFetch('/api/create-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cart: formattedCart,
            profile: currentUser
          })
        });

        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
        } else {
          throw new Error(data.error || "Failed to get checkout URL");
        }
      } catch (error) {
        console.error("DETAILED ERROR:", error);
        safeToast("Order failed", error.message, "error");
      } finally {
        if (modalPlaceStripeBtn) {
          modalPlaceStripeBtn.disabled = false;
          modalPlaceStripeBtn.textContent = "Pay Online (Card) →";
        }
        if (modalPlaceCreditBtn) modalPlaceCreditBtn.disabled = false;
      }
    });
  }

  // B2B Credit terms checkout
  if (modalPlaceCreditBtn) {
    modalPlaceCreditBtn.addEventListener("click", async () => {
      modalPlaceCreditBtn.disabled = true;
      modalPlaceCreditBtn.textContent = "Placing Order...";
      if (modalPlaceStripeBtn) modalPlaceStripeBtn.disabled = true;

      try {
        const currentUser = await getCurrentProfile();
        if (!currentUser) {
          safeToast("Please sign in first.", "", "error");
          window.location.href = "login.html";
          return;
        }

        const lines = getOrderLines();
        const orderObj = {
          totalCartons: totalCartons(),
          totalAmount: totalPrice(),
          status: 'pending',
          notes: `Paid via B2B Credit Terms (${currentUser.paymentTerms})`,
          paymentMethod: 'credit',
          paymentStatus: 'unpaid',
          creditTerms: currentUser.paymentTerms,
          items: lines.map(line => ({
            productId: line.p.id,
            sku: line.p.sku,
            name: line.p.name,
            cartons: line.qty,
            pricePerCarton: line.tier.price
          }))
        };

        const savedOrder = await Orders.add(orderObj);
        console.log("Order saved on credit terms:", savedOrder);

        clearCart();
        updateCheckoutBar();
        closeModal();

        safeToast("Order Placed", "Your B2B Credit order has been submitted successfully.", "success");
        
        const banner = document.getElementById("order-success");
        if (banner) {
          banner.style.display = "flex";
          setTimeout(() => {
            banner.style.display = "none";
            window.location.href = "account.html";
          }, 2500);
        } else {
          setTimeout(() => {
            window.location.href = "account.html";
          }, 2000);
        }
      } catch (error) {
        console.error("DETAILED ERROR:", error);
        safeToast("Order failed", error.message, "error");
      } finally {
        if (modalPlaceCreditBtn) {
          modalPlaceCreditBtn.disabled = false;
          modalPlaceCreditBtn.textContent = `Use B2B Credit (${user.paymentTerms}) →`;
        }
        if (modalPlaceStripeBtn) modalPlaceStripeBtn.disabled = false;
      }
    });
  }
}


/* ============================================================
   Page initialisation
   ============================================================ */

async function initCatalogPage() {
  try {
    user = await getCurrentProfile();
  } catch (error) {
    console.warn("No active user found:", error.message);
    user = null;
  }

  if (typeof buildNav === "function") {
    buildNav("catalog");
  }

  if (typeof buildFooter === "function") {
    buildFooter();
  }

  try {
    await loadProductsFromSupabase();
  } catch (error) {
    console.error("Failed to load products from Supabase:", error.message);

    safeToast(
      "Could not load Supabase products",
      "Using local product data for now.",
      "error"
    );

    loadFallbackProducts();
  }

  renderAll();
  renderComingSoon();
  updateCheckoutBar();
  bindCheckoutButtons();
}

const recurringOrder = document.getElementById('recurringOrder');
const recurringOptions = document.getElementById('recurring-options');
const deliveryInterval = document.getElementById('deliveryInterval');
const freqButtons = document.querySelectorAll('.freq-btn');

if (recurringOrder && recurringOptions && deliveryInterval) {
  recurringOrder.addEventListener('change', () => {
    if (recurringOrder.checked) {
      recurringOptions.style.maxHeight = '80px';
      recurringOptions.style.marginTop = '0.5rem';
    } else {
      recurringOptions.style.maxHeight = '0';
      recurringOptions.style.marginTop = '0';
    }
  });
}

freqButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    freqButtons.forEach(b => {
      b.classList.remove('active');
      b.style.fontWeight = '500';
      b.style.border = '1.5px solid #E0D5C8';
      b.style.background = '#fff';
    });
    btn.classList.add('active');
    btn.style.fontWeight = '600';
    btn.style.border = '1.5px solid var(--amber)';
    btn.style.background = '#fffbeb';
    deliveryInterval.value = btn.getAttribute('data-value');
  });
});

initCatalogPage();