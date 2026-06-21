const mongoose = require('mongoose');

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true } // plain text by explicit request — see README security note
}, { timestamps: true });

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------
const chefSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true }
}, { timestamps: true });

// ---------------------------------------------------------------------------
// Student
// ---------------------------------------------------------------------------
const studentSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true }
}, { timestamps: true });

// ---------------------------------------------------------------------------
// Menu item
// ---------------------------------------------------------------------------
const CATEGORIES = ['Tiffins', 'Meals', 'Drinks', 'Snacks', 'Desserts'];

const menuSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 0, default: 0 }, // stock on hand
  category: { type: String, required: true, enum: CATEGORIES }
}, { timestamps: true });

// ---------------------------------------------------------------------------
// Order — the real, persisted source of truth (replaces localStorage orderHistory)
// ---------------------------------------------------------------------------
const orderItemSchema = new mongoose.Schema({
  menuItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Menu' },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String },
  cartQuantity: { type: Number, required: true, min: 1 }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  token: { type: Number, required: true, unique: true },
  studentEmail: { type: String, required: true, lowercase: true, trim: true },
  items: { type: [orderItemSchema], required: true },
  total: { type: Number, required: true },
  status: {
    type: String,
    enum: ['Preparing', 'Ready', 'Completed', 'Cancelled'],
    default: 'Preparing'
  }
}, { timestamps: true });

module.exports = {
  Admin: mongoose.model('Admin', adminSchema),
  Chef: mongoose.model('Chef', chefSchema),
  Student: mongoose.model('Student', studentSchema),
  Menu: mongoose.model('Menu', menuSchema),
  Order: mongoose.model('Order', orderSchema),
  CATEGORIES
};
