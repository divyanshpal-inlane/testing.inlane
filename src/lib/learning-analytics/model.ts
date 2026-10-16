import type { Game } from "@/components/lesson/trivia";

/** Stable identifiers distinguish content revisions and survive option shuffling. */
export function contentHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++)
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
export const videoId = (url: string) => `video:${contentHash(url)}`;
export const quizId = (game: Game) =>
  `quiz:${contentHash(JSON.stringify(game))}`;
export const questionId = (question: string) => contentHash(question);
export interface LearningContext {
  courseId: string;
  lessonNumber: number;
  contentId: string;
}
export interface ResponseRecord {
  question_id: string;
  selected: string | null;
  elapsed_ms: number;
}
export interface LearningSnapshot {
  duration: number;
  ranges: [number, number][];
  active_ms: number;
  plays: number;
  pauses: number;
  seeks: number;
  errors: number;
  responses: ResponseRecord[];
  finished: boolean;
}
export const emptySnapshot = (): LearningSnapshot => ({
  duration: 0,
  ranges: [],
  active_ms: 0,
  plays: 0,
  pauses: 0,
  seeks: 0,
  errors: 0,
  responses: [],
  finished: false,
});
export function addRange(
  ranges: [number, number][],
  start: number,
  end: number,
): [number, number][] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return ranges;
  const merged: [number, number][] = [];
  for (const range of [
    ...ranges,
    [Math.max(0, start), end] as [number, number],
  ].sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1] + 0.05)
      last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}
/** Ignore seek jumps, hidden tabs, buffering and long suspended-clock gaps. */
export function playbackDelta(
  previous: number,
  current: number,
  wallMs: number,
  rate: number,
  active: boolean,
) {
  const delta = current - previous;
  return (
    active &&
    wallMs > 0 &&
    wallMs <= 2000 &&
    delta > 0 &&
    delta <= (wallMs / 1000) * rate + 0.35
  );
}
