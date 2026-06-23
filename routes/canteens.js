const express = require('express');
const router = express.Router();
const { Canteen } = require('../models');

// GET /api/canteens — list active canteens (for the customer "Order Food"
// canteen-selection screen). Disabled canteens are hidden from customers.
router.get('/', async (req, res) => {
  try {
    const canteens = await Canteen.find({ isActive: true }).sort({ name: 1 });
    res.status(200).json(canteens);
  } catch (err) {
    console.error('Fetch canteens error:', err);
    res.status(500).json({ error: 'Failed to fetch canteens.' });
  }
});

// GET /api/canteens/:id — single canteen detail (customer-facing; 404s on
// disabled canteens so a stale link can't be used to bypass disabling).
router.get('/:id', async (req, res) => {
  try {
    const canteen = await Canteen.findById(req.params.id);
    if (!canteen || !canteen.isActive) {
      return res.status(404).json({ error: 'Canteen not found.' });
    }
    res.status(200).json(canteen);
  } catch (err) {
    console.error('Fetch canteen error:', err);
    res.status(400).json({ error: 'Invalid canteen reference.' });
  }
});

module.exports = router;
