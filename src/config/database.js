import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

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
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
};

export const pool = mysql.createPool(dbConfig);

export const testDatabaseConnection = async () => {
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

export const initializeDatabase = async () => {
  let connection;
  try {
    await testDatabaseConnection();
    connection = await pool.getConnection();

    await connection.query('CREATE DATABASE IF NOT EXISTS ??', [dbConfig.database]);
    await connection.query('USE ??', [dbConfig.database]);

    // Crear tablas si no existen
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS pago_parcial (
        id_pago_parcial INT AUTO_INCREMENT PRIMARY KEY,
        id_cuota INT NOT NULL,
        monto DECIMAL(10, 2) NOT NULL,
        metodo_pago ENUM('efectivo', 'transferencia', 'tarjeta') NOT NULL,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (id_cuota) REFERENCES cuota(id_cuota) ON DELETE CASCADE,
        INDEX idx_metodo_pago (metodo_pago)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('Base de datos y tablas verificadas correctamente');
  } catch (error) {
    console.error('Error en inicialización de base de datos:', error);
    throw error;
  } finally {
    if (connection) connection.release();
  }
};