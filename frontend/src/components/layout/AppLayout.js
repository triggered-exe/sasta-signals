"use client";
import { useState, useEffect } from "react";
import Sidebar from "./Sidebar";
import Header from "./Header";
import { websites } from '../../config/websites';

export default function AppLayout({ children, selectedWebsite, setSelectedWebsite }) {
    const [isMenuExpanded, setIsMenuExpanded] = useState(false);
    const [isMobile, setIsMobile] = useState(false);

    // Initialize dark mode from localStorage on mount
    useEffect(() => {
        const isDarkMode = localStorage.getItem('darkMode') === 'true';
        if (isDarkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }, []);

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

    // Toggle dark mode
    const toggleDarkMode = () => {
        const isDark = document.documentElement.classList.toggle('dark');
        localStorage.setItem('darkMode', isDark.toString());
    };

    return (
        <div className="flex flex-col min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
            <Header />

            <div className="flex flex-1 relative">
                <Sidebar
                    isMenuExpanded={isMenuExpanded}
                    toggleMenuExpansion={toggleMenuExpansion}
                    toggleDarkMode={toggleDarkMode}
                    selectedWebsite={selectedWebsite}
                    setSelectedWebsite={setSelectedWebsite}
                />

                <main className={`flex-1 transition-all duration-300 ${isMenuExpanded ? 'ml-[250px]' : 'ml-[70px]'}`}>
                    <div className="w-full p-4 transition-all duration-300 bg-white/70 dark:bg-gray-900/50 text-gray-800 dark:text-white shadow-sm rounded-lg m-2">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
} 