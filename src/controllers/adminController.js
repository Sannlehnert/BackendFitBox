import { eliminarPersonasInactivas } from '../services/limpiezaService.js';

export const limpiezaInactivos = async (req, res, next) => {
  try {
    const result = await eliminarPersonasInactivas();
    res.json({
      success: true,
      message: `Limpieza completada. ${result.deleted} clientes eliminados.`,
      deleted: result.deleted
    });
  } catch (error) {
    next(error);
  }
};