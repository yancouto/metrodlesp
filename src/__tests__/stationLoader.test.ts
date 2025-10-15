import test from 'node:test';
import assert from 'node:assert/strict';

import {installFetchMock} from './testUtils.js';
import {bfsDistances, loadAdjacencyGraph, loadStations} from '../stationLoader.js';
import {LINES} from '../lines.js';

installFetchMock();

test('loadStations returns well-formed stations and valid lines', async () => {
	const stations = await loadStations();
	assert.ok(Array.isArray(stations), 'stations should be an array');
	assert.ok(stations.length > 0, 'should load at least one station');

	// All station ids are unique
	const ids = new Set(stations.map(s => s.id));
	assert.equal(ids.size, stations.length, 'station ids should be unique');

	// Sorted by name ascending (loader sorts)
	const names = stations.map(s => s.name);
	const sorted = [...names].sort((a, b) => a.localeCompare(b));
	assert.deepEqual(names, sorted, 'stations should be sorted by name');

	// Validate each station's shape and data
	const lineIds = new Set(Object.keys(LINES));
	for (const s of stations) {
		assert.equal(typeof s.id, 'string');
		assert.ok(s.id.length > 0, 'id must be non-empty');
		assert.equal(typeof s.name, 'string');
		assert.ok(s.name.length > 0, 'name must be non-empty');
		assert.ok(!/^Estação\b/i.test(s.name), 'name should not start with "Estação"');
		assert.ok(Array.isArray(s.lines), 'lines must be an array');
		assert.ok(s.lines.length > 0, 'station should have at least one line');
		assert.deepEqual(s.lines, [...s.lines].sort(), 'lines should be sorted');
		assert.equal(typeof (s as any).wikidataId, 'string', 'wikidataId must be present');
		assert.match((s as any).wikidataId, /^Q\d+$/, 'wikidataId should look like Q1234');
		for (const l of s.lines) {
			assert.equal(typeof l, 'string');
			assert.ok(lineIds.has(l), `unknown line id: ${l}`);
		}
	}

	const adj = await loadAdjacencyGraph();
	for (const s of stations) {
		const dist = bfsDistances(s, adj);
		assert.ok(stations.every(ns => dist.has(ns.wikidataId)), 'all stations reachable');
		assert.ok([...dist.values()].every(d => d >= 0), 'distances should be non-negative');
	}
});

test('loadStations cache returns same reference on subsequent calls', async () => {
	const a = await loadStations();
	const b = await loadStations();
	assert.ok(a === b, 'second call should return cached array reference');
});

test('LINES integrity: ids are numeric-like and have name/color', () => {
	for (const [id, line] of Object.entries(LINES)) {
		assert.match(id, /^\d{1,2}$/); // numeric string like '1', '15'
		assert.equal(String(line.id), id);
		assert.equal(typeof line.name, 'string');
		assert.ok(line.name.length > 0);
		assert.equal(typeof line.color, 'string');
		assert.ok(/^#?[0-9a-fA-F]{3,8}$/.test(line.color) || line.color.startsWith('rgb'), 'color should look like a CSS color');
	}
});

test('interchange stations have distance 0 (Consolação-Paulista)', async () => {
	const stations = await loadStations();
	const adj = await loadAdjacencyGraph();

	const consolacao = stations.find(s => s.id === 'CNS');
	const paulista = stations.find(s => s.id === 'PTA');

	assert.ok(consolacao, 'Consolação station should exist');
	assert.ok(paulista, 'Paulista station should exist');

	const distFromConsolacao = bfsDistances(consolacao!, adj);
	const distFromPaulista = bfsDistances(paulista!, adj);

	assert.equal(distFromConsolacao.get(paulista!.wikidataId), 0, 'Distance from Consolação to Paulista should be 0');
	assert.equal(distFromPaulista.get(consolacao!.wikidataId), 0, 'Distance from Paulista to Consolação should be 0');
});

test('Luz to Clínicas distance is 4', async () => {
	const stations = await loadStations();
	const adj = await loadAdjacencyGraph();

	const luz = stations.find(s => s.id === 'LUZ');
	const clinicas = stations.find(s => s.id === 'CLI');

	assert.ok(luz, 'Luz station should exist');
	assert.ok(clinicas, 'Clínicas station should exist');

	const distFromLuz = bfsDistances(luz!, adj);

	assert.equal(distFromLuz.get(clinicas!.wikidataId), 4, 'Distance from Luz to Clínicas should be 4');
});
