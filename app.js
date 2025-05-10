import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import moment from 'moment';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import cron from 'node-cron';

// Configuración de variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Configuración de la base de datos
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Para SSL si es necesario
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

// Validación de configuración de base de datos
if (!dbConfig.host || !dbConfig.user || !dbConfig.database) {
  console.error('Error: Configuración de base de datos incompleta');
  process.exit(1);
}

// Crear pool de conexiones
const pool = mysql.createPool(dbConfig);

// Middlewares de seguridad
app.use(helmet());
app.use(morgan('combined'));

// Configuración CORS
const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || [
  'http://localhost:5173',
  'https://fitbox-front.netlify.app'
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// Limitador de tasa para prevenir ataques de fuerza bruta
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // límite de 100 solicitudes por IP
  message: 'Demasiadas solicitudes desde esta IP, por favor intente más tarde'
});
app.use(limiter);

app.use(express.json({ limit: '10kb' }));

// Validar conexión a la base de datos
const testDatabaseConnection = async () => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.ping();
    console.log('Conexión a la base de datos establecida correctamente');
  } catch (error) {
    console.error('Error al conectar a la base de datos:', error);
    throw error;
  } finally {
    if (connection) connection.release();
  }
};

// Inicialización de la base de datos
const initializeDatabase = async () => {
  let connection;
  try {
    await testDatabaseConnection();
    connection = await pool.getConnection();

    await connection.query('CREATE DATABASE IF NOT EXISTS ??', [dbConfig.database]);
    await connection.query('USE ??', [dbConfig.database]);

    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    await connection.query('DROP TABLE IF EXISTS pago_parcial');
    await connection.query('DROP TABLE IF EXISTS cuota');
    await connection.query('DROP TABLE IF EXISTS membresia');
    await connection.query('DROP TABLE IF EXISTS persona');
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS persona (
        id_persona INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        apellido VARCHAR(100) NOT NULL,
        DNI VARCHAR(20) NOT NULL UNIQUE,
        lesiones TEXT,
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        telefono_tutor VARCHAR(20),
        es_menor BOOLEAN DEFAULT FALSE,
        INDEX idx_dni (DNI),
        INDEX idx_nombre_apellido (nombre, apellido)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS cuota (
        id_cuota INT AUTO_INCREMENT PRIMARY KEY,
        id_persona INT NOT NULL,
        fecha DATE NOT NULL,
        monto_total DECIMAL(10, 2) NOT NULL,
        monto_pagado DECIMAL(10, 2) NOT NULL DEFAULT 0,
        saldo_pendiente DECIMAL(10, 2) GENERATED ALWAYS AS (monto_total - monto_pagado) STORED,
        mes_pagado VARCHAR(20) NOT NULL,
        hora_pago DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (id_persona) REFERENCES persona(id_persona) ON DELETE CASCADE,
        INDEX idx_fecha (fecha),
        INDEX idx_mes_pagado (mes_pagado)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS pago_parcial (
        id_pago_parcial INT AUTO_INCREMENT PRIMARY KEY,
        id_cuota INT NOT NULL,
        monto DECIMAL(10, 2) NOT NULL,
        metodo_pago ENUM('efectivo', 'transferencia') NOT NULL,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (id_cuota) REFERENCES cuota(id_cuota) ON DELETE CASCADE,
        INDEX idx_metodo_pago (metodo_pago)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS membresia (
        id_membresia INT AUTO_INCREMENT PRIMARY KEY,
        id_persona INT NOT NULL,
        tipo ENUM('mensual', 'trimestral', 'anual') NOT NULL,
        fecha_inicio DATE NOT NULL,
        fecha_fin DATE NOT NULL,
        estado ENUM('activa', 'vencida', 'cancelada') DEFAULT 'activa',
        FOREIGN KEY (id_persona) REFERENCES persona(id_persona) ON DELETE CASCADE,
        INDEX idx_fecha_fin (fecha_fin),
        INDEX idx_estado (estado)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    console.log('Base de datos y tablas creadas correctamente');
  } catch (error) {
    console.error('Error en inicialización de base de datos:', error);
    throw error;
  } finally {
    if (connection) connection.release();
  }
};

// Función para eliminar personas inactivas por más de 3 meses
const eliminarPersonasInactivas = async () => {
  let connection;
  try {
    connection = await pool.getConnection();
    const fechaLimite = moment().subtract(3, 'months').format('YYYY-MM-DD');
    
    const [personasInactivas] = await connection.query(`
      SELECT p.id_persona 
      FROM persona p
      LEFT JOIN cuota c ON p.id_persona = c.id_persona
      GROUP BY p.id_persona
      HAVING MAX(c.fecha) IS NULL OR MAX(c.fecha) < ?`,
      [fechaLimite]
    );
    
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

// Configurar el cron job después de definir la función
cron.schedule('0 2 * * *', () => {
  console.log('Ejecutando limpieza automática de inactivos...');
  eliminarPersonasInactivas()
    .then(result => console.log(`Resultado: ${result.deleted} eliminados`))
    .catch(err => console.error('Error en limpieza automática:', err));
});

// Middleware para validar datos de entrada
const validateClientData = (req, res, next) => {
  const { nombre, apellido, DNI } = req.body;

  if (!nombre || !apellido || !DNI) {
    return res.status(400).json({
      success: false,
      error: 'Nombre, apellido y DNI son obligatorios'
    });
  }

  if (!/^[0-9]{7,8}$/.test(DNI)) {
    return res.status(400).json({
      success: false,
      error: 'DNI debe contener 7 u 8 dígitos'
    });
  }

  next();
};

// Middleware para validar datos de pago
const validatePaymentData = (req, res, next) => {
  const { id_persona, monto_total, fecha_pago } = req.body;

  if (!id_persona || !monto_total || !fecha_pago) {
    return res.status(400).json({
      success: false,
      error: 'ID de persona, monto total y fecha son obligatorios'
    });
  }

  if (isNaN(monto_total)) {
    return res.status(400).json({
      success: false,
      error: 'Monto total debe ser un número válido'
    });
  }

  if (!moment(fecha_pago, 'YYYY-MM-DD', true).isValid()) {
    return res.status(400).json({
      success: false,
      error: 'Fecha inválida, debe estar en formato YYYY-MM-DD'
    });
  }

  next();
};

// Endpoint para ejecutar manualmente la limpieza
app.post('/admin/limpieza-inactivos', async (req, res) => {
  try {
    const result = await eliminarPersonasInactivas();
    res.json({ 
      success: true,
      message: `Limpieza completada. ${result.deleted} clientes eliminados.`,
      deleted: result.deleted
    });
  } catch (error) {
    console.error('Error en limpieza manual:', error);
    res.status(500).json({ 
      success: false,
      error: 'Error al ejecutar limpieza',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Ruta para verificar estado del servidor
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Backend FitBox funcionando correctamente',
    environment: process.env.NODE_ENV,
    availableRoutes: [
      '/personas - POST (registrar cliente)',
      '/pagos - POST (registrar pago)',
      '/clientes - GET (listar clientes)',
      '/clientes/:id - GET (detalle cliente)',
      '/health - GET (estado del servidor)'
    ]
  });
});

// Ruta para registrar clientes
app.post('/personas', validateClientData, async (req, res) => {
  let connection;
  try {
    const { nombre, apellido, DNI, lesiones, telefono_tutor, es_menor } = req.body;

    connection = await pool.getConnection();

    // Verificar si el DNI ya existe
    const [existing] = await connection.query(
      'SELECT id_persona FROM persona WHERE DNI = ? LIMIT 1',
      [DNI]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'El DNI ya está registrado'
      });
    }

    const [result] = await connection.query(
      `INSERT INTO persona (nombre, apellido, DNI, lesiones, telefono_tutor, es_menor) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nombre, apellido, DNI, lesiones || null, telefono_tutor || null, es_menor || false]
    );

    res.status(201).json({
      success: true,
      message: 'Cliente registrado exitosamente',
      id: result.insertId
    });
  } catch (error) {
    console.error('Error al registrar cliente:', error);

    res.status(500).json({
      success: false,
      error: 'Error al registrar cliente',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    if (connection) connection.release();
  }
});

// Ruta para registrar pagos
app.post('/pagos', validatePaymentData, async (req, res) => {
  let connection;
  try {
    const { id_persona, monto_total, metodo_pago, fecha_pago, pagos_parciales } = req.body;

    const fecha = moment(fecha_pago).format('YYYY-MM-DD');
    const mes_pagado = moment(fecha_pago).format('MMMM YYYY');
    const montoTotalNum = parseFloat(monto_total);

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Insertar la cuota principal
    const [cuotaResult] = await connection.query(
      `INSERT INTO cuota (id_persona, fecha, monto_total, mes_pagado) 
       VALUES (?, ?, ?, ?)`,
      [id_persona, fecha, montoTotalNum, mes_pagado]
    );

    const id_cuota = cuotaResult.insertId;
    let monto_pagado = 0;

    // 2. Procesar pagos parciales
    if (pagos_parciales?.length > 0) {
      for (const pago of pagos_parciales) {
        const montoParcial = parseFloat(pago.monto);
        monto_pagado += montoParcial;

        await connection.query(
          `INSERT INTO pago_parcial (id_cuota, monto, metodo_pago) 
           VALUES (?, ?, ?)`,
          [id_cuota, montoParcial, pago.metodo_pago]
        );
      }
    } else {
      // Pago completo
      monto_pagado = montoTotalNum;
      await connection.query(
        `INSERT INTO pago_parcial (id_cuota, monto, metodo_pago) 
         VALUES (?, ?, ?)`,
        [id_cuota, montoTotalNum, metodo_pago || 'efectivo']
      );
    }

    // 3. Validar y actualizar monto pagado
    if (monto_pagado > montoTotalNum) {
      throw new Error('El monto pagado no puede exceder el monto total');
    }

    // 4. Actualizar monto pagado (esto activará el cálculo automático de saldo_pendiente)
    await connection.query(
      `UPDATE cuota SET monto_pagado = ? WHERE id_cuota = ?`,
      [monto_pagado, id_cuota]
    );

    // 5. Actualizar membresía si es necesario
    await connection.query(`
      UPDATE membresia 
      SET estado = 'activa'
      WHERE id_persona = ? AND estado = 'vencida'`,
      [id_persona]
    );

    await connection.commit();

    res.status(201).json({
      success: true,
      message: 'Pago registrado exitosamente',
      id: id_cuota
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Error al registrar pago:', error);
    res.status(500).json({
      success: false,
      error: 'Error al registrar pago',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    if (connection) connection.release();
  }
});

// Endpoint para listar clientes
app.get('/clientes', async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [results] = await connection.query(`
      SELECT 
        p.id_persona,
        p.nombre,
        p.apellido,
        CONCAT(p.nombre, ' ', p.apellido) as nombre_completo,
        p.DNI,
        COALESCE(p.telefono_tutor, '') as telefono,
        DATE_FORMAT(p.fecha_registro, '%Y-%m-%d %H:%i:%s') as fecha_registro,
        DATE_FORMAT(ultima_cuota.fecha, '%Y-%m-%d') as ultimo_pago,
        COALESCE(SUM(c.monto_pagado), 0) as total_pagado,
        COALESCE(SUM(c.monto_total), 0) as monto_total,
        ultima_cuota.saldo_pendiente as saldo_pendiente,  -- Solo el saldo de la última cuota
        CASE 
          WHEN ultima_cuota.fecha IS NULL THEN 'No Pagado'
          WHEN ultima_cuota.saldo_pendiente > 0 THEN 
            CONCAT('DEBE: $', FORMAT(ultima_cuota.saldo_pendiente, 2))
          WHEN DATEDIFF(CURDATE(), ultima_cuota.fecha) > 30 THEN 'Vencido'
          ELSE 'Al día'
        END as estado_pago
      FROM persona p
      LEFT JOIN cuota c ON p.id_persona = c.id_persona
      LEFT JOIN (
        SELECT id_persona, fecha, saldo_pendiente 
        FROM cuota 
        WHERE (id_persona, fecha) IN (
          SELECT id_persona, MAX(fecha) 
          FROM cuota 
          GROUP BY id_persona
        )
      ) ultima_cuota ON p.id_persona = ultima_cuota.id_persona
      GROUP BY p.id_persona
      ORDER BY p.nombre`);

    const processedResults = results.map(client => ({
      ...client,
      total_pagado: parseFloat(client.total_pagado),
      monto_total: parseFloat(client.monto_total),
      saldo_pendiente: parseFloat(client.saldo_pendiente)
    }));

    res.json({
      success: true,
      data: processedResults
    });
  } catch (error) {
    console.error('Error al obtener clientes:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener lista de clientes',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    if (connection) connection.release();
  }
});

// Endpoint para buscar clientes
app.get('/buscar-cliente', async (req, res) => {
  let connection;
  try {
    const { query } = req.query;
    const searchTerm = `%${query.trim()}%`;

    connection = await pool.getConnection();
    const [results] = await connection.query(`
      SELECT 
        p.id_persona,
        CONCAT(p.nombre, ' ', p.apellido) as nombre_completo,
        p.DNI,
        COALESCE(p.telefono_tutor, '') as telefono,
        DATE_FORMAT(ultima_cuota.fecha, '%Y-%m-%d') as ultimo_pago,
        COALESCE(SUM(c.monto_pagado), 0) as total_pagado,
        ultima_cuota.saldo_pendiente as saldo_pendiente,  -- Solo el saldo de la última cuota
        CASE 
          WHEN ultima_cuota.fecha IS NULL THEN 'No Pagado'
          WHEN ultima_cuota.saldo_pendiente > 0 THEN 
            CONCAT('DEBE: $', FORMAT(ultima_cuota.saldo_pendiente, 2))
          WHEN DATEDIFF(CURDATE(), ultima_cuota.fecha) > 30 THEN 'Vencido'
          ELSE 'Al día'
        END as estado_pago
      FROM persona p
      LEFT JOIN cuota c ON p.id_persona = c.id_persona
      LEFT JOIN (
        SELECT id_persona, fecha, saldo_pendiente 
        FROM cuota 
        WHERE (id_persona, fecha) IN (
          SELECT id_persona, MAX(fecha) 
          FROM cuota 
          GROUP BY id_persona
        )
      ) ultima_cuota ON p.id_persona = ultima_cuota.id_persona
      WHERE p.nombre LIKE ? OR p.apellido LIKE ? OR p.DNI LIKE ?
      GROUP BY p.id_persona
      LIMIT 10`, [searchTerm, searchTerm, searchTerm]);

    const processedResults = results.map(client => ({
      ...client,
      total_pagado: parseFloat(client.total_pagado),
      saldo_pendiente: parseFloat(client.saldo_pendiente)
    }));

    res.json({
      success: true,
      data: processedResults
    });
  } catch (error) {
    console.error('Error en búsqueda:', error);
    res.status(500).json({
      success: false,
      error: 'Error al buscar cliente',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    if (connection) connection.release();
  }
});

// Endpoint para detalles del cliente
app.get('/clientes/:id', async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    connection = await pool.getConnection();

    const [clientData] = await connection.query(`
      SELECT 
        p.*,
        COALESCE(SUM(c.monto_pagado), 0) as total_pagado,
        COALESCE(SUM(c.monto_total), 0) as monto_total,
        ultima_cuota.saldo_pendiente as saldo_pendiente,  -- Solo el saldo de la última cuota
        DATE_FORMAT(ultima_cuota.fecha, '%Y-%m-%d') as ultimo_pago,
        (SELECT COUNT(*) FROM cuota WHERE id_persona = p.id_persona) as total_pagos,
        DATE_FORMAT(p.fecha_registro, '%Y-%m-%d %H:%i:%s') as fecha_registro_formatted
      FROM persona p
      LEFT JOIN cuota c ON p.id_persona = c.id_persona
      LEFT JOIN (
        SELECT id_persona, fecha, saldo_pendiente 
        FROM cuota 
        WHERE id_persona = ? 
        ORDER BY fecha DESC 
        LIMIT 1
      ) ultima_cuota ON p.id_persona = ultima_cuota.id_persona
      WHERE p.id_persona = ?`, [id, id]);

    if (clientData.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado'
      });
    }

    const client = clientData[0];
    const estado_pago = calcularEstadoPago(client);

    res.json({
      success: true,
      data: {
        ...client,
        estado_pago,
        total_pagado: parseFloat(client.total_pagado),
        monto_total: parseFloat(client.monto_total),
        saldo_pendiente: parseFloat(client.saldo_pendiente),
        fecha_registro: client.fecha_registro_formatted
      }
    });
  } catch (error) {
    console.error('Error al obtener cliente:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener cliente',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    if (connection) connection.release();
  }
});

function calcularEstadoPago(cliente) {
  if (!cliente.ultimo_pago) return 'No Pagado';

  const saldo = parseFloat(cliente.saldo_pendiente);
  if (saldo > 0) return `DEBE: $${saldo.toFixed(2)}`;

  const diffDays = moment().diff(moment(cliente.ultimo_pago), 'days');
  return diffDays > 30 ? 'Vencido' : 'Al día';
}

// Endpoint para pagos detallados
app.get('/clientes/:id/pagos-detallados', async (req, res) => {
  let connection;
  try {
    const { id } = req.params;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'ID de cliente inválido'
      });
    }

    connection = await pool.getConnection();

    // Verificar que el cliente existe primero
    const [clientCheck] = await connection.query(
      'SELECT id_persona FROM persona WHERE id_persona = ?',
      [id]
    );

    if (clientCheck.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado'
      });
    }

    const [payments] = await connection.query(`
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
      ORDER BY c.fecha DESC`, [id]);

    const processedPayments = payments.map(payment => ({
      ...payment,
      monto_total: parseFloat(payment.monto_total),
      monto_pagado: parseFloat(payment.monto_pagado),
      saldo_pendiente: parseFloat(payment.saldo_pendiente),
      detalle_pagos: payment.detalle_pagos
        ? payment.detalle_pagos.split('|')
        : []
    }));

    res.json({
      success: true,
      data: processedPayments
    });
  } catch (error) {
    console.error('Error al obtener pagos detallados:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener historial de pagos',
      details: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        sqlError: error.sqlMessage
      } : undefined
    });
  } finally {
    if (connection) connection.release();
  }
});

// Middleware para manejo de rutas no encontradas
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Ruta no encontrada'
  });
});

// Inicializar y arrancar el servidor
const startServer = async () => {
  try {
    await initializeDatabase();

    app.listen(PORT, () => {
      console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
      console.log(`Entorno: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Error crítico durante la inicialización:', error);
    process.exit(1);
  }
};

// Manejo de cierre
const shutdown = async () => {
  try {
    await pool.end();
    console.log('\nPool de conexiones cerrado');
    process.exit(0);
  } catch (error) {
    console.error('Error al cerrar conexión:', error);
    process.exit(1);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startServer();