const express = require('express');
const router = express.Router();
const { Menu, CATEGORIES } = require('../models');
const { requireManager, requireChef, loadCanteen } = require('../middleware/auth');

// GET /api/menu?canteenId=...&category=Tiffins
// Public-ish read: any logged-in customer can read a canteen's menu once
// they've selected it. canteenId is required — there is no "global menu"
// anymore, every item belongs to exactly one canteen.
router.get('/', loadCanteen(), async (req, res) => {
  try {
    const { category } = req.query;
    const query = { canteen: req.canteen._id };
    if (category) query.category = category;

    const items = await Menu.find(query).sort({ name: 1 });
    res.status(200).json(items);
  } catch (err) {
    console.error('Fetch menu error:', err);
    res.status(500).json({ error: 'Failed to fetch menu.' });
  }
});

router.get('/categories', (req, res) => {
  res.status(200).json(CATEGORIES);
});

// ---------------------------------------------------------------------------
// Write routes — a chef can only touch their OWN canteen's menu; a manager
// can touch any canteen's menu by passing canteenId. We accept either role,
// then enforce the canteen match explicitly for chefs.
// ---------------------------------------------------------------------------
function requireChefOrManager(req, res, next) {
  if (req.header('x-manager-username')) return requireManager(req, res, next);
  return requireChef(req, res, next);
}

// Resolves the target canteen for a write: a chef is locked to their own
// canteen (ignores any canteenId in the body); a manager must supply one.
function resolveWriteCanteenId(req) {
  if (req.chef) return String(req.chef.canteen._id);
  return req.body.canteenId;
}

// POST /api/menu — create item, broadcast to that canteen's room only
router.post('/', requireChefOrManager, async (req, res) => {
  try {
    const canteenId = resolveWriteCanteenId(req);
    if (!canteenId) {
      return res.status(400).json({ error: 'canteenId is required.' });
    }

    const { name, price, quantity, category } = req.body;
    if (!name || price === undefined || quantity === undefined || !category) {
      return res.status(400).json({ error: 'Name, price, quantity and category are all required.' });
    }
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Category must be one of: ${CATEGORIES.join(', ')}` });
    }
    if (Number(price) < 0 || Number(quantity) < 0) {
      return res.status(400).json({ error: 'Price and quantity cannot be negative.' });
    }

    const item = new Menu({
      canteen: canteenId,
      name: String(name).trim(),
      price: Number(price),
      quantity: Number(quantity),
      category
    });
    await item.save();

    req.io.to(`kitchen:${canteenId}`).emit('menu:update', { type: 'created', item });
    res.status(201).json(item);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'An item with this name already exists in this canteen.' });
    }
    console.error('Create menu item error:', err);
    res.status(500).json({ error: 'Failed to add item.' });
  }
});

// PUT /api/menu/:id — a chef may only edit items belonging to their canteen
router.put('/:id', requireChefOrManager, async (req, res) => {
  try {
    const { name, price, quantity, category } = req.body;

    if (category && !CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Category must be one of: ${CATEGORIES.join(', ')}` });
    }
    if ((price !== undefined && Number(price) < 0) || (quantity !== undefined && Number(quantity) < 0)) {
      return res.status(400).json({ error: 'Price and quantity cannot be negative.' });
    }

    const existing = await Menu.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Item not found.' });
    }
    // A chef can never edit another canteen's item, even by guessing an ID.
    if (req.chef && String(existing.canteen) !== String(req.chef.canteen._id)) {
      return res.status(403).json({ error: 'You can only manage items in your own canteen.' });
    }

    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (price !== undefined) update.price = Number(price);
    if (quantity !== undefined) update.quantity = Number(quantity);
    if (category !== undefined) update.category = category;

    const updated = await Menu.findByIdAndUpdate(req.params.id, update, { new: true });

    req.io.to(`kitchen:${updated.canteen}`).emit('menu:update', { type: 'updated', item: updated });
    res.status(200).json(updated);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'An item with this name already exists in this canteen.' });
    }
    console.error('Update menu item error:', err);
    res.status(500).json({ error: 'Update failed.' });
  }
});

// DELETE /api/menu/:id
router.delete('/:id', requireChefOrManager, async (req, res) => {
  try {
    const existing = await Menu.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Item not found.' });
    }
    if (req.chef && String(existing.canteen) !== String(req.chef.canteen._id)) {
      return res.status(403).json({ error: 'You can only manage items in your own canteen.' });
    }

    await Menu.findByIdAndDelete(req.params.id);

    req.io.to(`kitchen:${existing.canteen}`).emit('menu:update', { type: 'deleted', itemId: req.params.id, category: existing.category });
    res.status(200).json({ message: 'Deleted.' });
  } catch (err) {
    console.error('Delete menu item error:', err);
    res.status(500).json({ error: 'Delete failed.' });
  }
});

module.exports = router;
