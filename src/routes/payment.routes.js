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

// ====================================================
// CUSTOMER & PROVIDER ENDPOINTS
// ====================================================

// Get payment history
router.get('/history', authenticateToken, asyncHandler(paymentController.getPaymentHistory));

// Get payment details
router.get('/:paymentId/details', authenticateToken, asyncHandler(paymentController.getPaymentDetails));

// ====================================================
// ADMIN ENDPOINTS
// ====================================================

// Refund payment to customer
router.post('/:paymentId/refund', authenticateToken, requireRole('admin'), asyncHandler(paymentController.refundPayment));

// Get payment summary
router.get('/admin/summary', authenticateToken, requireRole('admin'), asyncHandler(paymentController.getPaymentSummary));

export default router;