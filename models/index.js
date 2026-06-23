const mongoose = require('mongoose');

// ---------------------------------------------------------------------------
// Canteen — the new root entity. Every other collection that needs isolation
// (Menu, Order, Chef) carries a canteenId pointing back here.
// ---------------------------------------------------------------------------
const canteenSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
  location: { type: String, trim: true, default: '' },
  description: { type: String, trim: true, default: '' },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// ---------------------------------------------------------------------------
// Manager — global account, not tied to any single canteen. Replaces the old
// "Admin" model/terminology. A manager can operate on any canteen.
// ---------------------------------------------------------------------------
const managerSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true, trim: true },
  passwordHash: { type: String, required: true },
  fullName: { type: String, trim: true, default: '' },
  role: { type: String, default: 'manager' }
}, { timestamps: true });

// ---------------------------------------------------------------------------
// Chef — belongs to exactly one canteen. Managers create/edit/delete these.
// ---------------------------------------------------------------------------
const chefSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true }, // plain to preserve prior simple-auth behavior
  fullName: { type: String, trim: true, default: '' },
  contact: { type: String, trim: true, default: '' },
  canteen: { type: mongoose.Schema.Types.ObjectId, ref: 'Canteen', required: true },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// ---------------------------------------------------------------------------
// Student / Customer — global account. A customer can order from any canteen;
// which canteen they're currently shopping is tracked client-side and sent
// as a query/body param, never inferred from the account itself.
// ---------------------------------------------------------------------------
const studentSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true }
}, { timestamps: true });

// ---------------------------------------------------------------------------
// Menu item — scoped to one canteen. Category list is fixed globally for now
// (kept simple per existing app), but every item is isolated by canteenId.
// ---------------------------------------------------------------------------
const CATEGORIES = ['Tiffins', 'Meals', 'Drinks', 'Snacks', 'Desserts'];

const menuSchema = new mongoose.Schema({
  canteen: { type: mongoose.Schema.Types.ObjectId, ref: 'Canteen', required: true },
  name: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 0, default: 0 },
  category: { type: String, required: true, enum: CATEGORIES }
}, { timestamps: true });

// A given canteen shouldn't have two items with the exact same name —
// uniqueness is per-canteen, not global.
menuSchema.index({ canteen: 1, name: 1 }, { unique: true });

// ---------------------------------------------------------------------------
// Order — scoped to one canteen. Token numbers only need to be unique
// *within* an active canteen's active orders, not globally.
// ---------------------------------------------------------------------------
const orderItemSchema = new mongoose.Schema({
  menuItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Menu' },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String },
  cartQuantity: { type: Number, required: true, min: 1 }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  canteen: { type: mongoose.Schema.Types.ObjectId, ref: 'Canteen', required: true },
  token: { type: Number, required: true },
  studentEmail: { type: String, required: true, lowercase: true, trim: true },
  items: { type: [orderItemSchema], required: true },
  total: { type: Number, required: true },
  status: {
    type: String,
    enum: ['Preparing', 'Ready', 'Completed', 'Cancelled'],
    default: 'Preparing'
  }
}, { timestamps: true });

// Token uniqueness is per-canteen (two different canteens can both have a
// "#412" in flight at the same time without conflict).
orderSchema.index({ canteen: 1, token: 1 });

module.exports = {
  Canteen: mongoose.model('Canteen', canteenSchema),
  Manager: mongoose.model('Manager', managerSchema),
  Chef: mongoose.model('Chef', chefSchema),
  Student: mongoose.model('Student', studentSchema),
  Menu: mongoose.model('Menu', menuSchema),
  Order: mongoose.model('Order', orderSchema),
  CATEGORIES
};
