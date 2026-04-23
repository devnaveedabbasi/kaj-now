import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as service from '../../controllers/provider/service.controller.js'
import * as adminController from '../../controllers/admin/admin.controller.js'
const router = Router();

router.get('/all-categories', asyncHandler(service.getAllCategories));
router.get('/by-category/:categoryId', asyncHandler(service.getServicesByCategory));
router.get('/dashboard/stats', asyncHandler(adminController.getAdminDashboardStats));
router.get('/logs', asyncHandler(adminController.getActivityLogs));

// User management
router.get('/users', asyncHandler(adminController.getAllUsers));
router.get('/users/stats', asyncHandler(adminController.getUserStats));
router.get('/users/:userId', asyncHandler(adminController.getUserById));
router.put('/users/:userId/status', asyncHandler(adminController.updateUserStatus));
router.delete('/users/:userId', asyncHandler(adminController.deleteUser));

// Provider management
router.get('/providers', asyncHandler(adminController.getAllProviders));
router.get('/providers/:providerId', asyncHandler(adminController.getProviderById));
router.put('/providers/:providerId/kyc/approve', asyncHandler(adminController.approveProviderKyc));
router.put('/providers/:providerId/kyc/suspend', asyncHandler(adminController.suspendProviderKyc));
router.put('/providers/:providerId/kyc/reject', asyncHandler(adminController.rejectProviderKyc));
export default router;