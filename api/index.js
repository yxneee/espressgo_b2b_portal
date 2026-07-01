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

// Webhook
app.use('/webhook', express.raw({ type: 'application/json' }));

app.use(cors());
app.use(express.json());

// TEST ROUTE
app.get('/', (req, res) => {
  res.send('Server is running');
});

// CREATE CHECKOUT
app.post('/create-checkout-session', async (req, res) => {
  const { cart, profile } = req.body;

  console.log("Incoming cart:", cart);

  try {
    if (!cart || cart.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    const productIds = cart.map(i => i.product_id);

    const { data: products, error: productError } = await supabase
      .from('products')
      .select('*')
      .in('id', productIds);

    if (productError) throw productError;

    const { data: tiers, error: tierError } = await supabase
      .from('product_tiers')
      .select('*')
      .in('product_id', productIds);

    if (tierError) throw tierError;

    let line_items = [];
    let orderItems = [];
    let totalAmount = 0;
    let totalCartons = 0;

    for (const item of cart) {
      const product = products.find(p => p.id === item.product_id);

      if (!product) {
        throw new Error(`Product not found: ${item.product_id}`);
      }

      const tier = tiers.find(t =>
        t.product_id === item.product_id &&
        item.quantity >= t.min_quantity &&
        (t.max_quantity === null || item.quantity <= t.max_quantity)
      );

      if (!tier) {
        throw new Error(`No pricing tier for product ${item.product_id}`);
      }

      const price = tier.price;

      totalAmount += price * item.quantity;
      totalCartons += item.quantity;

      line_items.push({
        price_data: {
          currency: 'sgd',
          product_data: { name: product.name },
          unit_amount: Math.round(price * 100),
        },
        quantity: item.quantity,
      });

      orderItems.push({
        product_id: product.id,
        sku: product.sku,
        name: product.name,
        cartons: item.quantity,
        price_per_carton: price,
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items,
      success_url: `${process.env.BASE_URL}/success.html`,
      cancel_url: `${process.env.BASE_URL}/catalog.html`,

      metadata: {
        profile_id: profile.id, // Just send the ID
        // Create a tiny string of items: "prod_id:qty,prod_id:qty"
        order_items_mini: cart.map(i => `${i.product_id}:${i.quantity}`).join(',')
      },
    });

    console.log("✅ Stripe session:", session.id);

    res.json({ url: session.url });

  } catch (err) {
    console.error("❌ ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// WEBHOOK
app.post('/webhook', async (req, res) => {
  console.log("--- WEBHOOK HIT ---");
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log("🔔 Webhook received event type:", event.type);
  } catch (err) {
    console.error("❌ Webhook Signature Verification Failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { profile_id, order_items_mini } = session.metadata;

      // 1. Fetch the full profile from Supabase using the ID
      const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', profile_id)
          .single();

      // 2. Reconstruct the items from the mini string
      const itemPairs = order_items_mini.split(',');
      
      // 3. Save the Order Header
      const { data: order, error: orderError } = await supabase
          .from('orders')
          .insert([{
              profile_id: profile_id,
              company: profile.company_name || 'N/A',
              contact_name: profile.contact_name || 'N/A',
              business_type: profile.business_type,
              delivery_address: profile.delivery_address || 'Singapore',
              total_cartons: itemPairs.reduce((sum, pair) => sum + parseInt(pair.split(':')[1]), 0),
              total_amount: session.amount_total / 100, // Stripe uses cents
              status: 'processing',
          }])
          .select().single();

      if (orderError) {
          console.error("❌ DB Error:", orderError.message);
          return;
      }

      // 4. Save the items (The loop handles lookups)
      for (const pair of itemPairs) {
          const [prodId, qty] = pair.split(':');
          const { data: p } = await supabase.from('products').select('*').eq('id', prodId).single();

          await supabase.from('order_items').insert({
              order_id: order.id,
              product_id: prodId,
              sku: p.sku,
              name: p.name,
              cartons: parseInt(qty),
              price_per_carton: (session.amount_total / 100) / itemPairs.length // Simplified for now
          });
      }
      console.log('✅ Order saved successfully!');
  }
  res.json({ received: true });
});

// START SERVER
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

module.exports = app;