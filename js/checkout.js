async function checkout(cart, profile) {
  const res = await fetch('/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cart, profile })
  });

  const data = await res.json();
  window.location = data.url; // redirect to Stripe
}

const btn = document.getElementById("confirm-order-btn");
const terms = document.getElementById("terms-check");

btn.addEventListener("click", async () => {
  if (!terms.checked) {
    alert("Please agree to the terms first");
    return;
  }

  // 1. Collect form data
  const profile = {
    contact_name: document.getElementById("delivery-contact").value,
    company_name: document.getElementById("delivery-company").value,
    business_type: "B2B",
    delivery_address: document.getElementById("delivery-address").value,
    id: "temp-user-id"
  };

  // 2. Get cart
  const cart = JSON.parse(localStorage.getItem("cart")) || [];

  if (cart.length === 0) {
    alert("Cart is empty");
    return;
  }

  // 3. Go to Stripe
  await checkout(cart, profile);
});