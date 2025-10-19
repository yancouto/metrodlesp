import test from 'node:test';
import assert from 'node:assert/strict';
import {installFetchMock, installLocalStorageMock, installWindowLocationMock} from './testUtils.js';
import {bfsDistances, loadAdjacencyGraph, loadStations} from '../stationLoader.js';
import {buildShare} from '../logic.js';
import {LINES} from '../lines.js';

installFetchMock();
installLocalStorageMock();
installWindowLocationMock('https://yancouto.github.io/metrodlesp/');

test('share text includes title, per-guess lines, attempts, and distances', async () => {
	const stations = await loadStations();
	const findByName = (name: string) => stations.find(s => s.name === name)!;
	const SE = findByName('Sé');
	const ANR = findByName('Ana Rosa');
	const REP = findByName('República');

	const adj = await loadAdjacencyGraph();
	const distMap = bfsDistances(SE, adj);

	const state = {solutionId: SE.id, dateKey: '2025-10-12', guesses: [ANR.id, REP.id, SE.id], status: 'won' as const};
	const text = buildShare(state, stations, LINES, distMap);
	const lines = text.split('\n');
	assert.ok(lines[0].startsWith('Metrodle SP 2025-10-12'));
	// title + 3 guesses + attempts line + placeholder = 6 lines total
	assert.equal(lines.length, 6);
	assert.match(lines[1], /⬛ a \d+ paradas/);
	assert.match(lines[2], /⬛ a \d+ paradas/);
	assert.match(lines[3], /🟩 🚆/);
	assert.equal(lines[4], '3/6');
	assert.equal(lines[5], 'https://yancouto.github.io/metrodlesp/');
});
