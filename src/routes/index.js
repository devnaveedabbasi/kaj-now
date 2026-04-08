import { Router } from 'express';
import { authMiddleware as authenticateToken } from '../middleware/auth.js';

import customerAuthRoutes from './customer/auth.routes.js';
import customerHomeRoutes from './customer/home.routes.js';
import customerServiceCategoryRoutes from './customer/serviceCategory.routes.js';
import customerServiceRoutes from './customer/service.routes.js';

import adminAuthRoutes from './admin/auth.routes.js';
import {
  serviceCategoryAdminRouter,
  serviceSubcategoryAdminRouter,
} from './admin/serviceCategory.routes.js';
import adminWithdrawalRoutes from './admin/withdrawal.routes.js';

import providerAuthRoutes from './provider/auth.routes.js';
import providerServiceRoutes from './provider/service.routes.js';
import providerDashboardRoutes from './provider/dashboard.routes.js';
import providerJobRoutes from './provider/job.routes.js';
import uploadRoutes from './upload.routes.js';

const router = Router();

router.use('/auth/customer', customerAuthRoutes);
router.use('/customer', customerHomeRoutes);
router.use('/customer', customerServiceRoutes);
router.use('/auth/admin', adminAuthRoutes);
router.use('/auth/provider', providerAuthRoutes);
router.use('/provider/services', providerServiceRoutes);
router.use('/provider/dashboard', providerDashboardRoutes);
router.use('/provider', providerJobRoutes);
router.use('/upload', uploadRoutes);

router.use('/service-categories', customerServiceCategoryRoutes);
router.use('/admin/service-categories', serviceCategoryAdminRouter);
router.use('/admin/service-subcategories', serviceSubcategoryAdminRouter);
router.use('/admin', adminWithdrawalRoutes);

router.post('/update-fcm-token', authenticateToken, async (req, res) => {
  try {
    const { fcmToken } = req.body;

    if (!fcmToken) {
      return res.status(400).json({
        success: false,
        message: 'FCM token required',
      });
    }

    res.json({
      success: true,
      message: 'FCM token updated successfully',
    });
  } catch (error) {
    console.error('❌ FCM token update error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.get('/', (req, res) => {
  res.send('Hello World');
});
router.get('/test', (req, res) => {
  res.send({
    message: 'Platform detection working!',
    platform: 'kaj-now',
  });
});

export default router;
