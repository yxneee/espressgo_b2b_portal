const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Vercel needs this to handle the raw body for Stripe signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const sig = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);
  let event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log("Webhook Verified:", event.type);
  } catch (err) {
    console.error("Webhook Error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { profile_id, order_items_mini, total_cartons_str } = session.metadata;

    try {
      const itemPairs = order_items_mini.split(',');
      const finalCartons = parseInt(total_cartons_str) || 0;

      // 1. Fetch Profile
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', profile_id).maybeSingle();

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
          price_per_carton: (session.amount_total / 100 / itemPairs.length)
        });
      }
      console.log("ORDER SAVED TO SUPABASE SUCCESSFULLY");
    } catch (err) {
      console.error("SUPABASE ERROR:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(200).json({ received: true });
};