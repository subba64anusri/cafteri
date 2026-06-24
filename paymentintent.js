const mongoose = require('mongoose');

// A PaymentIntent bridges the gap between "we asked Razorpay to create an
// order" (POST /api/payment/create-order) and "Razorpay told us, via
// webhook, that it was paid" (POST /api/payment_status). Those two events
// happen in completely separate HTTP requests — possibly seconds apart,
// possibly on a retpercent webhook delivery — so we need somewhere durable
// to park the cart contents until the webhook arrives and we can safely
// create the real Order.
//
// This is intentionally a *separate* model from your existing Order model.
// We never guess at your Order schema here — see routes/payment.js for the
// one clearly-marked spot where this gets converted into a real Order.
const paymentIntentSchema = new mongoose.Schema({
  // Razorpay's order id, e.g. "order_abc123". This is the join key the
  // webhook uses to find this record (payload.payload.payment.entity.order_id).
  razorpayOrderId: { type: String, required: true, unique: true, index: true },

  // Who is paying, and for what — exactly what we'll need to build the
  // real Order once payment is confirmed.
  studentEmail: { type: String, required: true },
  canteenId: { type: String, required: true },
  items: { type: Array, required: true }, // raw cart array, trusted as-is

  // Amount in paise (smallest currency unit), as sent to Razorpay. Stored so
  // the webhook can sanity-check it matches what Razorpay reports paid.
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },

  // pending -> paid (webhook confirmed + Order created) or failed
  status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending', index: true },

  // Razorpay's payment id (e.g. "pay_xyz") once captured.
  razorpayPaymentId: { type: String, default: null },

  // Filled in once we create the real Order, so the cart page's polling
  // endpoint can hand back a token/orderId to redirect with.
  resultingOrderId: { type: String, default: null },
  resultingOrderToken: { type: mongoose.Schema.Types.Mixed, default: null },

  failureReason: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('PaymentIntent', paymentIntentSchema);