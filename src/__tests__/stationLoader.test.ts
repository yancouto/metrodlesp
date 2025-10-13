import test from 'node:test';
import assert from 'node:assert/strict';

// Polyfill fetch for stationLoader to read local CSV in Node
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {bfsDistances, loadAdjacencyGraph, loadStations} from '../stationLoader.js';
import {LINES} from '../lines.js';

// Minimal Response-like object for our loader needs
class SimpleResponse {
	constructor(private body: string, public ok = true) {
	}

	async text() {
		return this.body;
	}
}

// Install a fetch that ignores the incoming URL and reads the CSV from disk.
// stationLoader calls fetch('./src/stations.csv'), but Node's fetch does not
// support relative file paths in all environments. We provide a stable shim.
(globalThis as any).fetch = async (url: URL) => {
	const csvPath = resolve(process.cwd(), 'src', url.pathname.split('/').pop()!);
	const content = await readFile(csvPath, 'utf8');
	return new SimpleResponse(content) as any;
};

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

