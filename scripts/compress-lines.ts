// ESM TypeScript script to compress src/map/original_lines.geojson into src/map/lines.geojson
// - Keeps only geometry and properties: ref, colour/color
// - Rounds coordinates to GEOJSON_DP (default 5)
// - Prints size report

import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SRC = path.resolve(ROOT, "src", "map", "original_lines.geojson");
const OUT = path.resolve(ROOT, "src", "map", "lines.geojson");

type Position = number[]; // [lng, lat, ...]
type Geometry =
	| { type: "Point"; coordinates: Position }
	| { type: "MultiPoint"; coordinates: Position[] }
	| { type: "LineString"; coordinates: Position[] }
	| { type: "MultiLineString"; coordinates: Position[][] }
	| { type: "Polygon"; coordinates: Position[][] }
	| { type: "MultiPolygon"; coordinates: Position[][][] }
	| { type: "GeometryCollection"; geometries: Geometry[] };

type Feature = {
	type: "Feature";
	geometry: Geometry | null;
	properties?: Record<string, any> | null;
};

type FeatureCollection = {
	type: "FeatureCollection";
	features: Feature[];
};

function roundNum(n: number, dp: number): number {
	const f = Math.pow(10, dp);
	return Math.round(n * f) / f;
}

function roundCoords(pos: Position, dp: number): Position {
	return pos.map(v => (typeof v === "number" ? roundNum(v, dp) : v)) as Position;
}

function roundGeometry(geom: Geometry | null, dp: number): Geometry | null {
	if (!geom) return null;
	switch (geom.type) {
		case "Point":
			return { type: "Point", coordinates: roundCoords(geom.coordinates, dp) };
		case "MultiPoint":
			return { type: "MultiPoint", coordinates: geom.coordinates.map(c => roundCoords(c, dp)) };
		case "LineString":
			return { type: "LineString", coordinates: geom.coordinates.map(c => roundCoords(c, dp)) };
		case "MultiLineString":
			return { type: "MultiLineString", coordinates: geom.coordinates.map(r => r.map(c => roundCoords(c, dp))) };
		case "Polygon":
			return { type: "Polygon", coordinates: geom.coordinates.map(r => r.map(c => roundCoords(c, dp))) };
		case "MultiPolygon":
			return {
				type: "MultiPolygon",
				coordinates: geom.coordinates.map(p => p.map(r => r.map(c => roundCoords(c, dp)))),
			};
		case "GeometryCollection":
			return {
				type: "GeometryCollection",
				geometries: geom.geometries.map(g => roundGeometry(g, dp)!).filter(Boolean),
			};
		default:
			return geom;
	}
}

function trimProperties(props: Record<string, any> | null | undefined): Record<string, any> | undefined {
	if (!props) return undefined;
	const out: Record<string, any> = {};
	if (props.ref != null) out.ref = props.ref;
	// keep either colour or color (prefer colour)
	if (props.colour != null) out.colour = props.colour;
	else if (props.color != null) out.color = props.color;
	return Object.keys(out).length ? out : undefined;
}

async function sizeOf(file: string): Promise<number> {
	try {
		const s = await stat(file);
		return s.size;
	} catch {
		return 0;
	}
}

async function main() {
	const dp = Number.isFinite(Number(process.env.GEOJSON_DP)) ? Number(process.env.GEOJSON_DP) : 5;
	const srcSize = await sizeOf(SRC);
	const raw = await readFile(SRC, "utf8");
	const json = JSON.parse(raw) as FeatureCollection;

	const out: FeatureCollection = {
		type: "FeatureCollection",
		features: json.features.map((f): Feature => {
			const geometry = roundGeometry(f.geometry, dp);
			const properties = trimProperties(f.properties);
			return { type: "Feature", geometry, properties };
		}),
	};

	const min = JSON.stringify(out);
	await writeFile(OUT, min, "utf8");
	const outSize = await sizeOf(OUT);

	const kb = (n: number) => (n / 1024).toFixed(1) + " KB";
	const srcMB = (srcSize / (1024 * 1024)).toFixed(2) + " MB";
	const prevSizeNote = ""; // original script optionally reported previous compressed size if any
	const savingsVsSrc = srcSize ? (((srcSize - outSize) / srcSize) * 100).toFixed(1) + "%" : "n/a";

	// Console report
	console.log("GeoJSON compression complete");
	console.log(`  Source:      ${path.relative(ROOT, SRC)} ${srcMB}`);
	console.log(`  Compressed:  ${path.relative(ROOT, OUT)} ${kb(outSize)}${prevSizeNote}`);
	console.log(`  Savings vs source: ${savingsVsSrc}`);
}

main().catch(err => {
	console.error("Compression failed:", err);
	process.exitCode = 1;
});
