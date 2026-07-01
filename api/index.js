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

// This middleware logs every request so you can see it in Vercel Logs
app.use((req, res, next) => {
  console.log(`Incoming: ${req.method} ${req.url}`);
  next();
});

// STRIPE WEBHOOK (Needs raw body)
app.use(['/api/webhook', '/webhook'], express.raw({ type: 'application/json' }));

app.use(cors());
app.use(express.json());

// HEALTH CHECK
app.get('*', (req, res, next) => {
    if (req.url === '/api' || req.url === '/') return res.send('API is Online');
    next();
});

// THE MAIN CHECKOUT ROUTE
// We use a wildcard (*) or match the specific paths. 
// This ensures that even if Vercel sends '/api/index.js', it matches.
app.post(['/api/create-checkout-session', '/create-checkout-session', '/api/index.js', '*'], async (req, res) => {
  const { cart, profile } = req.body;
  
  if (!cart) return res.status(400).json({ error: "No cart provided" });

  try {
    const productIds = cart.map(i => i.product_id);
    const { data: products } = await supabase.from('products').select('*').in('id', productIds);
    const { data: tiers } = await supabase.from('product_tiers').select('*').in('product_id', productIds);

    let line_items = [];
    for (const item of cart) {
      const product = products?.find(p => p.id === item.product_id);
      const tier = tiers?.find(t =>
        t.product_id === item.product_id &&
        item.quantity >= t.min_quantity &&
        (t.max_quantity === null || item.quantity <= t.max_quantity)
      );

      if (!product || !tier) continue;

      line_items.push({
        price_data: {
          currency: 'sgd',
          product_data: { name: product.name },
          unit_amount: Math.round(tier.price * 100),
        },
        quantity: item.quantity,
      });
    }

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
    console.error("BACKEND ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;