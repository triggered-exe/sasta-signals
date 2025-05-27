"use client";
import { useEffect } from "react";
import "./globals.css";
import { initializeTheme } from "@/utils/theme";

export default function RootLayout({ children }) {
  useEffect(() => {
    initializeTheme();
  }, []);
  
  return (
    <html lang="en">
      <head>
      </head>
      <body className="bg-gray-100 text-gray-900 vsc-initialized">
        {children}
      </body>
    </html>
  );
}
