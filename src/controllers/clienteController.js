import * as clienteService from '../services/clienteService.js';

export const registrarCliente = async (req, res, next) => {
  try {
    const result = await clienteService.registrarCliente(req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

export const listarClientes = async (req, res, next) => {
  try {
    const data = await clienteService.listarClientes();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const buscarCliente = async (req, res, next) => {
  try {
    const { query } = req.query;
    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'El término de búsqueda debe tener al menos 2 caracteres'
      });
    }
    const data = await clienteService.buscarCliente(query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const obtenerCliente = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, error: 'ID de cliente inválido' });
    }
    const data = await clienteService.obtenerCliente(id);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};