require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const app = express();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 1. STRIPE WEBHOOK (Needs raw body)
app.use(['/api/webhook', '/webhook'], express.raw({ type: 'application/json' }));

// 2. MIDDLEWARE
app.use(cors());
app.use(express.json());

// 3. DIAGNOSTIC ROUTE
app.get(['/api', '/api/index.js'], (req, res) => res.send('API is Online'));

// 4. THE MAIN CHECKOUT ROUTE
// We use a wildcard (*) or match the specific rewrite destination
app.post(['/api/create-checkout-session', '/create-checkout-session', '/api/index.js'], async (req, res) => {
  const { cart, profile } = req.body;
  
  // Basic validation to prevent crashes
  if (!cart || !Array.isArray(cart) || cart.length === 0) {
    return res.status(400).json({ error: "Cart is empty or invalid" });
  }

  try {
    const productIds = cart.map(i => i.product_id);

    // Fetch data with error handling
    const { data: products, error: pErr } = await supabase.from('products').select('*').in('id', productIds);
    const { data: tiers, error: tErr } = await supabase.from('product_tiers').select('*').in('product_id', productIds);

    if (pErr || tErr || !products) throw new Error("Database lookup failed");

    let line_items = [];
    for (const item of cart) {
      const product = products.find(p => p.id === item.product_id);
      const tier = tiers.find(t =>
        t.product_id === item.product_id &&
        item.quantity >= t.min_quantity &&
        (t.max_quantity === null || item.quantity <= t.max_quantity)
      );

      if (!product || !tier) continue; // Skip items with missing pricing info

      line_items.push({
        price_data: {
          currency: 'sgd',
          product_data: { name: product.name },
          unit_amount: Math.round(tier.price * 100),
        },
        quantity: item.quantity,
      });
    }

    if (line_items.length === 0) throw new Error("No valid products found in cart");

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items,
      success_url: `${process.env.BASE_URL}/account.html`,
      cancel_url: `${process.env.BASE_URL}/catalog.html`,
      metadata: {
        profile_id: profile?.id || 'guest',
        order_items_mini: cart.map(i => `${i.product_id}:${i.quantity}`).join(',')
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;