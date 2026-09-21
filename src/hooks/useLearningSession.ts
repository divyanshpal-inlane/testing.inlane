import { useEffect, useRef } from "react";

import {
  emptySnapshot,
  type LearningContext,
} from "@/lib/learning-analytics/model";
import { saveLearningSession } from "@/queries/learningAnalytics";

/** One mount is one attempt. Cumulative snapshots make retries idempotent. */
export function useLearningSession(context: LearningContext) {
  const tracker = useRef({
    id: crypto.randomUUID(),
    sequence: 0,
    started: false,
    dirty: false,
    snapshot: emptySnapshot(),
  });
  const contextRef = useRef(context);
  contextRef.current = context;
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = () => {
    const t = tracker.current;
    if (!t.started || !t.dirty) return;
    t.dirty = false;
    const sessionId = t.id;
    const sessionContext = contextRef.current;
    const sequence = ++t.sequence;
    const snapshot = structuredClone(t.snapshot);
    const send = async () => {
      try {
        const { error } = await saveLearningSession(
          sessionContext,
          sessionId,
          sequence,
          snapshot,
        );
        if (error) throw error;
      } catch {
        // A later cumulative snapshot includes unsaved activity; no unbounded local queue.
        if (t.id === sessionId) t.dirty = true;
      }
    };
    void send();
  };
  useEffect(() => {
    const flush = () => flushRef.current();
    const interval = window.setInterval(flush, 5000);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("online", flush);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("online", flush);
      flush();
    };
  }, []);
  return {
    tracker: tracker.current,
    flush: () => flushRef.current(),
    restart: () => {
      flushRef.current();
      Object.assign(tracker.current, {
        id: crypto.randomUUID(),
        sequence: 0,
        started: false,
        dirty: false,
        snapshot: emptySnapshot(),
      });
    },
  };
}
