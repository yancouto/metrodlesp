Project: Metrodle SP

Overview
- A daily web puzzle inspired by Wordle, but for São Paulo’s metro/CPTM stations.
- Pure HTML + TypeScript (compiled to dist) + CSS. No bundler required.

Getting started
1) Install Node.js LTS.
2) Install deps: npm install
3) Build: npm run build
4) Open index.html in a browser (mobile recommended) or use any static server.

Project structure
- index.html: HTML shell that loads ./dist/index.js
- styles.css: minimal mobile-first styling
- src/index.ts: game logic, dataset, UI wiring
- tsconfig.json: TypeScript compiler configuration

Game rules (current implementation)
- One game per day (solution selected via date-based hash)
- 6 attempts max
- Search/autocomplete by station name or line name
- After each wrong guess, you see per-line color feedback (matches vs. misses)
- Stats saved to localStorage (played, wins, streak, best)
- Share result via Web Share API or clipboard fallback
- Map image is currently a placeholder; see TODO below

Data model
- Lines have an id, name, and color (see LINES in src/index.ts)
- Stations have an id, name, and an array of line ids
- Extend STATIONS with real data; keep ids stable once published

Contributing guidelines
- Keep PRs small and focused. Write clear titles and descriptions.
- Maintain TypeScript strictness (tsconfig strict: true). Avoid using any.
- Prefer small, composable functions. Keep pure logic testable without the DOM.
- Keep mobile-first UX; test on a phone if possible.
- Accessibility: labels, roles, readable contrast, keyboard focusable buttons.
- Don’t add heavy dependencies unless necessary. Prefer web standards APIs.

Coding style
- Use TypeScript with explicit types for public functions.
- Use const/let, avoid var. Avoid mutation where possible.
- Keep UI strings i18n-friendly; avoid hard-coding in multiple places.

Testing (manual for now)
- Clear localStorage between test runs when needed.
- Validate flows: win on first try, win on last try, lose after 6, duplicate guess, unknown station, share.
- Check stats update once per day only.

Build and release
- npm run build produces ./dist from ./src.
- GitHub Pages or any static hosting can serve the site; ensure index.html references ./dist/index.js.

Roadmap / TODO
- Replace map placeholder with a real image set for each station (no names/line colors). Add imageUrl for stations.
- Expand station dataset to full CPTM network.
