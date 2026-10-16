import type {
  LearningContext,
  LearningSnapshot,
} from "@/lib/learning-analytics/model";
import { supabase } from "@/lib/supabaseClient";
import type { Json } from "@/types/database.types";

export function saveLearningSession(
  context: LearningContext,
  sessionId: string,
  sequence: number,
  snapshot: LearningSnapshot,
) {
  return supabase.rpc("record_learning_session", {
    p_session_id: sessionId,
    p_course_id: context.courseId,
    p_lesson_number: context.lessonNumber,
    p_content_id: context.contentId,
    p_sequence: sequence,
    p_snapshot: snapshot as unknown as Json,
  });
}
export interface LearningItem {
  course_id: string;
  course_title: string;
  lesson_number: number;
  content_id: string;
  title: string;
  kind: "video" | "quiz";
  sessions: number;
  plays: number;
  completed_sessions: number;
  coverage: number;
  active_ms: number;
  correct: number;
  wrong: number;
  timeouts: number;
  first_correct: number;
  first_total: number;
  last_seen: string | null;
  pauses: number;
  seeks: number;
  errors: number;
}
export interface LearningLearner {
  learner_id: string;
  name: string | null;
  phone: string;
  videos_total: number;
  videos_completed: number;
  quizzes_total: number;
  quizzes_completed: number;
  sessions: number;
  active_ms: number;
  correct: number;
  wrong: number;
  timeouts: number;
  first_correct: number;
  first_total: number;
  last_seen: string | null;
  items: LearningItem[];
}
export interface LearningReport {
  rows: LearningLearner[];
  total_rows: number;
  tracking_since: string;
}
export interface LearningAttempt {
  id: string;
  started_at: string;
  updated_at: string;
  kind: "video" | "quiz";
  completed: boolean;
  coverage: number;
  snapshot: LearningSnapshot;
  correct: number;
  wrong: number;
  timeouts: number;
  responses: {
    question: string;
    selected: string | null;
    correct_answer: string;
    correct: boolean;
    elapsed_ms: number;
  }[];
}
export async function fetchLearningAnalytics(
  search: string,
  activity: string,
  course: string,
  lesson: string,
  page: number,
) {
  const { data, error } = await supabase.rpc("get_learning_analytics", {
    p_search: search,
    p_activity: activity,
    p_course_id: course || null,
    p_lesson_number: lesson ? Number(lesson) : null,
    p_page: page,
  });
  if (error) throw error;
  return data as unknown as LearningReport;
}
export async function fetchLearningAttempts(
  learnerId: string,
  item: LearningItem,
  page: number,
) {
  const { data, error } = await supabase.rpc("get_learning_attempts", {
    p_learner_id: learnerId,
    p_course_id: item.course_id,
    p_lesson_number: item.lesson_number,
    p_content_id: item.content_id,
    p_page: page,
  });
  if (error) throw error;
  return data as unknown as { rows: LearningAttempt[]; total_rows: number };
}
