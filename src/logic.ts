import type {Station} from './stationLoader.js';
import type {Line, LineId} from './lines.js';
import type {GameState} from './state.js';

export function hashString(s: string): number {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

export function normalize(s: string): string {
	return s
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();
}

export function arrayEquals<A>(a: A[], b: A[]): boolean {
	return a.length === b.length && a.every((val, idx) => val === b[idx]);
}

export function pickDailyStation(dateKey: string, stations: Station[]): Station {
	if (dateKey === "2025-10-15") return stations.find(s => s.name === "Ana Rosa")!;
	const idx = hashString('metrodlesp-' + dateKey) % stations.length;
	return stations[idx];
}

export function searchCandidates(query: string, stations: Station[], LINES: Record<string, Line>): Station[] {
	const qn = normalize(query.trim());
	if (!qn) return [];
	const byName = stations.filter(s => normalize(s.name).includes(qn));
	const lineHits: Set<LineId> = new Set();
	(Object.keys(LINES) as LineId[]).forEach((k) => {
		const l = LINES[k];
		if (normalize(l.name).includes(qn) || normalize(String(l.id)).includes(qn)) lineHits.add(l.id);
	});
	const byLine = stations.filter(s => s.lines.some(l => lineHits.has(l)));
	const map = new Map<string, Station>();
	[...byName, ...byLine].forEach(s => map.set(s.id, s));
	return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getKnownLineKnowledge(state: GameState, stations: Station[]): {
	eliminated: Set<LineId>;
	confirmed: Set<LineId>
} {
	const eliminated = new Set<LineId>();
	const confirmed = new Set<LineId>();
	const solution = stations.find(s => s.id === state.solutionId)!;
	for (const gid of state.guesses) {
		const g = stations.find(s => s.id === gid)!;
		for (const l of g.lines) {
			if (solution.lines.includes(l)) confirmed.add(l);
			else eliminated.add(l);
		}
	}
	return {eliminated, confirmed};
}

export function buildShare(
	state: GameState,
	stations: Station[],
	LINES: Record<string, Line>,
	DIST_FROM_SOLUTION: Map<string, number>
): string {
	const solution = stations.find(s => s.id === state.solutionId)!;
	const rows = state.guesses.map(id => {
		const guess = stations.find(s => s.id === id)!;
		const matchSquares = (arrayEquals(guess.lines, solution.lines) ? '🟩' : '⬛');
		if (guess.id === solution.id) return `${matchSquares} 🚆`;
		const distTxt = DIST_FROM_SOLUTION.get(guess.wikidataId)!;
		return `${matchSquares} a ${distTxt} paradas`;
	});
	const attempts = state.status === 'won' ? state.guesses.length : 'X';
	const title = `Metrodle SP ${state.dateKey}`;
	const url = new URL('./', window.location.href).toString();
	// Remove protocol for a cleaner share URL (e.g., metrodle.com.br or yancouto.github.io/metrodlesp/)
	const prettyUrl = url.replace(/^https?:\/\//, '');
	return [title, ...rows, `${attempts}/6`, prettyUrl].join('\n');
}

// Compute an 8-direction Unicode arrow from A->B based on geographic coordinates.
// Returns '' if any coordinate is missing/invalid.
export function directionArrowSymbol(
	from: { lat?: number; lon?: number },
	to: { lat?: number; lon?: number }
): string {
	if (typeof from.lat !== 'number' || typeof from.lon !== 'number' || typeof to.lat !== 'number' || typeof to.lon !== 'number') return '';
	const lat1 = from.lat * Math.PI / 180;
	const lon1 = from.lon * Math.PI / 180;
	const lat2 = to.lat * Math.PI / 180;
	const lon2 = to.lon * Math.PI / 180;
	const dLon = lon2 - lon1;
	const x = Math.cos(lat2) * Math.sin(dLon);
	const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
	let bearing = Math.atan2(x, y) * 180 / Math.PI; // -180..180, 0 = North
	if (isNaN(bearing)) return '';
	bearing = (bearing + 360) % 360; // 0..360
	const dirs = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
	const idx = Math.round(bearing / 45) % 8;
	return dirs[idx];
}
