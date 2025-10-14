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

# São Paulo Metro station adjacencies
SELECT ?station ?adjacent_station WHERE {
  ?station wdt:P31 wd:Q928830.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
  ?station wdt:P16 wd:Q483343;
    wdt:P5817 wd:Q55654238;
    wdt:P197 ?adjacent_station.
  ?adjacent_station wdt:P5817 wd:Q55654238.
}
ORDER BY (?station)

# São Paulo Metro station interchanges
SELECT ?station ?interchange_station WHERE {
  ?station wdt:P31 wd:Q928830.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
  ?station wdt:P16 wd:Q483343;
    wdt:P5817 wd:Q55654238;
    wdt:P1192 ?interchange_station.
  ?interchange_station wdt:P5817 wd:Q55654238.
}
ORDER BY (?station)

*/

// This module exports an async function `loadStations()` that reads ./src/stations.csv
// and returns Station[] compatible with the game. It aggregates multiple CSV rows per station
// (one per connecting line) into a single Station with unique LineId[] lines.

// Local type shadows to avoid importing from index.ts. Keep in sync with index.ts if changed.
export type LineId = string; // numeric string, e.g., '1', '2', '15'
export interface Station {
	id: string;
	name: string;
	lines: LineId[];
	imageUrl?: string;
	wikidataId: string;
	lat?: number;
	lon?: number;
}

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
	if (m) return m[1];
	if (IGNORED_LINES.has(label)) return undefined;
	throw new Error(`Unknown line: ${raw}`);
}

let stationsCache: Station[] | null = null;

function parsePoint(s: string): { lon: number; lat: number } | null {
	// Expected format: Point(lon lat)
	const m = s.match(/Point\(([-0-9.]+)\s+([-0-9.]+)\)/);
	if (!m) return null;
	return {lon: Number(m[1]), lat: Number(m[2])};
}

function extractQId(url: string): string | null {
	// Expect something like http://www.wikidata.org/entity/Q12345 or https://www.wikidata.org/wiki/Q12345
	const m = url.match(/Q\d+/i);
	return m ? m[0].toUpperCase() : null;
}

export async function loadStations(): Promise<Station[]> {
	if (stationsCache) return stationsCache;
	const url = new URL('./stations.csv', import.meta.url);
	const res = await fetch(url as any, {cache: 'no-cache'});
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
		const wdUrl = (r['station'] || '').trim();
		const wikidataId = extractQId(wdUrl);
		if (!wikidataId) continue; // skip if no wikidata id
		let entry = map.get(code);
		if (!entry) {
			entry = {id: code, name, lines: [] as LineId[], wikidataId};
			map.set(code, entry);
		} else {
			entry.wikidataId = wikidataId;
		}
		// Parse and attach coordinates if present
		const coordRaw = (r['coordinate_location'] || '').trim();
		if (coordRaw) {
			const pt = parsePoint(coordRaw);
			if (pt) {
				entry.lon = pt.lon;
				entry.lat = pt.lat;
			}
		}
		const lab = (r['connecting_lineLabel'] || '').trim();
		if (lab) {
			const mapped = normalizeLineLabel(lab);
			if (!mapped) continue;
			if (!entry.lines.includes(mapped)) {
				entry.lines.push(mapped);
				entry.lines.sort();
			}
		}
	}
	stationsCache = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
	return stationsCache;
}

export type AdjacencyGraph = Map<string, Set<string>>; // wikidataId -> neighbors (wikidataId)
let adjCache: AdjacencyGraph | null = null;
let interchangeCache: Set<string> | null = null; // Set of "Q1-Q2" pairs representing 0-distance connections

function makeInterchangeKey(a: string, b: string): string {
	// Ensure consistent ordering
	return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export async function loadAdjacencyGraph(): Promise<AdjacencyGraph> {
	if (adjCache) return adjCache;
	const url = new URL('./adjacencies.csv', import.meta.url);
	const res = await fetch(url as any, {cache: 'no-cache'});
	if (!res.ok) throw new Error('Falha ao carregar adjacencies.csv');
	const text = await res.text();
	const rows = await parseCSVObjects(text);
	const graph: AdjacencyGraph = new Map();

	function addEdge(a: string, b: string) {
		if (!graph.has(a)) graph.set(a, new Set());
		if (!graph.has(b)) graph.set(b, new Set());
		graph.get(a)!.add(b);
		graph.get(b)!.add(a);
	}

	for (const r of rows) {
		const a = extractQId((r['station'] || '').trim());
		const b = extractQId((r['adjacent_station'] || r['adjacent'] || '').trim());
		if (!a || !b) continue;
		addEdge(a, b);
	}

	// Load interchanges (connections between stations with 0 distance)
	const interchanges = new Set<string>();
	const interchangeUrl = new URL('./interchanges.csv', import.meta.url);
	const interchangeRes = await fetch(interchangeUrl as any, {cache: 'no-cache'});
	if (interchangeRes.ok) {
		const interchangeText = await interchangeRes.text();
		const interchangeRows = await parseCSVObjects(interchangeText);
		for (const r of interchangeRows) {
			const a = extractQId((r['station'] || '').trim());
			const b = extractQId((r['interchange_station'] || '').trim());
			if (!a || !b) continue;
			addEdge(a, b);
			interchanges.add(makeInterchangeKey(a, b));
		}
	}

	adjCache = graph;
	interchangeCache = interchanges;
	return graph;
}

export function bfsDistances(start: Station, graph: AdjacencyGraph): Map<string, number> {
	const dist = new Map<string, number>();
	const q: string[] = [start.wikidataId];
	dist.set(start.wikidataId, 0);
	while (q.length) {
		const cur = q.shift()!;
		const d = dist.get(cur)!;
		const nbrs = graph.get(cur);
		if (!nbrs) continue;
		for (const n of nbrs) {
			if (!dist.has(n)) {
				// Check if this is an interchange (0 distance)
				const isInterchange = interchangeCache?.has(makeInterchangeKey(cur, n)) ?? false;
				dist.set(n, isInterchange ? d : d + 1);
				q.push(n);
			}
		}
	}
	return dist;
}

