import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import moment from 'moment';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import cron from 'node-cron';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

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
  connectionLimit: 20,
  queueLimit: 0,
  acquireTimeout: 10000,
  timeout: 10000,
  reconnect: true,
  // Solo usar SSL en producción si está configurado
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
};

// Crear pool de conexiones
const pool = mysql.createPool(dbConfig);

// Middlewares de seguridad
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// Logging mejorado
morgan.token('user-id', (req) => {
  return req.user ? req.user.username : 'anonymous';
});

app.use(morgan(':method :url :status :res[content-length] - :response-time ms - :user-id'));

// Configuración CORS mejorada
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://fit-box.netlify.app',
      'http://localhost:5173',
      'https://fitbox-front.netlify.app'
    ];

    // Permitir requests sin origin (como mobile apps o curl)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      console.log('Origen bloqueado por CORS:', origin);
      callback(new Error('Origen no permitido'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200,
  maxAge: 86400 // 24 horas de cache para preflight
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Middleware para logging de peticiones
app.use((req, res, next) => {
  console.log('\n===== Nueva Petición =====');
  console.log(`Método: ${req.method}`);
  console.log(`Ruta: ${req.originalUrl}`);
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  console.log('==========================\n');
  next();
});

// Configuración JWT
const JWT_SECRET = process.env.JWT_SECRET || 'fitbox_secreto_2025';
const JWT_EXPIRES = '8h';

// Middleware de autenticación
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Acceso no autorizado' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Token inválido o expirado',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Limitador de tasa mejorado
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // límite de 100 solicitudes por IP
  message: {
    success: false,
    error: 'Demasiadas solicitudes desde esta IP, por favor intente más tarde'
  },
  standardHeaders: true,
  legacyHeaders: false
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

// Inicialización de la base de datos (MODIFICADO: Ya no elimina las tablas)
const initializeDatabase = async () => {
  let connection;
  try {
    await testDatabaseConnection();
    connection = await pool.getConnection();

    // Crear la base de datos si no existe
    await connection.query('CREATE DATABASE IF NOT EXISTS ??', [dbConfig.database]);
    await connection.query('USE ??', [dbConfig.database]);

    // Crear tablas si no existen (MODIFICADO: Ya no se eliminan las tablas)
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
        metodo_pago ENUM('efectivo', 'transferencia', 'tarjeta') NOT NULL,
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

    console.log('Base de datos y tablas verificadas correctamente');
  } catch (error) {
    console.error('Error en inicialización de base de datos:', error);
    throw error;
  } finally {
    if (connection) connection.release();
  }
};

// Función para eliminar personas inactivas por más de 3 meses (OPCIONAL)
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

  if (nombre.length > 100 || apellido.length > 100) {
    return res.status(400).json({
      success: false,
      error: 'Nombre y apellido no pueden exceder 100 caracteres'
    });
  }

  next();
};

// Middleware para validar datos de pago
const validatePaymentData = (req, res, next) => {
  const { id_persona, monto_total, fecha_pago, pagos_parciales } = req.body;

  if (!id_persona || !monto_total || !fecha_pago) {
    return res.status(400).json({
      success: false,
      error: 'ID de persona, monto total y fecha son obligatorios'
    });
  }

  if (isNaN(monto_total) || parseFloat(monto_total) <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Monto total debe ser un número válido mayor a 0'
    });
  }

  if (!moment(fecha_pago, 'YYYY-MM-DD', true).isValid()) {
    return res.status(400).json({
      success: false,
      error: 'Fecha inválida, debe estar en formato YYYY-MM-DD'
    });
  }

  if (pagos_parciales && Array.isArray(pagos_parciales)) {
    for (const pago of pagos_parciales) {
      if (!pago.monto || isNaN(pago.monto) || parseFloat(pago.monto) <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Cada pago parcial debe tener un monto válido mayor a 0'
        });
      }
      if (!['efectivo', 'transferencia', 'tarjeta'].includes(pago.metodo_pago)) {
        return res.status(400).json({
          success: false,
          error: 'Método de pago inválido para pago parcial'
        });
      }
    }
  }

  next();
};

// Endpoint para ejecutar manualmente la limpieza (OPCIONAL)
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
app.get('/health', async (req, res) => {
  try {
    await testDatabaseConnection();
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: 'connected',
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV
    });
  } catch (error) {
    res.status(500).json({
      status: 'Error',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error.message
    });
  }
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

// Ruta de login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  // Credenciales hardcodeadas
  const validUsername = 'FitBox';
  const validPassword = 'FitBox2025';

  if (username !== validUsername || password !== validPassword) {
    return res.status(401).json({
      success: false,
      error: 'Credenciales inválidas'
    });
  }

  // Crear token JWT
  const token = jwt.sign(
    { username: validUsername },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );

  res.json({
    success: true,
    token,
    user: { username: validUsername }
  });
});

