import dotenv from 'dotenv';

dotenv.config();

export const JWT_SECRET = process.env.JWT_SECRET || 'fitbox_secreto_2025';
export const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';