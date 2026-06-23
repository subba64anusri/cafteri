const express = require('express');
const router = express.Router();
const { Order, Menu } = require('../models');
const { requireManager, requireChef, loadCanteen } = require('../middleware/auth');

// Generate a short, friendly token number (100-999), retrying on collision
// against currently active orders WITHIN THE SAME CANTEEN ONLY — two
// different canteens can each have an active "#412" at the same time.
async function generateToken(canteenId) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = Math.floor(Math.random() * 900) + 100;
    const exists = await Order.findOne({
      canteen: canteenId,
      token: candidate,
      status: { $in: ['Preparing', 'Ready'] }
    });
    if (!exists) return candidate;
  }
  return Math.floor(Math.random() * 9000) + 1000;
}

// POST /api/orders — place a new order against a specific canteen
router.post('/', loadCanteen(), async (req, res) => {
  try {
    const { studentEmail, items } = req.body;
    const canteenId = req.canteen._id;

    if (!studentEmail || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'studentEmail and a non-empty items list are required.' });
    }

    // Re-validate against the real menu so prices/stock can't be spoofed
    // client-side, AND so an item from a different canteen can't sneak in.
    const menuIds = items.map(i => i.menuItem || i._id).filter(Boolean);
    const menuDocs = await Menu.find({ _id: { $in: menuIds }, canteen: canteenId });
    const menuById = new Map(menuDocs.map(m => [String(m._id), m]));

    const verifiedItems = [];
    for (const cartItem of items) {
      const id = String(cartItem.menuItem || cartItem._id || '');
      const menuDoc = menuById.get(id);
      if (!menuDoc) {
        return res.status(400).json({ error: `Item "${cartItem.name || id}" is not available in this canteen.` });
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

    let order;
    for (let attempt = 0; attempt < 5; attempt++) {
      const token = await generateToken(canteenId);
      try {
        order = new Order({
          canteen: canteenId,
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

    await Promise.all(verifiedItems.map(i =>
      Menu.findByIdAndUpdate(i.menuItem, { $inc: { quantity: -i.cartQuantity } })
    ));

    // Real-time: only that canteen's kitchen room hears about it.
    req.io.to(`kitchen:${canteenId}`).emit('order:new', order);
    req.io.to(`kitchen:${canteenId}`).emit('menu:update', { type: 'stock-changed' });

    res.status(201).json(order);
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: 'Could not place order. Please try again.' });
  }
});

// GET /api/orders?email=...&canteenId=...&status=...
// A student's own order history. canteenId is OPTIONAL here on purpose:
// the "My Orders" page shows a customer's orders across every canteen
// they've ever ordered from, not just the one currently selected.
router.get('/', async (req, res) => {
  try {
    const { email, status, canteenId } = req.query;
    const query = {};
    if (email) query.studentEmail = email.toLowerCase().trim();
    if (status) query.status = status;
    if (canteenId) query.canteen = canteenId;

    // Chef/manager views of order history (e.g. reports) MUST scope to a
    // canteen — only the student's personal "My Orders" page is allowed to
    // span canteens, and that's only reachable via the email filter above
    // with no chef/manager header present.
    if (!email && !canteenId) {
      return res.status(400).json({ error: 'Either email or canteenId is required.' });
    }

    const orders = await Order.find(query).sort({ createdAt: -1 });
    res.status(200).json(orders);
  } catch (err) {
    console.error('Fetch orders error:', err);
    res.status(500).json({ error: 'Failed to fetch orders.' });
  }
});

// GET /api/orders/active?canteenId=... — everything the kitchen still needs
// to act on, for ONE canteen. Chef header must match the canteen requested;
// manager header may request any canteen.
router.get('/active', loadCanteen(), async (req, res) => {
  try {
    if (req.header('x-chef-username')) {
      return requireChef(req, res, async () => {
        if (String(req.chef.canteen._id) !== String(req.canteen._id)) {
          return res.status(403).json({ error: 'You can only view orders for your own canteen.' });
        }
        await sendActiveOrders(req, res);
      });
    }
    return requireManager(req, res, () => sendActiveOrders(req, res));
  } catch (err) {
    console.error('Fetch active orders error:', err);
    res.status(500).json({ error: 'Failed to fetch active orders.' });
  }
});

async function sendActiveOrders(req, res) {
  const orders = await Order.find({
    canteen: req.canteen._id,
    status: { $in: ['Preparing', 'Ready'] }
  }).sort({ createdAt: 1 });
  res.status(200).json(orders);
}

// PUT /api/orders/:id/status — kitchen marks an order Ready / Completed.
// A chef may only update orders that belong to their own canteen.
router.put('/:id/status', async (req, res) => {
  try {
    const handle = async () => {
      const { status } = req.body;
      const allowed = ['Preparing', 'Ready', 'Completed', 'Cancelled'];
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
      }

      const existing = await Order.findById(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'Order not found.' });
      }
      if (req.chef && String(existing.canteen) !== String(req.chef.canteen._id)) {
        return res.status(403).json({ error: 'You can only manage orders for your own canteen.' });
      }

      const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });

      // Real-time: scoped to that canteen's kitchen room, plus the specific
      // student's personal room (so "My Orders" updates live regardless of
      // which canteen the student is currently browsing).
      req.io.to(`kitchen:${order.canteen}`).emit('order:status', order);
      req.io.to(`student:${order.studentEmail}`).emit('order:status', order);

      res.status(200).json(order);
    };

    if (req.header('x-chef-username')) {
      return requireChef(req, res, handle);
    }
    return requireManager(req, res, handle);
  } catch (err) {
    console.error('Update order status error:', err);
    res.status(500).json({ error: 'Failed to update order status.' });
  }
});

module.exports = router;
