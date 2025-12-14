import {bfsDistances, loadAdjacencyGraph, loadStations, Station} from "./stationLoader.js";
import {initKeyboard} from "./keyboard.js";
import {Line, LineId, LINES} from "./lines.js";
import * as state from "./state.js";
import {GameState, Stats} from "./state.js";
import * as logic from "./logic";
import {normalize} from "./logic";
// @ts-ignore
import mapUrl from "./map/map.html?url";
// @ts-ignore
import linesUrl from "./map/lines.geojson?url";
import html2canvas from "html2canvas";

let STATIONS: Station[];
let DIST_FROM_SOLUTION: Map<string, number>; // keyed by wikidataId

const shiftDays = 0;

// Utilities (São Paulo time UTC-3)
function getSPNow(): Date {
	// simulate BRT (UTC-3) without DST by shifting clock
	return new Date(Date.now() - 3 * 60 * 60 * 1000 + 1000 * 60 * 60 * 24 * shiftDays);
}

function getSPDateKey(): string {
	// YYYY-MM-DD in SP time
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
	const pad = (n: number) => n.toString().padStart(2, "0");
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

function compareLines(guess: Station, solution: Station): { line: Line; match: boolean }[] {
	// Stations are already merged at load time; compare directly
	const solSet = new Set(solution.lines);
	return guess.lines
		.slice()
		.sort()
		.map(id => ({line: LINES[id], match: solSet.has(id)}));
}

function lineChipsHTML(items: { line: Line; match: boolean }[]) {
	return items
		.map(
			({ line, match }) =>
				`<span class="line-chip ${match ? "" : "miss"}" title="${line.name}" style="background:${line.color}"></span>`,
		)
		.join("");
}

function suggestionLineChipsHTML(station: Station, knowledge: { eliminated: Set<LineId>; confirmed: Set<LineId> }) {
	const chips = station.lines.map(lid => {
		const line = LINES[lid];

		const isMiss = knowledge.eliminated.has(lid);
		return { line, match: !isMiss };
	});
	return lineChipsHTML(chips);
}

// Utility: Detect if device is touch/mobile
function isTouchDevice(): boolean {
	try {
		return "ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0;
	} catch {
		return false;
	}
}

async function shareResult(state: GameState): Promise<string | null> {
    const text = logic.buildShare(state, STATIONS, LINES, DIST_FROM_SOLUTION, hardMode, includeCPTM);
	// Analytics: share click
	gtag("event", "share_click", { method: "auto" });
	// Determine if device is touch-capable (mobile/tablet). On desktop, prefer clipboard.
	if (isTouchDevice() && navigator.share) {
		try {
			await navigator.share({ text });
			gtag("event", "share_success", { method: "navigator-share" });
			return "Compartilhado!";
		} catch {
			// fall through to clipboard
		}
	}
	try {
		await navigator.clipboard.writeText(text);
		gtag("event", "share_success", { method: "clipboard" });
	} catch {
		try {
			await navigator.share({ text });
			gtag("event", "share_success", { method: "navigator-share-fallback" });
			return "Compartilhado!";
		} catch {
			gtag("event", "share_fail");
			return "Falha ao compartilhar.";
		}
	}
	return null;
}

async function shareImgResult(state: GameState): Promise<string | null> {
	gtag("event", "share_img_click", { method: "auto" });
	const blob = await shareResultAsImage(gameState);
	if (!blob) {
		return "Falha ao gerar imagem.";
	}

	if (isTouchDevice() && navigator.share) {
		try {
			const file = new File([blob], "metrodle-sp-resultado.png", {
				type: "image/png",
			});
			await navigator.share({ files: [file] });
			gtag("event", "share_img_success", { method: "navigator-share" });
			return "Compartilhado!";
		} catch (e) {
			gtag("event", "share_img_fail");
			return "Falha ao compartilhar.";
		}
	} else {
		const a = document.createElement("a");
		const url = URL.createObjectURL(blob);
		a.href = url;
		a.download = `metrodle-sp-${todayKey}.png`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		gtag("event", "share_img_success", { method: "download" });
		return "Baixado!";
	}
}

async function shareResultAsImage(state: GameState) {
    const container = document.getElementById("share-image-container")!;
    container.innerHTML = logic.buildShareImageHTML(state, STATIONS, LINES, DIST_FROM_SOLUTION, hardMode, includeCPTM);
	// Add a class to enable export styles
	const shareImageEl = container.firstElementChild as HTMLElement;
	shareImageEl.classList.add("share-image");

	const canvas = await html2canvas(shareImageEl, {
		useCORS: true,
		backgroundColor: "#050a13",
	});

	// Clean up
	container.innerHTML = "";

	return new Promise<Blob | null>(resolve => {
		canvas.toBlob(resolve, "image/png");
	});
}

// Rendering and interactions
let gameState: GameState;
let stats: Stats;
let hardMode: boolean;
let dailyRotation: number;
let includeCPTM: boolean;
let openedForCptmPrompt = false;
const cptmNewHint = document.getElementById("cptmNewHint") as HTMLParagraphElement | null;
const hardModeHarderHint = document.getElementById("hardModeHarderHint") as HTMLParagraphElement | null;

function updateCptmHintVisibility() {
    try {
        const seen = state.loadCptmPromptSeen();
        // CPTM "new" hint only shows during CPTM prompt and if not seen yet
        const showCptm = openedForCptmPrompt && !seen;
        if (cptmNewHint) cptmNewHint.style.display = showCptm ? "block" : "none";
        // Hard mode harder hint: only show if hard mode is enabled
        if (hardModeHarderHint) hardModeHarderHint.style.display = hardMode ? "block" : "none";
    } catch {
        if (cptmNewHint) cptmNewHint.style.display = openedForCptmPrompt ? "block" : "none";
        if (hardModeHarderHint) hardModeHarderHint.style.display = hardMode ? "block" : "none";
    }
}

const guessInput = document.getElementById("guessInput") as HTMLInputElement;
const form = document.getElementById("guessForm") as HTMLFormElement;
const list = document.getElementById("stationsList") as HTMLDataListElement;
const guessesEl = document.getElementById("guesses") as HTMLDivElement;
const hintEl = document.getElementById("hint") as HTMLDivElement;
const shareBtn = document.getElementById("shareBtn") as HTMLButtonElement; // legacy (hidden)
const keyboardEl = document.getElementById("keyboard") as HTMLDivElement;
const backspaceBtn = document.getElementById("backspaceBtn") as HTMLButtonElement | null;
const okBtn = document.getElementById("okBtn") as HTMLButtonElement | null;
// Completion UI will be shown inside the stats dialog
const statsSummary = document.getElementById("statsSummary") as HTMLParagraphElement | null;
const statsShareBtn = document.getElementById("statsShareBtn") as HTMLButtonElement | null;
const statsShareImgBtn = document.getElementById("statsShareImgBtn") as HTMLButtonElement | null;
const statsShareMsg = document.getElementById("statsShareMsg") as HTMLDivElement | null;
const nextTimerEl = document.getElementById("nextTimer") as HTMLDivElement | null;

const helpDialog = document.getElementById("helpDialog") as HTMLDialogElement;
const helpBtn = document.getElementById("helpBtn") as HTMLButtonElement;
const helpClose = document.getElementById("helpClose") as HTMLButtonElement;
const openSettingsFromHelp = document.getElementById("openSettingsFromHelp") as HTMLAnchorElement | null;
const statsDialog = document.getElementById("statsDialog") as HTMLDialogElement;
const statsTitleEl = statsDialog.querySelector("h2") as HTMLHeadingElement | null;
const settingsDialog = document.getElementById("settingsDialog") as HTMLDialogElement;
const settingsBtn = document.getElementById("settingsBtn") as HTMLButtonElement;
const settingsClose = document.getElementById("settingsClose") as HTMLButtonElement;
const hardModeToggle = document.getElementById("hardModeToggle") as HTMLInputElement;
const hardModeSuggestion = document.getElementById("hardModeSuggestion") as HTMLDivElement;
const tryHardModeLink = document.getElementById("tryHardModeLink") as HTMLAnchorElement;
const cptmToggle = document.getElementById("cptmToggle") as HTMLInputElement;
const statsBtn = document.getElementById("statsBtn") as HTMLButtonElement;
const statsClose = document.getElementById("statsClose") as HTMLButtonElement;
const statPlayed = document.getElementById("statPlayed")!;
const statWin = document.getElementById("statWin")!;
const statStreak = document.getElementById("statStreak")!;
const statBest = document.getElementById("statBest")!;
const guessHistEl = document.getElementById("guessHist") as HTMLDivElement | null;

// PWA install analytics
try {
	window.addEventListener("beforeinstallprompt", () => {
		gtag("event", "install_prompt_shown");
	});
	window.addEventListener("appinstalled", () => {
		gtag("event", "install_accepted");
	});
} catch {}

function refreshDatalist() {
	const q = guessInput.value;
	const cands = q
		? logic.searchCandidates(q, STATIONS, LINES)
		: STATIONS.slice().sort((a, b) => a.name.localeCompare(b.name));
	list.innerHTML = cands.map(s => `<option value="${s.name}"></option>`).join("");
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
			const distHtml =
				!correct && typeof dist === "number"
					? ` <span class="dist-badge">a ${dist} ${dist === 1 ? "parada" : "paradas"}</span>`
					: "";
			const arrow = !correct ? logic.directionArrowSymbol(s, solution) : "";
			const arrowHtml = arrow ? ` <span class="dir-arrow" title="Direção aproximada">${arrow}</span>` : "";
			parts.push(
				`<div class="guess"><div><div class="name">${i + 1}. ${s.name}${correct ? " ✅" : ""}${distHtml}${arrowHtml}</div></div><div class="lines">${lineChipsHTML(comps)}</div></div>`,
			);
		} else {
			parts.push(
				`<div class="guess placeholder"><div><div class="name">${i + 1}. —</div></div><div class="lines"></div></div>`,
			);
		}
	}
	guessesEl.innerHTML = parts.join("");
}