// Protege todas las rutas siguientes con el middleware de autenticación
app.use(authenticate);

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
    const { id_persona, monto_total, fecha_pago, pagos_parciales = [] } = req.body;
    const montoTotalNum = parseFloat(monto_total);

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Verificar si existe una cuota pendiente para este cliente
    const [cuotasPendientes] = await connection.query(
      `SELECT id_cuota, monto_total, monto_pagado 
       FROM cuota 
       WHERE id_persona = ? AND saldo_pendiente > 0
       ORDER BY fecha ASC LIMIT 1`,
      [id_persona]
    );

    let id_cuota;
    let montoRestante = montoTotalNum;

    if (cuotasPendientes.length > 0) {
      // Usar la cuota pendiente existente
      id_cuota = cuotasPendientes[0].id_cuota;
      const saldoPendiente = parseFloat(cuotasPendientes[0].monto_total) - parseFloat(cuotasPendientes[0].monto_pagado);

      // 2. Registrar los nuevos pagos parciales
      for (const pago of pagos_parciales) {
        const montoParcial = parseFloat(pago.monto);

        await connection.query(
          `INSERT INTO pago_parcial (id_cuota, monto, metodo_pago) 
           VALUES (?, ?, ?)`,
          [id_cuota, montoParcial, pago.metodo_pago]
        );

        // Actualizar monto pagado en la cuota
        const [updateResult] = await connection.query(
          `UPDATE cuota 
           SET monto_pagado = monto_pagado + ? 
           WHERE id_cuota = ?`,
          [montoParcial, id_cuota]
        );

        montoRestante -= montoParcial;
      }

      // Verificar si se completó el pago
      const [cuotaActualizada] = await connection.query(
        `SELECT monto_total, monto_pagado FROM cuota WHERE id_cuota = ?`,
        [id_cuota]
      );

      const nuevoSaldo = parseFloat(cuotaActualizada[0].monto_total) - parseFloat(cuotaActualizada[0].monto_pagado);

      if (nuevoSaldo <= 0 && montoRestante > 0) {
        // Crear nueva cuota si sobra monto
        const [nuevaCuota] = await connection.query(
          `INSERT INTO cuota (id_persona, fecha, monto_total, mes_pagado) 
           VALUES (?, ?, ?, ?)`,
          [id_persona, fecha_pago, montoRestante, moment(fecha_pago).format('MMMM YYYY')]
        );
        id_cuota = nuevaCuota.insertId;
      }
    } else {
      // Crear nueva cuota si no hay pendientes
      const [nuevaCuota] = await connection.query(
        `INSERT INTO cuota (id_persona, fecha, monto_total, mes_pagado) 
         VALUES (?, ?, ?, ?)`,
        [id_persona, fecha_pago, montoTotalNum, moment(fecha_pago).format('MMMM YYYY')]
      );
      id_cuota = nuevaCuota.insertId;

      // Registrar pagos parciales
      for (const pago of pagos_parciales) {
        const montoParcial = parseFloat(pago.monto);

        await connection.query(
          `INSERT INTO pago_parcial (id_cuota, monto, metodo_pago) 
           VALUES (?, ?, ?)`,
          [id_cuota, montoParcial, pago.metodo_pago]
        );

        // Actualizar monto pagado
        await connection.query(
          `UPDATE cuota 
           SET monto_pagado = monto_pagado + ? 
           WHERE id_cuota = ?`,
          [montoParcial, id_cuota]
        );
      }
    }

    await connection.commit();

    // Obtener el saldo final
    const [cuotaFinal] = await connection.query(
      `SELECT monto_total, monto_pagado FROM cuota WHERE id_cuota = ?`,
      [id_cuota]
    );

    const saldoFinal = parseFloat(cuotaFinal[0].monto_total) - parseFloat(cuotaFinal[0].monto_pagado);

    res.status(201).json({
      success: true,
      message: 'Pago registrado exitosamente',
      id: id_cuota,
      saldo_pendiente: saldoFinal.toFixed(2)
    });

  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Error en registro de pago:', error);
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

    // Query optimizada y con manejo de errores mejorado
    const [results] = await connection.query(`
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
      ORDER BY p.nombre`);

    res.json({
      success: true,
      data: results.map(client => ({
        ...client,
        total_pagado: parseFloat(client.total_pagado),
        monto_total: parseFloat(client.monto_total),
        saldo_pendiente: parseFloat(client.saldo_pendiente)
      }))
    });
  } catch (error) {
    console.error('Error en /clientes:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener clientes',
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

    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'El término de búsqueda debe tener al menos 2 caracteres'
      });
    }

    const searchTerm = `%${query.trim()}%`;
    connection = await pool.getConnection();

    const [results] = await connection.query(
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

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Error en /buscar-cliente:', error);
    res.status(500).json({
      success: false,
      error: 'Error en la búsqueda',
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

    // Validación del ID
    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'ID de cliente inválido'
      });
    }

    connection = await pool.getConnection();

    // Query para obtener datos básicos del cliente
    const [clientData] = await connection.query(
      `SELECT * FROM persona WHERE id_persona = ?`,
      [id]
    );

    if (clientData.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Cliente no encontrado'
      });
    }

    // Query para obtener información de pagos
    const [payments] = await connection.query(
      `SELECT * FROM cuota WHERE id_persona = ? ORDER BY fecha DESC`,
      [id]
    );

    res.json({
      success: true,
      data: {
        ...clientData[0],
        pagos: payments.map(p => ({
          ...p,
          monto_total: parseFloat(p.monto_total),
          monto_pagado: parseFloat(p.monto_pagado),
          saldo_pendiente: parseFloat(p.saldo_pendiente)
        }))
      }
    });
  } catch (error) {
    console.error('Error en /clientes/:id:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener cliente',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    if (connection) connection.release();
  }
});

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

// Middleware para manejo de errores CORS
app.use((err, req, res, next) => {
  console.error('Error en la aplicación:', err);

  if (err.message === 'Origen no permitido por CORS') {
    return res.status(403).json({
      success: false,
      error: 'Acceso no permitido',
      details: `Origen ${req.headers.origin} no está permitido`
    });
  }

  next(err);
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
