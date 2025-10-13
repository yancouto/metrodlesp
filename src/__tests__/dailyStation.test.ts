import test from 'node:test';
import assert from 'node:assert/strict';
import {installFetchMock, installLocalStorageMock} from './testUtils.js';
import {loadStations} from '../stationLoader.js';
import {pickDailyStation} from '../logic.js';

installFetchMock();
installLocalStorageMock();

const DATES = ['2025-10-12', '2024-01-01', '2023-06-15'];

test('pickDailyStation is deterministic for a given date', async () => {
	const stations = await loadStations();
	for (const d of DATES) {
		const a = pickDailyStation(d, stations);
		const b = pickDailyStation(d, stations);
		assert.equal(a.id, b.id, `same date ${d} should yield same station`);
	}
});

test('different dates usually yield different stations', async () => {
	const stations = await loadStations();
	const picks = DATES.map(d => pickDailyStation(d, stations).id);
	// Not guaranteed all unique, but should be at least 2 distinct
	assert.ok(new Set(picks).size >= 2, 'expected at least two different stations across sample dates');
});