function renderStats() {
	// Update countdown UI if game ended
 if (nextTimerEl) {
        if (gameState.status === "playing") {
            nextTimerEl.textContent = "";
        } else {
            const ms = msUntilNextSPMidnight();
            nextTimerEl.textContent = `Próximo jogo em ${formatHHMMSS(ms)}`;
        }
    }
    // Update stats dialog title to reflect mode
    if (statsTitleEl) {
        statsTitleEl.textContent = includeCPTM ? "Estatísticas (CPTM) 📊" : "Estatísticas 📊";
    }
    statPlayed.textContent = String(stats.played);
	statWin.textContent = String(stats.wins);
	statStreak.textContent = String(stats.streak);
	statBest.textContent = String(stats.best);
	if (guessHistEl) {
		const losses = Math.max(0, stats.played - stats.wins);
		const values = [...stats.dist, losses]; // 1-6 + X
		const labels = ["1", "2", "3", "4", "5", "6", "X"];
		const max = Math.max(1, ...values);
		guessHistEl.innerHTML = values
			.map((count, i) => {
				const h = Math.round((count / max) * 100);
				const nz = count > 0 ? " nz" : "";
				return `<div class="bar"><div class="fill${nz}" style="height:${h}%"></div><div class="count">${count}</div><div class="label">${labels[i]}</div></div>`;
			})
			.join("");
	}
	// Show/enable share controls and summary when game finished
	if (statsSummary) {
		const solution = stationById(gameState.solutionId);
		if (gameState.status === "won") {
			const attempts = gameState.guesses.length;
			statsSummary.textContent = `Você acertou ${solution.name} em ${attempts} tentativa(s)!`;
		} else if (gameState.status === "lost") {
			statsSummary.textContent = `Não foi dessa vez. A estação era ${solution.name}.`;
		} else {
			statsSummary.textContent = "";
		}
	}
	if (statsShareBtn) {
		statsShareBtn.disabled = gameState.status === "playing";
	}
 if (statsShareImgBtn) {
		statsShareImgBtn.disabled = gameState.status === "playing";
	}
	// Show "Try Hard Mode" suggestion if applicable
	if (hardModeSuggestion) {
		if (gameState.status === "won" && gameState.guesses.length <= 3 && !hardMode) {
			hardModeSuggestion.style.display = "block";
		} else {
			hardModeSuggestion.style.display = "none";
		}
	}
}

