(() => {
  const btn = document.getElementById('checkout-btn');
  if (!btn) return;
  const status = document.getElementById('checkout-status');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    status.textContent = 'Creating payment order…';
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) throw new Error('checkout failed: ' + res.status);
      const data = await res.json();
      if (!data.pay_url) throw new Error('no payment URL');
      status.textContent = 'Order ' + data.order_id + ' · opening payment page…';
      window.location.assign(data.pay_url);
    } catch (err) {
      status.textContent = 'Could not create a payment order. Please try again later.';
      btn.disabled = false;
    }
  });
})();
