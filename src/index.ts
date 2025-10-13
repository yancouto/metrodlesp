import {bfsDistances, loadAdjacencyGraph, loadStations, Station} from './stationLoader.js';
import {initKeyboard} from './keyboard.js';
import {Line, LineId, LINES} from './lines.js';

let STATIONS: Station[];
let DIST_FROM_SOLUTION: Map<string, number>; // keyed by wikidataId

// Utilities
const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickDailyStation(dateKey: string): Station {
  const idx = hashString('metrodlesp:' + dateKey) % STATIONS.length;
  return STATIONS[idx];
}

// State
type GameState = {
  solutionId: string;
  dateKey: string;
  guesses: string[]; // station ids
  status: 'playing' | 'won' | 'lost';
};

const STORAGE_KEY = 'metrodlesp:state';
const STATS_KEY = 'metrodlesp:stats';

function loadState(): GameState {
  const raw = localStorage.getItem(STORAGE_KEY);
  const solution = pickDailyStation(todayKey);
  console.log("Today's station", solution);
  if (raw) {
    try {
      const state = JSON.parse(raw) as GameState;
      if (state.dateKey === todayKey && state.solutionId === solution.id) {
        return state;
      }
    } catch {}
  }
  const init: GameState = { solutionId: solution.id, dateKey: todayKey, guesses: [], status: 'playing' };
  saveState(init);
  return init;
}
function saveState(s: GameState) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }

// Stats
type Stats = { played: number; wins: number; streak: number; best: number; lastDate?: string; dist: number[] };
function loadStats(): Stats {
  const raw = localStorage.getItem(STATS_KEY);
  if (!raw) return { played: 0, wins: 0, streak: 0, best: 0, dist: [0,0,0,0,0,0] };
  try {
    return JSON.parse(raw) as Stats;
  } catch {
    return { played: 0, wins: 0, streak: 0, best: 0, dist: [0,0,0,0,0,0] };
  }
}
function saveStats(st: Stats) { localStorage.setItem(STATS_KEY, JSON.stringify(st)); }

function stationById(id: string) { return STATIONS.find(s => s.id === id)!; }
function stationByName(name: string) {
  const n = name.trim().toLowerCase();
  return STATIONS.find(s => s.name.toLowerCase() === n);
}

function searchCandidates(query: string): Station[] {
  const qn = normalize(query.trim());
  if (!qn) return [];
  // match by station name OR by line id/name (diacritics-insensitive)
  const byName = STATIONS.filter(s => normalize(s.name).includes(qn));
  const lineHits: Set<LineId> = new Set();
  (Object.keys(LINES) as LineId[]).forEach((k) => {
    const l = LINES[k];
    if (normalize(l.name).includes(qn) || normalize(String(l.id)).includes(qn)) lineHits.add(l.id);
  });
  const byLine = STATIONS.filter(s => s.lines.some(l => lineHits.has(l)));
  const map = new Map<string, Station>();
  [...byName, ...byLine].forEach(s => map.set(s.id, s));
  return [...map.values()].sort((a,b) => a.name.localeCompare(b.name));
}

function unique<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }

// Normalization helper: remove diacritics and lowercase for comparison/prediction
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function compareLines(guess: Station, solution: Station): { line: Line, match: boolean }[] {
  // Only evaluate the guessed station's lines and mark whether each exists in the solution.
  const solSet = new Set(solution.lines);
  return guess.lines.map(id => ({ line: LINES[id], match: solSet.has(id) }));
}

function lineChipsHTML(items: { line: Line, match: boolean }[]) {
  return items.map(({ line, match }) => `<span class="line-chip ${match ? '' : 'miss'}" title="${line.name}" style="background:${line.color}"></span>`).join('');
}

// Known info from previous guesses vs the hidden solution
function getKnownLineKnowledge(): { eliminated: Set<LineId>; confirmed: Set<LineId> } {
  const eliminated = new Set<LineId>();
  const confirmed = new Set<LineId>();
  const solution = stationById(state.solutionId);
  for (const gid of state.guesses) {
    const g = stationById(gid);
    for (const l of g.lines) {
      if (solution.lines.includes(l)) confirmed.add(l);
      else eliminated.add(l);
    }
  }
  return { eliminated, confirmed };
}

function suggestionLineChipsHTML(station: Station, knowledge: { eliminated: Set<LineId>; confirmed: Set<LineId> }) {
  const chips = station.lines.map((lid) => {
    const line = LINES[lid];

    const isMiss = knowledge.eliminated.has(lid);
    return { line, match: !isMiss };
  });
  return lineChipsHTML(chips);
}

function arrayEquals<A>(a: A[], b: A[]): boolean {
  return a.length === b.length && a.every((val, idx) => val === b[idx]);
}

