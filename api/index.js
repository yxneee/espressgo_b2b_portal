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

// --- 1. WEBHOOK (Must be first) ---
app.post(['/webhook', '/api/webhook'], express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log("Webhook Verified. Event:", event.type);
  } catch (err) {
    console.error("Webhook Signature Error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { profile_id, order_items_mini, total_cartons_str } = session.metadata;

    try {
      // Manual fallback for cartons
      const itemPairs = order_items_mini.split(',');
      let calcCartons = 0;
      itemPairs.forEach(p => calcCartons += parseInt(p.split(':')[1]) || 0);
      const finalCartons = parseInt(total_cartons_str) || calcCartons || 1;

      // 1. Fetch Profile
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', profile_id).single();

      // 2. Insert Order
      const { data: order, error: orderError } = await supabase.from('orders').insert([{
        profile_id: profile_id,
        company: profile?.company_name || 'N/A',
        contact_name: profile?.contact_name || 'N/A',
        business_type: profile?.business_type || 'B2B',
        delivery_address: profile?.delivery_address || 'Singapore',
        total_cartons: finalCartons,
        total_amount: session.amount_total / 100,
        status: 'processing',
        payment_method: 'stripe',
        payment_status: 'paid'
      }]).select().single();

      if (orderError) throw orderError;

      // 3. Insert Items
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
      console.log("ORDER SAVED TO SUPABASE SUCCESSFULLY");
    } catch (err) {
      console.error("SUPABASE ERROR:", err.message);
    }
  }
  res.json({ received: true });
});

// --- 2. MIDDLEWARE ---
app.use(cors({ origin: '*', methods: ['POST', 'GET', 'OPTIONS'], credentials: true }));
app.use(express.json());

// --- 3. ROUTES ---
app.get('/api/webhook', (req, res) => res.send('Routing logic is working! Webhook is ready.'));
app.get('/', (req, res) => res.send('API is Online'));

app.post('/api/create-checkout-session', async (req, res) => {
  const { cart, profile } = req.body;
  try {
    let totalCartons = 0;
    cart.forEach(i => totalCartons += i.quantity);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: cart.map(item => ({
        price_data: { currency: 'sgd', product_data: { name: 'Espressgo Product' }, unit_amount: 12000 }, // Fallback price
        quantity: item.quantity
      })),
      success_url: `${process.env.BASE_URL}/account.html?status=success`,
      cancel_url: `${process.env.BASE_URL}/catalog.html`,
      metadata: {
        profile_id: profile.id,
        total_cartons_str: String(totalCartons),
        order_items_mini: cart.map(i => `${i.product_id}:${i.quantity}`).join(',')
      },
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const chat = require('./chat.js');
app.post(['/api/chat', '/chat'], (req, res) => chat(req, res));

if (process.env.NODE_ENV !== 'production') {
  app.listen(3000, () => console.log('Local server: http://localhost:3000'));
}
module.exports = app;