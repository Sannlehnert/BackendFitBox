import jwt from 'jsonwebtoken';
import { JWT_SECRET, JWT_EXPIRES } from '../config/jwt.js';

export const login = (req, res) => {
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
};