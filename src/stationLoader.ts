/* Query used in WikiData (as reference):

# São Paulo Metro stations
SELECT ?station ?connecting_line ?connecting_lineLabel ?coordinate_location ?station_code ?stationLabel WHERE {
  ?station wdt:P31 wd:Q928830.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
  ?station wdt:P16 wd:Q483343.
  OPTIONAL { ?station wdt:P81 ?connecting_line. }
  OPTIONAL { ?station wdt:P625 ?coordinate_location. }
  OPTIONAL { ?station wdt:P296 ?station_code. }
  # Line and station in use
  ?station wdt:P5817 wd:Q55654238.
  ?connecting_line wdt:P5817 wd:Q55654238.
}
ORDER BY (?stationLabel)

*/

// This module exports an async function `loadStations()` that reads ./src/stations.csv
// and returns Station[] compatible with the game. It aggregates multiple CSV rows per station
// (one per connecting line) into a single Station with unique LineId[] lines.

// Local type shadows to avoid importing from index.ts. Keep in sync with index.ts if changed.
export type LineId = string; // numeric string, e.g., '1', '2', '15'
export interface Station { id: string; name: string; lines: LineId[]; imageUrl?: string; }

async function parseCSVObjects(text: string): Promise<Record<string, string>[]> {
  // Simple inline CSV parsing: split by lines and commas. Assumes no commas inside fields.
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length === 0) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (cols[c] ?? '').trim();
    }
    rows.push(obj);
  }
  return rows;
}

function slugify(ptName: string): string {
  return ptName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const IGNORED_LINES = new Set([
    "Ramal de São Paulo",
]);

function normalizeLineLabel(label: string): LineId | undefined {
  const raw = label
    .replace(/\u2013|\u2014|–|—/g, '-')
    .replace(/linha\s*/i, '')
    .trim();
  // try to extract leading number
  const m = raw.match(/^(\d{1,2})\b/);
  if(m) return m[1];
  if(IGNORED_LINES.has(label)) return undefined;
  throw new Error(`Unknown line: ${raw}`);
}

let stationsCache: Station[] | null = null;

export async function loadStations(): Promise<Station[]> {
  if (stationsCache) return stationsCache;
  const url = new URL('./stations.csv', import.meta.url);
  const res = await fetch(url as any, { cache: 'no-cache' });
  if (!res.ok) throw new Error('Falha ao carregar stations.csv');
  const text = await res.text();
  const rows = await parseCSVObjects(text);

  const map = new Map<string, Station>();

  for (const r of rows) {
    const code = (r['station_code'] || '').trim();
    if (!code) continue;
    let name = (r['stationLabel'] || '').trim();
    if (/^Estação\b/i.test(name)) name = name.replace(/^Estação\s+/i, '').trim();
    if (name.startsWith('Terminal Intermodal')) continue;
    let entry = map.get(code);
    if (!entry) { entry = { id: code, name, lines: [] as LineId[] }; map.set(code, entry); }
    const lab = (r['connecting_lineLabel'] || '').trim();
    if (lab) {
      const mapped = normalizeLineLabel(lab);
      if (!mapped) continue;
      if (!entry.lines.includes(mapped)) entry.lines.push(mapped);
    }
  }
  stationsCache = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  return stationsCache;
}

