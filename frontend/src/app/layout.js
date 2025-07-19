import "./globals.css";
import { getThemeServer } from "@/utils/theme-server";

export default function RootLayout({ children }) {
  // Get theme on server side from cookies
  const theme = getThemeServer();

  return (
    <html lang="en" className={theme}>
      <body className="bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 vsc-initialized">
        {children}
      </body>
    </html>
  );
}
