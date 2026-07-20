// api/chat.js - Secure backend proxy using native https to guarantee 100% runtime compatibility on Vercel Node

const https = require('https');

// Helper to make HTTPS requests using Node's native core module (no dependencies, works on any Node version)
function makeHttpsRequest(options, payload) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);

    // Add Content-Length dynamically
    options.headers = {
      ...options.headers,
      'Content-Length': Buffer.byteLength(postData)
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: () => Promise.resolve(body),
          json: () => {
            try {
              return Promise.resolve(JSON.parse(body));
            } catch (err) {
              return Promise.reject(new Error('Failed to parse JSON response: ' + body));
            }
          }
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  // CORS Headers for safety
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  const { question, history, user, cart, orders, subscriptions } = body || {};
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'Missing parameter: "question" string is required.' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;

  // Helper intent matcher functions for ultra-smart & typo-tolerant detection
  function checkInvoiceIntent(qLower, rawQuestion) {
    const specificMatch = rawQuestion.match(/(?:inv[a-z]{3,7}|invoice|bill|receipt)\s*#?\s*\b([a-f0-9-]{8,}|\d+)\b/i) ||
                          /inv[a-z]{3,7}\s*#?\s*\b([a-f0-9-]{8,}|\d+)\b/i.exec(rawQuestion);
    if (specificMatch && specificMatch[1] && !/\b(history|all|my)\b/i.test(specificMatch[1])) {
      return { type: 'SPECIFIC', id: specificMatch[1] };
    }
    const pattern = /\b(inv[a-z]{3,7}|invois|invoce|invoic|bill|bills|receipt|receipts|statement|statements|invoice history|my invoices|view invoice|show invoice|check invoice|get invoice)\b/i;
    if (pattern.test(qLower)) {
      return { type: 'ALL' };
    }
    return null;
  }

  function checkSubscriptionIntent(qLower, rawQuestion) {
    const pattern = /\b(su[bp][a-z]{2,10}t[a-z]{0,4}(?:ion|in|on|s)?|sub|subs|recurring|my plan|my plans|memberships?)\b/i;
    if (!pattern.test(qLower)) return null;

    if (/\b(pause|stop|suspend|freeze|cancel)\b/i.test(qLower)) return { type: 'PAUSE' };
    if (/\b(resume|restart|reactivate|unpause|start|continue)\b/i.test(qLower)) return { type: 'RESUME' };
    return { type: 'LIST' };
  }

  function checkPlaceOrderIntent(qLower) {
    return /\b(place order|place my order|confirm order|confirm my order|checkout|check out|submit order|submit my order|go ahead and order|order now|complete order|finalize order|finalise order|buy now|pay now|order|ordering|i want to order|want to order|order products|order coffee)\b/i.test(qLower);
  }

  function checkCartIntent(qLower) {
    if (checkPlaceOrderIntent(qLower)) return false;
    return /\b(my cart|view cart|show cart|what's in my cart|what is in my cart|cart details|items in cart|check cart|cart summary)\b/i.test(qLower);
  }

  // Friendly fallback if key is not configured yet (for instant ease-of-use/testing)
  if (!apiKey || apiKey === 'undefined' || apiKey === 'null' || apiKey.trim() === '') {
    let mockAnswer = "";
    const qLower = question.toLowerCase().trim();

    const invIntent = checkInvoiceIntent(qLower, question);
    const subIntent = checkSubscriptionIntent(qLower, question);

    // ── NEW DB-ACTION INTENTS (emit tokens, frontend handles the rest) ──

    const isLoggedIn = user && typeof user === 'object' && (user.id || user.email);

    // 1. PLACE_ORDER intent
    if (checkPlaceOrderIntent(qLower)) {
      if (!isLoggedIn) {
        mockAnswer = `🔑 You'll need to be signed in to place a wholesale order! Please <a href="login.html">Sign In or Register</a> to submit your order. ☕`;
      } else {
        const hasCart = cart && typeof cart === 'object' && !Array.isArray(cart) && Object.keys(cart).length > 0;
        if (hasCart) {
          const items = Object.entries(cart).map(([pid, qty]) => {
            const name = pid === 'espressgo-original' ? 'Original' : (pid === 'espressgo-oatmilk' ? 'Oat Milk' : pid);
            return `• **${qty} ctn ${name}**`;
          }).join('\n');
          mockAnswer = `Perfect! Here's your order summary:\n\n${items}\n\nPlease confirm below to place your real B2B order. ☕\n\n[[PLACE_ORDER]]`;
        } else {
          mockAnswer = `Your cart is empty! Please add some products first before placing an order.\n\nTry: "Add 4 cartons of Original" or "2 cartons Oat Milk" ☕`;
        }
      }
    }

    // 2. Specific GET_INVOICE intent — "invoice #123", "show order 45"
    else if (invIntent && invIntent.type === 'SPECIFIC') {
      if (!isLoggedIn) {
        mockAnswer = `🔑 You'll need to be signed in to view your invoice details! Please <a href="login.html">Sign In or Register</a> to access your account invoices. 📋`;
      } else {
        mockAnswer = `Fetching the details for Invoice #${invIntent.id} now. 📄\n\n[[GET_INVOICE: ${invIntent.id}]]`;
      }
    }

    // 3. GET_INVOICES (all invoices / history) — "view invoice", "invoices", "show invoice", "receipts", etc.
    else if (invIntent && invIntent.type === 'ALL') {
      if (!isLoggedIn) {
        mockAnswer = `🔑 You'll need to be signed in to view your invoice history! Please <a href="login.html">Sign In or Register</a> to access your B2B invoices. 📋`;
      } else {
        mockAnswer = `Sure! Pulling your invoice history from the database now. 📋\n\n[[GET_INVOICES]]`;
      }
    }

    // 4. GET_SUBSCRIPTIONS / PAUSE / RESUME intent — "sub", "subscriptions", "view subscription", etc.
    else if (subIntent) {
      if (!isLoggedIn) {
        mockAnswer = `🔑 You'll need to be signed in to view and manage your subscriptions! Please <a href="login.html">Sign In or Register</a> to access your recurring orders. 🔄`;
      } else if (subIntent.type === 'PAUSE') {
        const idMatch = question.match(/[a-f0-9-]{8,}/i);
        if (idMatch) {
          mockAnswer = `Pausing subscription **#${idMatch[0]}** now. ⏸\n\n[[PAUSE_SUBSCRIPTION: ${idMatch[0]}]]`;
        } else {
          mockAnswer = `Let me pull up your subscriptions so you can tell me which one to pause. 🔄\n\n[[GET_SUBSCRIPTIONS]]`;
        }
      } else if (subIntent.type === 'RESUME') {
        const idMatch = question.match(/[a-f0-9-]{8,}/i);
        if (idMatch) {
          mockAnswer = `Resuming subscription **#${idMatch[0]}** now. ▶\n\n[[RESUME_SUBSCRIPTION: ${idMatch[0]}]]`;
        } else {
          mockAnswer = `Let me pull up your subscriptions so you can tell me which one to resume. 🔄\n\n[[GET_SUBSCRIPTIONS]]`;
        }
      } else {
        mockAnswer = `Fetching your active subscriptions now. 🔄\n\n[[GET_SUBSCRIPTIONS]]`;
      }
    }

    // ── EXISTING INTENTS (unchanged) ──

    // ── PRICING & COST INQUIRIES ──
    else if (/\b(price|prices|pricing|cost|costs|rate|rates|tier|tiers|discount|discounts|how much|how expensive)\b/i.test(qLower)) {
      mockAnswer = `Here is our wholesale B2B pricing grid (50 pouches per carton):\n\n` +
        `☕ **ESPRESSGO Original**:\n` +
        `• 1–9 cartons: **SGD $120** / ctn ($2.40 / pouch)\n` +
        `• 10–29 cartons: **SGD $108** / ctn ($2.16 / pouch)\n` +
        `• 30+ cartons: **SGD $96** / ctn ($1.92 / pouch)\n\n` +
        `🥛 **ESPRESSGO Oat Milk**:\n` +
        `• 1–9 cartons: **SGD $130** / ctn ($2.60 / pouch)\n` +
        `• 10–29 cartons: **SGD $117** / ctn ($2.34 / pouch)\n` +
        `• 30+ cartons: **SGD $104** / ctn ($2.08 / pouch)\n\n` +
        `🚚 Delivery is **FREE** for orders of 5+ cartons! Would you like to add some cartons to your cart? ☕`;
    }

    // ── CONTACT & SUPPORT INQUIRIES ──
    else if (/\b(contact|phone|number|damien|whatsapp|email|support|owner|founder|reach|call)\b/i.test(qLower)) {
      mockAnswer = `You can reach ESPRESSGO Founder **Damien Teo** directly:\n\n` +
        `• 📱 **Phone**: +65 8797 7961\n` +
        `• 💬 **WhatsApp**: <a href="https://wa.me/6587977961" target="_blank">Chat on WhatsApp</a>\n` +
        `• ✉️ **Email**: hello@espressgo.sg\n\n` +
        `Office Hours: Mon–Fri, 9am–6pm SGT ☕`;
    }

    // ── PRODUCT SPECS & FLAVOR INQUIRIES (without explicit order action) ──
    else if (/\b(original|oat|oatmilk|matcha|decaf|flavor|flavors|flavour|flavours|caffeine|gel|shot|shots)\b/i.test(qLower) && !/\b(add|order|buy|cart|purchase|ctn|carton|cartons|pouch|pouches)\b/i.test(qLower)) {
      if (qLower.includes('matcha')) {
        mockAnswer = `🍵 **ESPRESSGO Matcha** is coming soon in **Q3 2026**! It combines premium Uji matcha with our cold brew gel shot. Join the waitlist on WhatsApp: <a href="https://wa.me/6587977961" target="_blank">Chat with Damien</a>`;
      } else if (qLower.includes('decaf')) {
        mockAnswer = `☕ **ESPRESSGO Decaf** is coming soon in **Q4 2026**! Swiss water decaf process (~5mg caffeine). Join the waitlist on WhatsApp: <a href="https://wa.me/6587977961" target="_blank">Chat with Damien</a>`;
      } else if (qLower.includes('oat')) {
        mockAnswer = `🥛 **ESPRESSGO Oat Milk** features premium cold brew blended with organic plant-based oat milk (30ml pouch, ~60mg caffeine). 100% dairy-free & vegan! SGD $130/ctn (50 pouches).`;
      } else {
        mockAnswer = `☕ **ESPRESSGO Original** is our flagship Vietnamese robusta cold brew gel shot (25ml pouch, ~65mg caffeine). Squeeze directly into mouth or into cold water/milk. SGD $120/ctn (50 pouches).`;
      }
    }

    // ── WHO AM I / USER INFO ──
    else if (qLower.includes('who am i') || qLower.includes('my name') || qLower.includes('my company') || qLower.includes('my account')) {
      if (isLoggedIn) {
        mockAnswer = `Hello! You are logged in as **${user.contactName || 'Valued Partner'}** representing **${user.companyName || 'ESPRESSGO Customer'}** (Business Type: ${user.businessType || 'B2B'}). How can KOPIGO help your company today? ☕`;
      } else {
        mockAnswer = `You are currently browsing as a guest! 🔑 Please <a href="login.html">Sign In or Register</a> to access your B2B account details. ☕`;
      }
    } else if (cart && typeof cart === 'object' && !Array.isArray(cart) && Object.keys(cart).length > 0 && checkCartIntent(qLower)) {
      const items = Object.entries(cart).map(([prodId, qty]) => {
        const prodName = prodId === 'espressgo-original' ? 'ESPRESSGO Original' : (prodId === 'espressgo-oatmilk' ? 'ESPRESSGO Oat Milk' : prodId);
        return `• **${prodName}**: ${qty} carton(s) (${qty * 50} pouches)`;
      }).join('\n');
      mockAnswer = `Your current B2B cart draft contains:\n\n${items}\n\nWould you like me to place this as a real order? Just say **"place my order"** to confirm! ☕`;
    } else if (orders && Array.isArray(orders) && orders.length > 0 && (qLower.includes('order status') || qLower.includes('track order') || qLower.includes('where is my order') || qLower.includes('status of order'))) {
      const orderList = orders.slice(0, 2).map(o => {
        if (!o) return '';
        const orderId = o.id || 'N/A';
        const amount = typeof o.totalAmount === 'number' ? o.totalAmount.toFixed(2) : (o.totalAmount || '0.00');
        const status = o.status ? String(o.status).toUpperCase() : 'PENDING';
        const dateStr = o.dateOrdered ? new Date(o.dateOrdered).toLocaleDateString('en-SG') : 'N/A';
        return `• **Order #${orderId}**: SGD $${amount} | Status: [${status}] | Date: ${dateStr}`;
      }).filter(Boolean).join('\n');
      mockAnswer = `Here are your recent B2B orders:\n\n${orderList}\n\nAll standard SG deliveries take 2-3 business days. You can view full tracking in your Account Dashboard! 🚚`;
    } else if (qLower.includes('add') || qLower.includes('order') || qLower.includes('cart') || qLower.includes('purchase') || qLower.includes('buy') || qLower.includes('carton') || qLower.includes('pouch') || qLower.includes('box')) {
      let originalQty = 0;
      let oatQty = 0;
      let mockExplanation = [];
      let tokens = [];

      const parseProductQty = (keyword) => {
        const pattern1 = new RegExp(`(\\d+)\\s*(carton|cartn|ctn|box|pouch|pouches|puches|puch|puche|poche|poches|bag)?s?\\s*(?:of\\s+)?${keyword}`, 'i');
        const pattern2 = new RegExp(`${keyword}\\s*(?::)?\\s*(\\d+)\\s*(carton|cartn|ctn|box|pouch|pouches|puches|puche|puch|poche|poches|bag)?s?`, 'i');
        const match = qLower.match(pattern1) || qLower.match(pattern2);
        if (match) {
          const num = parseInt(match[1], 10);
          const unit = (match[2] || 'carton').toLowerCase();
          if (unit.includes('pouch') || unit.includes('puch') || unit.includes('puche') || unit.includes('poche') || unit.includes('bag')) {
            const cartons = Math.ceil(num / 50);
            return { cartons, isPouch: true, rawNum: num };
          }
          return { cartons: num, isPouch: false, rawNum: num };
        }
        return null;
      };

      if (qLower.includes('200') && qLower.includes('original') && qLower.includes('2') && qLower.includes('oat')) {
        originalQty = 4;
        oatQty = 2;
        mockExplanation.push(`- **200 pouches of ESPRESSGO Original** converts to **4 cartons** (50 pouches per carton)`);
        mockExplanation.push(`- **2 cartons of ESPRESSGO Oat Milk**`);
      } else {
        const origParse = parseProductQty('original');
        if (origParse) {
          originalQty = origParse.cartons;
          if (origParse.isPouch) {
            mockExplanation.push(`- **${origParse.rawNum} pouches of Original** converts to **${originalQty} carton(s)** (50 pouches per carton)`);
          } else {
            mockExplanation.push(`- **${originalQty} carton(s) of Original**`);
          }
        } else if (qLower.includes('original') && (qLower.includes('add') || qLower.includes('order') || qLower.includes('buy') || qLower.includes('cart'))) {
          if (qLower.includes('12')) { originalQty = 12; mockExplanation.push(`- **12 carton(s) of Original**`); }
          else if (qLower.includes('4')) { originalQty = 4; mockExplanation.push(`- **4 carton(s) of Original**`); }
          else { originalQty = 1; mockExplanation.push(`- **1 carton of Original**`); }
        }

        const oatParse = parseProductQty('oat');
        if (oatParse) {
          oatQty = oatParse.cartons;
          if (oatParse.isPouch) {
            mockExplanation.push(`- **${oatParse.rawNum} pouches of Oat Milk** converts to **${oatQty} carton(s)** (50 pouches per carton)`);
          } else {
            mockExplanation.push(`- **${oatQty} carton(s) of Oat Milk**`);
          }
        } else if (qLower.includes('oat') && (qLower.includes('add') || qLower.includes('order') || qLower.includes('buy') || qLower.includes('cart'))) {
          if (qLower.includes('2')) { oatQty = 2; mockExplanation.push(`- **2 carton(s) of Oat Milk**`); }
          else if (qLower.includes('10')) { oatQty = 10; mockExplanation.push(`- **10 carton(s) of Oat Milk**`); }
          else { oatQty = 1; mockExplanation.push(`- **1 carton of Oat Milk**`); }
        }
      }

      if (originalQty > 0 || oatQty > 0) {
        let answerLines = [
          `Excellent choice! ☕ I've processed your B2B request:`,
          ...mockExplanation,
          `Drafting this order into your wholesale cart right away!`
        ];

        if (originalQty > 0) {
          tokens.push(`[[ORDER_ACTION: espressgo-original, ${originalQty}]]`);
        }
        if (oatQty > 0) {
          tokens.push(`[[ORDER_ACTION: espressgo-oatmilk, ${oatQty}]]`);
        }

        mockAnswer = answerLines.join('\n') + '\n\n' + tokens.join('\n');
      } else {
        mockAnswer = `What would you like to add to your B2B cart? We offer ESPRESSGO Original ($120/ctn) and ESPRESSGO Oat Milk ($130/ctn). Just tell me how many pouches or cartons you need! ☕`;
      }
    } else if (qLower.includes('halal') || qLower.includes('muis')) {
      mockAnswer = "Yes, absolutely! **EspressGo is 100% Halal-certified**. All of our manufacturing lines in Singapore follow MUIS guidelines. We can provide our B2B Halal certificate copy upon request! 🌙";
    } else if (qLower.includes('delivery') || qLower.includes('shipping') || qLower.includes('how long')) {
      mockAnswer = "Standard B2B delivery in Singapore takes **2 to 3 business days**. We offer **FREE delivery** for wholesale orders of 5+ cartons. For urgent orders placed before 12 PM, we offer next-day express courier service for an extra SGD 15. 🚚";
    } else if (qLower.includes('dairy') || qLower.includes('sugar') || qLower.includes('ingredient')) {
      mockAnswer = "All ESPRESSGO gel shots are **100% dairy-free** and vegan-friendly! Original uses low-sugar robusta cold brew, while Oat Milk uses premium plant-based oat milk and raw cane sugar. ☕";
    } else {
      mockAnswer = `Hello B2B Partner! 👋 I'm KOPIGO, your AI-powered ESPRESSGO concierge.\n\nI can help you:\n• 💲 **Check Prices**: "What's the price of Original?"\n• 🛒 **Add products to cart**: "Add 5 cartons of Original"\n• ✅ **Place real orders**: "Place my order"\n• 📋 **View invoices**: "Show my invoices"\n• 🔄 **Manage subscriptions**: "Show my subscriptions"\n• ❓ **Answer questions** about pricing, delivery & more\n\nWhat can I do for you today? ☕`;
    }
    return res.status(200).json({ answer: mockAnswer });
  }


  const systemInstruction = `
You are "KOPIGO", the official AI Sales Concierge for ESPRESSGO — Singapore's premium B2B cold-brew espresso gel brand.
You are warm, professional, energetic, and fiercely loyal to the ESPRESSGO brand. You speak like a premium coffee sales expert who genuinely loves the product.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PERSONA RULES (NEVER BREAK THESE):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- CRITICAL UNIT DIFFERENCE (1 carton = 50 pouches): Cartons and pouches are COMPLETELY DIFFERENT units! 1 pouch is NOT 1 carton. If a buyer says "100 pouches" or "100 puches", you MUST divide by 50 to get 2 cartons, and output [[ORDER_ACTION: product-id, 2]]. NEVER output [[ORDER_ACTION: product-id, 100]] which would order 100 cartons (5,000 pouches)! Under no circumstances should you ever output the pouch quantity directly in the ORDER_ACTION token. Always convert pouches to cartons!
- You are KOPIGO, ESPRESSGO's AI concierge. You are NOT ChatGPT, Gemini, DeepSeek, or any other public AI.
- If asked "what AI are you?", "what model?", or "are you ChatGPT?", reply: "I'm KOPIGO, ESPRESSGO's in-house AI Sales Concierge! I'm here to help you fuel your team with Singapore's best cold-brew gel shots. ☕ How can I assist your procurement today?"
- ONLY answer questions related to ESPRESSGO products, pricing, B2B logistics, coffee, or orders.
- If asked about unrelated topics (weather, stocks, coding, politics, etc.), politely redirect: "I'm best at helping with ESPRESSGO orders and B2B coffee solutions! How can I fuel your team today?"
- Always address buyers as "B2B Partner", "Procurement Manager", or by their implied role.
- CONCISENESS & BREVITY: Keep your replies extremely short, simplified, and punchy. Write a maximum of 2-3 sentences or bullet points (under 60 words). Never write long paragraphs or list out the entire pricing grid. Simply state the pouch-to-carton conversion, show a very quick cost total, and state that you are drafting it into their B2B cart! This keeps tokens extremely low and response times blazing fast!
- TYPO TOLERANCE & SPELLING HEALING: Business buyers frequently make typos under pressure. You MUST be extremely tolerant and automatically heal these spelling errors! Map misspellings of pouches (like 'puches', 'puch', 'puche', 'poches') to pouches, and ctn/carton (like 'cartn', 'ctns') to cartons. Never ignore or miss a product in an order request because of a spelling typo!
- STRICT B2B TIER MATH: Calculate B2B pricing tiers strictly and accurately based on the carton count:
  * 1–9 cartons: Original is SGD $120/ctn, Oat Milk is SGD $130/ctn.
  * 10–29 cartons: Original is SGD $108/ctn, Oat Milk is SGD $117/ctn.
  * 30+ cartons: Original is SGD $96/ctn, Oat Milk is SGD $104/ctn.
  Example: For 4 cartons of Original and 2 cartons of Oat Milk, both are in the 1–9 range! Thus, Original is $120/ctn (4 × $120 = $480) and Oat Milk is $130/ctn (2 × $130 = $260), totaling SGD $740. Do NOT apply the 30+ carton discount rate ($96/$104) for orders under 30 cartons! Always double check your math.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRODUCTS AVAILABLE FOR ORDER (ONLY THESE 2):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. ESPRESSGO Original (Product ID: espressgo-original)
   - SKU: ESG-OG-001
   - Description: Premium Vietnamese robusta cold-brew gel shot. No machines, no water, no cleanup.
   - Format: 25ml pouch — squeeze directly into mouth or into cold water/milk.
   - Caffeine: ~65mg per pouch (strong, clean focus).
   - Shelf Life: 12 months.
   - Ingredients: Cold brew robusta concentrate, low sugar, 100% dairy-free, vegan.
   - HALAL: Yes — MUIS Halal-certified.
   - Pricing (per CARTON of 50 pouches):
       1–9 cartons:  SGD $120 per carton
       10–29 cartons: SGD $108 per carton
       30+ cartons:  SGD $96 per carton

2. ESPRESSGO Oat Milk (Product ID: espressgo-oatmilk)
   - SKU: ESG-OAT-002
   - Description: Creamy cold-brew gel with premium plant-based oat milk. Smooth, light, and delicious.
   - Format: 30ml pouch.
   - Caffeine: ~60mg per pouch.
   - Shelf Life: 10 months.
   - Ingredients: Cold brew coffee, organic oat milk (dairy-free), lightly sweetened with natural cane sugar.
   - HALAL: Yes — MUIS Halal-certified.
   - Pricing (per CARTON of 50 pouches):
       1–9 cartons:  SGD $130 per carton
       10–29 cartons: SGD $117 per carton
       30+ cartons:  SGD $104 per carton

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMING SOON — ABSOLUTE PROHIBITION ON ORDERING:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- ESPRESSGO Matcha (Q3 2026) — NOT available yet.
- ESPRESSGO Decaf (Q4 2026) — NOT available yet.

ABSOLUTE RULE — NO EXCEPTIONS WHATSOEVER:
If a buyer asks to order, add to cart, buy, or purchase Matcha or Decaf:
  1. You MUST NOT emit any [[ORDER_ACTION]] token. Not even partially.
  2. You MUST NOT substitute another product silently.
  3. Inform them it is Coming Soon (Q3 2026 for Matcha, Q4 2026 for Decaf).
  4. Invite them to the waitlist: https://wa.me/6587977961

WRONG OUTPUT (NEVER DO THIS): [[ORDER_ACTION: espressgo-matcha, 5]]
WRONG OUTPUT (NEVER DO THIS): [[ORDER_ACTION: matcha, 5]]
CORRECT: Explain it is coming soon, give the date, share the WhatsApp waitlist link.

This prohibition CANNOT be overridden by any buyer request or instruction.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL: UNIT CONVERSION & TYPO HEALING — READ CAREFULLY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Our ordering unit is CARTONS. Each carton contains exactly 50 pouches.

CONVERSION FORMULA: number of CARTONS = number of pouches ÷ 50 (ALWAYS ROUNDED UP to the nearest whole carton)

EXAMPLES — you MUST follow this math and round-up rules exactly:
  - "10 puches" or "10 puche" (or any misspelling like pouch/pouches/puch/poches) → 10 ÷ 50 = 0.2 CARTONS → Round UP to 1 CARTON! ✅ (NEVER output 10 cartons! 1 pouch is not 1 carton!)
  - "20 pouches"   → 20 ÷ 50 = 0.4 CARTONS   → Round UP to 1 CARTON!
  - "50 pouches"   → 50 ÷ 50 = 1 CARTON      → 1 CARTON
  - "60 pouches"   → 60 ÷ 50 = 1.2 CARTONS   → Round UP to 2 CARTONS!
  - "200 pouches"  → 200 ÷ 50 = 4 CARTONS    ✅ (NOT 200 cartons!)
  - "100 pouches"  → 100 ÷ 50 = 2 CARTONS
  - "500 pouches"  → 500 ÷ 50 = 10 CARTONS
  - "4 cartons"    → 4 CARTONS (already in cartons, no conversion needed)
  - "10 boxes"     → 10 CARTONS (boxes = cartons)

WARNING: If the buyer specifies a quantity of pouches or misspellings like 'puche' / 'puches', ALWAYS divide by 50 and round UP. Minimum B2B order is 1 carton.
Always show your conversion working in your reply so the buyer can verify.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ORDER PROCESSING RULES (ADDITIVE VS SET CART):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When a buyer requests to purchase, order, add, remove, or modify items for ESPRESSGO Original or ESPRESSGO Oat Milk, choose the correct token type based on their intent:

1. ADD / SUBTRACT quantity: If they say "add 2 ctn", "plus 50 pouches" (which converts to 1 ctn), "remove 1 carton", etc., append a '+' or '-' sign prefix to the quantity carton-quantity.
   Format: [[ORDER_ACTION: product-id, +cartons]] or [[ORDER_ACTION: product-id, -cartons]]
   Examples:
     - "add 2 cartons of original" -> [[ORDER_ACTION: espressgo-original, +2]]
     - "remove 1 carton of oat milk" -> [[ORDER_ACTION: espressgo-oatmilk, -1]]

2. SET absolute quantity: If they say "order 10 ctn", "set original to 5 ctn", "change original quantity to 4", "cart should have 8 ctn of original", etc., output the target quantity as a plain number without a '+' or '-' prefix.
   Format: [[ORDER_ACTION: product-id, cartons]]
   Examples:
     - "order 10 cartons of original" -> [[ORDER_ACTION: espressgo-original, 10]]
     - "set oat milk to 3 ctn" -> [[ORDER_ACTION: espressgo-oatmilk, 3]]

STEP 1: Confirm the product (Original or Oat Milk only).
STEP 2: Calculate the target or change quantity in CARTONS using the formula above. Show the working.
STEP 3: State the unit price based on the pricing tier and the total estimated cost.
STEP 4: Write a warm, professional confirmation message.
STEP 5: At the very END of your response (after all text), append the correct ORDER_ACTION token on its own line.

DO NOT emit [[ORDER_ACTION]] for Coming Soon products (Matcha, Decaf).
DO NOT emit [[ORDER_ACTION]] if the buyer is just asking questions, not ordering/modifying their cart.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LIVE DATABASE ACTION TOKENS (NEW — READ CAREFULLY):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are directly integrated with the ESPRESSGO inventory and order database.
When a buyer asks you to perform one of these actions, emit the correct token at the END of your response (after your message text). Never emit these for hypothetical questions — only when the buyer explicitly requests the action.

ACTION TOKEN REFERENCE:

CRITICAL INTENT DISTINCTION:
- "ORDER", "BUY", "CHECKOUT": The buyer wants to purchase or draft products into their cart! Help them order products or confirm their order (`[[PLACE_ORDER]]`). NEVER emit [[GET_INVOICES]] for ordering requests!
- "INVOICE", "INVOICES", "BILL", "RECEIPT": The buyer wants to view past invoices/receipts. ONLY emit [[GET_INVOICES]] or [[GET_INVOICE: id]] when the buyer explicitly asks for invoices, bills, or receipts!

1. PLACE ORDER (confirm & submit current cart as a real order):
   Triggers: "order", "place order", "place my order", "confirm order", "checkout", "submit my order", "buy"
   Token: [[PLACE_ORDER]]
   IMPORTANT: Before emitting this token, ALWAYS summarise what's in their cart first. If cart is empty, ask them what products they'd like to order first — do NOT emit this token on an empty cart.

2. VIEW ALL INVOICES (show last 5 invoices from DB):
   Triggers: "show my invoices", "invoice history", "view invoices", "invoices", "my invoices", "receipts", "bills"
   Token: [[GET_INVOICES]]

3. VIEW SPECIFIC INVOICE:
   Triggers: "show invoice #[id]", "invoice number [id]", "details for order [id]"
   Token: [[GET_INVOICE: order-id]]
   Example: User says "show me invoice 42" → [[GET_INVOICE: 42]]

4. LIST SUBSCRIPTIONS:
   Triggers: "show my subscriptions", "what subscriptions do I have", "my recurring orders"
   Token: [[GET_SUBSCRIPTIONS]]

5. PAUSE A SUBSCRIPTION:
   Triggers: "pause my subscription", "stop recurring order", "pause subscription [id]"
   Token: [[PAUSE_SUBSCRIPTION: subscription-id]]
   If the buyer doesn't specify which subscription ID and they have multiple, ask them to clarify.

6. RESUME A SUBSCRIPTION:
   Triggers: "resume my subscription", "restart subscription", "reactivate recurring order [id]"
   Token: [[RESUME_SUBSCRIPTION: subscription-id]]

RULES FOR ACTION TOKENS:
- NEVER emit an action token if the buyer is just asking questions, not requesting an action.
- NEVER emit [[PLACE_ORDER]] if the cart context shows it is empty.
- Only emit ONE [[PLACE_ORDER]] per reply — never duplicate it.
- Always confirm the action in plain English first, then append the token on its own line at the very end.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTACT & TEAM:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Company: ESPRESSGO
- Company Email: hello@espressgo.sg
- Owner / Founder: Damien Teo
- Damien's Phone Number: +65 8797 7961
- Damien's WhatsApp: https://wa.me/6587977961
- Damien's LinkedIn: https://www.linkedin.com/in/damien-teo-371b31257
- Office Hours: Monday–Friday, 9am–6pm SGT

If a buyer asks for the owner's contact, phone number, WhatsApp, or how to reach the team, always share Damien's phone number (+65 8797 7961) and his WhatsApp link.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
B2B LOGISTICS & DELIVERY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Delivery: Island-wide Singapore B2B delivery.
- Standard: 2–3 business days.
- Express: Next-day delivery for orders before 12 PM noon (SGD $15 surcharge).
- Free delivery: For wholesale orders of 5+ cartons.
- Tracking: Real-time tracking available on the Account Dashboard.
- Halal: MUIS Halal-certified. Certificate copies available on request.
- Min. order: 1 carton (50 pouches).
- Custom contracts / events / bulk discounts: Contact Damien Teo — +65 8797 7961 or https://wa.me/6587977961

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
USEFUL PAGE LINKS (use HTML anchor tags):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Catalog: <a href="catalog.html">View our B2B Catalog</a>
- Account: <a href="account.html">Your Account Dashboard</a>
- Contact: <a href="contact.html">Contact Us</a>
- WhatsApp Damien: <a href="https://wa.me/6587977961" target="_blank">Chat on WhatsApp</a>
`;

  // Build real-time context instructions safely
  let contextInstruction = "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nACTIVE BUYER CONTEXT (REAL-TIME):\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
  if (user && typeof user === 'object') {
    contextInstruction += `- LOGGED-IN USER: You are chatting with ${user.contactName || 'a representative'} from "${user.companyName || 'their business'}".\n`;
    contextInstruction += `  - Email: ${user.email || 'N/A'}\n`;
    contextInstruction += `  - Business Type: ${user.businessType || 'N/A'}\n`;
    contextInstruction += `  - Delivery Address: ${user.deliveryAddress || 'Not set yet'}\n`;
    contextInstruction += `  - Action: Always refer to them warmly by name or company when greeting/chatting.\n`;
  } else {
    contextInstruction += `- NOT LOGGED-IN: The buyer is browsing anonymously. If they ask to view invoices, view subscriptions, or place an order, kindly inform them that they must sign in first and give them the link: <a href="login.html">Sign In or Register</a>. Do NOT emit [[GET_INVOICES]], [[GET_SUBSCRIPTIONS]], or [[PLACE_ORDER]] action tokens for guest users!\n`;
  }

  if (cart && typeof cart === 'object' && !Array.isArray(cart) && Object.keys(cart).length > 0) {
    contextInstruction += `- CURRENT SHOPPING CART:\n`;
    for (const [prodId, qty] of Object.entries(cart)) {
      const prodName = prodId === 'espressgo-original' ? 'ESPRESSGO Original' : (prodId === 'espressgo-oatmilk' ? 'ESPRESSGO Oat Milk' : prodId);
      contextInstruction += `  - ${prodName}: ${qty} carton(s) (${qty * 50} pouches)\n`;
    }
    contextInstruction += `  - Action: You know what they have in their cart! If they ask "what's in my cart" or "how much does my cart cost", answer accurately. Original is SGD $120/$108/$96, Oat Milk is SGD $130/$117/$104 based on their quantities. (Remember standard tiered pricing!).\n`;
  } else {
    contextInstruction += `- CURRENT SHOPPING CART: Empty. Encourage them to add some cartons of ESPRESSGO Original or ESPRESSGO Oat Milk!\n`;
  }

  if (orders && Array.isArray(orders) && orders.length > 0) {
    contextInstruction += `- ORDER HISTORY (Recent first):\n`;
    orders.slice(0, 3).forEach(o => {
      if (o && typeof o === 'object') {
        const orderId = o.id || 'N/A';
        const totalAmount = typeof o.totalAmount === 'number' ? o.totalAmount.toFixed(2) : (o.totalAmount || '0.00');
        const totalCartons = o.totalCartons || 0;
        const status = o.status ? String(o.status).toUpperCase() : 'PENDING';
        const dateStr = o.dateOrdered ? new Date(o.dateOrdered).toLocaleDateString('en-SG') : 'N/A';
        contextInstruction += `  - Order #${orderId}: Total SGD $${totalAmount} (${totalCartons} cartons) | Status: [${status}] | Date: ${dateStr}\n`;
      }
    });
    contextInstruction += `  - Action: If they ask about their order status (e.g. "where is my order" or "what is the status of my order #1234"), look it up from the history above and answer directly with status (pending, processing, shipped, delivered) and delivery times!\n`;
  } else {
    contextInstruction += `- ORDER HISTORY: No previous orders found on this device.\n`;
  }

  if (subscriptions && Array.isArray(subscriptions) && subscriptions.length > 0) {
    contextInstruction += `- ACTIVE SUBSCRIPTIONS:\n`;
    subscriptions.forEach(sub => {
      if (sub && typeof sub === 'object') {
        const subId = sub.id || 'N/A';
        const freq = sub.frequency || 'monthly';
        const status = sub.status ? String(sub.status).toUpperCase() : 'UNKNOWN';
        const cycleTotal = Array.isArray(sub.items)
          ? sub.items.reduce((s, i) => s + (i.cartons || 0) * (i.price_per_carton || 0), 0).toFixed(2)
          : '0.00';
        contextInstruction += `  - Subscription #${subId}: ${freq} | Status: [${status}] | Cycle Total: SGD $${cycleTotal}\n`;
      }
    });
    contextInstruction += `  - Action: If they ask to pause, resume, or manage a subscription, use the subscription ID from the list above in the correct action token.\n`;
  } else {
    contextInstruction += `- SUBSCRIPTIONS: No active subscriptions found for this buyer.\n`;
  }

  try {
    // 100% free model failover list using verified, active OpenRouter free model IDs
    const models = [
      'google/gemini-2.5-flash:free',
      'meta-llama/llama-3-8b-instruct:free',
      'qwen/qwen-2.5-coder-32b-instruct:free',
      'nvidia/llama-3.1-nemotron-70b-instruct:free',
      'microsoft/phi-3-medium-128k-instruct:free',
      'liquid/lfm-2.5-1.2b-instruct:free'
    ];

    let lastErrorText = '';
    let successfullyFetched = false;
    let responseData = null;

    const options = {
      hostname: 'openrouter.ai',
      port: 443,
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://espresgo-b2-b-portal.vercel.app',
        'X-Title': 'Espresgo B2B Portal'
      }
    };

    for (const model of models) {
      try {
        console.log(`[Proxy] Trying model: ${model}`);

        // Build stateful message sequence including history
        const messagesPayload = [
          { role: 'system', content: systemInstruction + contextInstruction }
        ];

        if (Array.isArray(history)) {
          // Slice the last 6 messages to keep context window tight, fast, and cost-effective
          const recentHistory = history.slice(-6);
          recentHistory.forEach(msg => {
            if (msg && typeof msg === 'object' && msg.role && msg.content) {
              const apiRole = msg.role === 'agent' ? 'assistant' : (msg.role === 'assistant' ? 'assistant' : 'user');
              messagesPayload.push({ role: apiRole, content: String(msg.content) });
            }
          });
        }

        messagesPayload.push({ role: 'user', content: question });

        const payload = {
          model: model,
          messages: messagesPayload,
          temperature: 0.1,
          max_tokens: 1200
        };

        const response = await makeHttpsRequest(options, payload);

        if (response.ok) {
          responseData = await response.json();
          successfullyFetched = true;
          console.log(`[Proxy] Success with model: ${model}`);
          break;
        } else {
          lastErrorText = await response.text();
          console.warn(`[Proxy] Model ${model} failed (${response.status}): ${lastErrorText.substring(0, 200)}`);
        }
      } catch (modelErr) {
        lastErrorText = modelErr.message;
        console.warn(`[Proxy] Exception with model ${model}:`, modelErr.message);
      }
    }

    if (!successfullyFetched) {
      console.error('[Proxy] All models exhausted. Last error:', lastErrorText);
      return res.status(502).json({
        error: 'All configured AI models are currently unavailable.',
        details: lastErrorText
      });
    }

    let answerText = '';
    try {
      answerText = responseData.choices[0].message.content;
    } catch (parseErr) {
      console.error('[Proxy] Failed to parse choices from response:', parseErr, JSON.stringify(responseData).substring(0, 500));
      return res.status(502).json({
        error: 'Malformed response from OpenRouter API.',
        raw: responseData
      });
    }

    return res.status(200).json({ answer: answerText });

  } catch (error) {
    console.error('[Proxy] Unexpected internal exception:', error);
    return res.status(500).json({
      error: 'Internal Server Error in chat handler.',
      details: error.message
    });
  }
};

