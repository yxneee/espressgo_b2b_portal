// api/chat-action.js — Secure AI Action Executor
// Called by the frontend AFTER KOPIGO emits a structured action token.
// Uses the Supabase service role key to perform DB reads/writes server-side.

const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// B2B tier pricing logic (mirrors system prompt)
function getUnitPrice(productId, totalCartons) {
  const tiers = {
    'espressgo-original': [
      { min: 30, price: 96 },
      { min: 10, price: 108 },
      { min: 1,  price: 120 }
    ],
    'espressgo-oatmilk': [
      { min: 30, price: 104 },
      { min: 10, price: 117 },
      { min: 1,  price: 130 }
    ]
  };
  const productTiers = tiers[productId] || tiers['espressgo-original'];
  for (const tier of productTiers) {
    if (totalCartons >= tier.min) return tier.price;
  }
  return productTiers[productTiers.length - 1].price;
}

// ── ACTION HANDLERS ───────────────────────────────────────────────────────────

/**
 * PLACE_ORDER — Insert a real order + order items into Supabase from chat cart.
 * Uses the same schema as catalog.js / Orders.add() in shared.js:
 *   orders: profile_id, company, contact_name, total_cartons, total_amount, status, payment_method, payment_status, notes
 *   order_items: order_id, product_id, cartons, price_per_carton
 */
async function handlePlaceOrder(supabase, userId, userProfile, cart) {
  if (!userId) {
    return { success: false, error: 'You must be logged in to place an order.' };
  }
  if (!cart || Object.keys(cart).length === 0) {
    return { success: false, error: 'Your cart is empty. Add some products first!' };
  }

  // Build order items array
  const totalCartons = Object.values(cart).reduce((s, q) => s + q, 0);
  const orderItems = Object.entries(cart).map(([productId, qty]) => ({
    product_id: productId,
    cartons: qty,
    price_per_carton: getUnitPrice(productId, totalCartons)
  }));
  const totalAmount = orderItems.reduce((s, i) => s + i.cartons * i.price_per_carton, 0);

  // Insert the order header — matching exact column names from catalog.js saveOrderToSupabase()
  const orderPayload = {
    profile_id: userId,
    company: userProfile?.companyName || 'B2B Partner',
    contact_name: userProfile?.contactName || userProfile?.email || 'B2B Partner',
    business_type: userProfile?.businessType || null,
    delivery_address: userProfile?.deliveryAddress || 'Singapore',
    total_cartons: totalCartons,
    total_amount: totalAmount,
    status: 'pending',
    payment_method: 'credit',
    payment_status: 'unpaid',
    notes: 'Placed via KOPIGO AI Chat'
  };

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert(orderPayload)
    .select()
    .single();

  if (orderError) {
    console.error('[chat-action] PLACE_ORDER order insert error:', orderError);
    return { success: false, error: 'Failed to create order: ' + orderError.message };
  }

  // Insert order items — matching order_items schema from catalog.js
  const itemsToInsert = orderItems.map(i => ({
    order_id: order.id,
    product_id: i.product_id,
    cartons: i.cartons,
    price_per_carton: i.price_per_carton
  }));

  const { error: itemsError } = await supabase
    .from('order_items')
    .insert(itemsToInsert);

  if (itemsError) {
    console.error('[chat-action] PLACE_ORDER items insert error:', itemsError);
    return { success: false, error: 'Order created but items failed: ' + itemsError.message };
  }

  return {
    success: true,
    order: {
      id: order.id,
      totalAmount,
      totalCartons,
      status: 'pending',
      dateOrdered: order.created_at,
      items: orderItems
    }
  };
}

/**
 * GET_INVOICES — Fetch the user's last 5 orders from Supabase.
 * Queries by profile_id (the actual FK column name).
 */
