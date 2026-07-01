/* js/subscriptions.js — Optimized & Fixed */
const db = window.sb || window.supabaseClient;

let importedItems = [];
let isSubmitting = false;

// Helper to show toasts (matches your shared.js setup)
function notify(title, message, type = "success") {
    if (typeof showToast === "function") {
        showToast(title, message, type);
    } else {
        alert(title + ": " + message);
    }
}

async function renderSubscriptionSummary() {
    console.log("Reading session storage...");
    const rawData = sessionStorage.getItem("subscriptionCart");
    
    if (!rawData) {
        console.warn("No subscription cart found in storage.");
        notify("Empty Cart", "No items found to subscribe to.", "error");
        setTimeout(() => window.location.href = "catalog.html", 1500);
        return;
    }

    importedItems = JSON.parse(rawData);
    console.log("Imported Items:", importedItems);

    const container = document.getElementById("subscription-items");
    if (!container) return;

    container.innerHTML = importedItems.map(item => `
        <div class="subscription-item" style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--sand);">
            <div>
                <strong>${item.name}</strong><br>
                <small>${item.cartons} Cartons @ $${item.price_per_carton.toFixed(2)}/ctn</small>
            </div>
            <div>$${(item.cartons * item.price_per_carton).toFixed(2)}</div>
        </div>
    `).join("");

    updateSubscriptionTotal();
}

function updateSubscriptionTotal() {
    const total = importedItems.reduce((sum, item) => sum + (item.cartons * item.price_per_carton), 0);
    const totalEl = document.getElementById("subscription-total");
    if (totalEl) {
        totalEl.innerHTML = `<h3>Cycle Total: SGD $${total.toFixed(2)}</h3>`;
    }
}

async function createSubscription() {
    console.log("Create Subscription clicked");
    
    if (isSubmitting) return;
    
    try {
        isSubmitting = true;
        const btn = document.getElementById("create-subscription-btn");
        btn.disabled = true;
        btn.textContent = "Processing...";

        // 1. Get current authenticated user
        const { data: { user }, error: userError } = await db.auth.getUser();
        
        if (userError || !user) {
            throw new Error("You must be signed in to create a subscription.");
        }

        const frequency = document.getElementById("frequency").value;

        // 2. Insert the Subscription Header
        const { data: subscription, error: subError } = await db
            .from("subscriptions")
            .insert({
                frequency: frequency,
                status: "active",
                user_id: user.id
            })
            .select()
            .single();

        if (subError) throw new Error("Header save failed: " + subError.message);

        // 3. Insert the Subscription Items
        const itemsToInsert = importedItems.map(item => ({
            subscription_id: subscription.id,
            product_id: item.product_id,
            cartons: parseInt(item.cartons),
            price_per_carton: parseFloat(item.price_per_carton)
        }));

        const { error: itemsError } = await db
            .from("subscription_items")
            .insert(itemsToInsert);

        if (itemsError) throw new Error("Items save failed: " + itemsError.message);

        // --- NEW PAYMENT REDIRECT CODE STARTS HERE ---
        
        notify("Saving...", "Redirecting to secure payment for first batch.", "success");

        // 4. Get the user profile (to ensure backend gets Company Name/Address)
        const { data: profile } = await db
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        // 5. Format the cart for your existing server.js
        const formattedCart = importedItems.map(item => ({
            product_id: item.product_id,
            quantity: item.cartons
        }));

        // 6. Call your existing Stripe endpoint (Port 3000)
        const res = await fetch('/create-checkout-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cart: formattedCart,
                profile: profile || user, // Use profile if found, otherwise auth user
                isSubscription: true,     // Flag for backend
                subscriptionId: subscription.id 
            })
        });

        const data = await res.json();

        // 7. Cleanup and Redirect to Stripe
        if (data.url) {
            // Only clear storage once we know payment is ready
            sessionStorage.removeItem("subscriptionCart");
            sessionStorage.removeItem("subscriptionInterval");
            localStorage.removeItem("espressgo_cart");
            
            window.location.href = data.url; // Go to Stripe
        } else {
            throw new Error(data.error || "Payment session failed.");
        }
        
        // --- NEW PAYMENT REDIRECT CODE ENDS HERE ---

    } catch (err) {
        console.error("Final Logic Error:", err);
        notify("Error", err.message, "error");
        
        // Re-enable button on error
        const btn = document.getElementById("create-subscription-btn");
        btn.disabled = false;
        btn.textContent = "Create Subscription";
    } finally {
        isSubmitting = false;
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Load data
    await renderSubscriptionSummary();

    // 2. Setup Frequency
    const savedInterval = sessionStorage.getItem("subscriptionInterval");
    const frequencySelect = document.getElementById("frequency");
    if (savedInterval && frequencySelect) {
        frequencySelect.value = savedInterval;
        // Make it enabled so the user can double check it
        frequencySelect.disabled = false; 
    }

    // 3. Bind Button
    const createBtn = document.getElementById("create-subscription-btn");
    if (createBtn) {
        createBtn.addEventListener("click", createSubscription);
    }
});