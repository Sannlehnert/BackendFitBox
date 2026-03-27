import dotenv from 'dotenv';
import app from './src/app.js';
import { initializeDatabase, pool } from './src/config/database.js';
import { startLimpiezaCron } from './src/services/limpiezaService.js';

dotenv.config();

const PORT = process.env.PORT || 3001;

const startServer = async () => {
  try {
    await initializeDatabase();
    startLimpiezaCron(); // Inicia el cron job de limpieza

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