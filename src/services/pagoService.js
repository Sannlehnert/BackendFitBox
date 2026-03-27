import moment from 'moment';
import * as cuotaModel from '../models/cuotaModel.js';
import * as pagoParcialModel from '../models/pagoParcialModel.js';
import { pool } from '../config/database.js';

export const registrarPago = async (data) => {
  const { id_persona, monto_total, fecha_pago, pagos_parciales = [] } = data;
  const montoTotalNum = parseFloat(monto_total);

  // Validaciones básicas
  if (!id_persona || !monto_total || !fecha_pago) {
    throw { status: 400, error: 'ID de persona, monto total y fecha son obligatorios' };
  }
  if (isNaN(montoTotalNum) || montoTotalNum <= 0) {
    throw { status: 400, error: 'Monto total debe ser un número válido mayor a 0' };
  }
  if (!moment(fecha_pago, 'YYYY-MM-DD', true).isValid()) {
    throw { status: 400, error: 'Fecha inválida, debe estar en formato YYYY-MM-DD' };
  }
  for (const pago of pagos_parciales) {
    if (!pago.monto || isNaN(pago.monto) || parseFloat(pago.monto) <= 0) {
      throw { status: 400, error: 'Cada pago parcial debe tener un monto válido mayor a 0' };
    }
    if (!['efectivo', 'transferencia', 'tarjeta'].includes(pago.metodo_pago)) {
      throw { status: 400, error: 'Método de pago inválido para pago parcial' };
    }
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    let cuotaPendiente = await cuotaModel.findPendienteByPersona(id_persona);
    let id_cuota;
    let montoRestante = montoTotalNum;

    if (cuotaPendiente) {
      id_cuota = cuotaPendiente.id_cuota;
      const saldoPendiente = parseFloat(cuotaPendiente.monto_total) - parseFloat(cuotaPendiente.monto_pagado);

      for (const pago of pagos_parciales) {
        const montoParcial = parseFloat(pago.monto);
        await pagoParcialModel.insert(id_cuota, montoParcial, pago.metodo_pago);
        await cuotaModel.updateMontoPagado(id_cuota, montoParcial);
        montoRestante -= montoParcial;
      }

      const cuotaActualizada = await cuotaModel.findById(id_cuota);
      const nuevoSaldo = cuotaActualizada.monto_total - cuotaActualizada.monto_pagado;

      if (nuevoSaldo <= 0 && montoRestante > 0) {
        const nuevaId = await cuotaModel.insert(
          id_persona,
          fecha_pago,
          montoRestante,
          moment(fecha_pago).format('MMMM YYYY')
        );
        id_cuota = nuevaId;
      }
    } else {
      id_cuota = await cuotaModel.insert(
        id_persona,
        fecha_pago,
        montoTotalNum,
        moment(fecha_pago).format('MMMM YYYY')
      );

      for (const pago of pagos_parciales) {
        const montoParcial = parseFloat(pago.monto);
        await pagoParcialModel.insert(id_cuota, montoParcial, pago.metodo_pago);
        await cuotaModel.updateMontoPagado(id_cuota, montoParcial);
      }
    }

    await connection.commit();

    const cuotaFinal = await cuotaModel.findById(id_cuota);
    const saldoFinal = cuotaFinal.monto_total - cuotaFinal.monto_pagado;

    return {
      success: true,
      message: 'Pago registrado exitosamente',
      id: id_cuota,
      saldo_pendiente: saldoFinal.toFixed(2)
    };
  } catch (error) {
    if (connection) await connection.rollback();
    throw error;
  } finally {
    if (connection) connection.release();
  }
};

export const obtenerPagosDetallados = async (id_persona) => {
  // Verificar existencia del cliente
  const { findById } = await import('../models/personaModel.js');
  const cliente = await findById(id_persona);
  if (!cliente) {
    throw { status: 404, error: 'Cliente no encontrado' };
  }
  return await cuotaModel.findAllWithPagosDetallados(id_persona);
};