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

    return (
        <div className="flex flex-col min-h-screen bg-background">
            <Header />

            <div className="flex flex-1 relative">
                <Sidebar
                    isMenuExpanded={isMenuExpanded}
                    toggleMenuExpansion={toggleMenuExpansion}
                    toggleDarkMode={toggleTheme}
                    selectedWebsite={selectedWebsite}
                    setSelectedWebsite={setSelectedWebsite}
                />

                <main className="flex-1 ml-[70px] bg-background">
                    <div className="min-h-[calc(100vh-64px)] p-6">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}