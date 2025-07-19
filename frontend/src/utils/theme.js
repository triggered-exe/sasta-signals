"use client";

/**
 * Simplified theme utility for managing theme with cookies
 * Default theme is white (light)
 */

/**
 * Get the current theme from cookies (client-side)
 * @returns {string} 'light' (default) or 'dark'
 */
export const getTheme = () => {
  try {
    // Check cookie
    const cookieTheme = document.cookie
      .split("; ")
      .find((row) => row.startsWith("theme="))
      ?.split("=")[1];

    if (cookieTheme) {
      return cookieTheme;
    }

    return "light"; // Default to light
  } catch (e) {
    return "light";
  }
};

/**
 * Set theme in cookie
 * @param {string} theme - 'dark' or 'light'
 */
export const setTheme = (theme) => {
  try {
    // Set in cookie (expires in 1 year)
    const expires = new Date();
    expires.setFullYear(expires.getFullYear() + 1);
    document.cookie = `theme=${theme}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;

    // Apply to document
    applyTheme(theme);
  } catch (e) {
    console.warn("Failed to set theme:", e);
  }
};

/**
 * Apply theme to the document
 * @param {string} theme - 'dark' or 'light'
 */
export const applyTheme = (theme) => {
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
};

/**
 * Toggle between dark and light mode
 * @returns {string} The new theme ('dark' or 'light')
 */
export const toggleTheme = () => {
  try {
    const currentTheme = getTheme();
    const newTheme = currentTheme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    return newTheme;
  } catch (e) {
    console.warn("Failed to toggle theme:", e);
    return "light";
  }
};
