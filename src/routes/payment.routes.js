import { Router } from 'express';
import {
  paymentSuccess,
  paymentFailed,
  paymentCancel,
  paymentIPN,
} from '../controllers/payment.controller.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// SSLCommerz CALLBACK routes — called by SSLCommerz gateway server
// These process the payment, create/reject the job, then redirect to results
// ─────────────────────────────────────────────────────────────────────────────
router.get('/success', paymentSuccess);
router.post('/success', paymentSuccess);

router.get('/fail', paymentFailed);
router.post('/fail', paymentFailed);

router.get('/cancel', paymentCancel);
router.post('/cancel', paymentCancel);

router.post('/ipn', paymentIPN);   // Server-to-server — must return 200

export default router;