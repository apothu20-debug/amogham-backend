const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const MERCHANT_ID = process.env.CLOVER_MERCHANT_ID || '32QHYQVNHHBP1';
const API_TOKEN   = process.env.CLOVER_API_TOKEN   || 'f70d70cb-8c2a-5773-b40f-93d1bb987427';
const BASE_URL    = 'https://api.clover.com/v3';
const PORT        = process.env.PORT || 3000;

const H = {
  'Authorization': `Bearer ${API_TOKEN}`,
  'Content-Type':  'application/json',
  'Accept':        'application/json'
};

async function clover(method, path, body = null) {
  const url = `${BASE_URL}/merchants/${MERCHANT_ID}${path}`;
  const res = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  console.log(`${method} ${path} -> ${res.status}`, JSON.stringify(data).slice(0,300));
  if (!res.ok) throw new Error(data.message || `Clover error ${res.status}`);
  return data;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', restaurant: 'Amogham Indian Cuisine', merchant: MERCHANT_ID });
});

async function getDineInTypeId() {
  try {
    const data = await clover('GET', '/order_types');
    const types = data.elements || [];
    console.log('Order types:', types.map(t => `${t.id}=${t.label}`).join(', '));
    const dineIn = types.find(t =>
      t.label?.toLowerCase().includes('dine') ||
      t.label?.toLowerCase().includes('dining') ||
      t.filterType === 'DINING'
    );
    return dineIn?.id || types[0]?.id || null;
  } catch(e) {
    console.error('Could not get order types:', e.message);
    return null;
  }
}

app.post('/api/order', async (req, res) => {
  const { tableNumber, items, note, paymentMethod } = req.body;
  console.log(`\nNEW ORDER - Table ${tableNumber}, ${items?.length} items`);

  if (!items || !items.length) {
    return res.status(400).json({ success: false, error: 'No items in order' });
  }

  try {
    const dineInTypeId = await getDineInTypeId();

    const orderNote = [
      `TABLE ${tableNumber}`,
      note ? `Note: ${note}` : '',
      `Payment: ${paymentMethod === 'online' ? 'Online' : 'Pay at table'}`
    ].filter(Boolean).join(' | ');

    const orderBody = {
      note: orderNote,
      ...(dineInTypeId ? { orderType: { id: dineInTypeId } } : {})
    };

    const order = await clover('POST', '/orders', orderBody);
    const orderId = order.id;
    console.log(`Order created: ${orderId}`);

    for (const item of items) {
      await clover('POST', `/orders/${orderId}/line_items`, {
        name:    item.name,
        price:   Math.round(item.price * 100),
        unitQty: item.qty * 1000
      });
    }

    const total = items.reduce((s, i) => s + i.price * i.qty, 0);
    console.log(`Order complete: ${orderId} | Table ${tableNumber} | $${total.toFixed(2)}`);

    res.json({ success: true, orderId, tableNumber, total: total.toFixed(2), message: `Order placed for Table ${tableNumber}` });

  } catch(err) {
    console.error('Order error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`Amogham server running on port ${PORT}`));
