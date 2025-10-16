import test from 'node:test';
import assert from 'node:assert/strict';

import {directionArrowSymbol} from '../logic.js';

// Helper to make small deltas in degrees
const SP = {lat: -23.5505, lon: -46.6333};

function shift(from: { lat: number, lon: number }, dLat: number, dLon: number) {
	return {lat: from.lat + dLat, lon: from.lon + dLon};
}

test('directionArrowSymbol returns empty when coords missing', () => {
	assert.equal(directionArrowSymbol({}, SP), '');
	assert.equal(directionArrowSymbol(SP, {}), '');
});

test('directionArrowSymbol cardinal directions', () => {
	const north = shift(SP, +0.01, 0);
	const south = shift(SP, -0.01, 0);
	const east = shift(SP, 0, +0.01);
	const west = shift(SP, 0, -0.01);

	assert.equal(directionArrowSymbol(SP, north), '↑');
	assert.equal(directionArrowSymbol(SP, south), '↓');
	assert.equal(directionArrowSymbol(SP, east), '→');
	assert.equal(directionArrowSymbol(SP, west), '←');
});

test('directionArrowSymbol intercardinal directions', () => {
	const ne = shift(SP, +0.01, +0.01);
	const se = shift(SP, -0.01, +0.01);
	const sw = shift(SP, -0.01, -0.01);
	const nw = shift(SP, +0.01, -0.01);

	assert.equal(directionArrowSymbol(SP, ne), '↗');
	assert.equal(directionArrowSymbol(SP, se), '↘');
	assert.equal(directionArrowSymbol(SP, sw), '↙');
	assert.equal(directionArrowSymbol(SP, nw), '↖');
});
