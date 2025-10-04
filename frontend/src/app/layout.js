import "./globals.css";
import { getThemeServer } from "@/utils/theme-server";

export default function RootLayout({ children }) {
  // Get theme on server side from cookies
  const theme = getThemeServer();

  return (
    <html lang="en" className={theme}>
      <body className="bg-background text-foreground min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
