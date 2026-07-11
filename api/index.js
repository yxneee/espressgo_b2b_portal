require('dotenv').config();

const express = require('express');
const app = express();
const cors = require('cors');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- 1. WEBHOOK (Must be before express.json) ---
app.post(['/api/webhook', '/webhook'], express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("❌ Webhook Error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      // FIX: Extracting the metadata we sent during checkout
      const { profile_id, order_items_mini, total_cartons_str } = session.metadata;

      try {
          // 1. Fetch the full profile
          const { data: profile } = await supabase.from('profiles').select('*').eq('id', profile_id).single();

          // 2. Save the Order Header
          const { data: order, error: orderError } = await supabase
              .from('orders')
              .insert([{
                  profile_id: profile_id,
                  company: profile?.company_name || 'N/A',
                  contact_name: profile?.contact_name || 'N/A',
                  business_type: profile?.business_type,
                  delivery_address: profile?.delivery_address || 'Singapore',
                  total_cartons: parseInt(total_cartons_str || session.metadata.total_cartons || 0),// Convert string back to number for DB
                  total_amount: session.amount_total / 100,
                  status: 'processing',
                  payment_method: 'stripe', // Track this for the new admin site
                  payment_status: 'paid'
              }])
              .select().single();

          if (orderError) throw orderError;

          // 3. Save the individual items
          const itemPairs = order_items_mini.split(',');
          for (const pair of itemPairs) {
              const [prodId, qty] = pair.split(':');
              const { data: p } = await supabase.from('products').select('*').eq('id', prodId).single();

              await supabase.from('order_items').insert({
                  order_id: order.id,
                  product_id: prodId,
                  sku: p?.sku || 'N/A',
                  name: p?.name || 'Product',
                  cartons: parseInt(qty),
                  price_per_carton: p?.tiers ? p.tiers[0].price : (session.amount_total / 100 / itemPairs.length)
              });
          }
          console.log('✅ SUCCESS: Order saved to database');
      } catch (dbErr) {
          console.error("❌ DATABASE SAVE FAILED:", dbErr.message);
          // Return 200 so Stripe stops retrying, but we log the error
      }
  }
  res.json({ received: true });
});

// standard middleware
app.use(cors({
  origin: '*',
  methods: ['POST', 'GET', 'OPTIONS'],
  credentials: true
}));
app.use(express.json());

// Add this temporary test route
app.get('/api/webhook', (req, res) => {
  res.send('Webhook path is visible! Use POST to send data.');
});

// Basic check routes
app.get('/', (req, res) => res.send('ESPRESSGO API Online'));
app.get('/api', (req, res) => res.send('API Server is Online'));

app.post('/api/create-checkout-session', async (req, res) => {
  const { cart, profile } = req.body;

  try {
    const productIds = cart.map(i => i.product_id);
    const { data: products } = await supabase.from('products').select('*').in('id', productIds);
    const { data: tiers } = await supabase.from('product_tiers').select('*').in('product_id', productIds);

    let line_items = [];
    let totalCartons = 0;

    for (const item of cart) {
      const product = products.find(p => p.id === item.product_id);
      const tier = tiers.find(t => 
        t.product_id === item.product_id && 
        item.quantity >= t.min_quantity && 
        (t.max_quantity === null || item.quantity <= t.max_quantity)
      );

      if (!product || !tier) continue;

      totalCartons += item.quantity;
      line_items.push({
        price_data: {
          currency: 'sgd',
          product_data: { name: product.name },
          unit_amount: Math.round(tier.price * 100), // Tiered Price
        },
        quantity: item.quantity,
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items,
      success_url: `${process.env.BASE_URL}/account.html?status=success`,
      cancel_url: `${process.env.BASE_URL}/catalog.html`,
      metadata: {
        profile_id: profile.id,
        // FIX: totalCartons MUST be converted to a String for Stripe
        total_cartons_str: String(totalCartons), 
        order_items_mini: cart.map(i => `${i.product_id}:${i.quantity}`).join(',')
      },
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error("❌ ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Import serverless functions
const chat = require('./chat.js');

app.post('/api/chat', (req, res) => chat(req, res));
app.post('/chat', (req, res) => chat(req, res));

// Local listener
if (process.env.NODE_ENV !== 'production') {
    app.listen(3000, () => console.log(`Running on http://localhost:3000`));
}

module.exports = app;