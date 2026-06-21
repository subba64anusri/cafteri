// Run with: npm run seed
// Populates the menu collection with starter items so the apps aren't empty
// on first run. Safe to re-run — it only inserts categories that are empty.
require('dotenv').config();
const mongoose = require('mongoose');
const { Menu } = require('./models');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/canteenDB';

const SEED_ITEMS = [
  { name: 'Idli Sambar', price: 40, quantity: 30, category: 'Tiffins' },
  { name: 'Masala Dosa', price: 60, quantity: 25, category: 'Tiffins' },
  { name: 'Upma', price: 35, quantity: 20, category: 'Tiffins' },
  { name: 'Veg Thali', price: 90, quantity: 20, category: 'Meals' },
  { name: 'Chicken Biryani', price: 150, quantity: 15, category: 'Meals' },
  { name: 'Rajma Rice', price: 80, quantity: 18, category: 'Meals' },
  { name: 'Masala Chai', price: 15, quantity: 50, category: 'Drinks' },
  { name: 'Filter Coffee', price: 20, quantity: 50, category: 'Drinks' },
  { name: 'Fresh Lime Soda', price: 25, quantity: 30, category: 'Drinks' },
  { name: 'Samosa (2 pcs)', price: 30, quantity: 40, category: 'Snacks' },
  { name: 'Veg Sandwich', price: 45, quantity: 25, category: 'Snacks' },
  { name: 'French Fries', price: 60, quantity: 20, category: 'Snacks' },
  { name: 'Gulab Jamun (2 pcs)', price: 35, quantity: 25, category: 'Desserts' },
  { name: 'Ice Cream Cup', price: 40, quantity: 30, category: 'Desserts' }
];

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected for seeding.');

  const existingCount = await Menu.countDocuments();
  if (existingCount > 0) {
    console.log(`Menu already has ${existingCount} items — skipping seed. Delete the collection first if you want a fresh seed.`);
    await mongoose.disconnect();
    return;
  }

  await Menu.insertMany(SEED_ITEMS);
  console.log(`Seeded ${SEED_ITEMS.length} menu items.`);
  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
