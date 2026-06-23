const express = require('express');
const router = express.Router();
const { Order, Menu } = require('../models');
const { requireManager, requireChef, loadCanteen } = require('../middleware/auth');

// Both routes below accept either a manager (any canteen via canteenId) or a
// chef (locked to their own canteen, canteenId in the request is ignored and
// replaced with the chef's actual assignment).
async function authorizeForCanteen(req, res, next) {
  if (req.header('x-chef-username')) {
    return requireChef(req, res, () => {
      req.query.canteenId = String(req.chef.canteen._id);
      req.params.canteenId = String(req.chef.canteen._id);
      next();
    });
  }
  return requireManager(req, res, next);
}

// GET /api/reports/summary?canteenId=... — today's revenue, today's orders,
// total menu items for ONE canteen.
router.get('/summary', authorizeForCanteen, loadCanteen({ requireActive: false }), async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todaysOrders = await Order.find({
      canteen: req.canteen._id,
      createdAt: { $gte: startOfToday },
      status: { $ne: 'Cancelled' }
    });

    const revenue = todaysOrders.reduce((sum, o) => sum + o.total, 0);
    const menuCount = await Menu.countDocuments({ canteen: req.canteen._id });

    res.status(200).json({
      revenue,
      orders: todaysOrders.length,
      menuCount
    });
  } catch (err) {
    console.error('Summary report error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/items?canteenId=... — units sold + revenue per item, and
// per category, for ONE canteen.
router.get('/items', authorizeForCanteen, loadCanteen({ requireActive: false }), async (req, res) => {
  try {
    const orders = await Order.find({ canteen: req.canteen._id, status: { $ne: 'Cancelled' } });

    const itemMap = new Map();
    const categoryMap = new Map();

    for (const order of orders) {
      for (const item of order.items) {
        const itemEntry = itemMap.get(item.name) || { units: 0, revenue: 0 };
        itemEntry.units += item.cartQuantity;
        itemEntry.revenue += item.price * item.cartQuantity;
        itemMap.set(item.name, itemEntry);

        const cat = item.category || 'Uncategorized';
        categoryMap.set(cat, (categoryMap.get(cat) || 0) + item.price * item.cartQuantity);
      }
    }

    const items = Array.from(itemMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue);

    const categories = Array.from(categoryMap.entries())
      .map(([category, revenue]) => ({ category, revenue }));

    res.status(200).json({ items, categories });
  } catch (err) {
    console.error('Items report error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
