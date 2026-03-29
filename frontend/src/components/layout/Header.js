import { useEffect, useState } from "react";
import { TrendingDown, Menu, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export default function Header({ toggleSidebar }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60 md:hidden">
      <div className="flex h-12 items-center gap-3 px-4">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 h-8 w-8"
          onClick={toggleSidebar}
          aria-label="Toggle menu"
        >
          <Menu className="h-5 w-5" />
        </Button>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <TrendingDown className="h-3.5 w-3.5" />
          </div>
          <h1 className="text-sm font-semibold leading-none tracking-tight">Sasta Signals</h1>
        </div>

        <div className="flex-1" />

        <Button
          variant="ghost"
          onClick={() => setTheme(mounted && resolvedTheme === "dark" ? "light" : "dark")}
          className="w-full max-w-9 justify-center h-9 px-3 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent relative"
          aria-label={mounted && resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
        >
          <Sun className="h-4 w-4 shrink-0 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>
      </div>
    </header>
  );
} 