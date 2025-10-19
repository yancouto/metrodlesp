import {bfsDistances, loadAdjacencyGraph, loadStations, Station} from './stationLoader.js';
import {initKeyboard} from './keyboard.js';
import {Line, LineId, LINES} from './lines.js';
import * as state from './state.js';
import {GameState, Stats} from './state.js';
import * as logic from "./logic";
import {normalize} from "./logic";
// @ts-ignore
import mapUrl from './map/map.html?url';
// @ts-ignore
import linesUrl from './map/lines.geojson?url';

let STATIONS: Station[];
let DIST_FROM_SOLUTION: Map<string, number>; // keyed by wikidataId

const shiftDays = 0;

// Utilities (São Paulo time UTC-3)
function getSPNow(): Date { // simulate BRT (UTC-3) without DST by shifting clock
	return new Date(Date.now() - 3 * 60 * 60 * 1000 + 1000 * 60 * 60 * 24 * shiftDays);
}

function getSPDateKey(): string { // YYYY-MM-DD in SP time
	return getSPNow().toISOString().slice(0, 10);
}

function msUntilNextSPMidnight(): number {
	const spNow = getSPNow();
	const y = spNow.getUTCFullYear();
	const m = spNow.getUTCMonth();
	const d = spNow.getUTCDate();
	const nextSpMidnightUTC = Date.UTC(y, m, d + 1, 0, 0, 0, 0) + 3 * 60 * 60 * 1000; // shift back to UTC
	return Math.max(0, nextSpMidnightUTC - Date.now());
}

