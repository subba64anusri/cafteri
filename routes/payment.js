const crypto = require('crypto');
const express = require('express');
const Razorpay = require('razorpay');

const PaymentIntent = require('../models/PaymentIntent');
const { Order, Menu } = require('../models');

const router = express.Router();

const razorpay = new Razorpay({
  key_id:"rzp_live_T5LOokxUfyhkVd",
  key_secret: "R4XhHgO6Dw95X3S8qYsPWXWK"
});

// ---------------------------------------------------------------------------
// POST /api/payment/create-order
// Called from cart.html instead of POST /api/orders. Trusts the price/items
// sent by the client as-is (no server-side recalculation against the menu —
// per explicit instruction). Creates a Razorpay order for the cart total,
// and a local PaymentIntent record so the webhook can find its way back to
// this cart later.
// ---------------------------------------------------------------------------
router.post('/create-order', async (req, res) => {
  try {
    const { studentEmail, items, canteenId } = req.body || {};

    if (!studentEmail || !canteenId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'studentEmail, canteenId and a non-empty items array are required.' });
    }

    // Trusting client-sent prices as-is, as requested. Each item is expected
    // to look like the cart shape in cart.html: { _id, name, price, cartQuantity }.
    const totalRupees = items.reduce((sum, item) => {
      const price = Number(item.price) || 0;
      const qty = Number(item.cartQuantity) || 0;
      return sum + price * qty;
    }, 0);

    if (totalRupees <= 0) {
      return res.status(400).json({ error: 'Cart total must be greater than zero.' });
    }

    // Razorpay wants the amount in the smallest currency unit (paise for INR).
    const amountInPaise = Math.round(totalRupees * 100);

    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      // receipt must be <= 40 chars for Razorpay
      receipt: `rcpt_${Date.now()}`,
      notes: {
        studentEmail,
        canteenId
      }
    });

    await PaymentIntent.create({
      razorpayOrderId: razorpayOrder.id,
      studentEmail,
      canteenId,
      items,
      amount: amountInPaise,
      currency: 'INR',
      status: 'pending'
    });

    res.status(201).json({
      razorpayOrderId: razorpayOrder.id,
      amount: amountInPaise,
      currency: 'INR',
      keyId: "rzp_live_T5LOokxUfyhkVd"
    });
  } catch (err) {
    console.error('Error creating Razorpay order:', err);
    res.status(500).json({ error: 'Could not initiate payment. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/payment/status/:razorpayOrderId
// Polled by cart.html after the Razorpay Checkout success handler fires,
// while we wait for the webhook to actually confirm + create the Order.
// ---------------------------------------------------------------------------
router.get('/status/:razorpayOrderId', async (req, res) => {
  try {
    const intent = await PaymentIntent.findOne({ razorpayOrderId: req.params.razorpayOrderId });
    if (!intent) {
      return res.status(404).json({ error: 'Payment record not found.' });
    }

    res.json({
      status: intent.status, // 'pending' | 'paid' | 'failed'
      orderId: intent.resultingOrderId,
      orderToken: intent.resultingOrderToken,
      failureReason: intent.failureReason
    });
  } catch (err) {
    console.error('Error checking payment status:', err);
    res.status(500).json({ error: 'Could not check payment status.' });
  }
});

// ---------------------------------------------------------------------------
// Webhook handler for Razorpay (server-to-server, not called by the
// browser). Configure this EXACT path in the Razorpay dashboard:
//
//     https://www.cafteri.com/api/payment_status
//
// It is exported separately (paymentStatusWebhookHandler, below) and
// mounted DIRECTLY on the app in server.js — not nested under this
// router's /api/payment prefix — both because you specified that exact
// top-level path, and because it needs express.raw() instead of
// express.json() for signature verification (see server.js wiring notes
// at the bottom of this file).
// ---------------------------------------------------------------------------
async function paymentStatusWebhookHandler(req, res) {
  const signature = req.headers['x-razorpay-signature'];
  const webhookSecret = "kjjfnkljfslfenvnjnvjkrevjejveov";

  if (!signature || !webhookSecret) {
    console.error('Webhook rejected: missing signature header or RAZORPAY_WEBHOOK_SECRET not configured.');
    return res.status(400).json({ error: 'Missing signature.' });
  }

  // req.body is a raw Buffer here (because of express.raw above), which is
  // exactly what Razorpay's HMAC was computed over. Verifying against a
  // re-parsed/re-stringified JSON object is a common bug — always verify
  // the raw bytes.
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(req.body)
    .digest('hex');

  const isValid = crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'utf8'),
    Buffer.from(signature, 'utf8')
  );

  if (!isValid) {
    console.error('Webhook rejected: signature mismatch.');
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  // Safe to parse now that the signature is verified.
  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch (err) {
    console.error('Webhook rejected: malformed JSON body.');
    return res.status(400).json({ error: 'Malformed payload.' });
  }

  // Always 200 quickly once verified+parsed, even if downstream processing
  // hits a snag — Razorpay retries on non-2xx, and we don't want it
  // hammering us if e.g. the Order model throws. We log instead.
  res.status(200).json({ received: true });

  try {
    const event = payload.event;

    if (event === 'payment.captured') {
      const paymentEntity = payload.payload.payment.entity;
      const razorpayOrderId = paymentEntity.order_id;
      const razorpayPaymentId = paymentEntity.id;
      const capturedAmount = paymentEntity.amount;

      const intent = await PaymentIntent.findOne({ razorpayOrderId });
      if (!intent) {
        console.error(`Webhook: no PaymentIntent found for order ${razorpayOrderId}`);
        return;
      }

      if (intent.status === 'paid') {
        // Already processed (duplicate webhook delivery) — Razorpay can
        // and does send the same event more than once. Just stop here.
        return;
      }

      if (capturedAmount !== intent.amount) {
        console.error(`Webhook: amount mismatch for order ${razorpayOrderId}. Expected ${intent.amount}, got ${capturedAmount}.`);
        intent.status = 'failed';
        intent.failureReason = 'Amount mismatch between Razorpay and stored payment intent.';
        await intent.save();
        return;
      }

      let createdOrder;
      try {
        createdOrder = await createOrderFromPaymentIntent(intent, razorpayPaymentId, req.io);
      } catch (orderErr) {
        console.error(`Webhook: failed to create order for paid intent ${razorpayOrderId}:`, orderErr);
        intent.status = 'failed';
        intent.razorpayPaymentId = razorpayPaymentId;
        intent.failureReason = orderErr.message || 'Could not create order after payment.';
        await intent.save();
        return;
      }

      intent.status = 'paid';
      intent.razorpayPaymentId = razorpayPaymentId;
      intent.resultingOrderId = createdOrder._id ? String(createdOrder._id) : null;
      intent.resultingOrderToken = createdOrder.token;
      await intent.save();
    }

    if (event === 'payment.failed') {
      const paymentEntity = payload.payload.payment.entity;
      const razorpayOrderId = paymentEntity.order_id;

      const intent = await PaymentIntent.findOne({ razorpayOrderId });
      if (intent && intent.status === 'pending') {
        intent.status = 'failed';
        intent.failureReason = paymentEntity.error_description || 'Payment failed.';
        await intent.save();
      }
    }
  } catch (err) {
    // Webhook response is already sent above; this just logs so it's
    // visible in server logs for manual follow-up.
    console.error('Error processing payment_status webhook:', err);
  }
}

// ---------------------------------------------------------------------------
// Mirrors generateToken() in routes/orders.js — short, canteen-scoped token,
// unique among that canteen's currently active orders, with a random
// fallback if 20 attempts all collide.
// ---------------------------------------------------------------------------
async function generateToken(canteenId) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = Math.floor(Math.random() * 900) + 100;
    const exists = await Order.findOne({
      canteen: canteenId,
      token: candidate,
      status: { $in: ['Preparing', 'Ready'] }
    });
    if (!exists) return candidate;
  }
  return Math.floor(Math.random() * 9000) + 1000;
}

