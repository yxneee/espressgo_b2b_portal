/* ============================================================
   js/complete-profile.js — Form Submission Script
   ============================================================ */
document.getElementById('complete-profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    document.getElementById('server-err').style.display = 'none';
    document.getElementById('err-contactName').style.display = 'none';
    document.getElementById('err-companyName').style.display = 'none';
    document.getElementById('err-businessType').style.display = 'none';
    document.getElementById('err-address').style.display = 'none';

    const contactName = document.getElementById('f-contactName').value.trim();
    const companyName = document.getElementById('f-companyName').value.trim();
    const businessType = document.getElementById('f-businessType').value;
    const address = document.getElementById('f-address').value.trim();
    
    const btn = document.getElementById('submit-btn');
    const btnText = document.getElementById('btn-text');

    let isValid = true;
    if (!contactName) { 
        isValid = false; 
        const el = document.getElementById('err-contactName');
        el.textContent = "⚠️ Contact name is required.";
        el.style.display = "flex"; 
    }
    
    if (!companyName || companyName.length < 2) { 
        isValid = false; 
        const el = document.getElementById('err-companyName');
        el.textContent = "⚠️ Enter your company name (Minimum 2 characters).";
        el.style.display = "flex"; 
    }
    
    if (!businessType) { 
        isValid = false; 
        const el = document.getElementById('err-businessType');
        el.textContent = "⚠️ Please select your business classification.";
        el.style.display = "flex"; 
    }
    
    if (!address || address.length < 5) { 
        isValid = false; 
        const el = document.getElementById('err-address');
        el.textContent = "⚠️ Please provide a valid delivery address.";
        el.style.display = "flex"; 
    }

    if (!isValid) return;

    btn.disabled = true;
    btnText.textContent = "Verifying profile variables...";

    try {
        const { data: { user }, error: userError } = await sb.auth.getUser();
        if (userError) throw userError;

        // Sync metadata
        const { error: updateError } = await sb.auth.updateUser({
            data: { 
                contactName: contactName,
                companyName: companyName, 
                businessType: businessType,
                deliveryAddress: address
            }
        });
        if (updateError) throw updateError;

        // Sync Database Row
        const { error: dbError } = await sb.from('profiles').update({ 
            contact_name: contactName,
            company_name: companyName, 
            business_type: businessType,
            delivery_address: address 
        }).eq('id', user.id);
        
        if (dbError) throw dbError;

        // Sync local storage state
        if (typeof Auth !== 'undefined' && typeof Auth.refreshUser === 'function') {
          await Auth.refreshUser();
        }

        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        window.location.replace(isLocalhost 
          ? window.location.origin + '/espresgo_b2b_portal/catalog.html' 
          : window.location.origin + '/catalog.html'
        );

    } catch (err) {
        console.error(err);
        document.getElementById('server-err-text').textContent = err.message || "Error saving parameters.";
        document.getElementById('server-err').style.display = 'flex';
        btn.disabled = false;
        btnText.textContent = "Save and Open Catalog";
    }
});