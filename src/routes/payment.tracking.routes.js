import { Router } from 'express';
import * as paymentTrackingController from '../controllers/payment.tracking.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authMiddleware as authenticateToken } from '../middleware/auth.js';

const router = Router();

// Get single payment tracking details (public - no auth required)
router.get('/track/:paymentId', asyncHandler(paymentTrackingController.getPaymentTracking));

// Get customer's payment history with refund status
router.get('/history/customer', authenticateToken, asyncHandler(paymentTrackingController.getCustomerPaymentHistory));

// Admin: Get all payments with filtering
router.get('/admin/all', authenticateToken, asyncHandler(paymentTrackingController.getAllPaymentsAdmin));

// Admin: Get refund history/audit trail
router.get('/admin/refunds', authenticateToken, asyncHandler(paymentTrackingController.getRefundHistory));

export default router;
