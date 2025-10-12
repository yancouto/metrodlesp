/* Query used in WikiData (as reference):

# São Paulo Metro stations
SELECT ?station ?connecting_line ?connecting_lineLabel ?coordinate_location ?station_code ?stationLabel WHERE {
  ?station wdt:P31 wd:Q928830.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
  ?station wdt:P16 wd:Q483343.
  OPTIONAL { ?station wdt:P81 ?connecting_line. }
  OPTIONAL { ?station wdt:P625 ?coordinate_location. }
  OPTIONAL { ?station wdt:P296 ?station_code. }
  ?station wdt:P5817 wd:Q55654238.
}
ORDER BY (?stationLabel)

*/

// This module exports an async function `loadStations()` that reads ./src/stations.csv
// and returns Station[] compatible with the game. It aggregates multiple CSV rows per station
// (one per connecting line) into a single Station with unique LineId[] lines.

// Local type shadows to avoid importing from index.ts. Keep in sync with index.ts if changed.
export type LineId = '1-Azul' | '2-Verde' | '3-Vermelha' | '4-Amarela' | '5-Lilás' | '15-Prata' | '8-Diamante' | '9-Esmeralda' | '10-Turquesa' | '11-Coral' | '12-Safira' | '13-Jade' | '7-Rubi';
export interface Station { id: string; name: string; lines: LineId[]; imageUrl?: string; }

// CSV parsing that supports quoted fields and commas inside quotes.
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* ignore */ }
      else { field += c; }
    }
  }
  // push last
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
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

// Map various Wikidata line labels to our LineId.
const LINE_BY_NUMBER: Record<string, LineId> = {
  '1': '1-Azul',
  '2': '2-Verde',
  '3': '3-Vermelha',
  '4': '4-Amarela',
  '5': '5-Lilás',
  '7': '7-Rubi',
  '8': '8-Diamante',
  '9': '9-Esmeralda',
  '10': '10-Turquesa',
  '11': '11-Coral',
  '12': '12-Safira',
  '13': '13-Jade',
  '15': '15-Prata',
};

function normalizeLineLabel(label: string): LineId | undefined {
  if (!label) return undefined;
  const raw = label
    .replace(/\u2013|\u2014|–|—/g, '-')
    .replace(/linha\s*/i, '')
    .trim();
  // try to extract leading number
  const m = raw.match(/^(\d{1,2})\b/);
  if (m && LINE_BY_NUMBER[m[1]]) return LINE_BY_NUMBER[m[1]];
  // fallback by color keywords
  const low = raw.toLowerCase();
  if (low.includes('azul')) return '1-Azul';
  if (low.includes('verde')) return '2-Verde';
  if (low.includes('vermelh')) return '3-Vermelha';
  if (low.includes('amarel')) return '4-Amarela';
  if (low.includes('lil')) return '5-Lilás';
  if (low.includes('prata') || low.includes('silver')) return '15-Prata';
  if (low.includes('rubi')) return '7-Rubi';
  if (low.includes('diamante')) return '8-Diamante';
  if (low.includes('esmeralda')) return '9-Esmeralda';
  if (low.includes('turquesa')) return '10-Turquesa';
  if (low.includes('coral')) return '11-Coral';
  if (low.includes('safira')) return '12-Safira';
  if (low.includes('jade')) return '13-Jade';
  return undefined;
}

let stationsCache: Station[] | null = null;

export async function loadStations(): Promise<Station[]> {
  if (stationsCache) return stationsCache;
  const url = './src/stations.csv';
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error('Falha ao carregar stations.csv');
  const text = await res.text();
  const rows = parseCSV(text);
  if (!rows.length) return (stationsCache = []);
  const header = rows[0].map(h => h.trim());
  const idxStationLabel = header.indexOf('stationLabel');
  const idxLineLabel = header.indexOf('connecting_lineLabel');
  if (idxStationLabel === -1) throw new Error('CSV sem coluna stationLabel');
  const map = new Map<string, Station>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const name = (r[idxStationLabel] || '').trim();
    if (!name) continue;
    const id = slugify(name);
    let entry = map.get(id);
    if (!entry) { entry = { id, name, lines: [] as LineId[] }; map.set(id, entry); }
    if (idxLineLabel !== -1) {
      const lab = (r[idxLineLabel] || '').trim();
      const mapped = normalizeLineLabel(lab);
      if (mapped && !entry.lines.includes(mapped)) entry.lines.push(mapped);
    }
  }
  stationsCache = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  return stationsCache;
}

