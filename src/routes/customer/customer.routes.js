import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as Customer from '../../controllers/customer/customer.controller.js'
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

// Browse services (public)
router.get('/all-categories', asyncHandler(Customer.getAllCategories));
router.get('/services-by-cat/:categoryId', asyncHandler(Customer.getServicesByCategory));

// Update location (private)
router.put('/location', authenticateToken, requireRole('customer'), asyncHandler(Customer.updateMyLocation));

// Booking endpoints (private - customer only)
router.post('/book-service', authenticateToken, requireRole('customer'), asyncHandler(Customer.bookService));
router.get('/my-bookings', authenticateToken, requireRole('customer'), asyncHandler(Customer.getMyBookings));
router.get('/bookings/:bookingId', authenticateToken, requireRole('customer'), asyncHandler(Customer.getBookingDetails));
router.get('/bookings/:bookingId/track', authenticateToken, requireRole('customer'), asyncHandler(Customer.trackBooking));
router.delete('/bookings/:bookingId', authenticateToken, requireRole('customer'), asyncHandler(Customer.cancelBooking));

export default router;