// Keyboard wiring (separated module)
let keyboard: { update: () => void } | null = null;
const suggestionsEl = document.getElementById("suggestions") as HTMLDivElement | null;

function renderSuggestions() {
	if (!suggestionsEl) return;
	const q = guessInput.value.trim();
	if (!q) {
		suggestionsEl.innerHTML = "";
		suggestionsEl.style.display = "none";
		return;
	}
	const qn = normalize(q);
	const knowledge = logic.getKnownLineKnowledge(gameState, STATIONS);
	// Name matches first
	const nameMatches = STATIONS.filter(s => normalize(s.name).includes(qn));
	// Determine which lines are being queried (by name or by number)
	const lineHits: LineId[] = [];
	(Object.keys(LINES) as LineId[]).forEach(id => {
		const l = LINES[id];
		if ((qn.length >= 2 && normalize(l.name).includes(qn)) || String(l.id) === qn) lineHits.push(l.id);
	});
	// Build HTML
	const seen = new Set<string>(); // station ids already shown
	const parts: string[] = [];
	// Render name matches (unique, sorted)
	nameMatches
		.sort((a, b) => a.name.localeCompare(b.name))
		.forEach(s => {
			if (seen.has(s.id)) return;
			seen.add(s.id);
			parts.push(
				`<button type="button" class="suggestion-item" data-id="${s.id}">` +
					`<div class="sugg-name">${s.name}</div>` +
					`<div class="lines">${suggestionLineChipsHTML(s, knowledge)}</div>` +
					`</button>`,
			);
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
			parts.push(
				`<button type="button" class="suggestion-item" data-id="${st.id}">` +
					`<div class="sugg-name">${st.name}</div>` +
					`<div class="lines">${suggestionLineChipsHTML(st, knowledge)}</div>` +
					`</button>`,
			);
		}
	}
	if (parts.length === 0) {
		suggestionsEl.innerHTML = "";
		suggestionsEl.style.display = "none";
		return;
	}
	suggestionsEl.innerHTML = parts.join("");
	suggestionsEl.style.display = "block";
	const mapEl = document.getElementById("mapImage");
	if (mapEl) {
		try {
			mapEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
		} catch {
			mapEl.scrollIntoView();
		}
	}
}

