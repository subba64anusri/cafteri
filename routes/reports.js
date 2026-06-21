const express = require('express');
const router = express.Router();
const { Order, Menu } = require('../models');

// GET /api/reports/summary — today's revenue, today's orders, total menu items
router.get('/summary', async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todaysOrders = await Order.find({
      createdAt: { $gte: startOfToday },
      status: { $ne: 'Cancelled' }
    });

    const revenue = todaysOrders.reduce((sum, o) => sum + o.total, 0);
    const menuCount = await Menu.countDocuments();

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

// GET /api/reports/items — units sold + revenue per item, and per category (for the chart)
router.get('/items', async (req, res) => {
  try {
    const orders = await Order.find({ status: { $ne: 'Cancelled' } });

    const itemMap = new Map();   // name -> { units, revenue }
    const categoryMap = new Map(); // category -> revenue

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
