const express = require('express');
const router = express.Router();
const { Order, Menu } = require('../models');

// Generate a short, friendly, unique-ish token number (100-999),
// retrying on collision against currently active orders.
async function generateToken() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = Math.floor(Math.random() * 900) + 100;
    const exists = await Order.findOne({ token: candidate, status: { $in: ['Preparing', 'Ready'] } });
    if (!exists) return candidate;
  }
  // Extremely unlikely fallback
  return Math.floor(Math.random() * 9000) + 1000;
}

// POST /api/orders — place a new order (replaces the old localStorage-only checkout)
router.post('/', async (req, res) => {
  try {
    const { studentEmail, items } = req.body;

    if (!studentEmail || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'studentEmail and a non-empty items list are required.' });
    }

    // Re-validate against the real menu so prices/stock can't be spoofed client-side
    const menuIds = items.map(i => i.menuItem || i._id).filter(Boolean);
    const menuDocs = await Menu.find({ _id: { $in: menuIds } });
    const menuById = new Map(menuDocs.map(m => [String(m._id), m]));

    const verifiedItems = [];
    for (const cartItem of items) {
      const id = String(cartItem.menuItem || cartItem._id || '');
      const menuDoc = menuById.get(id);
      if (!menuDoc) {
        return res.status(400).json({ error: `Item "${cartItem.name || id}" is no longer on the menu.` });
      }
      const qty = Number(cartItem.cartQuantity) || 0;
      if (qty < 1) {
        return res.status(400).json({ error: `Invalid quantity for "${menuDoc.name}".` });
      }
      if (menuDoc.quantity < qty) {
        return res.status(409).json({ error: `Only ${menuDoc.quantity} of "${menuDoc.name}" left in stock.` });
      }
      verifiedItems.push({
        menuItem: menuDoc._id,
        name: menuDoc.name,
        price: menuDoc.price,
        category: menuDoc.category,
        cartQuantity: qty
      });
    }

    const total = verifiedItems.reduce((sum, i) => sum + i.price * i.cartQuantity, 0);

    // Retry on the rare chance two requests grab the same token number at once
    // (the DB's unique index on `token` is the real guard; this just retries
    // cleanly instead of surfacing a raw duplicate-key error to the student).
    let order;
    for (let attempt = 0; attempt < 5; attempt++) {
      const token = await generateToken();
      try {
        order = new Order({
          token,
          studentEmail: studentEmail.toLowerCase().trim(),
          items: verifiedItems,
          total,
          status: 'Preparing'
        });
        await order.save();
        break;
      } catch (saveErr) {
        if (saveErr.code === 11000 && attempt < 4) continue; // duplicate token, retry
        throw saveErr;
      }
    }

    // Decrement stock for each item ordered
    await Promise.all(verifiedItems.map(i =>
      Menu.findByIdAndUpdate(i.menuItem, { $inc: { quantity: -i.cartQuantity } })
    ));

    // Real-time: tell the kitchen and admin dashboards a new order just landed
    req.io.emit('order:new', order);
    req.io.emit('menu:update', { type: 'stock-changed' });

    res.status(201).json(order);
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: 'Could not place order. Please try again.' });
  }
});

// GET /api/orders?email=... — a student's own order history
router.get('/', async (req, res) => {
  try {
    const { email, status } = req.query;
    const query = {};
    if (email) query.studentEmail = email.toLowerCase().trim();
    if (status) query.status = status;

    const orders = await Order.find(query).sort({ createdAt: -1 });
    res.status(200).json(orders);
  } catch (err) {
    console.error('Fetch orders error:', err);
    res.status(500).json({ error: 'Failed to fetch orders.' });
  }
});

// GET /api/orders/active — everything the kitchen still needs to act on
router.get('/active', async (req, res) => {
  try {
    const orders = await Order.find({ status: { $in: ['Preparing', 'Ready'] } }).sort({ createdAt: 1 });
    res.status(200).json(orders);
  } catch (err) {
    console.error('Fetch active orders error:', err);
    res.status(500).json({ error: 'Failed to fetch active orders.' });
  }
});

// PUT /api/orders/:id/status — kitchen marks an order Ready / Completed
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['Preparing', 'Ready', 'Completed', 'Cancelled'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
    }

    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    // Real-time: one broadcast covers everyone. Students filter by their own
    // email client-side; chef/admin dashboards use every update regardless.
    req.io.emit('order:status', order);

    res.status(200).json(order);
  } catch (err) {
    console.error('Update order status error:', err);
    res.status(500).json({ error: 'Failed to update order status.' });
  }
});

module.exports = router;
