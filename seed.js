// Run with: npm run seed
// Populates canteens, a manager account, one chef per canteen, and a starter
// menu for each canteen so the multi-tenant behavior is visible immediately
// (two canteens, each with its own independent menu/chef).
// Safe to re-run — it only inserts what's missing.
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { Canteen, Manager, Chef, Menu } = require('./models');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/canteenDB';

const SEED_CANTEENS = [
  {
    name: 'Main Campus Canteen',
    slug: 'main-campus',
    location: 'Block A, Ground Floor',
    description: 'The original canteen — tiffins, meals, snacks and more.',
    chef: { username: 'chef1', password: 'password123', fullName: 'Chef Ramesh' },
    menu: [
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
    ]
  },
  {
    name: 'Hostel Block Canteen',
    slug: 'hostel-block',
    location: 'Hostel Wing, Block C',
    description: 'Late-night snacks and quick bites near the hostel.',
    chef: { username: 'chef2', password: 'password123', fullName: 'Chef Lakshmi' },
    menu: [
      { name: 'Plain Dosa', price: 45, quantity: 20, category: 'Tiffins' },
      { name: 'Poha', price: 30, quantity: 25, category: 'Tiffins' },
      { name: 'Egg Curry Rice', price: 70, quantity: 15, category: 'Meals' },
      { name: 'Paneer Butter Masala Thali', price: 100, quantity: 12, category: 'Meals' },
      { name: 'Cold Coffee', price: 35, quantity: 30, category: 'Drinks' },
      { name: 'Buttermilk', price: 15, quantity: 40, category: 'Drinks' },
      { name: 'Maggi', price: 35, quantity: 35, category: 'Snacks' },
      { name: 'Chilli Paneer', price: 70, quantity: 18, category: 'Snacks' },
      { name: 'Rasmalai (2 pcs)', price: 40, quantity: 20, category: 'Desserts' }
    ]
  }
];

const DEFAULT_MANAGER_USERNAME = process.env.DEFAULT_MANAGER_USERNAME || 'manager';
const DEFAULT_MANAGER_PASSWORD = process.env.DEFAULT_MANAGER_PASSWORD || 'password123';

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected for seeding.');

  // --- MANAGER ---
  const existingManager = await Manager.findOne({ username: DEFAULT_MANAGER_USERNAME });
  if (existingManager) {
    console.log(`Manager "${DEFAULT_MANAGER_USERNAME}" already exists — skipping.`);
  } else {
    const passwordHash = await bcrypt.hash(DEFAULT_MANAGER_PASSWORD, 10);
    await new Manager({ username: DEFAULT_MANAGER_USERNAME, passwordHash, fullName: 'Platform Manager' }).save();
    console.log(`👤 Manager created -> ${DEFAULT_MANAGER_USERNAME} / ${DEFAULT_MANAGER_PASSWORD}`);
  }

  // --- CANTEENS, CHEFS, MENUS ---
  for (const seedCanteen of SEED_CANTEENS) {
    let canteen = await Canteen.findOne({ slug: seedCanteen.slug });
    if (!canteen) {
      canteen = await new Canteen({
        name: seedCanteen.name,
        slug: seedCanteen.slug,
        location: seedCanteen.location,
        description: seedCanteen.description
      }).save();
      console.log(`🏠 Canteen created -> ${canteen.name} (${canteen.slug})`);
    } else {
      console.log(`Canteen "${canteen.slug}" already exists — skipping creation.`);
    }

    const existingChef = await Chef.findOne({ username: seedCanteen.chef.username });
    if (!existingChef) {
      await new Chef({
        username: seedCanteen.chef.username,
        password: seedCanteen.chef.password,
        fullName: seedCanteen.chef.fullName,
        canteen: canteen._id
      }).save();
      console.log(`👨‍🍳 Chef created -> ${seedCanteen.chef.username} / ${seedCanteen.chef.password} (assigned to ${canteen.name})`);
    } else {
      console.log(`Chef "${seedCanteen.chef.username}" already exists — skipping.`);
    }

    const existingMenuCount = await Menu.countDocuments({ canteen: canteen._id });
    if (existingMenuCount > 0) {
      console.log(`Menu for "${canteen.slug}" already has ${existingMenuCount} items — skipping.`);
    } else {
      const items = seedCanteen.menu.map(item => ({ ...item, canteen: canteen._id }));
      await Menu.insertMany(items);
      console.log(`🍽️  Seeded ${items.length} menu items for ${canteen.name}.`);
    }
  }

  await mongoose.disconnect();
  console.log('Seeding complete.');
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
