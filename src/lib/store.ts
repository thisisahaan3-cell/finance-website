/**
 * Everything the user creates lives in the browser (localStorage): portfolios, watchlist,
 * favourites, settings and saved calculator inputs. Nothing is sent to a server.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { Txn } from './finance/portfolio';

export interface Portfolio {
  id: string;
  name: string;
  currency: string;
  benchmark: string;
  cash: number;
  txns: Txn[];
  /** target weights in percent of the whole portfolio, by symbol */
  targets: Record<string, number>;
  cashTarget: number;
  createdAt: string;
  updatedAt: string;
  sample?: boolean;
}

export interface SymbolMeta {
  name: string;
  sector?: string | null;
  industry?: string | null;
  currency?: string | null;
  marketCap?: number | null;
  type?: string | null;
  at: number;
}

export interface WorthItem {
  id: string;
  label: string;
  kind: string;
  amount: number;
}

export interface Settings {
  theme: 'light' | 'dark' | 'system';
  /** annual risk-free rate used for Sharpe ratios and CAPM, as a decimal */
  riskFree: number;
  /** expected long-run inflation, as a decimal */
  inflation: number;
  largeCapMinCr: number;
  midCapMinCr: number;
}

export interface AppState {
  version: 1;
  portfolios: Portfolio[];
  watchlist: string[];
  favourites: string[];
  recents: string[];
  lessonsDone: string[];
  settings: Settings;
  symbolMeta: Record<string, SymbolMeta>;
  netWorth: { assets: WorthItem[]; liabilities: WorthItem[]; monthlyExpenses: number };
  /** saved inputs of individual tools, keyed by tool */
  saved: Record<string, unknown>;
}

const KEY = 'artha:v1';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  riskFree: 0.065,
  inflation: 0.05,
  largeCapMinCr: 100_000,
  midCapMinCr: 30_000,
};

const initial = (): AppState => ({
  version: 1,
  portfolios: [],
  watchlist: ['^NSEI', 'RELIANCE.NS', 'HDFCBANK.NS', 'TCS.NS', 'INFY.NS'],
  favourites: [],
  recents: [],
  lessonsDone: [],
  settings: { ...DEFAULT_SETTINGS },
  symbolMeta: {},
  netWorth: { assets: [], liabilities: [], monthlyExpenses: 0 },
  saved: {},
});

function normalise(raw: unknown): AppState {
  const base = initial();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<AppState>;
  return {
    ...base,
    ...r,
    version: 1,
    portfolios: Array.isArray(r.portfolios) ? r.portfolios.filter((p) => p && typeof p.id === 'string' && Array.isArray(p.txns)) : [],
    watchlist: Array.isArray(r.watchlist) ? r.watchlist.filter((s) => typeof s === 'string') : base.watchlist,
    favourites: Array.isArray(r.favourites) ? r.favourites : [],
    recents: Array.isArray(r.recents) ? r.recents : [],
    lessonsDone: Array.isArray(r.lessonsDone) ? r.lessonsDone : [],
    settings: { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) },
    symbolMeta: r.symbolMeta && typeof r.symbolMeta === 'object' ? r.symbolMeta : {},
    netWorth: { ...base.netWorth, ...(r.netWorth ?? {}) },
    saved: r.saved && typeof r.saved === 'object' ? r.saved : {},
  };
}

function load(): AppState {
  try {
    const text = localStorage.getItem(KEY);
    return text ? normalise(JSON.parse(text)) : initial();
  } catch {
    return initial();
  }
}

let state: AppState = typeof localStorage === 'undefined' ? initial() : load();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveFailed = false;

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    saveFailed = false;
  } catch {
    saveFailed = true;
  }
}

export const storageFailed = () => saveFailed;
export const getState = (): AppState => state;

