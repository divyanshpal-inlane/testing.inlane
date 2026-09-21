import { useEffect, useRef } from "react";

import { useLearningSession } from "@/hooks/useLearningSession";
import {
  type LearningContext,
  questionId,
} from "@/lib/learning-analytics/model";

export function useQuizAnalytics(context: LearningContext) {
  const session = useLearningSession(context);
  const last = useRef(performance.now());
  useEffect(() => {
    session.tracker.started = true;
    session.tracker.dirty = true;
    session.flush();
    const clock = window.setInterval(() => {
      const now = performance.now();
      if (document.visibilityState === "visible" && now - last.current < 2000) {
        session.tracker.snapshot.active_ms += Math.round(now - last.current);
        session.tracker.dirty = true;
      }
      last.current = now;
    }, 1000);
    return () => {
      window.clearInterval(clock);
    };
  }, []);
  return {
    answer: (question: string, selected: string | null, elapsedMs: number) => {
      session.tracker.snapshot.responses.push({
        question_id: questionId(question),
        selected,
        elapsed_ms: Math.round(elapsedMs),
      });
      session.tracker.dirty = true;
      session.flush();
    },
    finish: () => {
      session.tracker.snapshot.finished = true;
      session.tracker.dirty = true;
      session.flush();
    },
  };
}
