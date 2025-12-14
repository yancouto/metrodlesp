import { test, expect, beforeEach } from "vitest";
import { loadState, saveState, loadStats, saveStats } from "../state";
import { STATIONS } from "./testUtils";

beforeEach(() => {
	// Clear storage between tests
	// @ts-ignore
	window.localStorage.clear();
});

test("metro and CPTM modes use separate storage namespaces for state", () => {
	const today = "2025-12-12";
	const metro = loadState(today, STATIONS); // default (metro)
	const cptm = loadState(today, STATIONS, true); // CPTM mode

	// Make different guesses to distinguish
	metro.guesses.push("station-metro");
	cptm.guesses.push("station-cptm");
	saveState(metro);
	saveState(cptm, true);

	const metro2 = loadState(today, STATIONS);
	const cptm2 = loadState(today, STATIONS, true);
	expect(metro2.guesses).toContain("station-metro");
	expect(metro2.guesses).not.toContain("station-cptm");
	expect(cptm2.guesses).toContain("station-cptm");
	expect(cptm2.guesses).not.toContain("station-metro");
});

test("metro and CPTM stats are saved separately", () => {
	const metroStats = loadStats();
	const cptmStats = loadStats(true);

	metroStats.played += 1;
	saveStats(metroStats);

	cptmStats.wins += 1;
	saveStats(cptmStats, true);

	const metro2 = loadStats();
	const cptm2 = loadStats(true);
	expect(metro2.played).toBeGreaterThan(0);
	expect(metro2.wins).toBe(0);
	expect(cptm2.wins).toBeGreaterThan(0);
});
