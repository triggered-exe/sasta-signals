import { useEffect, useState } from "react";
import {
    ShoppingCart, Zap, ShoppingBag, Truck,
    ChevronLeft, ChevronRight, Store,
    TrendingDown, Moon, Sun
} from "lucide-react";
import { useTheme } from "next-themes";
import { websites } from "../../config/websites";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const websiteIcons = {
    Instamart: Truck,
    Zepto: Zap,
    Blinkit: ShoppingCart,
    BigBasket: ShoppingBag,
    "Amazon Fresh": ShoppingCart,
    "Flipkart Grocery": Store,
    "Flipkart Minutes": Zap,
    Meesho: ShoppingBag,
    JioMart: Store,
};

function SidebarNav({ isExpanded, selectedWebsite, onSelect }) {
    return (
        <TooltipProvider delayDuration={0}>
            <ScrollArea className="flex-1">
                <div className="flex flex-col gap-1 p-2">
                    {websites.map((website) => {
                        const Icon = websiteIcons[website.name] || ShoppingBag;
                        const isActive = selectedWebsite === website.name;

                        const button = (
                            <Button
                                key={website.name}
                                variant="ghost"
                                className={cn(
                                    "w-full justify-start gap-3 h-10 rounded-lg transition-colors",
                                    isExpanded ? "px-3" : "px-0 justify-center",
                                    isActive
                                        ? "bg-primary/10 text-primary hover:bg-primary/15 font-medium"
                                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                                )}
                                onClick={() => onSelect(website.name)}
                            >
                                <Icon className={cn("h-4 w-4 shrink-0", isActive && "text-primary")} />
                                {isExpanded && (
                                    <span className="truncate text-sm">{website.name}</span>
                                )}
                            </Button>
                        );

                        if (!isExpanded) {
                            return (
                                <Tooltip key={website.name}>
                                    <TooltipTrigger asChild>{button}</TooltipTrigger>
                                    <TooltipContent side="right" sideOffset={8}>
                                        {website.name}
                                    </TooltipContent>
                                </Tooltip>
                            );
                        }

                        return button;
                    })}
                </div>
            </ScrollArea>
        </TooltipProvider>
    );
}

export default function Sidebar({
    isMenuExpanded,
    toggleMenuExpansion,
    selectedWebsite,
    setSelectedWebsite,
    isMobileOpen,
    setMobileOpen,
}) {
    const { resolvedTheme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const handleSelect = (name) => {
        setSelectedWebsite(name);
        if (isMobileOpen) setMobileOpen(false);
    };

    // Mobile sheet sidebar
    const mobileSidebar = (
        <Sheet open={isMobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent side="left" className="w-[260px] p-0">
                <div className="flex h-full flex-col">
                    {/* Logo */}
                    <div className="flex h-14 items-center gap-2.5 px-4">
                        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                            <TrendingDown className="h-3.5 w-3.5" />
                        </div>
                        <h2 className="text-sm font-semibold">Sasta Signals</h2>
                    </div>
                    <Separator />
                    <SidebarNav isExpanded selectedWebsite={selectedWebsite} onSelect={handleSelect} />
                    <Separator />
                    <div className="p-2">
                        <Button
                            variant="ghost"
                            onClick={() => setTheme(mounted && resolvedTheme === "dark" ? "light" : "dark")}
                            className="w-full justify-start gap-3 h-9 px-3 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent relative"
                            aria-label={mounted && resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
                        >
                            <Sun className="h-4 w-4 shrink-0 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                            <Moon className="absolute left-3 h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                            <span className="truncate text-sm">
                                {mounted && resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
                            </span>
                        </Button>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );

    // Desktop sidebar — full height, no topbar
    const desktopSidebar = (
        <aside
            className={cn(
                "hidden md:flex flex-col fixed top-0 h-screen border-r bg-sidebar transition-all duration-200 ease-in-out z-40",
                isMenuExpanded ? "w-[220px]" : "w-[56px]"
            )}
        >
            {/* Logo */}
            <div className={cn(
                "flex items-center shrink-0 h-14 border-b",
                isMenuExpanded ? "px-4 gap-2.5" : "justify-center"
            )}>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0">
                    <TrendingDown className="h-4 w-4" />
                </div>
                {isMenuExpanded && (
                    <div className="min-w-0">
                        <h1 className="text-sm font-semibold leading-none tracking-tight truncate">Sasta Signals</h1>
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">Price tracker</p>
                    </div>
                )}
            </div>

            {/* Nav */}
            <SidebarNav isExpanded={isMenuExpanded} selectedWebsite={selectedWebsite} onSelect={handleSelect} />

            <Separator />

            {/* Bottom actions: theme toggle + collapse */}
            <div className="p-2 space-y-1">
                {isMenuExpanded ? (
                    <Button
                        variant="ghost"
                        onClick={() => setTheme(mounted && resolvedTheme === "dark" ? "light" : "dark")}
                        className="w-full justify-start gap-3 h-9 rounded-lg px-3 text-muted-foreground hover:text-foreground hover:bg-accent relative"
                        aria-label={mounted && resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
                    >
                        <Sun className="h-4 w-4 shrink-0 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                        <Moon className="absolute left-3 h-4 w-4 shrink-0 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                        <span className="truncate text-sm">
                            {mounted && resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
                        </span>
                    </Button>
                ) : (
                    <TooltipProvider delayDuration={0}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setTheme(mounted && resolvedTheme === "dark" ? "light" : "dark")}
                                    className="h-8 w-8 mx-auto rounded-lg text-muted-foreground hover:text-foreground relative"
                                    aria-label={mounted && resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
                                >
                                    <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                                    <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="right" sideOffset={8}>
                                {mounted && resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}

                {/* Collapse toggle */}
                <TooltipProvider delayDuration={0}>
                    {isMenuExpanded ? (
                        <Button
                            variant="ghost"
                            onClick={toggleMenuExpansion}
                            className="w-full justify-start gap-3 h-9 rounded-lg px-3 text-muted-foreground hover:text-foreground hover:bg-accent"
                            aria-label="Collapse sidebar"
                        >
                            <ChevronLeft className="h-4 w-4 shrink-0" />
                            <span className="truncate text-sm">Collapse</span>
                        </Button>
                    ) : (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={toggleMenuExpansion}
                                    className="h-8 w-8 mx-auto rounded-lg text-muted-foreground hover:text-foreground"
                                    aria-label="Expand sidebar"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="right" sideOffset={8}>Expand</TooltipContent>
                        </Tooltip>
                    )}
                </TooltipProvider>
            </div>
        </aside>
    );

    return (
        <>
            {mobileSidebar}
            {desktopSidebar}
        </>
    );
} 