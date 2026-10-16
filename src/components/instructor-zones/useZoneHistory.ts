import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ZoneCoordinate } from "./types";

/**
 * A service area is stored as one closed ring, but every editor works on the
 * open form (the closing duplicate is a storage detail, and re-adding it
 * mid-edit produces a zero-length edge that `pointInPolygon`'s even-odd parity
 * mis-reads). 200 is ~7x the worst real ring — see the note in
 * ZoneDrawingEditor about the KML vertex distribution.
 */
export const MAX_VERTICES = 200;

const COORD_EPSILON = 1e-7;

export function isSamePoint(a: ZoneCoordinate, b: ZoneCoordinate): boolean {
  return (
    Math.abs(a.lat - b.lat) < COORD_EPSILON &&
    Math.abs(a.lng - b.lng) < COORD_EPSILON
  );
}

export function isClosedRing(c: ZoneCoordinate[] | null | undefined): boolean {
  if (!c || c.length < 4) return false;
  return isSamePoint(c[0], c[c.length - 1]);
}

export function closeRing(c: ZoneCoordinate[]): ZoneCoordinate[] {
  if (c.length < 3) return c;
  return isClosedRing(c) ? c : [...c, { ...c[0] }];
}

export function openRing(c: ZoneCoordinate[] | null | undefined) {
  if (!c) return [];
  return isClosedRing(c) ? c.slice(0, -1) : c;
}

export function arraysEqual(a: ZoneCoordinate[], b: ZoneCoordinate[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => isSamePoint(p, b[i]));
}

export function formatCoord(coord: ZoneCoordinate): string {
  return `${coord.lat.toFixed(6)}, ${coord.lng.toFixed(6)}`;
}

interface HistoryState {
  /** Every distinct ring the user has produced, oldest first. */
  stack: ZoneCoordinate[][];
  /** Index of the live entry in `stack`. */
  index: number;
}

export interface ApplyOptions {
  /**
   * Consecutive `apply` calls sharing a coalesce key collapse into one undo
   * step. Vertex drags fire a path event per animation frame, so without this
   * one drag becomes ~60 undo steps and the stack is unusable.
   */
  coalesce?: string;
}

export interface ZoneHistory {
  /** The live ring, always open (no closing duplicate). */
  ring: ZoneCoordinate[];
  canUndo: boolean;
  canRedo: boolean;
  /** The single way to change the ring. Returns false if the change was rejected. */
  apply: (next: ZoneCoordinate[] | null, options?: ApplyOptions) => boolean;
  undo: () => void;
  redo: () => void;
  /** Replace the whole history, e.g. when opening a different zone. */
  reset: (next: ZoneCoordinate[] | null) => void;
}

const EMPTY_RING: ZoneCoordinate[] = [];
const initialState = (next: ZoneCoordinate[] | null): HistoryState => ({
  stack: [openRing(next)],
  index: 0,
});

/**
 * Undo/redo for a polygon ring, covering every action that can change it.
 *
 * The important property is that the hook owns the ring rather than mirroring
 * one owned by a parent. An earlier implementation kept the stack as a mirror
 * of a `coordinates` prop and pushed from a `useEffect` watching that prop,
 * which silently lost coverage: `clear` emitted `null`, dragging used a
 * separate debounce, and in-progress draw clicks lived in a second piece of
 * state entirely — so none of those were undoable. Here the ring *is* the
 * history, every mutation goes through `apply`, and undo/redo simply move the
 * index. An action cannot be missing from the history because it did not go
 * through `apply`, and `apply` is the only way to change the value.
 *
 * State lives in a ref that is written synchronously and mirrored into React
 * state for rendering. That is deliberate: `apply` is called several times in a
 * row within one click handler (and from Google Maps' per-frame path events),
 * and deriving the next state from a `setState` updater would be both stale and
 * impure — a boolean "was this accepted?" return value could not be computed
 * inside an updater, because React may defer it and re-invoke it.
 */