async function handleGetInvoices(supabase, userId) {
  if (!userId) {
    return { success: false, error: 'You must be logged in to view invoices.' };
  }

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, status, total_amount, total_cartons, created_at, payment_status, payment_method')
    .eq('profile_id', userId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('[chat-action] GET_INVOICES error:', error);
    return { success: false, error: 'Failed to fetch invoices: ' + error.message };
  }

  // Normalise created_at → date_ordered for consistent frontend rendering
  const invoices = (orders || []).map(o => ({
    ...o,
    date_ordered: o.created_at
  }));

  return { success: true, invoices };
}

/**
 * GET_INVOICE — Fetch a specific order by ID including its line items.
 */
async function handleGetInvoice(supabase, userId, orderId) {
  if (!userId) {
    return { success: false, error: 'You must be logged in to view an invoice.' };
  }
  if (!orderId) {
    return { success: false, error: 'No order ID provided.' };
  }

  const { data: order, error } = await supabase
    .from('orders')
    .select('id, status, total_amount, total_cartons, created_at, payment_status, order_items(product_id, cartons, price_per_carton)')
    .eq('id', orderId)
    .eq('profile_id', userId)
    .single();

  if (error || !order) {
    console.error('[chat-action] GET_INVOICE error:', error);
    return { success: false, error: 'Order not found or access denied.' };
  }

  return { success: true, invoice: { ...order, date_ordered: order.created_at } };
}

/**
 * GET_SUBSCRIPTIONS — List the user's subscriptions with their items.
 */
async function handleGetSubscriptions(supabase, userId) {
  if (!userId) {
    return { success: false, error: 'You must be logged in to view subscriptions.' };
  }

  const { data: subs, error } = await supabase
    .from('subscriptions')
    .select('id, frequency, status, created_at, subscription_items(product_id, cartons, price_per_carton)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[chat-action] GET_SUBSCRIPTIONS error:', error);
    return { success: false, error: 'Failed to fetch subscriptions: ' + error.message };
  }

  return { success: true, subscriptions: subs || [] };
}

/**
 * PAUSE_SUBSCRIPTION / RESUME_SUBSCRIPTION — Toggle subscription status.
 */
async function handleToggleSubscription(supabase, userId, subscriptionId, newStatus) {
  if (!userId) {
    return { success: false, error: 'You must be logged in to manage subscriptions.' };
  }
  if (!subscriptionId) {
    return { success: false, error: 'No subscription ID provided.' };
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .update({ status: newStatus })
    .eq('id', subscriptionId)
    .eq('user_id', userId)
    .select('id, status, frequency')
    .single();

  if (error || !data) {
    console.error('[chat-action] TOGGLE_SUBSCRIPTION error:', error);
    return { success: false, error: 'Failed to update subscription: ' + (error?.message || 'Not found') };
  }

  return { success: true, subscription: data };
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const { action, userId, userProfile, cart, subscriptionId, orderId } = body || {};

  if (!action) {
    return res.status(400).json({ error: 'Missing "action" parameter.' });
  }

  const supabase = getSupabase();

  try {
    let result;

    switch (action) {
      case 'PLACE_ORDER':
        result = await handlePlaceOrder(supabase, userId, userProfile, cart);
        break;

      case 'GET_INVOICES':
        result = await handleGetInvoices(supabase, userId);
        break;

      case 'GET_INVOICE':
        result = await handleGetInvoice(supabase, userId, orderId);
        break;

      case 'GET_SUBSCRIPTIONS':
        result = await handleGetSubscriptions(supabase, userId);
        break;

      case 'PAUSE_SUBSCRIPTION':
        result = await handleToggleSubscription(supabase, userId, subscriptionId, 'paused');
        break;

      case 'RESUME_SUBSCRIPTION':
        result = await handleToggleSubscription(supabase, userId, subscriptionId, 'active');
        break;

      default:
        return res.status(400).json({ error: `Unknown action: "${action}"` });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('[chat-action] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error.', details: err.message });
  }
};
