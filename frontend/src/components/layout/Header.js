export default function Header() {
  return (
    <header className="bg-background/95 text-foreground border-b border-border p-4 flex items-center sticky top-0 z-50 backdrop-blur-sm shadow-sm">
      <div>
        <h1 className="text-2xl font-bold text-primary">Bachat Signals</h1>
        <p className="text-sm text-muted-foreground">Grocery price tracker & deal alerts</p>
      </div>
    </header>
  );
} 