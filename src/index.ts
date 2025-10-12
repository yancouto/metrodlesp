import { loadStations } from './stationLoader.js';
import { initKeyboard } from './keyboard.js';

type LineId = string; // numeric string: '1', '2', '15'

interface Line { id: LineId; name: string; color: string; }
interface Station { id: string; name: string; lines: LineId[]; imageUrl?: string; }

// Minimal dataset (bootstrap). Extend this list in the future.
const LINES: Record<string, Line> = {
  '1': { id: '1', name: 'Linha 1-Azul', color: '#0033a0' },
  '2': { id: '2', name: 'Linha 2-Verde', color: '#00a651' },
  '3': { id: '3', name: 'Linha 3-Vermelha', color: '#ee3124' },
  '4': { id: '4', name: 'Linha 4-Amarela', color: '#ffc20e' },
  '5': { id: '5', name: 'Linha 5-Lilás', color: '#7f3f98' },
  '7': { id: '7', name: 'Linha 7-Rubi', color: '#c21807' },
  '8': { id: '8', name: 'Linha 8-Diamante', color: '#8e8e8e' },
  '9': { id: '9', name: 'Linha 9-Esmeralda', color: '#0f9d58' },
  '10': { id: '10', name: 'Linha 10-Turquesa', color: '#30c6d9' },
  '11': { id: '11', name: 'Linha 11-Coral', color: '#ff7f50' },
  '12': { id: '12', name: 'Linha 12-Safira', color: '#26619c' },
  '13': { id: '13', name: 'Linha 13-Jade', color: '#00a86b' },
  '15': { id: '15', name: 'Linha 15-Prata', color: '#c0c0c0' },
};

let STATIONS: Station[] = [];

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
type Stats = { played: number; wins: number; streak: number; best: number; lastDate?: string; };
function loadStats(): Stats {
  const raw = localStorage.getItem(STATS_KEY);
  if (raw) { try { return JSON.parse(raw) as Stats; } catch {} }
  return { played: 0, wins: 0, streak: 0, best: 0 };
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
  const solSet = new Set(solution.lines);
  const list = unique([...guess.lines, ...solution.lines]);
  return list.map(id => ({ line: LINES[id], match: solSet.has(id) }));
}

function lineChipsHTML(items: { line: Line, match: boolean }[]) {
  return items.map(({ line, match }) => `<span class="line-chip ${match ? '' : 'miss'}" title="${line.name}" style="background:${line.color}"></span>`).join('');
}

// Share
function buildShare(state: GameState): string {
  const date = state.dateKey;
  const attempts = state.status === 'won' ? state.guesses.length : 'X';
  const title = `Metrodle SP ${date} ${attempts}/6`;
  const solution = stationById(state.solutionId);
  const rows = state.guesses.map(id => {
    const guess = stationById(id);
    const comps = compareLines(guess, solution);
    // Use green square for match, black square for miss
    return comps.map(c => c.match ? '🟩' : '⬛').join('');
  });
  return [title, ...rows].join('\n');
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
const shareBtn = document.getElementById('shareBtn') as HTMLButtonElement;
const shareMsg = document.getElementById('shareMsg') as HTMLDivElement;
const keyboardEl = document.getElementById('keyboard') as HTMLDivElement;

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

function refreshDatalist() {
  const q = guessInput.value;
  const cands = q ? searchCandidates(q) : STATIONS.slice().sort((a,b)=>a.name.localeCompare(b.name));
  list.innerHTML = cands.map(s => `<option value="${s.name}"></option>`).join('');
}

function renderGuesses() {
  const solution = stationById(state.solutionId);
  guessesEl.innerHTML = state.guesses.map((id, i) => {
    const s = stationById(id);
    const comps = compareLines(s, solution);
    const correct = s.id === solution.id;
    return `<div class="guess"><div><div class="name">${i+1}. ${s.name}${correct ? ' ✅' : ''}</div></div><div class="lines">${lineChipsHTML(comps)}</div></div>`;
  }).join('');
}

function renderStats() {
  statPlayed.textContent = String(stats.played);
  statWin.textContent = String(stats.wins);
  statStreak.textContent = String(stats.streak);
  statBest.textContent = String(stats.best);
}

// Keyboard wiring (separated module)
let keyboard: { update: () => void } | null = null;
const suggestionsEl = document.getElementById('suggestions') as HTMLDivElement | null;

function renderSuggestions() {
  if (!suggestionsEl) return;
  const q = guessInput.value.trim();
  const items = q ? searchCandidates(q) : [];
  if (!q || items.length === 0) {
    suggestionsEl.innerHTML = '';
    suggestionsEl.style.display = 'none';
    return;
  }
  const html = items.map(s => `<button type="button" class="suggestion-item" data-id="${s.id}">${s.name}</button>`).join('');
  suggestionsEl.innerHTML = html;
  suggestionsEl.style.display = 'block';
  // Ensure the suggestions overlay is visible on screen (mobile keyboards can shift the viewport)
  const mapEl = document.getElementById('mapImage');
  if (mapEl) {
    // Use nearest to avoid jumping too much; smooth scroll for nicer UX
    try { mapEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { mapEl.scrollIntoView(); }
  }
}

// Delegate clicks for suggestions
if (suggestionsEl) {
  suggestionsEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target && target.matches('button.suggestion-item')) {
      const id = target.getAttribute('data-id')!;
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
  shareBtn.disabled = false;
  // update stats once per day
  if (stats.lastDate !== state.dateKey) {
    stats.played += 1;
    stats.lastDate = state.dateKey;
    if (won) { stats.wins += 1; stats.streak += 1; stats.best = Math.max(stats.best, stats.streak); } else { stats.streak = 0; }
    saveStats(stats);
  }
  renderStats();
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
    const comps = compareLines(match, solution);
    const ok = comps.filter(c => c.match).length;
    setHint(`Linhas em comum: ${ok}/${comps.length}`);
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

  shareBtn.addEventListener('click', async () => {
    const msg = await shareResult(state);
    shareMsg.textContent = msg;
  });
}

// Boot: load stations from CSV (required) then init UI
async function boot() {
  const loaded = await loadStations();
  console.log('loaded', loaded);
  STATIONS = loaded;
  state = loadState();
  stats = loadStats();
  initUI();
}

// Start app
boot();
