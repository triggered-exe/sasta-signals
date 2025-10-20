## Bachat Signals — Frontend (Next.js)

This is the Next.js frontend for Bachat Signals — a grocery price tracking and deal alerts app for India.

### Scripts

- Dev server: `pnpm dev`
- Build: `pnpm build`
- Start (prod): `pnpm start`
- Lint: `pnpm lint`

### Run locally

1. Install deps: `pnpm install`
2. Start dev: `pnpm dev`
3. Visit http://localhost:3000

### Project notes

- Brand title and metadata live in `src/app/layout.js`
- Header branding is in `src/components/layout/Header.js`
- Uses Tailwind CSS with dark/light themes

### Deploy

Build with `pnpm build` and serve with `pnpm start` (Node 18+).
