import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

class SimpleResponse {
	constructor(private body: string, public ok = true) {
	}

	async text() {
		return this.body;
	}
}

export function installFetchMock() {
	(globalThis as any).fetch = async (url: URL) => {
		const csvPath = resolve(process.cwd(), 'src', url.pathname.split('/').pop()!);
		const content = await readFile(csvPath, 'utf8');
		return new SimpleResponse(content) as any;
	};
}

export function installLocalStorageMock() {
	const store = new Map<string, string>();
	(globalThis as any).localStorage = {
		getItem(key: string) {
			return store.has(key) ? store.get(key)! : null;
		},
		setItem(key: string, value: string) {
			store.set(key, String(value));
		},
		removeItem(key: string) {
			store.delete(key);
		},
		clear() {
			store.clear();
		},
	};
	return store;
}
