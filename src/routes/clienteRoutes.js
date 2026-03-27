import express from 'express';
import { authenticate } from '../middlewares/auth.js';
import { validateClientData } from '../middlewares/validators.js';
import {
  registrarCliente,
  listarClientes,
  buscarCliente,
  obtenerCliente
} from '../controllers/clienteController.js';

const router = express.Router();

// Todas las rutas de clientes requieren autenticación
router.use(authenticate);

router.post('/personas', validateClientData, registrarCliente);
router.get('/clientes', listarClientes);
router.get('/buscar-cliente', buscarCliente);
router.get('/clientes/:id', obtenerCliente);

export default router;