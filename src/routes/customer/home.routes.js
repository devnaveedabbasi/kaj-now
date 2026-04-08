import { Router } from 'express';
import { getHome } from '../../controllers/customer/customerHome.controller.js';

const router = Router();

router.get('/home', getHome);

export default router;
