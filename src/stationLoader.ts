/* Query used in WikiData (as reference):

We query them from: https://query.wikidata.org/

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
SELECT DISTINCT ?station ?adjacent_station WHERE {
  ?station wdt:P31/wdt:P279* wd:Q928830; # station is metro station
    wdt:P16 wd:Q483343; # is in SP Metro
    wdt:P5817 wd:Q55654238; # is in use
    p:P197 ?adjacent_station_prop. # adjacent statement
  ?adjacent_station_prop ps:P197 ?adjacent_station; # adjacent station
    (pq:P81|pq:P1192) ?connecting_line. # through this line
  ?connecting_line wdt:P16 wd:Q483343; # connecting line from SP metro
    wdt:P5817 wd:Q55654238. # and in use
  ?adjacent_station wdt:P5817 wd:Q55654238. # adjacent line in use
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
}
ORDER BY ?station ?adjacent_station

# São Paulo Metro station interchanges
SELECT ?station ?interchange_station WHERE {
  ?station wdt:P31/wdt:P279* wd:Q928830; # is a subway station
    wdt:P16 wd:Q483343; # in SP subway
    wdt:P5817 wd:Q55654238; # in use
    wdt:P833 ?interchange_station. # interchanges with this
  ?interchange_station wdt:P31/wdt:P279* wd:Q928830; # is a subway station
    wdt:P16 wd:Q483343; # in SP subway
    wdt:P5817 wd:Q55654238; # in use
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
}
ORDER BY (?station)

# All stations
SELECT DISTINCT ?station ?connecting_line ?connecting_lineLabel ?coordinate_location ?stationLabel WHERE {
  VALUES ?network { wd:Q483343 wd:Q110914375 }
  ?station wdt:P16 ?network; # its transport network is São Paulo Metropolitan Trains
           wdt:P31/wdt:P279* wd:Q55488; # station is railway station
           wdt:P5817 wd:Q55654238; # it is in use
           (wdt:P1192|wdt:P81) ?connecting_line.
  OPTIONAL { ?station wdt:P625 ?coordinate_location. }
  ?connecting_line wdt:P5817 wd:Q55654238. # line is in use
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
}
ORDER BY (?stationLabel)

# All adjacencies
SELECT DISTINCT ?station ?adjacent_station WHERE {
  VALUES ?network { wd:Q483343 wd:Q110914375 }
  VALUES ?network2 { wd:Q483343 wd:Q110914375 }
  ?station wdt:P31/wdt:P279* wd:Q55488; # station is railway station
    wdt:P16 ?network; # in CPTM+Metro
    wdt:P5817 wd:Q55654238; # in use
    p:P197 ?adjacent_station_prop. # adjacent station property
  ?adjacent_station_prop ps:P197 ?adjacent_station; # the adjacent station
    (pq:P81|pq:P1192) ?connecting_line. # the connecting line
  ?adjacent_station wdt:P5817 wd:Q55654238. # adjacent station in use
  ?connecting_line wdt:P16 ?network2; # connecting line in CPTM
    wdt:P5817 wd:Q55654238. # and in use
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
}
ORDER BY ?station ?adjacent_station

# All interchanges: No new one?
SELECT ?station ?interchange_station WHERE {
  VALUES ?network { wd:Q483343 wd:Q110914375 }
  VALUES ?network2 { wd:Q483343 wd:Q110914375 }
  ?station wdt:P31/wdt:P279* wd:Q55488; # is a subway station
    wdt:P16 ?network; # in SP subway
    wdt:P5817 wd:Q55654238; # in use
    wdt:P833 ?interchange_station. # interchanges with this
  ?interchange_station wdt:P31/wdt:P279* wd:Q55488; # is a subway station
    wdt:P16 ?network2; # in SP subway/CPTM
    wdt:P5817 wd:Q55654238; # in use
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
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
	const headers = lines[0].split(",").map(h => h.trim());
	const rows: Record<string, string>[] = [];
	for (let i = 1; i < lines.length; i++) {
		const cols = lines[i].split(",");
		if (cols.length === 0) continue;
		const obj: Record<string, string> = {};
		for (let c = 0; c < headers.length; c++) {
			obj[headers[c]] = (cols[c] ?? "").trim();
		}
		rows.push(obj);
	}
	return rows;
}

function slugify(ptName: string): string {
	return ptName
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "");
}

const IGNORED_LINES = new Set(["Ramal de São Paulo", "Expresso Turístico", "Expresso Linha 10"]);

function normalizeLineLabel(label: string): LineId | undefined {
	const raw = label
		.replace(/\u2013|\u2014|–|—/g, "-")
		.replace(/linha\s*/i, "")
		.trim();
	// try to extract leading number
	const m = raw.match(/^(\d{1,2})\b/);
	if (m) return m[1];
	if (IGNORED_LINES.has(label)) return undefined;
	throw new Error(`Unknown line: ${raw}`);
}

