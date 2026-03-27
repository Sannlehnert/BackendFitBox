import * as personaModel from '../models/personaModel.js';

export const registrarCliente = async (data) => {
  const { nombre, apellido, DNI, lesiones, telefono_tutor, es_menor } = data;

  // Validaciones
  if (!nombre || !apellido || !DNI) {
    throw { status: 400, error: 'Nombre, apellido y DNI son obligatorios' };
  }
  if (!/^[0-9]{7,8}$/.test(DNI)) {
    throw { status: 400, error: 'DNI debe contener 7 u 8 dígitos' };
  }
  if (nombre.length > 100 || apellido.length > 100) {
    throw { status: 400, error: 'Nombre y apellido no pueden exceder 100 caracteres' };
  }

  const existing = await personaModel.findByDNI(DNI);
  if (existing) {
    throw { status: 409, error: 'El DNI ya está registrado' };
  }

  const id = await personaModel.insert({ nombre, apellido, DNI, lesiones, telefono_tutor, es_menor });
  return { success: true, message: 'Cliente registrado exitosamente', id };
};

export const listarClientes = async () => {
  return await personaModel.findAllWithStats();
};

export const buscarCliente = async (query) => {
  return await personaModel.search(query);
};

export const obtenerCliente = async (id) => {
  const cliente = await personaModel.findById(id);
  if (!cliente) {
    throw { status: 404, error: 'Cliente no encontrado' };
  }
  const pagos = await import('../models/cuotaModel.js').then(m => m.findAllByPersona(id));
  return { ...cliente, pagos };
};