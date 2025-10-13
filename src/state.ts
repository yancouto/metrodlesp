import type {Station} from './stationLoader.js';
import {pickDailyStation} from './logic.js';

export type GameState = {
	solutionId: string;
	dateKey: string;
	guesses: string[]; // station ids
	status: 'playing' | 'won' | 'lost';
};

export type Stats = { played: number; wins: number; streak: number; best: number; lastDate?: string; dist: number[] };

const STORAGE_KEY = 'metrodlesp:state';
const STATS_KEY = 'metrodlesp:stats';

export function loadState(dateKey: string, stations: Station[]): GameState {
	const solution = pickDailyStation(dateKey, stations);
	const raw = localStorage.getItem(STORAGE_KEY);
	if (raw) {
		try {
			const state = JSON.parse(raw) as GameState;
			if (state.dateKey === dateKey && state.solutionId === solution.id) {
				return state;
			}
		} catch {
		}
	}
	const init: GameState = {solutionId: solution.id, dateKey, guesses: [], status: 'playing'};
	saveState(init);
	return init;
}

export function saveState(s: GameState) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function loadStats(): Stats {
	const raw = localStorage.getItem(STATS_KEY);
	if (!raw) return {played: 0, wins: 0, streak: 0, best: 0, dist: [0, 0, 0, 0, 0, 0]};
	try {
		return JSON.parse(raw) as Stats;
	} catch {
		return {played: 0, wins: 0, streak: 0, best: 0, dist: [0, 0, 0, 0, 0, 0]};
	}
}

export function saveStats(st: Stats) {
	localStorage.setItem(STATS_KEY, JSON.stringify(st));
}
