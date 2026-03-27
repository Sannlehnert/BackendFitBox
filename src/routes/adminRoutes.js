import express from 'express';
import { authenticate } from '../middlewares/auth.js';
import { limpiezaInactivos } from '../controllers/adminController.js';

const router = express.Router();

router.use(authenticate);

router.post('/limpieza-inactivos', limpiezaInactivos);

export default router;