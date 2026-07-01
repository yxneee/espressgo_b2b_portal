const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { cart, profile } = req.body;

  if (!cart || !Array.isArray(cart) || cart.length === 0) {
    return res.status(400).json({ error: "Cart is empty or invalid" });
  }

  try {
    const productIds = cart.map(i => i.product_id);

    // Fetch data from Supabase
    const { data: products, error: pErr } = await supabase.from('products').select('*').in('id', productIds);
    const { data: tiers, error: tErr } = await supabase.from('product_tiers').select('*').in('product_id', productIds);

    if (pErr || tErr || !products) {
      console.error("DB Error:", pErr || tErr);
      return res.status(500).json({ error: "Failed to load product data from database" });
    }

    let line_items = [];
    for (const item of cart) {
      const product = products.find(p => p.id === item.product_id);
      const tier = tiers.find(t =>
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

    if (line_items.length === 0) {
        return res.status(400).json({ error: "No valid products were found in your cart" });
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

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error("CRASH:", err.message);
    return res.status(500).json({ error: err.message });
  }
};