const stationsCache: { base: Station[] | null; cptm: Station[] | null } = {base: null, cptm: null};
// Map each original wikidata id to its merged representative wikidata id (per mode)
const idToRepCache: { base: Map<string, string> | null; cptm: Map<string, string> | null } = {base: null, cptm: null};

function parsePoint(s: string): { lon: number; lat: number } | null {
	// Expected format: Point(lon lat)
	const m = s.match(/Point\(([-0-9.]+)\s+([-0-9.]+)\)/);
	if (!m) return null;
	return { lon: Number(m[1]), lat: Number(m[2]) };
}

function extractQId(url: string): string {
	// Expect something like http://www.wikidata.org/entity/Q12345 or https://www.wikidata.org/wiki/Q12345
	const m = url.match(/Q\d+/i);
	if (!m) throw new Error(`Invalid wikidata id: ${url}`);
	return m[0].toUpperCase();
}

export type LoadStationsOptions = {
    includeCPTM?: boolean;
};

function normalizeNameForCanon(n: string): string {
	let s = n.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
	// Remove known prefixes
	s = s.replace(/^(estacao|estação)\s+/i, "");
	s = s.replace(/^terminal\s+intermodal\s+/i, "");
	// Drop parenthetical suffixes like (metrô), (CPTM)
	s = s.replace(/\s*\([^)]*\)\s*/g, " ");
	// Remove leading Portuguese articles
	s = s.replace(/^(da|de|do|das|dos)\s+/i, "");
	// Collapse whitespace
	return s.replace(/\s+/g, " ").trim();
}

function startsWithArticlePT(name: string): boolean {
	return /^(da|de|do|das|dos)\s+/i.test(name);
}

function hasTerminalPrefix(name: string): boolean {
	return /^\s*terminal\s+intermodal\b/i.test(name);
}

function chooseRepresentative(a: Station, b: Station): Station {
	// Prefer variant without leading article; then without Terminal Intermodal; then shorter name
	const aArt = startsWithArticlePT(a.name);
	const bArt = startsWithArticlePT(b.name);
	if (aArt !== bArt) return aArt ? b : a;
	const aTerm = hasTerminalPrefix(a.name);
	const bTerm = hasTerminalPrefix(b.name);
	if (aTerm !== bTerm) return aTerm ? b : a;
	return a.name.length <= b.name.length ? a : b;
}

export async function loadStations(_opts: LoadStationsOptions = {}): Promise<Station[]> {
	const includeCPTM = !!_opts.includeCPTM;
	const cacheKey = includeCPTM ? "cptm" : "base";
	const cached = stationsCache[cacheKey as keyof typeof stationsCache];
	if (cached) return cached as Station[];

	const url = includeCPTM
		? new URL("./data/stations_with_cptm.csv", import.meta.url)
		: new URL("./stations.csv", import.meta.url);
    const res = await fetch(url as any, { cache: "no-cache" });
    if (!res.ok) throw new Error("Falha ao carregar stations.csv");
    const text = await res.text();
	const rows = await parseCSVObjects(text);

	const byId = new Map<string, Station>();

	for (const r of rows) {
		// Don't use station code because one station might have multiple codes
		let name = r["stationLabel"]
			.replace(/^Estação\s+/i, "")
			.replace(/^Terminal Intermodal\s+/i, "")
			.replace(/\s*\(metrô\)\s*/i, "")
			.trim();
		const wikidataId = extractQId(r["station"])!;
		let entry = byId.get(wikidataId);
		if (!entry) {
			entry = { id: wikidataId, name, lines: [] as LineId[], wikidataId };
			byId.set(wikidataId, entry);
		}
		// Parse and attach coordinates if present
		const coordRaw = (r["coordinate_location"] || "").trim();
		if (coordRaw) {
			const pt = parsePoint(coordRaw);
			if (pt) {
				entry.lon = pt.lon;
				entry.lat = pt.lat;
			}
		}
		const lab = (r["connecting_lineLabel"] || "").trim();
		if (lab) {
			const mapped = normalizeLineLabel(lab);
			if (!mapped) continue;
			if (!entry.lines.includes(mapped)) {
				entry.lines.push(mapped);
				entry.lines.sort();
			}
		}
	}

	// Merge by canonical name
	const groups = new Map<string, Station[]>();
	for (const st of byId.values()) {
		const key = normalizeNameForCanon(st.name);
		const arr = groups.get(key);
		if (arr) arr.push(st);
		else groups.set(key, [st]);
	}

	const idToRep = new Map<string, string>();
	const merged: Station[] = [];
	for (const arr of groups.values()) {
		// choose representative among variants
		let rep = arr[0];
		for (let i = 1; i < arr.length; i++) rep = chooseRepresentative(rep, arr[i]);
		const unionLines = Array.from(new Set(arr.flatMap(s => s.lines))).sort();
		// Prefer coordinates from representative; if missing, take first available
		let lat = rep.lat, lon = rep.lon;
		if (typeof lat !== "number" || typeof lon !== "number") {
			for (const s of arr) {
				if (typeof s.lat === "number" && typeof s.lon === "number") {
					lat = s.lat;
					lon = s.lon;
					break;
				}
			}
		}
		const repStation: Station = {id: rep.id, wikidataId: rep.wikidataId, name: rep.name, lines: unionLines};
		if (typeof lat === "number" && typeof lon === "number") {
			repStation.lat = lat;
			repStation.lon = lon;
		}
		merged.push(repStation);
		for (const s of arr) idToRep.set(s.id, rep.id);
	}

	// Cache id mapping for this mode
	(idToRepCache as any)[cacheKey] = idToRep;
	// Sort and cache stations
	merged.sort((a, b) => a.name.localeCompare(b.name));
	(stationsCache as any)[cacheKey] = merged;
	return merged;
}

