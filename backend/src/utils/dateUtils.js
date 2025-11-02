/**
 * Date utility functions for the application
 */

/**
 * Get current time in Indian Standard Time (IST)
 * IST is UTC+5:30 (5 hours and 30 minutes ahead of UTC)
 * @returns {Date} Current date and time in IST
 */
export const getCurrentIST = () => {
  const now = new Date();
  return new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
};

/**
 * Convert any date to IST
 * @param {Date} date - The date to convert to IST
 * @returns {Date} The date converted to IST
 */
export const toIST = (date) => {
  return new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
};

/**
 * Format a date to IST string with timezone indicator
 * @param {Date} date - The date to format
 * @returns {string} ISO string with +05:30 timezone indicator
 */
export const formatISTString = (date) => {
  const istDate = toIST(date);
  return istDate.toISOString().replace('Z', '+05:30');
};

/**
 * Get IST timezone information
 * @returns {object} Object containing timezone details
 */
export const getISTInfo = () => {
  return {
    timezone: 'Asia/Kolkata (IST)',
    offset: '+05:30',
    offsetHours: 5.5,
    offsetMs: 5.5 * 60 * 60 * 1000
  };
};