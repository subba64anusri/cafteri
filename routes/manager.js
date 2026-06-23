const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { Canteen, Chef, Menu, Order } = require('../models');
const { requireManager } = require('../middleware/auth');

// Every route in this file is manager-only.
router.use(requireManager);

// ===========================================================================
// CANTEEN MANAGEMENT
// ===========================================================================

// GET /api/manager/canteens — ALL canteens, including disabled ones (unlike
// the public /api/canteens route), so managers can re-enable them.
router.get('/canteens', async (req, res) => {
  try {
    const canteens = await Canteen.find().sort({ name: 1 });
    res.status(200).json(canteens);
  } catch (err) {
    console.error('Fetch canteens (manager) error:', err);
    res.status(500).json({ error: 'Failed to fetch canteens.' });
  }
});

// GET /api/manager/canteens/:id/stats — quick stats for the dashboard card:
// today's revenue/orders, total menu items, chef count.
router.get('/canteens/:id/stats', async (req, res) => {
  try {
    const canteen = await Canteen.findById(req.params.id);
    if (!canteen) {
      return res.status(404).json({ error: 'Canteen not found.' });
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [todaysOrders, menuCount, chefCount] = await Promise.all([
      Order.find({ canteen: canteen._id, createdAt: { $gte: startOfToday }, status: { $ne: 'Cancelled' } }),
      Menu.countDocuments({ canteen: canteen._id }),
      Chef.countDocuments({ canteen: canteen._id })
    ]);

    const revenue = todaysOrders.reduce((sum, o) => sum + o.total, 0);

    res.status(200).json({
      canteenId: canteen._id,
      revenue,
      orders: todaysOrders.length,
      menuCount,
      chefCount
    });
  } catch (err) {
    console.error('Canteen stats error:', err);
    res.status(400).json({ error: 'Invalid canteen reference.' });
  }
});

// POST /api/manager/canteens — create a new canteen
router.post('/canteens', async (req, res) => {
  try {
    const { name, slug, location, description } = req.body;

    if (!name || !slug) {
      return res.status(400).json({ error: 'Canteen name and slug are required.' });
    }

    const normalizedSlug = String(slug).trim().toLowerCase().replace(/\s+/g, '-');
    const existing = await Canteen.findOne({ slug: normalizedSlug });
    if (existing) {
      return res.status(409).json({ error: `A canteen with the slug "${normalizedSlug}" already exists.` });
    }

    const canteen = new Canteen({
      name: String(name).trim(),
      slug: normalizedSlug,
      location: (location || '').trim(),
      description: (description || '').trim()
    });
    await canteen.save();

    res.status(201).json(canteen);
  } catch (err) {
    console.error('Create canteen error:', err);
    res.status(500).json({ error: 'Failed to create canteen.' });
  }
});

// PUT /api/manager/canteens/:id — edit name/location/description/slug
router.put('/canteens/:id', async (req, res) => {
  try {
    const { name, location, description, slug } = req.body;
    const update = {};

    if (name !== undefined) update.name = String(name).trim();
    if (location !== undefined) update.location = String(location).trim();
    if (description !== undefined) update.description = String(description).trim();

    if (slug !== undefined) {
      const normalizedSlug = String(slug).trim().toLowerCase().replace(/\s+/g, '-');
      const conflict = await Canteen.findOne({ slug: normalizedSlug, _id: { $ne: req.params.id } });
      if (conflict) {
        return res.status(409).json({ error: `A canteen with the slug "${normalizedSlug}" already exists.` });
      }
      update.slug = normalizedSlug;
    }

    const updated = await Canteen.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!updated) {
      return res.status(404).json({ error: 'Canteen not found.' });
    }

    res.status(200).json(updated);
  } catch (err) {
    console.error('Update canteen error:', err);
    res.status(500).json({ error: 'Update failed.' });
  }
});

// PUT /api/manager/canteens/:id/status — enable/disable a canteen
router.put('/canteens/:id/status', async (req, res) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be true or false.' });
    }

    const updated = await Canteen.findByIdAndUpdate(req.params.id, { isActive }, { new: true });
    if (!updated) {
      return res.status(404).json({ error: 'Canteen not found.' });
    }

    res.status(200).json(updated);
  } catch (err) {
    console.error('Toggle canteen status error:', err);
    res.status(500).json({ error: 'Failed to update canteen status.' });
  }
});

// DELETE /api/manager/canteens/:id — only allowed if the canteen has no
// menu items, orders, or chefs left. This protects order history (a real
// platform should never silently delete past orders/revenue records) while
// still letting managers clean up canteens that were created by mistake.
router.delete('/canteens/:id', async (req, res) => {
  try {
    const canteenId = req.params.id;
    const [menuCount, orderCount, chefCount] = await Promise.all([
      Menu.countDocuments({ canteen: canteenId }),
      Order.countDocuments({ canteen: canteenId }),
      Chef.countDocuments({ canteen: canteenId })
    ]);

    if (menuCount > 0 || orderCount > 0 || chefCount > 0) {
      return res.status(409).json({
        error: `Cannot delete: this canteen still has ${menuCount} menu item(s), ${orderCount} order(s), and ${chefCount} chef(s). Remove or reassign those first, or disable the canteen instead of deleting it.`
      });
    }

    const deleted = await Canteen.findByIdAndDelete(canteenId);
    if (!deleted) {
      return res.status(404).json({ error: 'Canteen not found.' });
    }

    res.status(200).json({ message: 'Canteen deleted.' });
  } catch (err) {
    console.error('Delete canteen error:', err);
    res.status(500).json({ error: 'Delete failed.' });
  }
});

