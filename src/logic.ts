import type { Station } from "./stationLoader.js";
import type { Line, LineId } from "./lines.js";
import type { GameState } from "./state.js";
import { AleaPRNG, aleaPRNG } from "./aleaPRNG.js";

function oldHashString(s: string): number {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

export function normalize(s: string): string {
	return s
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();
}

export function arrayEquals<A>(a: A[], b: A[]): boolean {
	return a.length === b.length && a.every((val, idx) => val === b[idx]);
}

export function pickDailyStation(dateKey: string, stations: Station[]): Station {
	if (dateKey >= "2025-11-03") {
		// Calculate the day number since a fixed epoch
		const epoch = new Date("2025-11-01");
		const today = new Date(dateKey);
		const dayNum = Math.floor((today.getTime() - epoch.getTime()) / (1000 * 60 * 60 * 24));
		const N = stations.length;
		const cycleNum = Math.floor(dayNum / N);
		const idxInCycle = dayNum % N;

		// Use AleaPRNG seeded with cycleNum for shuffle
		const prng = aleaPRNG(cycleNum.toString());

		// Fisher-Yates shuffle
		function shuffleArray<T>(arr: T[], prng: AleaPRNG): T[] {
			const a = arr.slice();
			for (let i = a.length - 1; i > 0; i--) {
				const j = Math.floor(prng.range(0, i));
				[a[i], a[j]] = [a[j], a[i]];
			}
			return a;
		}

		const shuffled = shuffleArray(stations, prng);
		return shuffled[idxInCycle];
	} else if (dateKey >= "2025-10-25") {
		const idx = oldHashString("metrodlesp8:" + dateKey);
		return stations[idx % stations.length];
	} else {
		const idx = oldHashString("metrodlesp-" + dateKey);
		return stations[idx % stations.length];
	}
}

export function searchCandidates(query: string, stations: Station[], LINES: Record<string, Line>): Station[] {
	const qn = normalize(query.trim());
	if (!qn) return [];
	const byName = stations.filter(s => normalize(s.name).includes(qn));
	const lineHits: Set<LineId> = new Set();
	(Object.keys(LINES) as LineId[]).forEach(k => {
		const l = LINES[k];
		if (normalize(l.name).includes(qn) || normalize(String(l.id)).includes(qn)) lineHits.add(l.id);
	});
	const byLine = stations.filter(s => s.lines.some(l => lineHits.has(l)));
	const map = new Map<string, Station>();
	[...byName, ...byLine].forEach(s => map.set(s.id, s));
	return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getLineMatchSquare(guessLines: LineId[], solutionLines: LineId[]): string {
	const exactMatch = arrayEquals(guessLines, solutionLines);
	if (exactMatch) {
		return "🟩";
	}
	const partialMatch = guessLines.some(line => solutionLines.includes(line));
	if (partialMatch) {
		return "🟨";
	}
	return "⬛";
}

export function getKnownLineKnowledge(
	state: GameState,
	stations: Station[],
): {
	eliminated: Set<LineId>;
	confirmed: Set<LineId>;
} {
	const eliminated = new Set<LineId>();
	const confirmed = new Set<LineId>();
	const solution = stations.find(s => s.id === state.solutionId)!;
	for (const gid of state.guesses) {
		const g = stations.find(s => s.id === gid)!;
		for (const l of g.lines) {
			if (solution.lines.includes(l)) {
				confirmed.add(l);
			} else {
				eliminated.add(l);
			}
		}
	}
	return { eliminated, confirmed };
}

export function buildShare(
    state: GameState,
    stations: Station[],
    LINES: Record<string, Line>,
    DIST_FROM_SOLUTION: Map<string, number>,
    hardMode: boolean,
    includeCPTM: boolean = false,
): string {
	const solution = stations.find(s => s.id === state.solutionId)!;
	const rows = state.guesses.map(id => {
		const guess = stations.find(s => s.id === id)!;
		const matchSquares = getLineMatchSquare(guess.lines, solution.lines);
		if (guess.id === solution.id) return `${matchSquares} 🚆`;
		const distTxt = DIST_FROM_SOLUTION.get(guess.wikidataId)!;
		return `${matchSquares} a ${distTxt} paradas`;
	});
 const attempts = state.status === "won" ? state.guesses.length : "X";
 // Title suffix per mode: (CPTM), (⚔️), (CPTM+⚔️)
 let suffix = "";
 if (includeCPTM && hardMode) suffix = " (CPTM+⚔️)";
 else if (includeCPTM) suffix = " (CPTM)";
 else if (hardMode) suffix = " (⚔️)";
 const title = `Metrodle SP ${state.dateKey}${suffix}`;
	// Remove protocol for a cleaner share URL (e.g., metrodle.com.br or yancouto.github.io/metrodlesp/)
	const url = new URL("./", window.location.href).toString().replace(/^https?:\/\//, "").replace(/\/$/, "");
	const prettyUrl = `#metrodlesp ${url}`;
	return [title, ...rows, `${attempts}/6`, prettyUrl].join("\n");
}

export function buildShareImageHTML(
    state: GameState,
    stations: Station[],
    LINES: Record<string, Line>,
    DIST_FROM_SOLUTION: Map<string, number>,
    hardMode: boolean,
    includeCPTM: boolean = false,
): string {
	const solution = stations.find(s => s.id === state.solutionId)!;
	const rows = state.guesses.map(id => {
		const guess = stations.find(s => s.id === id)!;
		const matchSquares = getLineMatchSquare(guess.lines, solution.lines);
		if (guess.id === solution.id) return `<div>${matchSquares} 🚆</div>`;
		const distTxt = DIST_FROM_SOLUTION.get(guess.wikidataId)!;
		return `<div>${matchSquares} a ${distTxt} paradas</div>`;
	});
 const attempts = state.status === "won" ? state.guesses.length : "X";
 let suffix = "";
 if (includeCPTM && hardMode) suffix = " (CPTM+⚔️)";
 else if (includeCPTM) suffix = " (CPTM)";
 else if (hardMode) suffix = " (⚔️)";
 const title = `<h2>Metrodle SP ${state.dateKey}${suffix}</h2>`;
	const url = new URL("./", window.location.href).toString().replace(/^https?:\/\//, "");
	const prettyUrl = `<div class="url">${url}</div>`;
	return `<div class="share-image">
        <img src="/logo.png" alt="Metrodle SP Logo" class="logo">
        ${title}
        <div class="rows">${rows.join("")}</div>
        <div class="attempts">${attempts}/6</div>
        ${prettyUrl}
    </div>`;
}

// Compute an 8-direction Unicode arrow from A->B based on geographic coordinates.
// Returns '' if any coordinate is missing/invalid.
export function getDailyRotation(dateKey: string): number {
	const prng = aleaPRNG("rotation:" + dateKey);
	return Math.floor(prng.range(1, 360));
}

export function directionArrowSymbol(from: { lat?: number; lon?: number }, to: { lat?: number; lon?: number }): string {
	if (
		typeof from.lat !== "number" ||
		typeof from.lon !== "number" ||
		typeof to.lat !== "number" ||
		typeof to.lon !== "number"
	)
		return "";
	const lat1 = (from.lat * Math.PI) / 180;
	const lon1 = (from.lon * Math.PI) / 180;
	const lat2 = (to.lat * Math.PI) / 180;
	const lon2 = (to.lon * Math.PI) / 180;
	const dLon = lon2 - lon1;
	const x = Math.cos(lat2) * Math.sin(dLon);
	const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
	let bearing = (Math.atan2(x, y) * 180) / Math.PI; // -180..180, 0 = North
	if (isNaN(bearing)) return "";
	bearing = (bearing + 360) % 360; // 0..360
	const dirs = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
	const idx = Math.round(bearing / 45) % 8;
	return dirs[idx];
}
