import express from 'express';
import {
  // Card callbacks (existing)
  paymentSuccess,
  paymentFailed,
  paymentCancel,
  // bKash callbacks (new)
  bkashPaymentSuccess,
  bkashPaymentFailed,
  bkashPaymentCancel,
  bkashIpnHandler,
} from '../controllers/payment.controller.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// CARD PAYMENT CALLBACKS (existing — unchanged)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/success', paymentSuccess);
router.get('/fail', paymentFailed);
router.get('/cancel', paymentCancel);

// ─────────────────────────────────────────────────────────────────────────────
// BKASH PAYMENT CALLBACKS (new)
// SSLCommerz can POST or GET to these URLs depending on its config.
// Register both so the gateway works in all configurations.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/bkash/success', bkashPaymentSuccess);
router.post('/bkash/success', bkashPaymentSuccess);

router.get('/bkash/fail', bkashPaymentFailed);
router.post('/bkash/fail', bkashPaymentFailed);

router.get('/bkash/cancel', bkashPaymentCancel);
router.post('/bkash/cancel', bkashPaymentCancel);

// IPN is always a server-to-server POST
router.post('/bkash/ipn', bkashIpnHandler);

export default router;