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
 * Get the current theme from localStorage or system preference
 * @returns {string} 'dark' or 'light'
 */
export const getTheme = () => {
  if (typeof window === 'undefined') return 'light';

  try {
    const theme = localStorage.getItem('theme');
    if (theme) return theme;

    const systemTheme = getSystemPreference();
    localStorage.setItem('theme', systemTheme);
    return systemTheme;
  } catch (e) {
    return getSystemPreference();
  }
};

/**
 * Apply theme to the document
 * @param {string} theme - 'dark' or 'light'
 */
export const applyTheme = (theme) => {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
};

/**
 * Initialize theme from localStorage or system preference and apply to document
 * @returns {string} The current theme ('dark' or 'light')
 */
export const initializeTheme = () => {
  const theme = getTheme();
  applyTheme(theme);
  return theme;
};

/**
 * Toggle between dark and light mode
 * @returns {string} The new theme ('dark' or 'light')
 */
export const toggleTheme = () => {
  try {
    const currentTheme = getTheme();
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    localStorage.setItem('theme', newTheme);
    applyTheme(newTheme);

    return newTheme;
  } catch (e) {
    console.warn('Failed to toggle theme:', e);
    return 'light';
  }
};

/**
 * Inline script code for theme initialization (to prevent flash)
 * This is the same logic as above but as a string for use in <script> tags
 */
export const themeInitScript = `
(function() {
  // Get the system's preferred color scheme
  const getSystemPreference = () => {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  // Get the current theme from localStorage or system preference
  const getTheme = () => {
    try {
      const theme = localStorage.getItem('theme');
      if (theme) return theme;

      const systemTheme = getSystemPreference();
      localStorage.setItem('theme', systemTheme);
      return systemTheme;
    } catch (e) {
      return getSystemPreference();
    }
  };

  // Apply theme to the document
  const applyTheme = (theme) => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  // Initialize theme
  const theme = getTheme();
  applyTheme(theme);
})();
`;