// ===========================================================================
// CHEF MANAGEMENT
// ===========================================================================

// GET /api/manager/chefs — all chefs across all canteens, with canteen info
// populated so the dashboard can show "Chef Ramesh — Main Campus Canteen".
// Optional ?canteenId= filters to one canteen.
router.get('/chefs', async (req, res) => {
  try {
    const { canteenId } = req.query;
    const query = canteenId ? { canteen: canteenId } : {};
    const chefs = await Chef.find(query).populate('canteen', 'name slug').sort({ username: 1 });
    res.status(200).json(chefs.map(c => ({
      _id: c._id,
      username: c.username,
      fullName: c.fullName,
      contact: c.contact,
      isActive: c.isActive,
      canteen: c.canteen ? { id: c.canteen._id, name: c.canteen.name, slug: c.canteen.slug } : null,
      createdAt: c.createdAt
    })));
  } catch (err) {
    console.error('Fetch chefs error:', err);
    res.status(500).json({ error: 'Failed to fetch chefs.' });
  }
});

// POST /api/manager/chefs — add a chef, assigned to a canteen at creation
router.post('/chefs', async (req, res) => {
  try {
    const { username, password, fullName, contact, canteenId } = req.body;

    if (!username || !password || !canteenId) {
      return res.status(400).json({ error: 'Username, password, and canteenId are required.' });
    }

    const canteen = await Canteen.findById(canteenId);
    if (!canteen) {
      return res.status(404).json({ error: 'Selected canteen does not exist.' });
    }

    const existing = await Chef.findOne({ username: String(username).trim() });
    if (existing) {
      return res.status(409).json({ error: `A chef with the username "${username}" already exists.` });
    }

    const chef = new Chef({
      username: String(username).trim(),
      password: String(password).trim(),
      fullName: (fullName || '').trim(),
      contact: (contact || '').trim(),
      canteen: canteen._id
    });
    await chef.save();

    res.status(201).json({
      _id: chef._id,
      username: chef.username,
      fullName: chef.fullName,
      contact: chef.contact,
      isActive: chef.isActive,
      canteen: { id: canteen._id, name: canteen.name, slug: canteen.slug }
    });
  } catch (err) {
    console.error('Create chef error:', err);
    res.status(500).json({ error: 'Failed to add chef.' });
  }
});

// PUT /api/manager/chefs/:id — edit name/contact/active-state and optionally
// reassign to a different canteen.
router.put('/chefs/:id', async (req, res) => {
  try {
    const { fullName, contact, isActive, canteenId } = req.body;
    const update = {};

    if (fullName !== undefined) update.fullName = String(fullName).trim();
    if (contact !== undefined) update.contact = String(contact).trim();
    if (isActive !== undefined) update.isActive = Boolean(isActive);

    if (canteenId !== undefined) {
      const canteen = await Canteen.findById(canteenId);
      if (!canteen) {
        return res.status(404).json({ error: 'Selected canteen does not exist.' });
      }
      update.canteen = canteen._id;
    }

    const updated = await Chef.findByIdAndUpdate(req.params.id, update, { new: true }).populate('canteen', 'name slug');
    if (!updated) {
      return res.status(404).json({ error: 'Chef not found.' });
    }

    res.status(200).json({
      _id: updated._id,
      username: updated.username,
      fullName: updated.fullName,
      contact: updated.contact,
      isActive: updated.isActive,
      canteen: updated.canteen ? { id: updated.canteen._id, name: updated.canteen.name, slug: updated.canteen.slug } : null
    });
  } catch (err) {
    console.error('Update chef error:', err);
    res.status(500).json({ error: 'Update failed.' });
  }
});

// PUT /api/manager/chefs/:id/reset-password
router.put('/chefs/:id/reset-password', async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || String(newPassword).trim().length < 4) {
      return res.status(400).json({ error: 'New password must be at least 4 characters.' });
    }

    const updated = await Chef.findByIdAndUpdate(
      req.params.id,
      { password: String(newPassword).trim() },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ error: 'Chef not found.' });
    }

    res.status(200).json({ message: `Password reset for "${updated.username}".` });
  } catch (err) {
    console.error('Reset chef password error:', err);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// DELETE /api/manager/chefs/:id
router.delete('/chefs/:id', async (req, res) => {
  try {
    const deleted = await Chef.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Chef not found.' });
    }
    res.status(200).json({ message: 'Chef deleted.' });
  } catch (err) {
    console.error('Delete chef error:', err);
    res.status(500).json({ error: 'Delete failed.' });
  }
});

module.exports = router;
