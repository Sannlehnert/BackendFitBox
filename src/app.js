import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { logger } from './utils/logger.js';
import rateLimiter from './middlewares/rateLimiter.js';
import { corsOptions } from './config/cors.js';
import authRoutes from './routes/authRoutes.js';
import clienteRoutes from './routes/clienteRoutes.js';
import pagoRoutes from './routes/pagoRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import { notFound, errorHandler } from './middlewares/errorHandler.js';

const app = express();

// Seguridad
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

// Logging
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use(morgan(':method :url :status :res[content-length] - :response-time ms - :user-id'));

// CORS
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Limitador de tasa
app.use(rateLimiter);

// Parseo JSON con límite
app.use(express.json({ limit: '10kb' }));

// Rutas públicas
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

app.get('/health', async (req, res) => {
  try {
    const { testDatabaseConnection } = await import('./config/database.js');
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

// Montar rutas
app.use('/api', authRoutes);
app.use('/', clienteRoutes);   // /personas, /clientes, /buscar-cliente
app.use('/', pagoRoutes);      // /pagos, /clientes/:id/pagos-detallados
app.use('/admin', adminRoutes);

// Manejo de errores
app.use(notFound);
app.use(errorHandler);

export default app;