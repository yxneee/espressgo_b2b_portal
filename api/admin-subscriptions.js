/* ============================================================
   api/admin-subscriptions.js
   Vercel serverless function – returns ALL subscriptions with
   joined profile & items data for the admin dashboard.
   Uses the service role key to bypass RLS.
   ============================================================ */

const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify the caller is an authenticated admin using their JWT
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: no token provided' });
    }

    // Validate the JWT and get the user
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return res.status(401).json({ error: 'Unauthorized: invalid token' });
    }

    // Check that the user has admin role in profiles
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile || profile.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin role required' });
    }

    // Fetch all subscriptions with joined profile and items
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .select(`
        id,
        created_at,
        frequency,
        status,
        user_id,
        profiles(company_name, contact_name, email),
        subscription_items(
          id,
          cartons,
          price_per_carton,
          product_id,
          products(
            id,
            name,
            sku
          )
        )
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json({ subscriptions: data || [] });
  } catch (err) {
    console.error('[admin-subscriptions] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
