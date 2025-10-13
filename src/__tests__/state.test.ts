import test from 'node:test';
import assert from 'node:assert/strict';
import {installFetchMock, installLocalStorageMock} from './testUtils.js';
import {loadStations} from '../stationLoader.js';
import {loadState, loadStats, saveState, saveStats} from '../state.js';

installFetchMock();
installLocalStorageMock();

const DATE_A = '2025-10-12';
const DATE_B = '2025-10-13';

test('loadState initializes when none exists and persists across reloads', async () => {
	const stations = await loadStations();
	const s1 = loadState(DATE_A, stations);
	assert.equal(s1.dateKey, DATE_A);
	assert.ok(s1.solutionId);
	assert.deepEqual(s1.guesses, []);
	assert.equal(s1.status, 'playing');

	// Modify and save
	(s1.guesses as string[]).push(stations[0].id);
	saveState(s1);

	const s2 = loadState(DATE_A, stations);
	assert.deepEqual(s2, s1, 'should load the same state for same day and solution');
});

test('loadState resets for a new day or solution change', async () => {
	const stations = await loadStations();
	loadState(DATE_A, stations);
	// Next day should create a new state
	const b = loadState(DATE_B, stations);
	assert.equal(b.dateKey, DATE_B);
	assert.notEqual(b.solutionId, undefined);
	assert.deepEqual(b.guesses, []);
	assert.equal(b.status, 'playing');
});

test('loadStats/saveStats roundtrip', () => {
	const st0 = loadStats();
	assert.equal(st0.played, 0);
	st0.played = 5;
	st0.wins = 3;
	st0.streak = 2;
	st0.best = 3;
	st0.dist = [0, 1, 1, 1, 0, 0];
	saveStats(st0);
	const st1 = loadStats();
	assert.deepEqual(st1, st0);
});
