import rateLimit from 'express-rate-limit';

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

export default limiter;