// ---------------------------------------------------------------------------
// Creates the real Order once the webhook has confirmed payment.
//
// IMPORTANT DIFFERENCE from POST /api/orders in routes/orders.js: by this
// point the student has ALREADY PAID (Razorpay captured the charge against
// the cart total at checkout time). routes/orders.js can safely reject an
// order outright if stock ran out or an item is invalid, because no money
// has moved yet. We can't do that here — rejecting would mean charging
// someone and giving them nothing. So instead:
//
//   - Each item is looked up against the live Menu (matching the same
//     canteen-scoping routes/orders.js uses) to get the authoritative
//     name/price/category snapshot stored on the order — never trusting
//     the client-sent snapshot, consistent with how /api/orders behaves.
//   - If an item no longer exists in this canteen's menu at all, it's
//     dropped from the order and flagged in `stockIssues` rather than
//     failing the whole order.
//   - If stock is insufficient, the order is created for whatever quantity
//     IS available (could be 0, i.e. dropped), stock is decremented by
//     that capped amount (never negative), and the shortfall is recorded
//     in `stockIssues` for manual follow-up / refund decisions by staff.
//   - The order's `total` reflects what was actually fulfilled, which may
//     be LESS than what Razorpay captured if there were shortages. That
//     mismatch is intentionally surfaced (via stockIssues + log) rather
//     than hidden — Cafteri staff need to see it to decide on a partial
//     refund, not have it silently swallowed.
//
// Returns the created Order (Mongoose doc) plus stockIssues for logging.
// ---------------------------------------------------------------------------
async function createOrderFromPaymentIntent(intent, razorpayPaymentId, io) {
  const canteenId = intent.canteenId;
  const stockIssues = [];

  const menuIds = intent.items.map(i => i.menuItem || i._id).filter(Boolean);
  const menuDocs = await Menu.find({ _id: { $in: menuIds }, canteen: canteenId });
  const menuById = new Map(menuDocs.map(m => [String(m._id), m]));

  const verifiedItems = [];
  for (const cartItem of intent.items) {
    const id = String(cartItem.menuItem || cartItem._id || '');
    const menuDoc = menuById.get(id);
    const requestedQty = Number(cartItem.cartQuantity) || 0;

    if (!menuDoc) {
      stockIssues.push({
        name: cartItem.name || id,
        requested: requestedQty,
        fulfilled: 0,
        reason: 'Item no longer exists in this canteen\'s menu.'
      });
      continue;
    }

    const fulfillableQty = Math.max(0, Math.min(requestedQty, menuDoc.quantity));
    if (fulfillableQty < requestedQty) {
      stockIssues.push({
        name: menuDoc.name,
        requested: requestedQty,
        fulfilled: fulfillableQty,
        reason: fulfillableQty === 0 ? 'Out of stock.' : 'Only partial stock available.'
      });
    }

    if (fulfillableQty > 0) {
      verifiedItems.push({
        menuItem: menuDoc._id,
        name: menuDoc.name,
        price: menuDoc.price,
        category: menuDoc.category,
        cartQuantity: fulfillableQty
      });
    }
  }

  if (verifiedItems.length === 0) {
    // Every item was unavailable. We still must not silently lose a paid
    // transaction — log loudly so staff can refund, and surface a clear
    // failure reason via the status-poll endpoint instead of pretending
    // an order was placed.
    console.error(
      `PAID ORDER COULD NOT BE FULFILLED — refund required. ` +
      `razorpayOrderId=${intent.razorpayOrderId} razorpayPaymentId=${razorpayPaymentId} ` +
      `studentEmail=${intent.studentEmail} canteenId=${canteenId} ` +
      `stockIssues=${JSON.stringify(stockIssues)}`
    );
    throw new Error('None of the items in this order are currently available. Please contact support for a refund.');
  }

  const total = verifiedItems.reduce((sum, i) => sum + i.price * i.cartQuantity, 0);

  let order;
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = await generateToken(canteenId);
    try {
      order = new Order({
        canteen: canteenId,
        token,
        studentEmail: String(intent.studentEmail).toLowerCase().trim(),
        items: verifiedItems,
        total,
        status: 'Preparing'
      });
      await order.save();
      break;
    } catch (saveErr) {
      if (saveErr.code === 11000 && attempt < 4) continue; // duplicate token, retry
      throw saveErr;
    }
  }

  await Promise.all(verifiedItems.map(i =>
    Menu.findByIdAndUpdate(i.menuItem, { $inc: { quantity: -i.cartQuantity } })
  ));

  if (stockIssues.length > 0) {
    console.error(
      `PAID ORDER FULFILLED WITH SHORTAGES — review for partial refund. ` +
      `orderId=${order._id} token=${order.token} razorpayPaymentId=${razorpayPaymentId} ` +
      `stockIssues=${JSON.stringify(stockIssues)}`
    );
  }

  if (io) {
    io.to(`kitchen:${canteenId}`).emit('order:new', order);
    io.to(`kitchen:${canteenId}`).emit('menu:update', { type: 'stock-changed' });
  }

  return order;
}

module.exports = router;
module.exports.paymentStatusWebhookHandler = paymentStatusWebhookHandler;
module.exports.webhookRawBodyParser = express.raw({ type: 'application/json' });