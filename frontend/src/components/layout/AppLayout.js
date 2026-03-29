"use client";
import { useState, useEffect, useCallback } from "react";
import Sidebar from "./Sidebar";
import Header from "./Header";
import Footer from "./Footer";
import { cn } from "@/lib/utils";

export default function AppLayout({ children, selectedWebsite, setSelectedWebsite }) {
    const [isMenuExpanded, setIsMenuExpanded] = useState(true);
    const [isMobileOpen, setMobileOpen] = useState(false);

    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth < 768) {
                setIsMenuExpanded(false);
                setMobileOpen(false);
            }
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    const toggleMenuExpansion = useCallback(() => {
        setIsMenuExpanded((prev) => !prev);
    }, []);

    const toggleSidebar = useCallback(() => {
        setMobileOpen((prev) => !prev);
    }, []);

    return (
        <div className="flex flex-col min-h-screen bg-background">
            {/* Mobile-only header */}
            <Header
                toggleSidebar={toggleSidebar}
            />

            <div className="flex flex-1">
                <Sidebar
                    isMenuExpanded={isMenuExpanded}
                    toggleMenuExpansion={toggleMenuExpansion}
                    selectedWebsite={selectedWebsite}
                    setSelectedWebsite={setSelectedWebsite}
                    isMobileOpen={isMobileOpen}
                    setMobileOpen={setMobileOpen}
                />

                <main
                    className={cn(
                        "flex-1 transition-[margin] duration-200 ease-in-out",
                        "md:ml-[56px]",
                        isMenuExpanded && "md:ml-[220px]"
                    )}
                >
                    <div className="container mx-auto p-4 md:p-6 max-w-[1600px]">
                        {children}
                    </div>
                </main>
            </div>

            <Footer isMenuExpanded={isMenuExpanded} />
        </div>
    );
}