// Based on wikidata ids
// interchanges are 0-cost transfers
export type AdjacencyGraph = {
	adjacent: Map<string, Set<string>>;
	interchange: Map<string, Set<string>>;
};
const adjCache: { base: AdjacencyGraph | null; cptm: AdjacencyGraph | null } = {base: null, cptm: null};

export async function loadAdjacencyGraph(_opts: { includeCPTM?: boolean } = {}): Promise<AdjacencyGraph> {
	const includeCPTM = !!_opts.includeCPTM;
	const cacheKey = includeCPTM ? "cptm" : "base";
	const cached = adjCache[cacheKey as keyof typeof adjCache];
	if (cached) return cached as AdjacencyGraph;

	const adjUrl = includeCPTM
		? new URL("./data/adjacencies_with_cptm.csv", import.meta.url)
		: new URL("./adjacencies.csv", import.meta.url);
	const interUrl = includeCPTM
		? new URL("./data/interchanges_with_cptm.csv", import.meta.url)
		: new URL("./interchanges.csv", import.meta.url);
	// Load raw graphs keyed by original ids
	const [rawAdjacent, rawInter] = await Promise.all([loadAdjacencyCsv(adjUrl, "station", "adjacent_station"), loadAdjacencyCsv(interUrl, "station", "interchange_station")]);

	// Ensure we have the id→representative mapping for this mode
	let idToRep = idToRepCache[cacheKey as keyof typeof idToRepCache];
	if (!idToRep) {
		await loadStations({includeCPTM});
		idToRep = idToRepCache[cacheKey as keyof typeof idToRepCache] || new Map();
	}
	const toRep = (id: string) => idToRep!.get(id) || id;

	function remap(graph: Map<string, Set<string>>): Map<string, Set<string>> {
		const out = new Map<string, Set<string>>();
		for (const [a, set] of graph.entries()) {
			const ra = toRep(a);
			for (const b of set) {
				const rb = toRep(b);
				if (ra === rb) continue; // collapse self-loops created by merging
				if (!out.has(ra)) out.set(ra, new Set());
				out.get(ra)!.add(rb);
			}
		}
		return out;
	}

	const built: AdjacencyGraph = {
		adjacent: remap(rawAdjacent),
		interchange: remap(rawInter),
	};
	(adjCache as any)[cacheKey] = built;
	return built;
}

export async function loadAdjacencyCsv(url: URL, a: string, b: string): Promise<Map<string, Set<string>>> {
	const res = await fetch(url, { cache: "no-cache" });
	if (!res.ok) throw new Error("Falha ao carregar adjacencies.csv");
	const text = await res.text();
	const rows = await parseCSVObjects(text);
	const graph = new Map();

	function addEdge(a: string, b: string) {
		if (!graph.has(a)) graph.set(a, new Set());
		graph.get(a)!.add(b);
	}

	for (const r of rows) addEdge(extractQId(r[a]), extractQId(r[b]));
	return graph;
}

export function bfsDistances(start: Station, graph: AdjacencyGraph): Map<string, number> {
	// 0-1 BFS using a deque; zeroGraph edges cost 0, graph edges cost 1
	const dist = new Map<string, number>();
	const deque: string[] = [];
	// eew, shift and unshift are linear
	const pushFront = (v: string) => deque.unshift(v);
	const pushBack = (v: string) => deque.push(v);
	const popFront = () => deque.shift()!;

	dist.set(start.wikidataId, 0);
	pushFront(start.wikidataId);
	while (deque.length) {
		const cur = popFront();
		const d = dist.get(cur)!;
		// Zero-cost neighbors first
		const zeros = graph.interchange.get(cur);
		if (zeros) {
			for (const n of zeros) {
				const nd = d; // zero cost
				if (!dist.has(n) || nd < dist.get(n)!) {
					dist.set(n, nd);
					pushFront(n);
				}
			}
		}
		// Cost-1 neighbors
		const nbrs = graph.adjacent.get(cur);
		if (nbrs) {
			for (const n of nbrs) {
				const nd = d + 1;
				if (!dist.has(n) || nd < dist.get(n)!) {
					dist.set(n, nd);
					pushBack(n);
				}
			}
		}
	}
	return dist;
}
