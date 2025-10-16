import test from 'node:test';
import assert from 'node:assert/strict';

import {directionArrowSymbol, normalize} from '../logic.js';

// Very small sanity tests to demonstrate how to add a test in this repo

test('normalize removes diacritics and lowercases', () => {
	assert.equal(normalize('Água Branca'), 'agua branca');
	assert.equal(normalize('  Sé  ').trim(), 'se');
});

test('directionArrowSymbol basic behavior', () => {
	const SP = {lat: -23.5505, lon: -46.6333};
	const east = {lat: SP.lat, lon: SP.lon + 0.01};
	assert.equal(directionArrowSymbol(SP, east), '→');

	// Missing coords returns empty string
	assert.equal(directionArrowSymbol({}, east), '');
});
