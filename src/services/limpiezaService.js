import moment from 'moment';
import cron from 'node-cron';
import { pool } from '../config/database.js';

export const eliminarPersonasInactivas = async () => {
  let connection;
  try {
    connection = await pool.getConnection();
    const fechaLimite = moment().subtract(3, 'months').format('YYYY-MM-DD');

    const [personasInactivas] = await connection.query(`
      SELECT p.id_persona
      FROM persona p
      LEFT JOIN cuota c ON p.id_persona = c.id_persona
      GROUP BY p.id_persona
      HAVING MAX(c.fecha) IS NULL OR MAX(c.fecha) < ?
    `, [fechaLimite]);

    if (personasInactivas.length === 0) {
      console.log('No hay personas inactivas para eliminar');
      return { deleted: 0 };
    }

    const idsAEliminar = personasInactivas.map(p => p.id_persona);
    const query = `DELETE FROM persona WHERE id_persona IN (${idsAEliminar.map(() => '?').join(',')})`;
    const [result] = await connection.query(query, idsAEliminar);

    console.log(`Eliminadas ${result.affectedRows} personas inactivas`);
    return { deleted: result.affectedRows };
  } catch (error) {
    console.error('Error al eliminar personas inactivas:', error);
    throw error;
  } finally {
    if (connection) connection.release();
  }
};

export const startLimpiezaCron = () => {
  cron.schedule('0 2 * * *', () => {
    console.log('Ejecutando limpieza automática de inactivos...');
    eliminarPersonasInactivas()
      .then(result => console.log(`Resultado: ${result.deleted} eliminados`))
      .catch(err => console.error('Error en limpieza automática:', err));
  });
  console.log('Cron job de limpieza iniciado (diario a las 2:00 AM)');
};