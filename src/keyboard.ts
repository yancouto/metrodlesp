// Virtual keyboard module (QWERTY) with predictive disabling based on station name continuations
// Exports a single initKeyboard() function to wire the keyboard to the main UI

export type LineId = string;

export interface Station {
	id: string;
	name: string;
	lines: LineId[];
}

export type SearchFn = (query: string) => Station[];
export type SubmitFn = (text: string) => void;

function normalize(s: string): string {
	return s
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();
}

// Compute the set of next allowed characters based on station name prefix
function nextAllowedChars(prefixRaw: string, stations: Station[]): Set<string> {
	const prefix = normalize(prefixRaw.trim());
	const allowed = new Set<string>();
	const candidates = stations;
	for (const s of candidates) {
		const name = normalize(s.name);
		if (prefix.length === 0) {
			if (name.length > 0) allowed.add(name[0]);
			continue;
		}
		if (name.startsWith(prefix)) {
			if (name.length > prefix.length) {
				allowed.add(name[prefix.length]);
			}
		}
	}
	// NOTE: do not force-enable if empty; caller accepts all disabled state
	return allowed;
}

// QWERTY layout rows
const ROWS: string[] = [
	'QWERTYUIOP',
	'ASDFGHJKL',
	'ZXCVBNM',
];

export function initKeyboard(opts: {
	root: HTMLElement;
	input: HTMLInputElement;
	getStations: () => Station[];
	onSubmit: SubmitFn;
	onInputChanged: () => void; // caller updates suggestions/datalist/etc
}): { update: () => void } {
	const {root, input, getStations, onSubmit, onInputChanged} = opts;

	root.innerHTML = '';

	// Render letter rows
	for (const row of ROWS) {
		const rowEl = document.createElement('div');
		rowEl.className = 'kb-row';
		for (const ch of row) {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'key';
			btn.textContent = ch;
			btn.setAttribute('data-value', ch.toLowerCase());
			btn.addEventListener('click', () => handleKey(ch.toLowerCase()));
			rowEl.appendChild(btn);
		}
		root.appendChild(rowEl);
	}

	// Utility keys row (only dash and space; OK and Backspace moved to form area)
	const utilRow = document.createElement('div');
	utilRow.className = 'kb-row util';

	const hyphen = document.createElement('button');
	hyphen.type = 'button';
	hyphen.className = 'key dash';
	hyphen.textContent = '-';
	hyphen.dataset.value = '-';
	hyphen.addEventListener('click', () => handleKey('-'));
	utilRow.appendChild(hyphen);

	const space = document.createElement('button');
	space.type = 'button';
	space.className = 'key action wide';
	space.textContent = 'Espaço';
	space.dataset.value = ' ';
	space.addEventListener('click', () => handleKey(' '));
	utilRow.appendChild(space);

	root.appendChild(utilRow);

	function handleKey(val: string) {
		if (val === 'BACKSPACE') {
			input.value = input.value.slice(0, -1);
			onInputChanged();
			api.update();
			return;
		}
		if (val === 'OK') {
			const v = input.value.trim();
			if (v) onSubmit(v);
			input.value = '';
			onInputChanged();
			api.update();
			return;
		}
		// regular char
		const btn = root.querySelector(`button.key[data-value="${val}"]`) as HTMLButtonElement | null;
		if (btn && btn.dataset.disabled === 'true') return; // respect disabled
		input.value += val;
		onInputChanged();
		api.update();
	}

	const api = {
		update() {
			const stations = getStations();
			const allowed = nextAllowedChars(input.value, stations);
			const buttons = Array.from(root.querySelectorAll('button.key')) as HTMLButtonElement[];
			for (const b of buttons) {
				const v = b.getAttribute('data-value')!;
				if (v === 'BACKSPACE' || v === 'OK') {
					b.dataset.disabled = 'false';
					continue;
				}
				const normalized = v; // v is a single char ('a'-'z', '-', or ' ')
				const isAllowed = allowed.has(normalized);
				b.dataset.disabled = isAllowed ? 'false' : 'true';
				b.disabled = false; // keep clickable; visually indicate via data-disabled
			}
		}
	};

	// initial state
	api.update();
	return api;
}
