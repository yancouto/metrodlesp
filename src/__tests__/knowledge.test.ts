import test from 'node:test';
import assert from 'node:assert/strict';
import {installFetchMock, installLocalStorageMock} from './testUtils.js';
import {loadStations} from '../stationLoader.js';
import {getKnownLineKnowledge} from '../logic.js';

installFetchMock();
installLocalStorageMock();

test('getKnownLineKnowledge confirms and eliminates lines based on guesses', async () => {
	const stations = await loadStations();
	const findByName = (name: string) => stations.find(s => s.name === name)!;
	const SE = findByName('Sé'); // Sé (lines '1' and '3')
	const ANR = findByName('Ana Rosa'); // Ana Rosa ('1','2')
	const TAT = findByName('Tatuapé'); // Tatuapé ('3')

	const state = {solutionId: SE.id, dateKey: '2025-10-12', guesses: [ANR.id, TAT.id], status: 'playing' as const};
	const {eliminated, confirmed} = getKnownLineKnowledge(state, stations);

	// From ANR vs SE: '1' should be confirmed, '2' eliminated
	assert.ok(confirmed.has('1'));
	assert.ok(eliminated.has('2'));
	// From TAT vs SE: '3' confirmed
	assert.ok(confirmed.has('3'));
});
