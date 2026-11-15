import { useCallback, useEffect, useRef, useState } from 'react';

export interface Async<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Run an async function when `deps` change. Stale responses are discarded, errors become
 * a readable message, and the previous data stays visible while a refresh is in flight.
 * Pass `null` as the function to stay idle.
 */
export function useAsync<T>(fn: (() => Promise<T>) | null, deps: unknown[]): Async<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: !!fn });
  const [tick, setTick] = useState(0);
  const run = useRef(0);
  useEffect(() => {
    if (!fn) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    const id = ++run.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => {
        if (id === run.current) setState({ data, error: null, loading: false });
      },
      (e) => {
        if (id === run.current) setState({ data: null, error: e instanceof Error ? e.message : 'Something went wrong.', loading: false });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** Width of an element, tracked with ResizeObserver, for responsive SVG charts. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.round(e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Try a calculation; return its value or the error message, never both. */
export function attempt<T>(fn: () => T): { value: T; error: null } | { value: null; error: string } {
  try {
    return { value: fn(), error: null };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : 'Check the inputs.' };
  }
}
