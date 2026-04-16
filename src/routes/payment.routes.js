// routes/payment.routes.js
import express from 'express';
import * as paymentController from '../controllers/payment.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../middleware/auth.js';

const router = express.Router();

// ====================================================
// CALLBACK ENDPOINTS (From Payment Gateway)
// ====================================================
router.get('/success', asyncHandler(paymentController.paymentSuccess));
router.get('/fail', asyncHandler(paymentController.paymentFailed));
router.get('/cancel', (req, res) => {
  res.redirect(`${process.env.FRONTEND_URL}/payment/cancelled`);
});


export default router;