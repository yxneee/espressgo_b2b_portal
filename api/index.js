require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient (
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Webhook Middleware (Must come before express.json)
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log("--- WEBHOOK HIT ---");
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log("Webhook received event type:", event.type);
  } catch (err) {
    console.error("Webhook Signature Verification Failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { profile_id, order_items_mini } = session.metadata;

      // 1. Fetch the full profile from Supabase
      const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', profile_id)
          .single();

      // 2. Save the Order Header
      const { data: order, error: orderError } = await supabase
          .from('orders')
          .insert([{
              profile_id: profile_id,
              company: profile?.company_name || 'N/A',
              contact_name: profile?.contact_name || 'N/A',
              business_type: profile?.business_type,
              delivery_address: profile?.delivery_address || 'Singapore',
              total_cartons: session.metadata.total_cartons, 
              total_amount: session.amount_total / 100, // Stripe uses cents
              status: 'processing',
          }])
          .select().single();

      if (orderError) {
          console.error("DB Error saving order:", orderError.message);
          return res.status(500).json({ error: orderError.message });
      }

      // 3. Save the individual items
      const itemPairs = order_items_mini.split(',');
      for (const pair of itemPairs) {
          const [prodId, qty] = pair.split(':');
          const { data: p } = await supabase.from('products').select('*').eq('id', prodId).single();

          await supabase.from('order_items').insert({
              order_id: order.id,
              product_id: prodId,
              sku: p?.sku || 'N/A',
              name: p?.name || 'Unknown Product',
              cartons: parseInt(qty),
              price_per_carton: p ? (session.amount_total / 100 / itemPairs.length) : 0 // Simplified or fetch from tier
          });
      }
      console.log('Order saved successfully to Supabase!');
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

app.get('/', (req, res) => res.send('ESPRESSGO API is running'));

// Import serverless functions
const chat = require('./chat.js');
app.post('/api/chat', (req, res) => chat(req, res));
app.post('/chat', (req, res) => chat(req, res));

// Checkout and send to database
app.post('/api/create-checkout-session', async (req, res) => {
  const { cart, profile } = req.body;

  try {
    if (!cart || cart.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }

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

      if (!product || !tier) throw new Error(`Pricing or Product not found for ${item.product_id}`);

      totalCartons += item.quantity;

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
      success_url: `${process.env.BASE_URL}/account.html?status=success`,
      cancel_url: `${process.env.BASE_URL}/catalog.html`,
      metadata: {
        profile_id: profile.id,
        total_cartons: totalCartons,
        order_items_mini: cart.map(i => `${i.product_id}:${i.quantity}`).join(',')
      },
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error("ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Local listener
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});yu

module.exports = app;