// Delegate clicks for suggestions
if (suggestionsEl) {
	suggestionsEl.addEventListener("click", e => {
		const el = (e.target as HTMLElement).closest("button.suggestion-item") as HTMLElement | null;
		if (el) {
			const id = el.getAttribute("data-id")!;
			const st = stationById(id);
			guessInput.value = st.name;
			// Avoid focusing the input on mobile to prevent native keyboard
			try {
				guessInput.blur();
			} catch {}
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
			} catch {}
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
		} catch {}
	}, ms) as unknown as number;
}

function endGame(won: boolean) {
    gameState.status = won ? "won" : "lost";
    gtag("event", "finished", { value: gameState.status });
    state.saveState(gameState, includeCPTM);
    // update stats once per day
    if (stats.lastDate !== gameState.dateKey) {
        stats.played += 1;
        stats.lastDate = gameState.dateKey;
        if (won) {
            stats.wins += 1;
            stats.streak += 1;
            stats.best = Math.max(stats.best, stats.streak);
            const attempts = gameState.guesses.length;
            if (attempts >= 1 && attempts <= 6) stats.dist[attempts - 1] += 1;
        } else {
            stats.streak = 0;
        }
        state.saveStats(stats, includeCPTM);
    }
	// Disable interactive input and refresh UI
	if (won && hardMode) {
		renderMap(); // Re-render map immediately on win to remove rotation/hidden lines
	}
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
	const won = gameState.guesses.includes(solution.id);
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
		gtag("event", "guess_fail", { value: "not_found" });
		setHint("Estação não encontrada.");
		return;
	}
	if (gameState.guesses.includes(match.id)) {
		setHint("Você já tentou essa estação.");
		return;
	}
	if (gameState.status !== "playing") {
		setHint("O jogo de hoje terminou.");
		return;
	}
 gtag("event", "guess");
 gameState.guesses.push(match.id);
 state.saveState(gameState, includeCPTM);
 renderGuesses();
	// Re-render the map only if parameters affecting it have changed
	const newParams = computeMapParams();
	if (!mapParamsEqual(lastMapParams, newParams)) {
		renderMap();
	}
	if (match.id === solution.id) {
		setHint(`Acertou! Era ${solution.name}.`);
	} else {
		// No hint text required per spec; feedback is visual via line chips.
		setHint("");
	}
	checkIfEnded();
	if (gameState.status !== "playing") shareBtn.disabled = false;
}

