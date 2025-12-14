#!/usr/bin/env node
// Compress src/map/original_lines.geojson into src/map/lines.geojson
// - keep only geometry and properties used by the app: ref and colour/color
// - round coordinates to 5 decimal places (~1.1 m)
// - output minified JSON and report size savings

import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC = path.resolve(ROOT, 'src', 'map', 'original_lines.geojson');
const OUT = path.resolve(ROOT, 'src', 'map', 'lines.geojson');

function roundNum(n, dp = 5) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function roundCoords(coords, dp = 5) {
  if (Array.isArray(coords)) {
    if (coords.length && typeof coords[0] === 'number') {
      // [lon, lat] or [lon, lat, alt]
      return coords.map(v => (typeof v === 'number' ? roundNum(v, dp) : v));
    }
    return coords.map(c => roundCoords(c, dp));
  }
  return coords;
}

function sanitizeFeatureProps(props) {
  const out = {};
  if (!props || typeof props !== 'object') return out;
  if (props.ref != null) out.ref = props.ref;
  // Preserve either spelling if present
  if (props.colour != null) out.colour = props.colour;
  if (props.color != null) out.color = props.color;
  return out;
}

function processGeometry(geom, dp = 5) {
  if (!geom || typeof geom !== 'object') return geom;
  const { type, coordinates, geometries } = geom;
  if (coordinates) {
    return { type, coordinates: roundCoords(coordinates, dp) };
  }
  if (type === 'GeometryCollection' && Array.isArray(geometries)) {
    return { type, geometries: geometries.map(g => processGeometry(g, dp)) };
  }
  return geom;
}

function processFeature(f, dp = 5) {
  return {
    type: 'Feature',
    properties: sanitizeFeatureProps(f.properties),
    geometry: processGeometry(f.geometry, dp),
  };
}

function processCollection(fc, dp = 5) {
  if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    throw new Error('Input is not a GeoJSON FeatureCollection');
  }
  return {
    type: 'FeatureCollection',
    features: fc.features.map(f => processFeature(f, dp)),
  };
}

async function fileSize(p) {
  try {
    const s = await stat(p);
    return s.size;
  } catch {
    return 0;
  }
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

async function main() {
  try {
    const [beforeOriginal, beforeCompressed] = await Promise.all([fileSize(SRC), fileSize(OUT)]);
    const raw = await readFile(SRC, 'utf8');
    const json = JSON.parse(raw);
    const dp = Number.parseInt(process.env.GEOJSON_DP || '5', 10);
    const processed = processCollection(json, dp);
    const outStr = JSON.stringify(processed);
    await writeFile(OUT, outStr, 'utf8');
    const afterCompressed = await fileSize(OUT);
    const saved = beforeOriginal > 0 ? (1 - afterCompressed / beforeOriginal) * 100 : 0;
    console.log('GeoJSON compression complete');
    console.log(`  Source:      ${path.relative(ROOT, SRC)} ${fmtBytes(beforeOriginal)}`);
    console.log(`  Compressed:  ${path.relative(ROOT, OUT)} ${fmtBytes(afterCompressed)}${beforeCompressed ? ` (was ${fmtBytes(beforeCompressed)})` : ''}`);
    if (beforeOriginal > 0) console.log(`  Savings vs source: ${saved.toFixed(1)}%`);
    process.exit(0);
  } catch (e) {
    console.error('Failed to compress lines.geojson:', e?.message || e);
    process.exit(1);
  }
}

await main();
