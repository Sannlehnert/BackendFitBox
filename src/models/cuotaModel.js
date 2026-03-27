import { pool } from '../config/database.js';

export const findPendienteByPersona = async (id_persona) => {
  const [rows] = await pool.query(
    `SELECT id_cuota, monto_total, monto_pagado
     FROM cuota
     WHERE id_persona = ? AND saldo_pendiente > 0
     ORDER BY fecha ASC LIMIT 1`,
    [id_persona]
  );
  return rows[0];
};

export const insert = async (id_persona, fecha, monto_total, mes_pagado) => {
  const [result] = await pool.query(
    `INSERT INTO cuota (id_persona, fecha, monto_total, mes_pagado)
     VALUES (?, ?, ?, ?)`,
    [id_persona, fecha, monto_total, mes_pagado]
  );
  return result.insertId;
};

export const updateMontoPagado = async (id_cuota, incremento) => {
  await pool.query(
    `UPDATE cuota SET monto_pagado = monto_pagado + ? WHERE id_cuota = ?`,
    [incremento, id_cuota]
  );
};

export const findById = async (id_cuota) => {
  const [rows] = await pool.query(
    `SELECT monto_total, monto_pagado FROM cuota WHERE id_cuota = ?`,
    [id_cuota]
  );
  return rows[0];
};

export const findAllByPersona = async (id_persona) => {
  const [rows] = await pool.query(
    `SELECT * FROM cuota WHERE id_persona = ? ORDER BY fecha DESC`,
    [id_persona]
  );
  return rows.map(r => ({
    ...r,
    monto_total: parseFloat(r.monto_total),
    monto_pagado: parseFloat(r.monto_pagado),
    saldo_pendiente: parseFloat(r.saldo_pendiente)
  }));
};

export const findAllWithPagosDetallados = async (id_persona) => {
  const [rows] = await pool.query(`
    SELECT
      c.id_cuota,
      DATE_FORMAT(c.fecha, '%Y-%m-%d') as fecha,
      c.monto_total,
      c.monto_pagado,
      c.saldo_pendiente,
      c.mes_pagado,
      (
        SELECT GROUP_CONCAT(CONCAT(pp.monto, ' (', pp.metodo_pago, ')') SEPARATOR '|')
        FROM pago_parcial pp
        WHERE pp.id_cuota = c.id_cuota
      ) as detalle_pagos
    FROM cuota c
    WHERE c.id_persona = ?
    ORDER BY c.fecha DESC
  `, [id_persona]);

  return rows.map(r => ({
    ...r,
    monto_total: parseFloat(r.monto_total),
    monto_pagado: parseFloat(r.monto_pagado),
    saldo_pendiente: parseFloat(r.saldo_pendiente),
    detalle_pagos: r.detalle_pagos ? r.detalle_pagos.split('|') : []
  }));
};