type MapParams = { showLines: boolean; bearing: number | null; knownCsv: string | null };
let lastMapParams: MapParams | null = null;

function computeMapParams(): MapParams {
	const solution = stationById(gameState.solutionId);
	const isWon = gameState.status === "won";
	const showLines = !hardMode || gameState.guesses.length >= 2 || isWon;
	let knownCsv: string | null = null;
	if (showLines) {
		try {
			const knowledge = logic.getKnownLineKnowledge(gameState, STATIONS);
			const known = [...knowledge.confirmed.values(), ...knowledge.eliminated.values()];
			knownCsv = known.length ? known.join(",") : null;
		} catch {
		}
	}
	const bearing = hardMode && gameState.guesses.length < 4 && !isWon ? dailyRotation : null;
	return {showLines, bearing, knownCsv};
}

function mapParamsEqual(a: MapParams | null, b: MapParams | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return a.showLines === b.showLines && a.bearing === b.bearing && a.knownCsv === b.knownCsv;
}

function renderMap() {
	const mapDiv = document.getElementById("mapImage") as HTMLDivElement;
	const indicatorsDiv = document.getElementById("map-indicators") as HTMLDivElement;
	mapDiv.innerHTML = ""; // Clear only the map container
	// Determine today's solution and pass its coordinates to the embedded map
	const solution = stationById(gameState.solutionId);
	const isWon = gameState.status === "won";
	const params = new URLSearchParams();
	if (typeof solution.lon === "number" && typeof solution.lat === "number") {
		params.set("lon", String(solution.lon));
		params.set("lat", String(solution.lat));
		params.set("z", "15"); // default zoom
	}
	if (!hardMode || gameState.guesses.length >= 2 || isWon) {
		params.set("lines", linesUrl);
		// Pass known (confirmed) line ids so only those render in color
		try {
			const knowledge = logic.getKnownLineKnowledge(gameState, STATIONS);
			const known = [...knowledge.confirmed.values(), ...knowledge.eliminated.values()];
			if (known.length) params.set("known", known.join(","));
		} catch {
		}
	}
	if (hardMode && gameState.guesses.length < 4 && !isWon) {
		params.set("bearing", String(dailyRotation));
	}
	const iframe = document.createElement("iframe");
	// Append MapTiler key if available via Vite env (not present in tests/build output)
	const VITE_KEY = (import.meta as any).env.VITE_MAPTILER_KEY;
	if (VITE_KEY) params.set("k", VITE_KEY);

	iframe.src = mapUrl + (params.toString() ? `?${params.toString()}` : "");
	iframe.title = "Mapa (sem nomes)";
	iframe.style.width = "100%";
	iframe.style.height = "100%";
	iframe.style.border = "0";
	iframe.setAttribute("loading", "lazy");
	mapDiv.appendChild(iframe);

	// Update cached params snapshot to avoid unnecessary reloads next time
	lastMapParams = computeMapParams();

	indicatorsDiv.innerHTML = "";
	if (hardMode && !isWon) {
		if (gameState.guesses.length < 4) {
			const rotated = document.createElement("div");
			rotated.className = "map-indicator";
			rotated.title = "Mapa girado";
			rotated.textContent = "🔄";
			rotated.addEventListener("click", () => {
				showToast("O mapa está rotacionado. Ele voltará ao normal após o quarto erro.");
			});
			indicatorsDiv.appendChild(rotated);
		}
		if (gameState.guesses.length < 2) {
			const hidden = document.createElement("div");
			hidden.className = "map-indicator";
			hidden.title = "Linhas ocultas";
			hidden.textContent = "👁️‍🗨️";
			hidden.addEventListener("click", () => {
				showToast("As linhas do metrô estão ocultas. Elas aparecerão após o segundo erro.");
			});
			indicatorsDiv.appendChild(hidden);
		}
	}
}

