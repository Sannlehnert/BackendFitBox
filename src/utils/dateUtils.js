import moment from 'moment';

export const formatDate = (date, format = 'YYYY-MM-DD') => {
  return moment(date).format(format);
};

export const getCurrentDate = () => {
  return moment().format('YYYY-MM-DD');
};

export const getMonthName = (date) => {
  return moment(date).format('MMMM YYYY');
};

export const subtractMonths = (months) => {
  return moment().subtract(months, 'months').format('YYYY-MM-DD');
};