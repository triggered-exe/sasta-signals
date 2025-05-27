"use client";
import { useState, useEffect } from "react";
import Sidebar from "./Sidebar";
import Header from "./Header";
import { toggleTheme } from "@/utils/theme";

export default function AppLayout({ children, selectedWebsite, setSelectedWebsite }) {
    const [isMenuExpanded, setIsMenuExpanded] = useState(false);
    const [isMobile, setIsMobile] = useState(false);

    // Initialize isMobile state after component mounts
    useEffect(() => {
        setIsMobile(window.innerWidth < 768);
    }, []);

    // Handle window resize
    useEffect(() => {
        const handleResize = () => {
            const mobile = window.innerWidth < 768;
            setIsMobile(mobile);

            // Auto-collapse on small screens
            if (mobile && isMenuExpanded) {
                setIsMenuExpanded(false);
            }
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [isMenuExpanded]);

    // Toggle menu expansion
    const toggleMenuExpansion = () => {
        setIsMenuExpanded(!isMenuExpanded);
    };

    // Toggle theme using utility function
    const handleToggleTheme = () => {
        toggleTheme();
    };

    return (
        <div className="flex flex-col min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
            <Header />

            <div className="flex flex-1 relative">
                <Sidebar
                    isMenuExpanded={isMenuExpanded}
                    toggleMenuExpansion={toggleMenuExpansion}
                    toggleDarkMode={handleToggleTheme}
                    selectedWebsite={selectedWebsite}
                    setSelectedWebsite={setSelectedWebsite}
                />

                <main className="flex-1 ml-[70px]">
                    <div className="p-4 transition-all duration-300 bg-white/70 dark:bg-gray-900/50 text-gray-800 dark:text-white shadow-sm rounded-lg">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}