export function update(fn: (s: AppState) => AppState): void {
  const next = fn(state);
  if (next === state) return;
  state = next;
  listeners.forEach((l) => l());
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 150);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (saveTimer) persist();
  });
  // keep several open tabs in step
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && e.newValue) {
      try {
        state = normalise(JSON.parse(e.newValue));
        listeners.forEach((l) => l());
      } catch {
        /* ignore a corrupt write from another tab */
      }
    }
  });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}

/** A tool's inputs, remembered between visits. `reset` restores the defaults. */
export function useSaved<T extends object>(key: string, defaults: T): [T, (patch: Partial<T>) => void, () => void] {
  const stored = useStore((s) => s.saved[key]) as Partial<T> | undefined;
  const value = (stored ? { ...defaults, ...stored } : defaults) as T;
  const set = useCallback(
    (patch: Partial<T>) => update((s) => ({ ...s, saved: { ...s.saved, [key]: { ...defaults, ...((s.saved[key] as object) ?? {}), ...patch } } })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const reset = useCallback(
    () =>
      update((s) => {
        const saved = { ...s.saved };
        delete saved[key];
        return { ...s, saved };
      }),
    [key],
  );
  return [value, set, reset];
}

export const uid = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- portfolios ---------- */

export function createPortfolio(name: string, currency = 'INR', benchmark = '^NSEI', extra: Partial<Portfolio> = {}): string {
  const id = uid();
  const now = new Date().toISOString();
  update((s) => ({
    ...s,
    portfolios: [...s.portfolios, { id, name: name.trim() || 'My portfolio', currency, benchmark, cash: 0, txns: [], targets: {}, cashTarget: 0, createdAt: now, updatedAt: now, ...extra }],
  }));
  return id;
}

export function patchPortfolio(id: string, fn: (p: Portfolio) => Portfolio): void {
  update((s) => ({ ...s, portfolios: s.portfolios.map((p) => (p.id === id ? { ...fn(p), updatedAt: new Date().toISOString() } : p)) }));
}

export function deletePortfolio(id: string): void {
  update((s) => ({ ...s, portfolios: s.portfolios.filter((p) => p.id !== id) }));
}

export function rememberMeta(symbol: string, meta: Omit<SymbolMeta, 'at'>): void {
  update((s) => {
    const prev = s.symbolMeta[symbol];
    const next = { ...prev, ...Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined && v !== null)), at: Date.now() } as SymbolMeta;
    if (prev && prev.name === next.name && prev.sector === next.sector && prev.industry === next.industry && prev.currency === next.currency && prev.marketCap === next.marketCap) return s;
    return { ...s, symbolMeta: { ...s.symbolMeta, [symbol]: next } };
  });
}

/* ---------- small preferences ---------- */

export function toggleFavourite(toolId: string): void {
  update((s) => ({ ...s, favourites: s.favourites.includes(toolId) ? s.favourites.filter((f) => f !== toolId) : [...s.favourites, toolId] }));
}

export function noteRecent(toolId: string): void {
  update((s) => (s.recents[0] === toolId ? s : { ...s, recents: [toolId, ...s.recents.filter((r) => r !== toolId)].slice(0, 8) }));
}

export function toggleWatch(symbol: string): void {
  update((s) => ({ ...s, watchlist: s.watchlist.includes(symbol) ? s.watchlist.filter((w) => w !== symbol) : [...s.watchlist, symbol] }));
}

export function setSettings(patch: Partial<Settings>): void {
  update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
}

/* ---------- backup ---------- */

export function exportBackup(): string {
  return JSON.stringify({ app: 'artha', exportedAt: new Date().toISOString(), state }, null, 2);
}

/** Replace all saved data with a backup file's contents. Throws a readable error if the file is not a backup. */
export function importBackup(text: string): void {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const candidate = parsed?.state ?? parsed;
  if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.portfolios)) throw new Error('That file is not an Artha backup.');
  update(() => normalise(candidate));
}

export function resetAll(): void {
  update(() => initial());
}
