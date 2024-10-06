import "./globals.css";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-gray-100 text-gray-900 vsc-initialized">
        {children}
      </body>
    </html>
  );
}