function formatHHMMSS(ms: number): string {
	let s = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(s / 3600);
	s -= h * 3600;
	const m = Math.floor(s / 60);
	s -= m * 60;
	const pad = (n: number) => n.toString().padStart(2, '0');
	return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

let midnightResetTimer: number | null = null;
let endCountdownTimer: number | null = null;

const todayKey = getSPDateKey();

function stationById(id: string) {
	return STATIONS.find(s => s.id === id)!;
}

function stationByName(name: string) {
	const n = name.trim().toLowerCase();
	return STATIONS.find(s => s.name.toLowerCase() === n);
}

function compareLines(guess: Station, solution: Station): { line: Line, match: boolean }[] {
	// Only evaluate the guessed station's lines and mark whether each exists in the solution.
	const solSet = new Set(solution.lines);
	return guess.lines.map(id => ({line: LINES[id], match: solSet.has(id)}));
}

function lineChipsHTML(items: { line: Line, match: boolean }[]) {
	return items.map(({
											line,
											match
										}) => `<span class="line-chip ${match ? '' : 'miss'}" title="${line.name}" style="background:${line.color}"></span>`).join('');
}

function suggestionLineChipsHTML(station: Station, knowledge: { eliminated: Set<LineId>; confirmed: Set<LineId> }) {
	const chips = station.lines.map((lid) => {
		const line = LINES[lid];

		const isMiss = knowledge.eliminated.has(lid);
		return {line, match: !isMiss};
	});
	return lineChipsHTML(chips);
}

async function shareResult(state: GameState) {
	const text = logic.buildShare(state, STATIONS, LINES, DIST_FROM_SOLUTION);
	// Analytics: share click
	try { // @ts-ignore
		gtag('event', 'share_click', {method: 'auto'});
	} catch {
	}
	// Determine if device is touch-capable (mobile/tablet). On desktop, prefer clipboard.
	let isTouch = false;
	try {
		isTouch = (('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0);
	} catch {
		isTouch = false;
	}
	if (isTouch && navigator.share) {
		try {
			await navigator.share({text});
			try { // @ts-ignore
				gtag('event', 'share_success', {method: 'navigator-share'});
			} catch {
			}
			return 'Compartilhado!';
		} catch {
			// fall through to clipboard
		}
	}
	try {
		await navigator.clipboard.writeText(text);
		try { // @ts-ignore
			gtag('event', 'share_success', {method: 'clipboard'});
		} catch {
		}
		return 'Copiado para a área de transferência!';
	} catch {
		try {
			await navigator.share({text});
			try { // @ts-ignore
				gtag('event', 'share_success', {method: 'navigator-share-fallback'});
			} catch {
			}
			return 'Compartilhado!';
		} catch {
			try { // @ts-ignore
				gtag('event', 'share_fail');
			} catch {
			}
			return "Falha ao compartilhar.";
		}
	}
}

// Rendering and interactions
let gameState: GameState;
let stats: Stats;

const guessInput = document.getElementById('guessInput') as HTMLInputElement;
const form = document.getElementById('guessForm') as HTMLFormElement;
const list = document.getElementById('stationsList') as HTMLDataListElement;
const guessesEl = document.getElementById('guesses') as HTMLDivElement;
const hintEl = document.getElementById('hint') as HTMLDivElement;
const shareBtn = document.getElementById('shareBtn') as HTMLButtonElement; // legacy (hidden)
const keyboardEl = document.getElementById('keyboard') as HTMLDivElement;
const backspaceBtn = document.getElementById('backspaceBtn') as HTMLButtonElement | null;
const okBtn = document.getElementById('okBtn') as HTMLButtonElement | null;
// Completion UI will be shown inside the stats dialog
const statsSummary = document.getElementById('statsSummary') as HTMLParagraphElement | null;
const statsShareBtn = document.getElementById('statsShareBtn') as HTMLButtonElement | null;
const statsShareMsg = document.getElementById('statsShareMsg') as HTMLDivElement | null;
const nextTimerEl = document.getElementById('nextTimer') as HTMLDivElement | null;

const helpDialog = document.getElementById('helpDialog') as HTMLDialogElement;
const helpBtn = document.getElementById('helpBtn') as HTMLButtonElement;
const helpClose = document.getElementById('helpClose') as HTMLButtonElement;
const statsDialog = document.getElementById('statsDialog') as HTMLDialogElement;
const statsBtn = document.getElementById('statsBtn') as HTMLButtonElement;
const statsClose = document.getElementById('statsClose') as HTMLButtonElement;
const statPlayed = document.getElementById('statPlayed')!;
const statWin = document.getElementById('statWin')!;
const statStreak = document.getElementById('statStreak')!;
const statBest = document.getElementById('statBest')!;
const guessHistEl = document.getElementById('guessHist') as HTMLDivElement | null;

function refreshDatalist() {
	const q = guessInput.value;
	const cands = q ? logic.searchCandidates(q, STATIONS, LINES) : STATIONS.slice().sort((a, b) => a.name.localeCompare(b.name));
	list.innerHTML = cands.map(s => `<option value="${s.name}"></option>`).join('');
}


function renderGuesses() {
	const solution = stationById(gameState.solutionId);
	const total = 6;
	const parts: string[] = [];
	for (let i = 0; i < total; i++) {
		if (i < gameState.guesses.length) {
			const id = gameState.guesses[i];
			const s = stationById(id);
			const comps = compareLines(s, solution);
			const correct = s.id === solution.id;
			const dist = DIST_FROM_SOLUTION.get(s.wikidataId);
			const distHtml = !correct && typeof dist === 'number' ? ` <span class="dist-badge">a ${dist} ${dist === 1 ? 'parada' : 'paradas'}</span>` : '';
			const arrow = !correct ? logic.directionArrowSymbol(s, solution) : '';
			const arrowHtml = arrow ? ` <span class="dir-arrow" title="Direção aproximada">${arrow}</span>` : '';
			parts.push(`<div class="guess"><div><div class="name">${i + 1}. ${s.name}${correct ? ' ✅' : ''}${distHtml}${arrowHtml}</div></div><div class="lines">${lineChipsHTML(comps)}</div></div>`);
		} else {
			parts.push(`<div class="guess placeholder"><div><div class="name">${i + 1}. —</div></div><div class="lines"></div></div>`);
		}
	}
	guessesEl.innerHTML = parts.join('');
}

function renderStats() {
	// Update countdown UI if game ended
	if (nextTimerEl) {
		if (gameState.status === 'playing') {
			nextTimerEl.textContent = '';
		} else {
			const ms = msUntilNextSPMidnight();
			nextTimerEl.textContent = `Próximo jogo em ${formatHHMMSS(ms)}`;
		}
	}
	statPlayed.textContent = String(stats.played);
	statWin.textContent = String(stats.wins);
	statStreak.textContent = String(stats.streak);
	statBest.textContent = String(stats.best);
	if (guessHistEl) {
		const losses = Math.max(0, stats.played - stats.wins);
		const values = [...stats.dist, losses]; // 1-6 + X
		const labels = ['1', '2', '3', '4', '5', '6', 'X'];
		const max = Math.max(1, ...values);
		guessHistEl.innerHTML = values.map((count, i) => {
			const h = Math.round((count / max) * 100);
			const nz = count > 0 ? ' nz' : '';
			return `<div class="bar"><div class="fill${nz}" style="height:${h}%"></div><div class="count">${count}</div><div class="label">${labels[i]}</div></div>`;
		}).join('');
	}
	// Show/enable share controls and summary when game finished
	if (statsSummary) {
		const solution = stationById(gameState.solutionId);
		if (gameState.status === 'won') {
			const attempts = gameState.guesses.length;
			statsSummary.textContent = `Você acertou ${solution.name} em ${attempts} tentativa(s)!`;
		} else if (gameState.status === 'lost') {
			statsSummary.textContent = `Não foi dessa vez. A estação era ${solution.name}.`;
		} else {
			statsSummary.textContent = '';
		}
	}
	if (statsShareBtn) {
		statsShareBtn.disabled = gameState.status === 'playing';
	}
}

// Keyboard wiring (separated module)
let keyboard: { update: () => void } | null = null;
const suggestionsEl = document.getElementById('suggestions') as HTMLDivElement | null;

function renderSuggestions() {
	if (!suggestionsEl) return;
	const q = guessInput.value.trim();
	if (!q) {
		suggestionsEl.innerHTML = '';
		suggestionsEl.style.display = 'none';
		return;
	}
	const qn = normalize(q);
	const knowledge = logic.getKnownLineKnowledge(gameState, STATIONS);
	// Name matches first
	const nameMatches = STATIONS.filter(s => normalize(s.name).includes(qn));
	// Determine which lines are being queried (by name or by number)
	const lineHits: LineId[] = [];
	(Object.keys(LINES) as LineId[]).forEach((id) => {
		const l = LINES[id];
		if ((qn.length >= 2 && normalize(l.name).includes(qn)) || String(l.id) === qn) lineHits.push(l.id);
	});
	// Build HTML
	const seen = new Set<string>();
	const parts: string[] = [];
	// Render name matches (unique, sorted)
	nameMatches.sort((a, b) => a.name.localeCompare(b.name)).forEach(s => {
		if (seen.has(s.id)) return;
		seen.add(s.id);
		parts.push(`<button type="button" class="suggestion-item" data-id="${s.id}">` +
			`<div class="sugg-name">${s.name}</div>` +
			`<div class="lines">${suggestionLineChipsHTML(s, knowledge)}</div>` +
			`</button>`);
	});
	// Render line-based groups with separators
	for (const lid of lineHits) {
		const line = LINES[lid];
		let any = false;
		const stationsOnLine = STATIONS.filter(s => s.lines.includes(lid)).sort((a, b) => a.name.localeCompare(b.name));
		for (const st of stationsOnLine) {
			if (seen.has(st.id)) continue;
			seen.add(st.id);
			if (!any) {
				any = true;
				// Group separator indicating why these appear; carry color via CSS var
				parts.push(`<div class="suggestion-sep" style="--line-color:${line.color}">${line.name}</div>`);
			}
			parts.push(`<button type="button" class="suggestion-item" data-id="${st.id}">` +
				`<div class="sugg-name">${st.name}</div>` +
				`<div class="lines">${suggestionLineChipsHTML(st, knowledge)}</div>` +
				`</button>`);
		}
	}
	if (parts.length === 0) {
		suggestionsEl.innerHTML = '';
		suggestionsEl.style.display = 'none';
		return;
	}
	suggestionsEl.innerHTML = parts.join('');
	suggestionsEl.style.display = 'block';
	const mapEl = document.getElementById('mapImage');
	if (mapEl) {
		try {
			mapEl.scrollIntoView({block: 'nearest', behavior: 'smooth'});
		} catch {
			mapEl.scrollIntoView();
		}
	}
}

// Delegate clicks for suggestions
if (suggestionsEl) {
	suggestionsEl.addEventListener('click', (e) => {
		const el = (e.target as HTMLElement).closest('button.suggestion-item') as HTMLElement | null;
		if (el) {
			const id = el.getAttribute('data-id')!;
			const st = stationById(id);
			guessInput.value = st.name;
			// Avoid focusing the input on mobile to prevent native keyboard
			try {
				guessInput.blur();
			} catch {
			}
			refreshDatalist();
			renderSuggestions();
			if (keyboard) keyboard.update();
		}
	});
}

function startEndCountdown() {
	if (endCountdownTimer) {
		clearInterval(endCountdownTimer as any);
		endCountdownTimer = null;
	}
	endCountdownTimer = setInterval(() => {
		if (!nextTimerEl) return;
		const ms = msUntilNextSPMidnight();
		nextTimerEl.textContent = `Próximo jogo em ${formatHHMMSS(ms)}`;
		if (ms <= 0) {
			clearInterval(endCountdownTimer as any);
			endCountdownTimer = null;
			try {
				location.reload();
			} catch {
			}
		}
	}, 1000) as unknown as number;
}

function scheduleMidnightReset() {
	if (midnightResetTimer) {
		clearTimeout(midnightResetTimer as any);
		midnightResetTimer = null;
	}
	const ms = msUntilNextSPMidnight();
	midnightResetTimer = setTimeout(() => {
		try {
			location.reload();
		} catch {
		}
	}, ms) as unknown as number;
}

function endGame(won: boolean) {
	gameState.status = won ? 'won' : 'lost';
	gtag('event', 'finished', {value: gameState.status});
	state.saveState(gameState);
	// update stats once per day
	if (stats.lastDate !== gameState.dateKey) {
		stats.played += 1;
		stats.lastDate = gameState.dateKey;
		if (won) {
			stats.wins += 1;
			stats.streak += 1;
			stats.best = Math.max(stats.best, stats.streak);
			const attempts = gameState.guesses.length;
			if (attempts >= 1 && attempts <= 6)
				stats.dist[attempts - 1] += 1;
		} else {
			stats.streak = 0;
		}
		state.saveStats(stats);
	}
	// Disable interactive input and refresh UI
	updatePlayableUI();
	renderStats();
	// Start next-day countdown in stats dialog
	startEndCountdown();
	// Show stats dialog upon completion
	try {
		statsDialog.showModal();
	} catch {
		// ignore
	}
}

function checkIfEnded() {
	const solution = stationById(gameState.solutionId);
	const won = gameState.guesses.some(id => id === solution.id);
	if (won) endGame(true);
	else if (gameState.guesses.length >= 6) endGame(false);
}

function setHint(text: string) {
	hintEl.textContent = text;
}

function onSubmitGuess(name: string) {
	const solution = stationById(gameState.solutionId);
	const match = stationByName(name) || STATIONS.find(s => s.name.toLowerCase().includes(name.trim().toLowerCase()));
	if (!match) {
		gtag('event', 'guess_fail', {value: "not_found"});
		setHint('Estação não encontrada.');
		return;
	}
	if (gameState.guesses.includes(match.id)) {
		setHint('Você já tentou essa estação.');
		return;
	}
	if (gameState.status !== 'playing') {
		setHint('O jogo de hoje terminou.');
		return;
	}
	gtag('event', 'guess');
	gameState.guesses.push(match.id);
	state.saveState(gameState);
	renderGuesses();
	if (match.id === solution.id) {
		setHint(`Acertou! Era ${solution.name}.`);
	} else {
		// No hint text required per spec; feedback is visual via line chips.
		setHint('');
	}
	checkIfEnded();
	if (gameState.status !== 'playing') shareBtn.disabled = false;
}

function renderMap() {
	const mapDiv = document.getElementById('mapImage') as HTMLDivElement;
	mapDiv.innerHTML = '';
	// Determine today's solution and pass its coordinates to the embedded map
	const solution = stationById(gameState.solutionId);
	const params = new URLSearchParams();
	if (typeof solution.lon === 'number' && typeof solution.lat === 'number') {
		params.set('lon', String(solution.lon));
		params.set('lat', String(solution.lat));
		params.set('z', '15'); // default zoom
	}
	params.set('lines', linesUrl);
	const iframe = document.createElement('iframe');
	// Append MapTiler key if available via Vite env (not present in tests/build output)
	const VITE_KEY = (import.meta as any).env.VITE_MAPTILER_KEY;
	if (VITE_KEY) params.set('k', VITE_KEY);

	iframe.src = mapUrl + (params.toString() ? `?${params.toString()}` : '');
	iframe.title = 'Mapa (sem nomes)';
	iframe.style.width = '100%';
	iframe.style.height = '100%';
	iframe.style.border = '0';
	iframe.setAttribute('loading', 'lazy');
	mapDiv.appendChild(iframe);
}

function updatePlayableUI() {
	const playing = gameState.status === 'playing';
	if (guessInput) guessInput.disabled = !playing;
	if (backspaceBtn) backspaceBtn.disabled = !playing;
	if (okBtn) okBtn.disabled = !playing;
	if (keyboard) keyboard.update();
}

function initUI() {
	refreshDatalist();
	renderGuesses();
	renderStats();
	renderMap();
	shareBtn.disabled = gameState.status === 'playing';
	updatePlayableUI();

	// On touch/mobile devices, prevent the native keyboard from opening
	try {
		const isTouch = (('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0);
		if (isTouch) {
			guessInput.readOnly = true; // programmatic updates still work
			// If it somehow gains focus, blur immediately
			guessInput.addEventListener('focus', () => {
				try {
					guessInput.blur();
				} catch {
				}
			}, true);
			// Prevent default touch behavior that would try to focus
			guessInput.addEventListener('touchstart', (ev) => {
				ev.preventDefault();
			});
		}
	} catch {
	}

	// Initialize keyboard module
	keyboard = initKeyboard({
		root: keyboardEl,
		input: guessInput,
		getStations: () => STATIONS,
		getKeywords: () => Object.values(LINES).map(l => {
			const name = l.name;
			const dashIdx = name.indexOf('-');
			return dashIdx >= 0 ? name.slice(dashIdx + 1).trim() : name;
		}),
		getEnabled: () => gameState.status === 'playing',
		onSubmit: (v) => {
			onSubmitGuess(v);
			renderGuesses();
			renderSuggestions();
		},
		onInputChanged: () => {
			refreshDatalist();
			renderSuggestions();
		}
	});

	// Input listeners
	guessInput.addEventListener('input', () => {
		refreshDatalist();
		renderSuggestions();
		if (keyboard) keyboard.update();
	});
	form.addEventListener('submit', (e) => {
		e.preventDefault();
		const v = guessInput.value.trim();
		if (!v) return;
		onSubmitGuess(v);
		guessInput.value = '';
		refreshDatalist();
		renderSuggestions();
		if (keyboard) keyboard.update();
	});

	helpBtn.addEventListener('click', () => helpDialog.showModal());
	helpClose.addEventListener('click', () => {
		helpDialog.close();
		try {
			localStorage.setItem('seenHelpV1', '1');
		} catch {
		}
	});
	statsBtn.addEventListener('click', () => {
		renderStats();
		statsDialog.showModal();
	});
	statsClose.addEventListener('click', () => statsDialog.close());

	if (backspaceBtn) {
		backspaceBtn.addEventListener('click', () => {
			guessInput.value = guessInput.value.slice(0, -1);
			refreshDatalist();
			renderSuggestions();
			if (keyboard) keyboard.update();
		});
	}

	if (statsShareBtn) {
		statsShareBtn.addEventListener('click', async () => {
			const msg = await shareResult(gameState);
			if (statsShareMsg) statsShareMsg.textContent = msg;
		});
	}
}

// Boot: load stations from CSV (required) then init UI
async function boot() {
	scheduleMidnightReset();
	STATIONS = await loadStations();
	gameState = state.loadState(todayKey, STATIONS);
	stats = state.loadStats();
	const solution = stationById(gameState.solutionId);
	let ADJ_GRAPH = await loadAdjacencyGraph();
	DIST_FROM_SOLUTION = bfsDistances(solution, ADJ_GRAPH);
	initUI();
	// Auto-open help on first run
	try {
		if (!localStorage.getItem('seenHelpV1')) {
			helpDialog.showModal();
		}
	} catch {
	}
}

// Start app
boot();
