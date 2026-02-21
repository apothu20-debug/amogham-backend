const path = require('path');
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const MERCHANT_ID = process.env.CLOVER_MERCHANT_ID || '32QHYQVNHHBP1';
const API_TOKEN   = process.env.CLOVER_API_TOKEN   || 'f70d70cb-8c2a-5773-b40f-93d1bb987427';
const BASE_URL    = 'https://api.clover.com/v3';
const PORT        = process.env.PORT || 3000;

const H = {
  'Authorization': `Bearer ${API_TOKEN}`,
  'Content-Type':  'application/json',
  'Accept':        'application/json'
};

// HST 13% tax rate ID
const HST_TAX_ID = '4710YHR5PYKNA';

// Dining table number → Clover table ID
const TABLE_IDS = {
  '101': 'AJHV4299CQNY0',
  '102': 'PPWTMP5N59Z4T',
  '103': 'X2SCNG1619WWC',
  '104': 'EWWR8K0D8TKDR',
  '201': 'KAZEVCER0TT1J',
  '202': 'SQAKAATCYV5FJ',
  '203': 'VVVDHYZ2FAQ98',
};

async function clover(method, path, body = null) {
  const res = await fetch(`${BASE_URL}/merchants/${MERCHANT_ID}${path}`, {
    method, headers: H, body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  console.log(`${method} ${path} -> ${res.status}`);
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
    const dineIn = types.find(t =>
      t.label?.toLowerCase().includes('dine') || t.filterType === 'DINING'
    );
    return dineIn?.id || types[0]?.id || null;
  } catch(e) { return null; }
}

app.post('/api/order', async (req, res) => {
  const { tableNumber, items, note, paymentMethod } = req.body;
  console.log(`\nNEW ORDER - Table ${tableNumber}, ${items?.length} items`);
  if (!items || !items.length) return res.status(400).json({ success: false, error: 'No items' });

  try {
    const dineInTypeId = await getDineInTypeId();
    const tableId = TABLE_IDS[String(tableNumber)];
    const orderNote = [
      note ? `Note: ${note}` : '',
      `Payment: ${paymentMethod === 'online' ? 'Paid online' : 'Pay at table'}`
    ].filter(Boolean).join(' | ');

    // Create order first
    const order = await clover('POST', '/orders', {
      title: `TABLE ${tableNumber}`,
      note: orderNote,
      ...(dineInTypeId ? { orderType: { id: dineInTypeId } } : {}),
      ...(tableId ? { tableId } : {})
    });
    const orderId = order.id;
    console.log(`Order created: ${orderId} for TABLE ${tableNumber}`);

    // Add line items — inventory items inherit tax automatically
    for (const item of items) {
      if (item.cloverId) {
        await clover('POST', `/orders/${orderId}/line_items`, {
          item: { id: item.cloverId },
          unitQty: item.qty * 1000
        });
      } else {
        await clover('POST', `/orders/${orderId}/line_items`, {
          name: item.name,
          price: Math.round(item.price * 100),
          unitQty: item.qty * 1000
        });
      }
      console.log(`Added: ${item.name} x${item.qty}`);
    }

    // Calculate total and update order
    const subtotal = items.reduce((s, i) => s + Math.round(i.price * 100) * i.qty, 0);
    const tax = Math.round(subtotal * 0.13);
    const total = subtotal + tax;

    await clover('POST', `/orders/${orderId}`, { total });
    console.log(`DONE: ${orderId} | TABLE ${tableNumber} | $${(total/100).toFixed(2)}`);

    res.json({ success: true, orderId, tableNumber, total: (total/100).toFixed(2) });

  } catch(err) {
    console.error('Order error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all inventory items
app.get('/api/items', async (req, res) => {
  try {
    const data = await fetch(`${BASE_URL}/merchants/${MERCHANT_ID}/items?limit=500&expand=categories`, { headers: H });
    const json = await data.json();
    const items = (json.elements || []).map(i => ({
      id: i.id, name: i.name, price: i.price,
      category: i.categories?.elements?.[0]?.name || 'None'
    }));
    res.json({ success: true, count: items.length, items });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// Recent orders for staff notifications
app.get('/api/recent-orders', async (req, res) => {
  try {
    const since = Date.now() - (30 * 60 * 1000);
    const data = await fetch(
      `${BASE_URL}/merchants/${MERCHANT_ID}/orders?filter=createdTime>=${since}&expand=lineItems&limit=20`,
      { headers: H }
    );
    const json = await data.json();
    const orders = (json.elements || [])
      .filter(o => o.title && o.title.includes('TABLE'))
      .map(o => ({
        id: o.id,
        table: o.title?.replace('TABLE ', '') || '?',
        items: (o.lineItems?.elements || []).map(i => i.name).join(', ') || 'Order',
        total: ((o.lineItems?.elements || []).reduce((s, i) => s + (i.price || 0), 0) / 100).toFixed(2),
        time: o.createdTime
      }));
    res.json({ success: true, orders });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// Get dining tables
app.get('/api/tables', async (req, res) => {
  try {
    const data = await fetch(`${BASE_URL}/merchants/${MERCHANT_ID}/tables`, { headers: H });
    const json = await data.json();
    res.json({ success: true, tables: json.elements || [] });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// Get tax rates
app.get('/api/taxrates', async (req, res) => {
  try {
    const data = await fetch(`${BASE_URL}/merchants/${MERCHANT_ID}/tax_rates`, { headers: H });
    const json = await data.json();
    res.json({ success: true, taxRates: json.elements || [] });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.listen(PORT, () => console.log(`Amogham server running on port ${PORT}`));

// ── POST /api/apply-hst ─────────────────────────
// Bulk-adds HST to all inventory items
app.post('/api/apply-hst', async (req, res) => {
  const HST = '4710YHR5PYKNA';
  try {
    const data = await fetch(`${BASE_URL}/merchants/${MERCHANT_ID}/items?limit=500`, { headers: H });
    const json = await data.json();
    const items = json.elements || [];
    console.log(`Applying HST to ${items.length} items...`);

    let success = 0, failed = 0;
    for (const item of items) {
      try {
        // Step 1: Set defaultTaxRates=false so we can assign custom tax
        await fetch(`${BASE_URL}/merchants/${MERCHANT_ID}/items/${item.id}`,
          { method: 'POST', headers: H,
            body: JSON.stringify({ defaultTaxRates: false }) });

        // Step 2: Associate HST tax rate with item
        const r = await fetch(
          `${BASE_URL}/merchants/${MERCHANT_ID}/tax_rate_items`,
          { method: 'POST', headers: H,
            body: JSON.stringify({ elements: [{ taxRate: { id: HST }, item: { id: item.id } }] }) }
        );
        if (r.ok) { success++; console.log(`✓ ${item.name}`); }
        else {
          const txt = await r.text();
          failed++;
          console.log(`✗ ${item.name}: ${r.status} ${txt.substring(0,80)}`);
        }
      } catch(e) { failed++; console.log(`✗ ${item.name}: ${e.message}`); }
    }
    res.json({ success: true, message: `HST applied: ${success} ok, ${failed} failed` });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── GET /api/item-tax/:itemId ───────────────────
app.get('/api/item-tax/:itemId', async (req, res) => {
  try {
    const data = await fetch(
      `${BASE_URL}/merchants/${MERCHANT_ID}/items/${req.params.itemId}?expand=taxRates`,
      { headers: H }
    );
    const json = await data.json();
    res.json({ success: true, item: json.name, taxRates: json.taxRates?.elements || [] });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});
