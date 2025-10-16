Project: Metrodle SP — Developer Guidelines

This document captures project-specific practices and constraints to speed up future development and debugging. It
assumes familiarity with TypeScript, Vite, Node’s test runner, and modern browser APIs.

1) Build and configuration

- Node/runtime and modules
    - Node.js 18+ is assumed.
    - ESM throughout (package.json has "type": "module").
    - Import paths inside src must include the .js extension for local modules (e.g., import {loadStations} from "
      ./stationLoader.js"). TypeScript is configured to allow this and Vite resolves to the .ts source.

- Dev server and production build (Vite)
    - Dev: npm run dev → serves the app via Vite at http://localhost:5173.
    - Build: npm run build → builds to /build by Vite (see vite.config.ts).
    - Preview: npm run preview → serves the production build locally.
    - index.html boots the app with <script type="module" src="/src/index.ts"> and loads styles.css.

- Assets and URL handling
    - CSVs and other assets inside src are referenced with new URL('./file.ext', import.meta.url). Vite will bundle/copy
      them as needed.
    - For non-code assets you want a public URL for (e.g., embedded map), import with ?url (e.g., import mapUrl from '
      ./map/map.html?url').
    - MapTiler key is passed via Vite environment. Create a .env file (ignored by VCS) with:
        - VITE_MAPTILER_KEY=your_key
          The game passes ?k=... to src/map/map.html.

- Timezone and daily reset
    - Daily puzzle uses São Paulo time (UTC-3) with getSPNow() shifting the clock by -3h. Do not replace with local
      time; tests and share text rely on this.
    - The app auto-reloads at São Paulo midnight and shows a countdown on the stats dialog after finishing.

- Data files
    - src/stations.csv (Wikidata export) — columns used: station, stationLabel, station_code (ignored for id),
      connecting_lineLabel, coordinate_location.
        - Ids are the station wikidata QIDs (e.g., Q1234). Names have the "Estação" prefix removed.
        - Lines are numeric string ids (e.g., '1', '3', '15') mapped from connecting_lineLabel; unknown lines throw in
          dev/tests.
        - Coordinates parsed from Point(lon lat) are optional and used for arrows/distance/map centering.
    - src/adjacencies.csv — edges between station QIDs (cost 1).
    - src/interchanges.csv — zero-cost edges between station QIDs.
    - CSV parser is deliberately minimal: split by commas/lines only, no quoted fields. Keep fields free of commas.

- Lines catalog
    - src/lines.ts is the single source of truth for supported lines: ids, names, and colors. Keep this consistent with
      the Wikidata → line id mapping.

2) Testing

- Runner and scripts
    - Tests are TypeScript files under src/__tests__.
    - npm test runs: tsc && node --test dist/__tests__/*.js.
    - npm run typecheck runs tsc without executing tests.

- Patterns and constraints
    - Always import local modules with .js extension even in tests (ESM mode): import {normalize} from '../logic.js'.
    - Tests run against the compiled dist/*, so ensure tsc succeeds (tsconfig targets ESM) before node --test.
    - No network in tests: use the provided fetch mock to read local CSVs.
    - Determinism: logic.pickDailyStation contains an override for a specific date (2025-10-15 → Ana Rosa) to help with
      stable tests; keep that in mind if you adjust station lists.

- Mocks/utilities
    - src/__tests__/testUtils.ts exports installFetchMock() which shims globalThis.fetch to work with new URL('
      ./file.csv', import.meta.url) and loads from src instead of the network. Call installFetchMock() at the top of
      tests that need station/graph loading.
    - Some tests also shim localStorage via a simple in-memory map (see existing tests for examples).

- Adding a new test (example)
    - Create a new file in src/__tests__/myFeature.test.ts:
      import test from 'node:test';
      import assert from 'node:assert/strict';
      import {normalize} from '../logic.js';

      test('normalize removes diacritics and lowercases', () => {
      assert.equal(normalize('Água Branca'), 'agua branca');
      // normalize does not trim; trim if you need that in your logic
      assert.equal(normalize('  Sé  ').trim(), 'se');
      });

    - Run npm test. If you need stations data, also:
      import {installFetchMock} from './testUtils.js';
      installFetchMock();

- Coverage
    - Critical covered behaviors: station loading and data integrity (lines vs LINES), adjacency and interchange graph
      with 0–1 BFS distances, daily station selection determinism, candidate search and normalization, known line
      knowledge derivation, share text format, direction arrow symbols, and state/stats persistence.

3) Additional development information

- UI/system architecture
    - src/index.ts orchestrates: game state, suggestions, virtual keyboard, rendering, sharing, and dialogs.
    - src/keyboard.ts renders a QWERTY virtual keyboard fixed at the bottom; keys become visually disabled based on
      possible continuations but remain clickable for guidance. Keyboard and inputs are disabled after finishing the
      daily puzzle.
    - Suggestions appear over the map area, scroll within bounds, and display line chips (with red X overlays for
      eliminated lines). Line-name queries are grouped under colored separators.
    - Guesses list always shows 6 slots; each guess shows line chips (with red X for misses), distance to the solution (
      number of stops), and a small 8-way direction arrow. The map is an embedded iframe centered on today’s station.
    - Stats dialog shows played/wins/streak/best and a vertical histogram (1–6 + X). On completion it opens
      automatically and includes share and countdown.

- Data and algorithmic details
    - Station ids are the Wikidata QIDs; this keeps ids stable across CSV updates.
    - Lines are numeric string ids. Unknown line labels during load should be treated as errors in dev/tests to surface
      data issues early.
    - BFS distances: bfsDistances() implements a 0–1 BFS where adjacency edges cost 1 stop and interchange edges cost 0.
    - Direction arrows: logic.directionArrowSymbol() maps bearings to Unicode arrows (↑↗→↘↓↙←↖). Empty string if coords
      missing.

- Coding/style
    - Favor small, pure helpers in src/logic.ts for testability.
    - Keep index.ts DOM-manipulation only; persistence in src/state.ts.
    - Avoid adding heavy dependencies; current CSV parsing is intentionally simple.
    - Use feature flags/overrides sparingly; if adding one for tests, document it here and keep them obviously
      date-anchored.

- Common pitfalls
    - Import path extensions: missing .js in src imports will break in the browser (404 on /dist/*). TypeScript is set
      to moduleResolution: bundler; follow existing patterns.
    - Tests vs dev server: tests read from dist; the dev server reads directly from src. Re-run npm test after TS
      changes to keep dist fresh.
    - CSV quoting: do not introduce commas in CSV fields unless you improve the parser. Prefer replacing commas in
      station names with hyphens if necessary.
    - Timezone: do not replace UTC-3 shift with local time; it will break the “todayKey” alignment and countdown.

- Map integration
    - Embedded map is src/map/map.html loaded via ?url. It accepts ?lon, ?lat, ?z params for initial view and ?lines for
      an overlay geojson URL. Labels are hidden and transit is styled neutral.
    - If you adjust the map style provider, keep attribution visible and pass keys via environment, not hardcoded.

- Deployment
    - GitHub Pages works with the Vite build; ensure absolute asset paths (logo, social meta) point to the correct
      public URL.

- Analytics (optional)
    - The project currently includes a Google gtag snippet. If adding events, make calls robust (wrapped in try/catch)
      and avoid breaking tests (which run in Node/no DOM).