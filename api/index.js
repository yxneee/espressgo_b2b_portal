require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 1. STRIPE WEBHOOK (Must be defined BEFORE express.json())
app.use('/api/webhook', express.raw({ type: 'application/json' }));
app.use('/webhook', express.raw({ type: 'application/json' }));

// 2. STANDARD MIDDLEWARE
app.use(cors({
  origin: '*', 
  methods: ['POST', 'GET', 'OPTIONS'],
  credentials: true
}));
app.use(express.json());

// 3. ROUTES
app.get('/api', (req, res) => res.send('Server is running'));
app.get('/', (req, res) => res.send('Server is running'));

// CREATE CHECKOUT SESSION
app.post(['/api/create-checkout-session', '/create-checkout-session'], async (req, res) => {
  const { cart, profile } = req.body;
  console.log("Incoming cart:", cart);

  try {
    if (!cart || cart.length === 0) return res.status(400).json({ error: "Cart is empty" });

    const productIds = cart.map(i => i.product_id);

    // Fetch data from Supabase
    const { data: products } = await supabase.from('products').select('*').in('id', productIds);
    const { data: tiers } = await supabase.from('product_tiers').select('*').in('product_id', productIds);

    let line_items = [];
    for (const item of cart) {
      const product = products.find(p => p.id === item.product_id);
      const tier = tiers.find(t =>
        t.product_id === item.product_id &&
        item.quantity >= t.min_quantity &&
        (t.max_quantity === null || item.quantity <= t.max_quantity)
      );

      if (!product || !tier) throw new Error(`Pricing not found for ${item.product_id}`);

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
        profile_id: profile.id,
        order_items_mini: cart.map(i => `${i.product_id}:${i.quantity}`).join(',')
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// WEBHOOK LOGIC
app.post(['/api/webhook', '/webhook'], async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { profile_id, order_items_mini } = session.metadata;

    const { data: profile } = await supabase.from('profiles').select('*').eq('id', profile_id).single();
    const itemPairs = order_items_mini.split(',');

    const { data: order, error: orderError } = await supabase.from('orders').insert([{
        profile_id,
        company: profile.company_name || 'N/A',
        contact_name: profile.contact_name || 'N/A',
        business_type: profile.business_type,
        delivery_address: profile.delivery_address || 'Singapore',
        total_cartons: itemPairs.reduce((sum, pair) => sum + parseInt(pair.split(':')[1]), 0),
        total_amount: session.amount_total / 100,
        status: 'processing',
    }]).select().single();

    if (!orderError) {
      for (const pair of itemPairs) {
        const [prodId, qty] = pair.split(':');
        const { data: p } = await supabase.from('products').select('*').eq('id', prodId).single();
        await supabase.from('order_items').insert({
          order_id: order.id, product_id: prodId, sku: p.sku, name: p.name,
          cartons: parseInt(qty), price_per_carton: session.amount_total / 100 / parseInt(qty) // Approximate for webhook
        });
      }
    }
  }
  res.json({ received: true });
});

// Vercel handles the export. Local testing uses the listen.
if (process.env.NODE_ENV !== 'production') {
    app.listen(3000, () => console.log(`Server running on http://localhost:3000`));
}

module.exports = app;