import { useRef, useEffect } from "react";
import { FaChevronRight, FaShoppingBasket, FaArrowRight, FaArrowLeft, FaMoon, FaSun } from 'react-icons/fa';
import { SiSwiggy, SiAmazon, SiFlipkart, SiBigbasket } from 'react-icons/si';
import { GiShoppingBag } from 'react-icons/gi';
import { websites } from '../../config/websites';
import { Button } from '@/components/ui/button';

// Map website names to icons
const websiteIcons = {
    "Instamart": <SiSwiggy className="text-xl" />,
    "Zepto": <FaShoppingBasket className="text-xl" />,
    "Blinkit": <FaShoppingBasket className="text-xl" />,
    "BigBasket": <SiBigbasket className="text-xl" />,
    "Amazon Fresh": <SiAmazon className="text-xl" />,
    "Flipkart Grocery": <SiFlipkart className="text-xl" />,
    "Meesho": <GiShoppingBag className="text-xl" />,
    "JioMart": <img src="https://images.seeklogo.com/logo-png/46/1/jiomart-logo-png_seeklogo-469685.png" className="w-6 h-6 rounded-full" />
};

export default function Sidebar({
    isMenuExpanded,
    toggleMenuExpansion,
    toggleDarkMode,
    selectedWebsite,
    setSelectedWebsite
}) {
    const sidebarRef = useRef(null);

    useEffect(() => {
        // Handle clicks outside the sidebar
        const handleClickOutside = (event) => {
            if (sidebarRef.current && !sidebarRef.current.contains(event.target) && isMenuExpanded) {
                toggleMenuExpansion();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isMenuExpanded, toggleMenuExpansion]);

    // Remove auto-expand on hover for more professional behavior
    // Users will manually control the sidebar state

    // Handle website selection
    const handleWebsiteClick = (websiteName) => {
        setSelectedWebsite(websiteName);
    };

    return (
        <div
            ref={sidebarRef}
            className={`fixed top-16 h-[calc(100vh-64px)] transition-all duration-300 ease-in-out animate-fade-in
                ${isMenuExpanded ? 'w-[280px]' : 'w-[70px]'} 
                bg-sidebar text-sidebar-foreground
                z-50 border-r border-sidebar-border shadow-lg`}
        >
            {/* Header with toggle button */}
            <div className="border-b border-sidebar-border py-4 px-4 flex items-center justify-between">
                {isMenuExpanded && (
                    <h2 className="font-semibold text-lg text-sidebar-foreground transition-opacity duration-300">
                        Websites
                    </h2>
                )}
                <Button
                    onClick={toggleMenuExpansion}
                    variant="ghost"
                    size="icon"
                    className={`rounded-lg transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${isMenuExpanded ? '' : 'mx-auto'}`}
                    aria-label={isMenuExpanded ? "Collapse menu" : "Expand menu"}
                >
                    {isMenuExpanded ? <FaArrowLeft size={16} /> : <FaArrowRight size={16} />}
                </Button>
            </div>

            <div className={`overflow-y-auto h-[calc(100%-140px)] ${isMenuExpanded ? 'px-4' : 'px-2'} py-4`}>
                <div className="space-y-2">
                    {websites.map((website) => (
                        <Button
                            key={website.name}
                            variant="ghost"
                            className={`w-full h-12 text-left rounded-lg transition-all duration-200 flex items-center group
                                ${isMenuExpanded ? 'px-4' : 'justify-center px-2'} 
                                ${selectedWebsite === website.name
                                    ? 'bg-primary/20 text-primary border border-primary/30 shadow-sm'
                                    : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                                }`}
                            onClick={() => handleWebsiteClick(website.name)}
                            title={!isMenuExpanded ? website.name : ''}
                        >
                            <div className={`${isMenuExpanded ? 'mr-3' : ''} ${selectedWebsite === website.name
                                ? 'text-primary'
                                : 'text-sidebar-foreground group-hover:text-sidebar-accent-foreground'}`}>
                                {websiteIcons[website.name] || <FaShoppingBasket className="text-xl" />}
                            </div>

                            {isMenuExpanded && (
                                <div className="flex-1 min-w-0">
                                    <h3 className={`text-sm font-medium truncate ${selectedWebsite === website.name
                                        ? 'text-primary'
                                        : 'text-sidebar-foreground'}`}>
                                        {website.name}
                                    </h3>
                                </div>
                            )}

                            {isMenuExpanded && (
                                <FaChevronRight className={`transition-transform duration-200 ${selectedWebsite === website.name
                                    ? "text-primary"
                                    : "text-sidebar-foreground group-hover:text-sidebar-accent-foreground"
                                    }`} />
                            )}
                        </Button>
                    ))}
                </div>
            </div>

            {/* Dark mode toggle at bottom of sidebar */}
            <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-sidebar-border bg-sidebar">
                <Button
                    onClick={toggleDarkMode}
                    variant="ghost"
                    className="w-full h-12 rounded-lg flex items-center justify-center group hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    aria-label="Toggle dark mode"
                    title="Toggle dark mode"
                >
                    <span className="dark:hidden">
                        <FaMoon className="text-sidebar-foreground group-hover:text-sidebar-accent-foreground" />
                    </span>
                    <span className="hidden dark:inline">
                        <FaSun className="text-sidebar-foreground group-hover:text-sidebar-accent-foreground" />
                    </span>
                    {isMenuExpanded && (
                        <span className="ml-3 text-sm font-medium text-sidebar-foreground group-hover:text-sidebar-accent-foreground">
                            <span className="dark:hidden">Dark Mode</span>
                            <span className="hidden dark:inline">Light Mode</span>
                        </span>
                    )}
                </Button>
            </div>
        </div>
    );
} 