import { pool } from '../config/database.js';

export const findByDNI = async (DNI) => {
  const [rows] = await pool.query(
    'SELECT id_persona FROM persona WHERE DNI = ? LIMIT 1',
    [DNI]
  );
  return rows[0];
};

export const insert = async (data) => {
  const { nombre, apellido, DNI, lesiones, telefono_tutor, es_menor } = data;
  const [result] = await pool.query(
    `INSERT INTO persona (nombre, apellido, DNI, lesiones, telefono_tutor, es_menor)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [nombre, apellido, DNI, lesiones || null, telefono_tutor || null, es_menor || false]
  );
  return result.insertId;
};

export const findById = async (id) => {
  const [rows] = await pool.query(
    'SELECT * FROM persona WHERE id_persona = ?',
    [id]
  );
  return rows[0];
};

export const findAllWithStats = async () => {
  const [rows] = await pool.query(`
    SELECT
      p.id_persona,
      p.nombre,
      p.apellido,
      CONCAT(p.nombre, ' ', p.apellido) as nombre_completo,
      p.DNI,
      COALESCE(p.telefono_tutor, '') as telefono,
      DATE_FORMAT(p.fecha_registro, '%Y-%m-%d %H:%i:%s') as fecha_registro,
      DATE_FORMAT(MAX(c.fecha), '%Y-%m-%d') as ultimo_pago,
      COALESCE(SUM(c.monto_pagado), 0) as total_pagado,
      COALESCE(SUM(c.monto_total), 0) as monto_total,
      COALESCE(SUM(c.saldo_pendiente), 0) as saldo_pendiente,
      CASE
        WHEN MAX(c.fecha) IS NULL THEN 'No Pagado'
        WHEN SUM(c.saldo_pendiente) > 0 THEN
          CONCAT('DEBE: $', FORMAT(SUM(c.saldo_pendiente), 2))
        WHEN DATEDIFF(CURDATE(), MAX(c.fecha)) > 30 THEN 'Vencido'
        ELSE 'Al día'
      END as estado_pago
    FROM persona p
    LEFT JOIN cuota c ON p.id_persona = c.id_persona
    GROUP BY p.id_persona
    ORDER BY p.nombre
  `);
  return rows.map(r => ({
    ...r,
    total_pagado: parseFloat(r.total_pagado),
    monto_total: parseFloat(r.monto_total),
    saldo_pendiente: parseFloat(r.saldo_pendiente)
  }));
};

export const search = async (term) => {
  const searchTerm = `%${term}%`;
  const [rows] = await pool.query(
    `SELECT
       p.id_persona,
       CONCAT(p.nombre, ' ', p.apellido) as nombre_completo,
       p.DNI,
       (SELECT MAX(fecha) FROM cuota WHERE id_persona = p.id_persona) as ultimo_pago
     FROM persona p
     WHERE p.nombre LIKE ? OR p.apellido LIKE ? OR p.DNI LIKE ?
     LIMIT 10`,
    [searchTerm, searchTerm, searchTerm]
  );
  return rows;
};