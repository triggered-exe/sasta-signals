import { useRef, useEffect } from "react";
import { FaChevronRight, FaShoppingBasket, FaArrowRight, FaArrowLeft, FaMoon, FaSun } from 'react-icons/fa';
import { SiSwiggy, SiAmazon, SiFlipkart, SiBigbasket } from 'react-icons/si';
import { GiShoppingBag } from 'react-icons/gi';
import { websites } from '../../config/websites';

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

    const handleMouseEnter = () => {
        if (!isMenuExpanded) {
            toggleMenuExpansion();
        }
    };

    const handleMouseLeave = () => {
        if (isMenuExpanded) {
            toggleMenuExpansion();
        }
    };

    // Handle website selection
    const handleWebsiteClick = (websiteName) => {
        setSelectedWebsite(websiteName);
    };

    return (
        <div
            ref={sidebarRef}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            className={`fixed top-16 h-[calc(100vh-64px)] transition-all duration-300 
                ${isMenuExpanded ? 'w-[250px]' : 'w-[70px]'} 
                bg-white dark:bg-gray-800 text-gray-800 dark:text-white
                z-50 border-r border-gray-200 dark:border-gray-700`}
        >
            {/* Expand/collapse toggle button */}
            <div className="border-b border-gray-200 dark:border-gray-700 py-3 px-4 flex items-center justify-between">
                {isMenuExpanded && <span className="font-medium text-gray-700 dark:text-gray-300">Websites</span>}
                <button
                    onClick={toggleMenuExpansion}
                    className={`p-2 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 
                        transition-colors ${isMenuExpanded ? '' : 'mx-auto'}`}
                    aria-label={isMenuExpanded ? "Collapse menu" : "Expand menu"}
                >
                    {isMenuExpanded ? <FaArrowLeft size={14} /> : <FaArrowRight size={14} />}
                </button>
            </div>

            <div className={`overflow-y-auto h-[calc(100%-120px)] ${isMenuExpanded ? 'px-6' : 'px-2'} py-4`}>
                <div className="space-y-3">
                    {websites.map((website) => (
                        <button
                            key={website.name}
                            className={`w-full p-3 text-left rounded-lg transition-all duration-200 flex items-center
                                ${selectedWebsite === website.name
                                    ? "bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600"
                                    : "bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border-gray-200 dark:border-gray-700"
                                }
                                ${isMenuExpanded ? '' : 'justify-center'} border`}
                            onClick={() => handleWebsiteClick(website.name)}
                            title={!isMenuExpanded ? website.name : ''}
                        >
                            <div className={`${isMenuExpanded ? 'mr-3' : ''} ${selectedWebsite === website.name
                                ? 'text-blue-500 dark:text-blue-400'
                                : 'text-gray-500 dark:text-gray-400'}`}>
                                {websiteIcons[website.name] || <FaShoppingBasket className="text-xl" />}
                            </div>

                            {isMenuExpanded && (
                                <div className="flex-1">
                                    <h3 className="text-lg font-medium text-gray-800 dark:text-gray-200">
                                        {website.name}
                                    </h3>
                                </div>
                            )}

                            {isMenuExpanded && (
                                <FaChevronRight className={`transition-transform duration-200 ${selectedWebsite === website.name
                                    ? "text-blue-500 dark:text-blue-400"
                                    : "text-gray-400 dark:text-gray-500"
                                    }`} />
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Dark mode toggle at bottom of sidebar */}
            <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                <button
                    onClick={toggleDarkMode}
                    className="w-full p-2 rounded-lg flex items-center justify-center bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-white transition-colors"
                    aria-label="Toggle dark mode"
                    title="Toggle dark mode"
                >
                    <span className="dark:hidden">
                        <FaMoon className="text-gray-600" />
                    </span>
                    <span className="hidden dark:inline">
                        <FaSun className="text-yellow-300" />
                    </span>
                    {isMenuExpanded && (
                        <span className="ml-2">
                            <span className="dark:hidden">Dark Mode</span>
                            <span className="hidden dark:inline">Light Mode</span>
                        </span>
                    )}
                </button>
            </div>
        </div>
    );
} 