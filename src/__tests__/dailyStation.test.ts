import { test, expect } from "vitest";
import { pickDailyStation } from "../logic";
import { STATIONS } from "./testUtils";

test("pickDailyStation is deterministic for a given date", () => {
	const station1 = pickDailyStation("2025-11-05", STATIONS, false);
	const station2 = pickDailyStation("2025-11-05", STATIONS, false);
	expect(station1).toEqual(station2);
});

test("different dates usually yield different stations", () => {
	const station1 = pickDailyStation("2025-11-05", STATIONS, false);
	const station2 = pickDailyStation("2025-11-06", STATIONS, false);
	expect(station1).not.toEqual(station2);
});
