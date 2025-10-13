import test from 'node:test';
import assert from 'node:assert/strict';
import {installFetchMock, installLocalStorageMock} from './testUtils.js';
import {loadStations} from '../stationLoader.js';
import {LINES} from '../lines.js';
import {normalize, searchCandidates} from '../logic.js';

installFetchMock();
installLocalStorageMock();

test('candidate search by station name is diacritics-insensitive and sorted', async () => {
	const stations = await loadStations();
	const res = searchCandidates('Sao', stations, LINES); // should match "São" names
	assert.ok(res.length > 0);
	const names = res.map(s => s.name);
	const sorted = [...names].sort((a, b) => a.localeCompare(b));
	assert.deepEqual(names, sorted, 'results should be sorted by name');
	assert.ok(res.some(s => normalize(s.name).includes('sao')));
});

test('candidate search by line number and name', async () => {
	const stations = await loadStations();
	const redByNum = searchCandidates('3', stations, LINES);
	assert.ok(redByNum.some(s => s.lines.includes('3')));
	const redByName = searchCandidates('Vermelha', stations, LINES);
	assert.ok(redByName.length >= redByNum.length * 0.5, 'should find many Linha 3 stations by name');
});
