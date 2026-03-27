import * as pagoService from '../services/pagoService.js';

export const registrarPago = async (req, res, next) => {
  try {
    const result = await pagoService.registrarPago(req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

export const obtenerPagosDetallados = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, error: 'ID de cliente inválido' });
    }
    const data = await pagoService.obtenerPagosDetallados(id);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};