import type {Station} from "./stationLoader.js";
import {pickDailyStation} from "./logic.js";

export type GameState = {
	solutionId: string;
	dateKey: string;
	guesses: string[]; // station ids
	status: "playing" | "won" | "lost";
	// Persist whether hard mode should be considered for sharing for this day's game/state
	// This allows consistent share suffix even if the user toggles mid-game.
	hardModeUsed?: boolean;
};

export type Stats = {
	played: number;
	wins: number;
	streak: number;
	best: number;
	lastDate?: string;
	dist: number[];
};

const STORAGE_KEY = "metrodlesp:state";
const STORAGE_KEY_CPTM = "metrodlesp:state:cptm";
const STATS_KEY = "metrodlesp:stats";
const STATS_KEY_CPTM = "metrodlesp:stats:cptm";
const HARD_MODE_KEY = "metrodlesp:hardMode";
const INCLUDE_CPTM_KEY = "metrodlesp:includeCPTM";
const CPTM_PROMPT_SEEN_KEY = "metrodlesp:cptmPromptSeenV1";
const DEBUG_STATIONS_LOG = false;

export function loadHardMode(): boolean {
	const raw = localStorage.getItem(HARD_MODE_KEY);
	return raw === "true";
}

export function saveHardMode(isEnabled: boolean) {
    localStorage.setItem(HARD_MODE_KEY, String(isEnabled));
}

// CPTM mode (include CPTM train stations)
export function loadIncludeCPTM(): boolean {
    try {
        const raw = localStorage.getItem(INCLUDE_CPTM_KEY);
        return raw === "true";
    } catch {
        return false;
    }
}

export function saveIncludeCPTM(isEnabled: boolean) {
    try {
        localStorage.setItem(INCLUDE_CPTM_KEY, String(isEnabled));
    } catch {}
}

export function loadCptmPromptSeen(): boolean {
    try {
        return localStorage.getItem(CPTM_PROMPT_SEEN_KEY) === "1";
    } catch {
        return false;
    }
}

export function saveCptmPromptSeen() {
    try {
        localStorage.setItem(CPTM_PROMPT_SEEN_KEY, "1");
    } catch {}
}

export function loadState(dateKey: string, stations: Station[], includeCPTM: boolean = false): GameState {
	if (DEBUG_STATIONS_LOG) {
		if (stations && stations.length) {
			const today = new Date(dateKey);
			for (let i = 0; i < 30; i++) {
				const d = new Date(today);
				d.setDate(today.getDate() - i);
				const debugDateKey = d.toISOString().slice(0, 10);
				try {
					const station = pickDailyStation(debugDateKey, stations);
					console.log(debugDateKey, station?.name, station?.id);
				} catch (e) {
					console.log(debugDateKey, "ERROR", e);
				}
			}
		}
	}
	const solution = pickDailyStation(dateKey, stations);
	if ((import.meta as any).env?.DEV) console.log('DEV', solution);
	const key = includeCPTM ? STORAGE_KEY_CPTM : STORAGE_KEY;
	const raw = localStorage.getItem(key);
	if (raw) {
		try {
			const state = JSON.parse(raw) as GameState;
			if (state.dateKey === dateKey && state.solutionId === solution.id) {
				return state;
			}
		} catch {}
	}
	const init: GameState = {
		solutionId: solution.id,
		dateKey,
		guesses: [],
		status: "playing",
		hardModeUsed: loadHardMode(),
	};
	saveState(init, includeCPTM);
	return init;
}

export function saveState(s: GameState, includeCPTM: boolean = false) {
	const key = includeCPTM ? STORAGE_KEY_CPTM : STORAGE_KEY;
	localStorage.setItem(key, JSON.stringify(s));
}

export function loadStats(includeCPTM: boolean = false): Stats {
	const key = includeCPTM ? STATS_KEY_CPTM : STATS_KEY;
	const raw = localStorage.getItem(key);
	if (!raw) return { played: 0, wins: 0, streak: 0, best: 0, dist: [0, 0, 0, 0, 0, 0] };
	try {
		return JSON.parse(raw) as Stats;
	} catch {
		return { played: 0, wins: 0, streak: 0, best: 0, dist: [0, 0, 0, 0, 0, 0] };
	}
}

export function saveStats(st: Stats, includeCPTM: boolean = false) {
	const key = includeCPTM ? STATS_KEY_CPTM : STATS_KEY;
	localStorage.setItem(key, JSON.stringify(st));
}
