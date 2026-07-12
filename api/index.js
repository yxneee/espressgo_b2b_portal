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