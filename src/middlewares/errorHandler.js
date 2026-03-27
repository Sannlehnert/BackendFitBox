export const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Ruta no encontrada'
  });
};

export const errorHandler = (err, req, res, next) => {
  console.error('Error en la aplicación:', err);

  if (err.message === 'Origen no permitido por CORS') {
    return res.status(403).json({
      success: false,
      error: 'Acceso no permitido',
      details: `Origen ${req.headers.origin} no está permitido`
    });
  }

  // Errores personalizados con status
  if (err.status) {
    return res.status(err.status).json({
      success: false,
      error: err.error,
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }

  // Error de base de datos u otro
  res.status(500).json({
    success: false,
    error: 'Error interno del servidor',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
};