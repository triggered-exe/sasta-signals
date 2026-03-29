import { cn } from "@/lib/utils";

export default function Footer({ isMenuExpanded }) {
    return (
        <footer
            className={cn(
                "border-t bg-background/60 transition-[margin] duration-200 ease-in-out",
                "md:ml-[56px]",
                isMenuExpanded && "md:ml-[220px]"
            )}
        >
            <div className="container mx-auto max-w-[1600px] px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                    Sasta Signals &copy; {new Date().getFullYear()}
                </span>
                <span className="hidden sm:inline text-xs text-muted-foreground">
                    Grocery deals &amp; price alerts
                </span>
            </div>
        </footer>
    );
}