function updatePlayableUI() {
	const playing = gameState.status === "playing";
	if (guessInput) guessInput.disabled = !playing;
	if (backspaceBtn) backspaceBtn.disabled = !playing;
	if (okBtn) okBtn.disabled = !playing;
	if (keyboard) keyboard.update();
}

function initUI() {
	refreshDatalist();
	renderGuesses();
	renderStats();
	shareBtn.disabled = gameState.status === "playing";
	updatePlayableUI();

	// On touch/mobile devices, prevent the native keyboard from opening
	try {
		const isTouch = "ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0;
		if (isTouch) {
			guessInput.readOnly = true; // programmatic updates still work
			// If it somehow gains focus, blur immediately
			guessInput.addEventListener(
				"focus",
				() => {
					try {
						guessInput.blur();
					} catch {}
				},
				true,
			);
			// Prevent default touch behavior that would try to focus
			guessInput.addEventListener("touchstart", ev => {
				ev.preventDefault();
			});
		}
	} catch {}

	// Initialize keyboard module
	keyboard = initKeyboard({
		root: keyboardEl,
		input: guessInput,
		getStations: () => STATIONS,
		getKeywords: () =>
			Object.values(LINES).map(l => {
				const name = l.name;
				const dashIdx = name.indexOf("-");
				return dashIdx >= 0 ? name.slice(dashIdx + 1).trim() : name;
			}),
		getEnabled: () => gameState.status === "playing",
		onSubmit: v => {
			onSubmitGuess(v);
			renderGuesses();
			renderSuggestions();
		},
		onInputChanged: () => {
			refreshDatalist();
			renderSuggestions();
		},
	});

	// Input listeners
	guessInput.addEventListener("input", () => {
		refreshDatalist();
		renderSuggestions();
		if (keyboard) keyboard.update();
	});
	form.addEventListener("submit", e => {
		e.preventDefault();
		const v = guessInput.value.trim();
		if (!v) return;
		onSubmitGuess(v);
		guessInput.value = "";
		refreshDatalist();
		renderSuggestions();
		if (keyboard) keyboard.update();
	});

 helpBtn.addEventListener("click", () => helpDialog.showModal());
  helpClose.addEventListener("click", () => {
    helpDialog.close();
    try {
      localStorage.setItem("seenHelpV1", "1");
    } catch {}
  });
  statsBtn.addEventListener("click", () => {
    renderStats();
    statsDialog.showModal();
  });
  statsClose.addEventListener("click", () => statsDialog.close());

  // Settings dialog interactions
  openedForCptmPrompt = false;
  settingsBtn.addEventListener("click", () => {
    // sync toggles before opening
    hardModeToggle.checked = hardMode;
    cptmToggle.checked = includeCPTM;
    openedForCptmPrompt = false;
		updateCptmHintVisibility();
    settingsDialog.showModal();
  });
  settingsClose.addEventListener("click", () => {
    // If we showed Settings as a CPTM prompt, consider it seen on close
    if (openedForCptmPrompt) {
			try {
				// If user closes without enabling, count as dismissed
				if (!includeCPTM) {
					try {
						gtag("event", "cptm_prompt_dismissed");
					} catch {
					}
				}
				state.saveCptmPromptSeen();
			} catch {
			}
      openedForCptmPrompt = false;
    }
    settingsDialog.close();
  });

	if (backspaceBtn) {
		backspaceBtn.addEventListener("click", () => {
			guessInput.value = guessInput.value.slice(0, -1);
			refreshDatalist();
			renderSuggestions();
			if (keyboard) keyboard.update();
		});
	}

 if (statsShareBtn) {
        statsShareBtn.addEventListener("click", async () => {
            statsShareBtn.disabled = true;
            try {
                const msg = await shareResult(gameState);
                statsShareBtn.textContent = msg ?? "Copiado!";
            } finally {
                statsShareBtn.disabled = false;
            }
        });
    }

	if (statsShareImgBtn) {
		statsShareImgBtn.addEventListener("click", async () => {
			statsShareImgBtn.disabled = true;
			try {
				const msg = await shareImgResult(gameState);
				statsShareImgBtn.textContent = msg;
			} finally {
				statsShareImgBtn.disabled = false;
			}
		});
 }

    tryHardModeLink.addEventListener("click", e => {
        e.preventDefault();
        statsDialog.close();
        // Open settings to let the user enable hard mode
        hardModeToggle.checked = hardMode;
        cptmToggle.checked = includeCPTM;
			openedForCptmPrompt = false;
			updateCptmHintVisibility();
        settingsDialog.showModal();
    });
    hardModeToggle.addEventListener("change", () => {
        hardMode = hardModeToggle.checked;
        state.saveHardMode(hardMode);
        renderMap();
        // Update visibility of the hard mode hint based on the new state
        updateCptmHintVisibility();
    });

    cptmToggle.addEventListener("change", () => {
        includeCPTM = cptmToggle.checked;
			try {
				gtag("event", "cptm_toggle", {enabled: includeCPTM, source: openedForCptmPrompt ? "prompt" : "settings"});
				if (openedForCptmPrompt && includeCPTM) {
					gtag("event", "cptm_prompt_accepted");
				}
			} catch {
			}
        state.saveIncludeCPTM(includeCPTM);
        state.saveCptmPromptSeen();
        // Reload to reinitialize stations/data and daily solution with the new setting
        location.reload();
    });

    // Initial map render
    renderMap();
}

