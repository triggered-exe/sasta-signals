/**
 * Theme utility functions for managing dark/light mode
 */

/**
 * Get the system's preferred color scheme
 * @returns {string} 'dark' or 'light'
 */
const getSystemPreference = () => {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

/**
 * Initialize theme from localStorage or system preference and apply to document
 * Should be called on component mount (client-side only)
 */
export const initializeTheme = () => {
  try {
    let theme = localStorage.getItem('theme');

    if (!theme) {
      // No stored preference, use system preference
      theme = getSystemPreference();
      localStorage.setItem('theme', theme);
    }

    // Apply theme to document
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch (e) {
    // Handle localStorage access errors (e.g., in private browsing)
    const systemTheme = getSystemPreference();
    if (systemTheme === 'dark') {
      document.documentElement.classList.add('dark');
    }
  }
};

/**
 * Toggle between dark and light mode
 * @returns {string} The new theme ('dark' or 'light')
 */
export const toggleTheme = () => {
  try {
    const currentTheme = localStorage.getItem('theme') || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    localStorage.setItem('theme', newTheme);

    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    return newTheme;
  } catch (e) {
    console.warn('Failed to toggle theme:', e);
    return 'light';
  }
};
