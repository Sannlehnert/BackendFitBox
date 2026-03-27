export const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://fit-box.netlify.app',
      'http://localhost:5173',
      'https://fitbox-front.netlify.app'
    ];

    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      console.log('Origen bloqueado por CORS:', origin);
      callback(new Error('Origen no permitido por CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200,
  maxAge: 86400
};