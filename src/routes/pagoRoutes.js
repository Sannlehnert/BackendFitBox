import express from 'express';
import { authenticate } from '../middlewares/auth.js';
import { validatePaymentData } from '../middlewares/validators.js';
import {
  registrarPago,
  obtenerPagosDetallados
} from '../controllers/pagoController.js';

const router = express.Router();

router.use(authenticate);

router.post('/pagos', validatePaymentData, registrarPago);
router.get('/clientes/:id/pagos-detallados', obtenerPagosDetallados);

export default router;