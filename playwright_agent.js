/* ============================================================
   playwright_agent.js — Automated B2B AI Order Placement Agent

   Purpose:
   - Opens local ESPRESSGO portal
   - Logs in as a buyer
   - Adds a product quantity to cart
   - Opens checkout modal
   - Places order
   - Verifies success banner

   Run with:
   node playwright_agent.js

   Requirements:
   npm install playwright
   npx playwright install
   ============================================================ */

const { chromium } = require('playwright');


/* ============================================================
   Configuration
   ============================================================ */

// Change this if your local server uses another port.
const BASE_URL = 'http://localhost:8000';

// Use a real buyer account registered through your Supabase login page.
const BUYER_EMAIL = 'your_registered_buyer_email@example.com';
const BUYER_PASSWORD = 'your_password_here';

// Simulated AI-parsed order parameters.
// Example user request:
// "Order 4 cartons of Original to 1 Marina Boulevard"
const mockAiParsedOrder = {
  productName: 'ESPRESSGO Original',
  productId: 'espressgo-original',
  cartons: 4,
  deliveryAddress: '1 Marina Boulevard, Singapore 018989'
};


/* ============================================================
   Main automation function
   ============================================================ */

async function executeB2BOrderAgent(orderSpec) {
  console.log('=====================================================');
  console.log('🤖 ESPRESSGO AI PLAYWRIGHT B2B ORDER AGENT ACTIVATED');
  console.log('=====================================================');
  console.log(`📦 Order Target:  ${orderSpec.cartons} cartons of ${orderSpec.productName}`);
  console.log(`📍 Delivery Dest: ${orderSpec.deliveryAddress}`);
  console.log('=====================================================\n');

  let browser;

  try {
    console.log('🚀 Launching automated Chromium browser...');

    browser = await chromium.launch({
      headless: false,
      slowMo: 120
    });

    const context = await browser.newContext({
      viewport: {
        width: 1366,
        height: 768
      }
    });

    const page = await context.newPage();

    page.on('console', msg => {
      const type = msg.type();

      if (['error', 'warning'].includes(type)) {
        console.log(`[browser ${type}] ${msg.text()}`);
      }
    });

    page.on('pageerror', error => {
      console.error('[browser page error]', error.message);
    });

    /* ========================================================
       1. Navigate to login page
       ======================================================== */

    console.log('🌐 Navigating to ESPRESSGO login page...');

    await page.goto(`${BASE_URL}/login.html`, {
      waitUntil: 'domcontentloaded'
    });

    await page.waitForSelector('#auth-form', {
      state: 'visible',
      timeout: 10000
    });

    /* ========================================================
       2. Login using buyer credentials
       ======================================================== */

    console.log('🔐 Entering B2B buyer credentials...');

    await page.fill('#f-email', BUYER_EMAIL);
    await page.fill('#f-password', BUYER_PASSWORD);

    console.log('🚪 Clicking Sign In button...');

    await Promise.all([
      page.waitForURL('**/catalog.html', {
        timeout: 20000
      }),
      page.click('#auth-submit')
    ]);

    console.log('🎉 Login successful! Arrived at ESPRESSGO B2B Catalog.');

    /* ========================================================
       3. Wait for product cards to render
       ======================================================== */

    console.log(`🛒 Locating ${orderSpec.productName} product card...`);

    const productCard = page.locator(`.product-card:has-text("${orderSpec.productName}")`);

    await productCard.waitFor({
      state: 'visible',
      timeout: 15000
    });

    const stepperInput = productCard.locator('.stepper-input');

    await stepperInput.waitFor({
      state: 'visible',
      timeout: 10000
    });

    /* ========================================================
       4. Input carton quantity
       ======================================================== */

    console.log(`✨ Automating carton entry: ${orderSpec.cartons} cartons`);

    await stepperInput.fill(String(orderSpec.cartons));

    // Your frontend updates quantity on onchange, so trigger change.
    await stepperInput.dispatchEvent('change');

    /* ========================================================
       5. Click checkout button
       ======================================================== */

    console.log('💳 Waiting for sticky checkout bar...');

    const checkoutBtn = page.locator('#checkout-btn');

    await checkoutBtn.waitFor({
      state: 'visible',
      timeout: 10000
    });

    console.log('👉 Auto-clicking B2B Checkout button...');

    await checkoutBtn.click();

    /* ========================================================
       6. Wait for modal and submit order
       ======================================================== */

    console.log('📝 Waiting for confirmation modal...');

    const modal = page.locator('#checkout-modal.open');

    await modal.waitFor({
      state: 'visible',
      timeout: 10000
    });

    const placeOrderBtn = page.locator('#modal-place');

    await placeOrderBtn.waitFor({
      state: 'visible',
      timeout: 10000
    });

    console.log('🚀 Finalising order authorization...');

    await placeOrderBtn.click();

    /* ========================================================
       7. Verify success banner
       ======================================================== */

    console.log('🔍 Checking order success banner...');

    const successToast = page.locator('#order-success');

    await successToast.waitFor({
      state: 'visible',
      timeout: 15000
    });

    const toastText = await successToast.textContent();

    console.log('\n=====================================================');
    console.log('✅ B2B ORDER COMPLETED SUCCESSFULLY BY AI ROBOT!');
    console.log(`📢 Page response: "${toastText.trim()}"`);
    console.log('=====================================================');

    /* ========================================================
       8. Optional: go to account page and verify order exists
       ======================================================== */

    console.log('\n📄 Opening Account page to verify order history...');

    await page.goto(`${BASE_URL}/account.html`, {
      waitUntil: 'domcontentloaded'
    });

    await page.waitForSelector('#account-panels', {
      timeout: 15000
    });

    const pageText = await page.textContent('body');

    if (pageText.includes(orderSpec.productName)) {
      console.log('✅ Order appears in account history.');
    } else {
      console.log('⚠️ Order placed, but product name was not found in account page text.');
    }

    console.log('\n🏁 Automation completed. Closing browser in 3 seconds...');

    await page.waitForTimeout(3000);
  } catch (error) {
    console.error('\n❌ Playwright Agent automation failed:');
    console.error(error);

    console.log('\nChecklist:');
    console.log('1. Is your local server running?');
    console.log(`2. Can you open ${BASE_URL}/login.html manually?`);
    console.log('3. Did you replace BUYER_EMAIL and BUYER_PASSWORD?');
    console.log('4. Did you create this buyer account in Supabase?');
    console.log('5. Is Supabase RLS allowing the buyer to insert orders?');
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}


/* ============================================================
   Start automation
   ============================================================ */

executeB2BOrderAgent(mockAiParsedOrder);