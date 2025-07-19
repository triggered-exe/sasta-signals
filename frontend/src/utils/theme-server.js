/**
 * Server-side theme utilities
 * This file contains server-only code and should not be imported in client components
 */

import { cookies } from "next/headers";

/**
 * Get the current theme from cookies (server-side)
 * @returns {string} 'light' (default) or 'dark'
 */
export const getThemeServer = () => {
  try {
    const cookieStore = cookies();
    const theme = cookieStore.get("theme")?.value;
    return theme === "dark" ? "dark" : "light"; // Default to light
  } catch (e) {
    return "light"; // Default fallback
  }
};