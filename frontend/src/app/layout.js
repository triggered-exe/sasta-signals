import "./globals.css";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const isDarkMode = localStorage.getItem('darkMode') === 'true';
                  if (isDarkMode) {
                    document.documentElement.classList.add('dark');
                  }
                } catch (e) {
                  // Handle localStorage access errors (e.g., in private browsing)
                }
              })();
            `,
          }}
        />
      </head>
      <body className="bg-gray-100 text-gray-900 vsc-initialized">
        {children}
      </body>
    </html>
  );
}