// Boot: load stations from CSV (required) then init UI
async function boot() {
    scheduleMidnightReset();
    includeCPTM = state.loadIncludeCPTM();
	try {
		gtag("event", "cptm_mode_impression", {mode: includeCPTM ? "cptm" : "metro"});
	} catch {
	}
    STATIONS = await loadStations({ includeCPTM });
    gameState = state.loadState(todayKey, STATIONS, includeCPTM);
    stats = state.loadStats(includeCPTM);
    // For testing purposes
    (window as any).STATIONS = STATIONS;
    (window as any).gameState = gameState;
    hardMode = state.loadHardMode();
    hardModeToggle.checked = hardMode;
    cptmToggle.checked = includeCPTM;
    dailyRotation = logic.getDailyRotation(todayKey);
    const solution = stationById(gameState.solutionId);
	let ADJ_GRAPH = await loadAdjacencyGraph({includeCPTM});
    DIST_FROM_SOLUTION = bfsDistances(solution, ADJ_GRAPH);
    initUI();
    // Wire help link to open settings
    if (openSettingsFromHelp) {
        openSettingsFromHelp.addEventListener("click", e => {
            e.preventDefault();
            helpDialog.close();
            hardModeToggle.checked = hardMode;
            cptmToggle.checked = includeCPTM;
            openedForCptmPrompt = false;
					updateCptmHintVisibility();
            settingsDialog.showModal();
        });
    }

    // Auto-open help on first run; also mark CPTM prompt as seen so we don't double prompt
    let firstRun = false;
    try {
        if (!localStorage.getItem("seenHelpV1")) {
            firstRun = true;
            helpDialog.showModal();
            // Consider CPTM prompt as already surfaced for first-time users
            state.saveCptmPromptSeen();
        }
    } catch {}

    // Show CPTM opt-in prompt once (but not on very first run)
    try {
        const shouldPromptCPTM = !firstRun && !state.loadCptmPromptSeen() && !includeCPTM;
        if (shouldPromptCPTM) {
            hardModeToggle.checked = hardMode;
            cptmToggle.checked = includeCPTM;
            openedForCptmPrompt = true;
					updateCptmHintVisibility();
            settingsDialog.showModal();
        }
    } catch {}
}

// Start app
boot();

let toastTimer: any | null = null;
function showToast(message: string) {
	const toast = document.getElementById("toast-notification") as HTMLDivElement;
	toast.textContent = message;
	toast.classList.add("show");
	if (toastTimer) {
		clearTimeout(toastTimer);
	}
	toastTimer = setTimeout(() => {
		toast.classList.remove("show");
		toastTimer = null;
	}, 3000);
}
