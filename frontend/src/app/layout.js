import "./globals.css";
import { ThemeProvider } from "next-themes";

export const metadata = {
  title: "Sasta Signals",
  description:
    "Sasta Signals — grocery price tracker and deal alerts across Instamart, BigBasket, Blinkit, Zepto, Amazon Fresh, Flipkart Grocery, and more.",
  applicationName: "Sasta Signals",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
  openGraph: {
    title: "Sasta Signals — Grocery Deals & Price Alerts",
    description:
      "Track grocery prices and get instant deal alerts across Instamart, BigBasket, Blinkit, Zepto, Amazon Fresh, Flipkart Grocery, and more.",
    url: "https://example.com",
    siteName: "Sasta Signals",
    locale: "en_IN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sasta Signals — Grocery Deals & Price Alerts",
    description:
      "Track grocery prices and get instant deal alerts across Instamart, BigBasket, Blinkit, Zepto, Amazon Fresh, Flipkart Grocery, and more.",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
