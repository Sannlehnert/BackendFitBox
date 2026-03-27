import { pool } from '../config/database.js';

export const insert = async (id_cuota, monto, metodo_pago) => {
  const [result] = await pool.query(
    `INSERT INTO pago_parcial (id_cuota, monto, metodo_pago) VALUES (?, ?, ?)`,
    [id_cuota, monto, metodo_pago]
  );
  return result.insertId;
};