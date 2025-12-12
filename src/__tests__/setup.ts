import { vi } from "vitest";
import { STATIONS } from "./testUtils";

const mockLocalStorage = (() => {
	let store: { [key: string]: string } = {};
	return {
		getItem: (key: string) => store[key] || null,
		setItem: (key: string, value: string) => {
			store[key] = value.toString();
		},
		removeItem: (key: string) => {
			delete store[key];
		},
		clear: () => {
			store = {};
		},
	};
})();

Object.defineProperty(window, "localStorage", {
	value: mockLocalStorage,
});

vi.mock("../stationLoader", async () => {
	const original = await vi.importActual("../stationLoader");
	return {
		...original,
		loadStations: (_opts?: any) => Promise.resolve(STATIONS),
		loadAdjacencyGraph: () => {
			const adj = new Map();
			adj.set("station1", ["station2"]);
			adj.set("station2", ["station1"]);
			adj.set("Consolação", ["Paulista", "República"]);
			adj.set("Paulista", ["Consolação"]);
			adj.set("Luz", ["República"]);
			adj.set("República", ["Luz", "Consolação"]);
			adj.set("Clínicas", ["Consolação"]);
			return Promise.resolve({
				adj,
				interchange: new Map([["Consolação", "Paulista"]]),
			});
		},
	};
});
