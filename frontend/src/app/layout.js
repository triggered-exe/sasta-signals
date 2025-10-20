import "./globals.css";
import { getThemeServer } from "@/utils/theme-server";

export const metadata = {
  title: "Bachat Signals",
  description:
    "Bachat Signals — grocery price tracker and deal alerts across Instamart, BigBasket, Blinkit, Zepto, Amazon Fresh, Flipkart Grocery, and more.",
  applicationName: "Bachat Signals",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
  openGraph: {
    title: "Bachat Signals — Grocery Deals & Price Alerts",
    description:
      "Track grocery prices and get instant deal alerts across Instamart, BigBasket, Blinkit, Zepto, Amazon Fresh, Flipkart Grocery, and more.",
    url: "https://example.com",
    siteName: "Bachat Signals",
    locale: "en_IN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bachat Signals — Grocery Deals & Price Alerts",
    description:
      "Track grocery prices and get instant deal alerts across Instamart, BigBasket, Blinkit, Zepto, Amazon Fresh, Flipkart Grocery, and more.",
  },
};

export default function RootLayout({ children }) {
  // Get theme on server side from cookies
  const theme = getThemeServer();

  return (
    <html lang="en" className={theme} suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
