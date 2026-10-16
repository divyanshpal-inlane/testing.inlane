import { useEffect, useRef } from "react";

import { useLearningSession } from "@/hooks/useLearningSession";
import {
  addRange,
  type LearningContext,
  playbackDelta,
} from "@/lib/learning-analytics/model";

export default function TrackedVideo({
  src,
  title,
  context,
}: {
  src: string;
  title: string;
  context: LearningContext;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const { tracker, flush, restart } = useLearningSession(context);
  const ended = useRef(false);
  const previous = useRef<{ position: number; time: number } | null>(null);
  const reset = () => {
    previous.current = null;
  };
  const sample = () => {
    const el = video.current;
    if (!el) return;
    const now = performance.now();
    const old = previous.current;
    const active =
      !el.paused &&
      !el.seeking &&
      el.readyState >= 2 &&
      document.visibilityState === "visible";
    if (
      old &&
      playbackDelta(
        old.position,
        el.currentTime,
        now - old.time,
        el.playbackRate,
        active,
      )
    ) {
      tracker.snapshot.ranges = addRange(
        tracker.snapshot.ranges,
        old.position,
        el.currentTime,
      );
      tracker.snapshot.active_ms += Math.round(now - old.time);
      tracker.dirty = true;
    }
    if (Number.isFinite(el.duration) && el.duration > 0)
      tracker.snapshot.duration = el.duration;
    previous.current = active ? { position: el.currentTime, time: now } : null;
  };
  useEffect(() => {
    document.addEventListener("visibilitychange", reset);
    return () => document.removeEventListener("visibilitychange", reset);
  }, []);
  return (
    <video
      ref={video}
      className="w-full overflow-hidden rounded-lg"
      aria-label={title}
      src={src}
      autoPlay
      playsInline
      controls
      preload="metadata"
      onPlaying={() => {
        if (!tracker.started) tracker.started = true;
        sample();
        tracker.dirty = true;
        flush();
      }}
      onPlay={() => {
        if (ended.current) {
          restart();
          ended.current = false;
        }
        tracker.snapshot.plays++;
        reset();
      }}
      onTimeUpdate={sample}
      onPause={() => {
        tracker.snapshot.pauses++;
        tracker.dirty = tracker.started;
        reset();
        flush();
      }}
      onSeeking={() => {
        tracker.snapshot.seeks++;
        tracker.dirty = tracker.started;
        reset();
      }}
      onSeeked={reset}
      onRateChange={reset}
      onWaiting={reset}
      onEnded={() => {
        ended.current = true;
        tracker.dirty = tracker.started;
        reset();
        flush();
      }}
      onError={() => {
        tracker.started = true;
        tracker.snapshot.errors++;
        tracker.dirty = true;
        flush();
      }}
    >
      Your browser does not support the video tag.
    </video>
  );
}
