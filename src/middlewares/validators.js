import moment from 'moment';

export const validateClientData = (req, res, next) => {
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

export const validatePaymentData = (req, res, next) => {
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