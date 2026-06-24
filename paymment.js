const crypto = require('crypto');
const express = require('express');
const Razorpay = require('razorpay');

const PaymentIntent = require('../models/PaymentIntent');
// const { Order } = require('../models'); // <-- uncomment once you share your Order model,
                                             //     see createOrderFromPaymentIntent() below.

const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
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
      keyId: process.env.RAZORPAY_KEY_ID
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
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

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

      const createdOrder = await createOrderFromPaymentIntent(intent, razorpayPaymentId, req.io);

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
// >>> WIRE IN YOUR REAL ORDER MODEL HERE <<<
//
// This is the one function that needs your actual Order schema / routes
// logic from routes/orders.js. Once you share that file, replace the body
// below with the same creation logic POST /api/orders currently uses
// (token generation, schema fields, etc.) so behavior stays identical
// regardless of whether the student paid via Razorpay or (if you keep it)
// any other path.
//
// Must return the created order, with at least `_id` and `token` populated,
// since those are sent back to the cart page via the status-poll endpoint.
// ---------------------------------------------------------------------------
async function createOrderFromPaymentIntent(intent, razorpayPaymentId, io) {
  throw new Error(
    'createOrderFromPaymentIntent() is not implemented yet — wire in your real Order model/logic here once you share models/Order.js and routes/orders.js.'
  );

  // Example shape, once your Order model is available:
  //
  // const order = await new Order({
  //   studentEmail: intent.studentEmail,
  //   canteenId: intent.canteenId,
  //   items: intent.items,
  //   token: await getNextToken(intent.canteenId), // match your existing token logic
  //   paymentStatus: 'paid',
  //   razorpayOrderId: intent.razorpayOrderId,
  //   razorpayPaymentId
  // }).save();
  //
  // if (io) {
  //   io.to(`kitchen:${intent.canteenId}`).emit('new-order', order);
  // }
  //
  // return order;
}

module.exports = router;
module.exports.paymentStatusWebhookHandler = paymentStatusWebhookHandler;
module.exports.webhookRawBodyParser = express.raw({ type: 'application/json' });