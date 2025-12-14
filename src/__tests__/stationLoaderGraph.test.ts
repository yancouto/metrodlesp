import { test, expect, beforeAll, describe, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// We need the REAL stationLoader (not the mock from setup.ts) for these tests
beforeAll(async () => {
	// Ensure this suite uses the real stationLoader (bypass global mock from setup.ts)
	try {
		vi.unmock("../stationLoader");
		vi.unmock("../stationLoader.js");
	} catch {}
	// Minimal fetch mock: load local files from src when stationLoader requests CSVs
	// Supports both file:// and normal URL strings
	// @ts-ignore
	globalThis.fetch = async (input: any) => {
		const href: string = typeof input === "string" ? input : (input?.url ?? input?.href ?? String(input));
		let abs: string | null = null;
		// Try to interpret as URL first
		try {
			const u = new URL(href);
			if (u.protocol === "file:") {
				abs = decodeURIComponent(u.pathname.replace(/^\//, ""));
			} else {
				// For http(s) style paths like /src/adjacencies.csv, map to local file under project
				const p = decodeURIComponent(u.pathname);
				if (p.startsWith("/src/")) {
					abs = path.join(process.cwd(), p.replace(/^\//, ""));
				} else if (p.includes("/src/")) {
					abs = path.join(process.cwd(), p.slice(p.indexOf("/src/") + 1));
				} else {
					abs = path.join(process.cwd(), p.replace(/^\//, ""));
				}
			}
		} catch {
			// Not a URL; treat as path relative to CWD
			abs = path.isAbsolute(href) ? href : path.join(process.cwd(), href);
		}
		// Normalize dist → src fallback if needed
		if (!fs.existsSync(abs)) {
			const trySrc = abs.replace(/\\dist\\/g, "\\src\\").replace(/\/dist\//g, "/src/");
			if (fs.existsSync(trySrc)) abs = trySrc;
		}
		// As a last resort, if path points to compiled test dir, replace to src
		if (!fs.existsSync(abs) && /__tests__/.test(abs)) {
			const guess = abs.replace(/__tests__.*/, "src/adjacencies.csv");
			if (fs.existsSync(guess)) abs = guess;
		}
		if (!fs.existsSync(abs)) {
			throw new Error(`Test fetch mock could not resolve path: ${href} → ${abs}`);
		}
		const text = await fs.promises.readFile(abs, "utf8");
		return {
			ok: true,
			status: 200,
			statusText: "OK",
			async text() {
				return text;
			},
			async json() {
				return JSON.parse(text);
			},
		} as any;
	};
	// Do not reset all modules to avoid interfering with other tests; import actual modules per-call
});

async function loadDeps() {
	const stationLoader = await import("../stationLoader.js");
	const { LINES } = await import("../lines.js");
	return { stationLoader, LINES } as const;
}

function isSubset<T>(a: Iterable<T>, universe: Set<T>): boolean {
	for (const v of a) if (!universe.has(v)) return false;
	return true;
}

function makeUndirected(graph: Map<string, Set<string>>): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	const add = (u: string, v: string) => {
		if (!out.has(u)) out.set(u, new Set());
		out.get(u)!.add(v);
	};
	for (const [u, vs] of graph) {
		for (const v of vs) {
			add(u, v);
			add(v, u);
		}
	}
	return out;
}

async function loadAll(includeCPTM: boolean) {
	const { stationLoader } = await loadDeps();
	const stations = await stationLoader.loadStations({ includeCPTM });
	const g = await stationLoader.loadAdjacencyGraph({ includeCPTM });
	return { stations, g } as const;
}

function toSet(v: any): Set<string> {
	if (v instanceof Set) return v as Set<string>;
	if (Array.isArray(v)) return new Set<string>(v);
	// Fallback: try to iterate
	try {
		return new Set<string>([...v]);
	} catch {
		return new Set<string>();
	}
}

async function assertGraphProperties(includeCPTM: boolean) {
	const { stations, g } = await loadAll(includeCPTM);

	// 1) No self-loops in either adjacency or interchange
	for (const [u, vs] of g.adjacent) {
		const set = toSet(vs);
		expect(set.has(u)).toBe(false);
	}
	for (const [u, vs] of g.interchange) {
		const set = toSet(vs);
		expect(set.has(u)).toBe(false);
	}

	// 2) (Informational) We treat edges as undirected in gameplay; ensure the undirected projection is built
	//    without creating duplicate self-links.
	//    Note: raw CSVs may list a single direction only; we validate connectivity below.

	// 3) Combined graph connectivity (treat both edge kinds as connections)
	const combined = new Map<string, Set<string>>();
	const mergeInto = (src: Map<string, any>) => {
		for (const [u, vs] of src) {
			if (!combined.has(u)) combined.set(u, new Set());
			const set = combined.get(u)!;
			for (const v of toSet(vs)) set.add(v);
		}
	};
	mergeInto(g.adjacent);
	mergeInto(g.interchange);

	const undirected = makeUndirected(combined);
	const allNodes = new Set<string>([...undirected.keys(), ...[...undirected.values()].flatMap(s => [...s])]);
	expect(allNodes.size).toBeGreaterThan(0);
	const start = [...allNodes][0];
	const seen = new Set<string>([start]);
	const queue = [start];
	while (queue.length) {
		const u = queue.shift()!;
		for (const v of undirected.get(u) || []) {
			if (!seen.has(v)) {
				seen.add(v);
				queue.push(v);
			}
		}
	}
	// All stations that appear in the graph should be reachable
	expect(seen.size).toBe(allNodes.size);

	// 4) Lines in stations conform to LINES catalog
	const { LINES } = await loadDeps();
	const allowed = new Set(Object.keys(LINES));
	for (const s of stations) {
		expect(isSubset(s.lines, allowed)).toBe(true);
	}
}

describe("stationLoader data integrity", () => {
	test("metro-only graph and stations pass integrity checks", async () => {
		await assertGraphProperties(false);
	});

	test("CPTM-inclusive graph and stations pass integrity checks", async () => {
		await assertGraphProperties(true);
	});
});
