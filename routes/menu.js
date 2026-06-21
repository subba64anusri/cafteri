const express = require('express');
const router = express.Router();
const { Menu, CATEGORIES } = require('../models');

// GET /api/menu?category=Tiffins  (category optional — omit for all items)
router.get('/', async (req, res) => {
  try {
    const { category } = req.query;
    const query = category ? { category } : {};
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

// POST /api/menu  — create item, broadcast to all connected students live
router.post('/', async (req, res) => {
  try {
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
      name: String(name).trim(),
      price: Number(price),
      quantity: Number(quantity),
      category
    });
    await item.save();

    req.io.emit('menu:update', { type: 'created', item });
    res.status(201).json(item);
  } catch (err) {
    console.error('Create menu item error:', err);
    res.status(500).json({ error: 'Failed to add item.' });
  }
});

// PUT /api/menu/:id
router.put('/:id', async (req, res) => {
  try {
    const { name, price, quantity, category } = req.body;

    if (category && !CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Category must be one of: ${CATEGORIES.join(', ')}` });
    }
    if ((price !== undefined && Number(price) < 0) || (quantity !== undefined && Number(quantity) < 0)) {
      return res.status(400).json({ error: 'Price and quantity cannot be negative.' });
    }

    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (price !== undefined) update.price = Number(price);
    if (quantity !== undefined) update.quantity = Number(quantity);
    if (category !== undefined) update.category = category;

    const updated = await Menu.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!updated) {
      return res.status(404).json({ error: 'Item not found.' });
    }

    req.io.emit('menu:update', { type: 'updated', item: updated });
    res.status(200).json(updated);
  } catch (err) {
    console.error('Update menu item error:', err);
    res.status(500).json({ error: 'Update failed.' });
  }
});

// DELETE /api/menu/:id
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Menu.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Item not found.' });
    }

    req.io.emit('menu:update', { type: 'deleted', itemId: req.params.id, category: deleted.category });
    res.status(200).json({ message: 'Deleted.' });
  } catch (err) {
    console.error('Delete menu item error:', err);
    res.status(500).json({ error: 'Delete failed.' });
  }
});

module.exports = router;