// Share
function buildShare(state: GameState): string {
  const date = state.dateKey;
  const attempts = state.status === 'won' ? state.guesses.length : 'X';
  const title = `Metrodle SP ${date}`;
  const solution = stationById(state.solutionId);
  const rows = state.guesses.map(id => {
    const guess = stationById(id);
    const comps = compareLines(guess, solution);
    const matchSquares = (arrayEquals(guess.lines, solution.lines)? '🟩' : '⬛');
    if(guess.id === solution.id)
      return `${matchSquares} 🚆`;
    let distTxt = DIST_FROM_SOLUTION.get(guess.wikidataId)!;
    return `${matchSquares} a ${distTxt} paradas`;
  });
  return [title, ...rows, ` ${attempts}/6`, 'placeholder.com'].join('\n');
}

async function shareResult(state: GameState) {
  const text = buildShare(state);
  if ((navigator as any).share) {
    try { await (navigator as any).share({ text }); return 'Compartilhado!'; } catch {}
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'Copiado para a área de transferência!';
  } catch {
    return 'Copie manualmente:\n' + text;
  }
}

// Rendering and interactions
let state: GameState;
let stats: Stats;

const guessInput = document.getElementById('guessInput') as HTMLInputElement;
const form = document.getElementById('guessForm') as HTMLFormElement;
const list = document.getElementById('stationsList') as HTMLDataListElement;
const guessesEl = document.getElementById('guesses') as HTMLDivElement;
const hintEl = document.getElementById('hint') as HTMLDivElement;
const shareBtn = document.getElementById('shareBtn') as HTMLButtonElement; // legacy (hidden)
const shareMsg = document.getElementById('shareMsg') as HTMLDivElement;
const keyboardEl = document.getElementById('keyboard') as HTMLDivElement;
const backspaceBtn = document.getElementById('backspaceBtn') as HTMLButtonElement | null;
const okBtn = document.getElementById('okBtn') as HTMLButtonElement | null;
const endDialog = document.getElementById('endDialog') as HTMLDialogElement | null;
const endSummary = document.getElementById('endSummary') as HTMLParagraphElement | null;
const endShareBtn = document.getElementById('endShareBtn') as HTMLButtonElement | null;
const endShareMsg = document.getElementById('endShareMsg') as HTMLDivElement | null;
const endCloseBtn = document.getElementById('endCloseBtn') as HTMLButtonElement | null;

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
  const cands = q ? searchCandidates(q) : STATIONS.slice().sort((a,b)=>a.name.localeCompare(b.name));
  list.innerHTML = cands.map(s => `<option value="${s.name}"></option>`).join('');
}

function renderGuesses() {
  const solution = stationById(state.solutionId);
  const total = 6;
  const parts: string[] = [];
  for (let i = 0; i < total; i++) {
    if (i < state.guesses.length) {
      const id = state.guesses[i];
      const s = stationById(id);
      const comps = compareLines(s, solution);
      const correct = s.id === solution.id;
      const dist = DIST_FROM_SOLUTION.get(s.wikidataId);
      const distHtml = !correct && typeof dist === 'number' ? ` <span class="dist-badge">a ${dist} ${dist === 1 ? 'parada' : 'paradas'}</span>` : '';
      parts.push(`<div class="guess"><div><div class="name">${i+1}. ${s.name}${correct ? ' ✅' : ''}${distHtml}</div></div><div class="lines">${lineChipsHTML(comps)}</div></div>`);
    } else {
      parts.push(`<div class="guess placeholder"><div><div class="name">${i+1}. —</div></div><div class="lines"></div></div>`);
    }
  }
  guessesEl.innerHTML = parts.join('');
}

