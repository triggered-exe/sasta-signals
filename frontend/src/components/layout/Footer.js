export default function Footer() {
    const year = new Date().getFullYear();
    return (
        <footer className="border-t bg-background/60 ml-[70px]">
            <div className="mx-auto max-w-7xl px-4 py-3 text-xs text-muted-foreground flex items-center justify-between">
                <span>Bachat Signals © {year}</span>
                <span className="hidden sm:inline">Grocery deals and price alerts</span>
            </div>
        </footer>
    );
}