export function useZoneHistory(
  initial: ZoneCoordinate[] | null,
  onChange: (next: ZoneCoordinate[] | null) => void,
  /** Re-seeds the history whenever one of these changes. */
  deps: unknown[] = [],
): ZoneHistory {
  const stateRef = useRef<HistoryState>(initialState(initial));
  const [state, setState] = useState<HistoryState>(stateRef.current);

  // The coalesce key of the most recent apply, so a burst of same-key applies
  // keeps overwriting the current slot instead of extending the stack.
  const lastCoalesceRef = useRef<string | null>(null);

  const commit = useCallback((next: HistoryState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // The stack is never empty (see `initialState`), so this index is always in
  // range. The `?? EMPTY_RING` fallback is a stable module constant rather than
  // an inline `[]`, which would be a fresh array on every render and churn the
  // dependents of the effects and memo below.
  const ring = state.stack[state.index] ?? EMPTY_RING;

  // Re-seed when the editor is pointed at a different subject (a different
  // instructor's zone, or a fresh wizard step).
  useEffect(() => {
    lastCoalesceRef.current = null;
    commit(initialState(initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // A zone is loaded asynchronously, so `initial` is `null` on the first render
  // and populated a tick later. `deps` has not changed by then, so without this
  // the editor would open permanently empty on a zone that already exists.
  //
  // Guarded on the history still being pristine. Once anything has been
  // applied, a later `initial` is the parent's echo of the admin's own edit, and
  // re-seeding then would silently discard the undo stack.
  useEffect(() => {
    if (!initial || initial.length === 0) return;
    const prev = stateRef.current;
    const seeded = prev.stack[prev.index] ?? EMPTY_RING;
    const pristine =
      prev.index === 0 && prev.stack.length === 1 && seeded.length === 0;
    if (!pristine) return;
    lastCoalesceRef.current = null;
    commit(initialState(initial));
  }, [initial, commit]);

  const apply = useCallback(
    (next: ZoneCoordinate[] | null, options?: ApplyOptions): boolean => {
      const open = openRing(next);
      const prev = stateRef.current;
      const current = prev.stack[prev.index] ?? EMPTY_RING;

      // No-op edits (a drag that ended where it started, a re-applied ring)
      // must not consume a history slot.
      if (arraysEqual(open, current)) return false;
      // Do not let an over-long ring enter the stack: undo would then have to
      // walk through states the database CHECK constraint rejects.
      if (open.length > MAX_VERTICES) return false;

      const coalesce = options?.coalesce ?? null;
      const continuingBurst =
        coalesce !== null && lastCoalesceRef.current === coalesce;
      lastCoalesceRef.current = coalesce;

      // A continuing burst overwrites the slot the previous frame wrote;
      // anything else starts a new slot, discarding any redo tail.
      const stack = continuingBurst
        ? prev.stack.slice(0, prev.index).concat([open])
        : prev.stack.slice(0, prev.index + 1).concat([open]);

      commit({ stack, index: stack.length - 1 });
      return true;
    },
    [commit],
  );

  const undo = useCallback(() => {
    const prev = stateRef.current;
    if (prev.index <= 0) return;
    lastCoalesceRef.current = null;
    commit({ ...prev, index: prev.index - 1 });
  }, [commit]);

  const redo = useCallback(() => {
    const prev = stateRef.current;
    if (prev.index >= prev.stack.length - 1) return;
    lastCoalesceRef.current = null;
    commit({ ...prev, index: prev.index + 1 });
  }, [commit]);

  const reset = useCallback(
    (next: ZoneCoordinate[] | null) => {
      lastCoalesceRef.current = null;
      commit(initialState(next));
    },
    [commit],
  );

  // Skip the first emission: the parent already holds the initial value, and
  // re-emitting it would only churn its state.
  const emittedRef = useRef(false);
  useEffect(() => {
    if (!emittedRef.current) {
      emittedRef.current = true;
      return;
    }
    onChangeRef.current(ring.length === 0 ? null : closeRing(ring));
  }, [ring]);

  return useMemo(
    () => ({
      ring,
      canUndo: state.index > 0,
      canRedo: state.index < state.stack.length - 1,
      apply,
      undo,
      redo,
      reset,
    }),
    [ring, state.index, state.stack.length, apply, undo, redo, reset],
  );
}