function renderStats() {
  statPlayed.textContent = String(stats.played);
  statWin.textContent = String(stats.wins);
  statStreak.textContent = String(stats.streak);
  statBest.textContent = String(stats.best);
  if (guessHistEl) {
    const max = Math.max(1, ...stats.dist);
    const bars = stats.dist.map((count, i) => {
      const h = Math.round((count / max) * 100);
      return `<div class="bar"><div class="count">${count}</div><div class="fill" style="height:${h}%"></div><div class="label">${i+1}</div></div>`;
    }).join('');
    guessHistEl.innerHTML = bars;
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
  const knowledge = getKnownLineKnowledge();
  // Name matches first
  const nameMatches = STATIONS.filter(s => normalize(s.name).includes(qn));
  // Determine which lines are being queried (by name or by number)
  const lineHits: LineId[] = [];
  (Object.keys(LINES) as LineId[]).forEach((id) => {
    const l = LINES[id];
    if (normalize(l.name).includes(qn) || normalize(String(l.id)).includes(qn)) lineHits.push(l.id);
  });
  // Build HTML
  const seen = new Set<string>();
  const parts: string[] = [];
  // Render name matches (unique, sorted)
  nameMatches.sort((a,b)=>a.name.localeCompare(b.name)).forEach(s => {
    if (seen.has(s.id)) return; seen.add(s.id);
    parts.push(`<button type="button" class="suggestion-item" data-id="${s.id}">`+
        `<div class="sugg-name">${s.name}</div>`+
        `<div class="lines">${suggestionLineChipsHTML(s, knowledge)}</div>`+
        `</button>`);
  });
  // Render line-based groups with separators
  for (const lid of lineHits) {
    const line = LINES[lid];
    // Group separator indicating why these appear
    parts.push(`<div class="suggestion-sep">${line.name}</div>`);
    const stationsOnLine = STATIONS.filter(s => s.lines.includes(lid)).sort((a,b)=>a.name.localeCompare(b.name));
    for (const st of stationsOnLine) {
      if (seen.has(st.id)) continue; seen.add(st.id);
      parts.push(`<button type="button" class="suggestion-item" data-id="${st.id}">`+
          `<div class="sugg-name">${st.name}</div>`+
          `<div class="lines">${suggestionLineChipsHTML(st, knowledge)}</div>`+
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
    try { mapEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { mapEl.scrollIntoView(); }
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
      guessInput.focus();
      refreshDatalist();
      renderSuggestions();
      if (keyboard) keyboard.update();
    }
  });
}

function endGame(won: boolean) {
  state.status = won ? 'won' : 'lost';
  saveState(state);
  // update stats once per day
  if (stats.lastDate !== state.dateKey) {
    stats.played += 1;
    stats.lastDate = state.dateKey;
    if (won) {
      stats.wins += 1;
      stats.streak += 1;
      stats.best = Math.max(stats.best, stats.streak);
      const attempts = state.guesses.length;
      if (attempts >= 1 && attempts <= 6) {
        stats.dist[attempts - 1] += 1;
      }
    } else {
      stats.streak = 0;
    }
    saveStats(stats);
  }
  renderStats();
  // Show completion dialog with share
  if (endDialog) {
    const solution = stationById(state.solutionId);
    const attempts = state.status === 'won' ? state.guesses.length : 6;
    if (endSummary) endSummary.textContent = won ? `Você acertou ${solution.name} em ${attempts} tentativa(s)!` : `Não foi dessa vez. A estação era ${solution.name}.`;
    try { endDialog.showModal(); } catch { /* dialog might already be open */ }
  }
}

function checkIfEnded() {
  const solution = stationById(state.solutionId);
  const won = state.guesses.some(id => id === solution.id);
  if (won) endGame(true);
  else if (state.guesses.length >= 6) endGame(false);
}

function setHint(text: string) { hintEl.textContent = text; }

function onSubmitGuess(name: string) {
  const solution = stationById(state.solutionId);
  const match = stationByName(name) || STATIONS.find(s => s.name.toLowerCase().includes(name.trim().toLowerCase()));
  if (!match) { setHint('Estação não encontrada.'); return; }
  if (state.guesses.includes(match.id)) { setHint('Você já tentou essa estação.'); return; }
  if (state.status !== 'playing') { setHint('O jogo de hoje terminou.'); return; }
  state.guesses.push(match.id);
  saveState(state);
  renderGuesses();
  if (match.id === solution.id) {
    setHint(`Acertou! Era ${solution.name}.`);
  } else {
    // No hint text required per spec; feedback is visual via line chips.
    setHint('');
  }
  checkIfEnded();
  if (state.status !== 'playing') shareBtn.disabled = false;
}

function renderMap() {
  const solution = stationById(state.solutionId);
  const mapDiv = document.getElementById('mapImage') as HTMLDivElement;
  mapDiv.innerHTML = '';
  // Placeholder rectangle with blurred circles representing lines count
  const wrapper = document.createElement('div');
  wrapper.className = 'placeholder';
  wrapper.textContent = `Estação do dia: ${solution.lines.length} linhas (imagem placeholder)`;
  mapDiv.appendChild(wrapper);
}

function initUI() {
  refreshDatalist();
  renderGuesses();
  renderStats();
  renderMap();
  shareBtn.disabled = state.status === 'playing';

  // Initialize keyboard module
  keyboard = initKeyboard({
    root: keyboardEl,
    input: guessInput,
    getStations: () => STATIONS,
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
  helpClose.addEventListener('click', () => helpDialog.close());
  statsBtn.addEventListener('click', () => { renderStats(); statsDialog.showModal(); });
  statsClose.addEventListener('click', () => statsDialog.close());

  if (backspaceBtn) {
    backspaceBtn.addEventListener('click', () => {
      guessInput.value = guessInput.value.slice(0, -1);
      refreshDatalist();
      renderSuggestions();
      if (keyboard) keyboard.update();
    });
  }

  if (endShareBtn) {
    endShareBtn.addEventListener('click', async () => {
      const msg = await shareResult(state);
      if (endShareMsg) endShareMsg.textContent = msg;
    });
  }
  if (endCloseBtn && endDialog) {
    endCloseBtn.addEventListener('click', () => endDialog.close());
  }
}

// Boot: load stations from CSV (required) then init UI
async function boot() {
  STATIONS = await loadStations();
  state = loadState();
  stats = loadStats();
  const solution = stationById(state.solutionId);
  let ADJ_GRAPH = await loadAdjacencyGraph();
  DIST_FROM_SOLUTION = bfsDistances(solution, ADJ_GRAPH);
  initUI();
}

// Start app
boot();
