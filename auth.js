export const getAuthToken = () => localStorage.getItem('fitbox_token');

export const setAuthToken = (token) => {
  localStorage.setItem('fitbox_token', token);
};

export const removeAuthToken = () => {
  localStorage.removeItem('fitbox_token');
};

export const authHeader = () => {
  const token = getAuthToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};