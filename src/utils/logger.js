import morgan from 'morgan';

// Configurar token personalizado para morgan
morgan.token('user-id', (req) => {
  return req.user ? req.user.username : 'anonymous';
});

// Exportar logger simple que morgan usará para escribir los logs 
export const logger = {
  info: (message) => console.log(message),
  error: (message) => console.error(message),
  warn: (message) => console.warn(message),
  debug: (message) => console.debug(message)
};