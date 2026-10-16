import { emptySnapshot } from "../../src/lib/learning-analytics/model";
export const useCurrentAdmin = () => ({
  data: {
    id: "sample-admin",
    is_super_admin: true,
    permissions: ["game_analytics"],
  },
  isLoading: false,
});
export const useCurrentUser = () => ({ data: null, isLoading: false });
const item = {
  course_id: "e129f667-0510-4f07-9847-edb58356dc74",
  course_title: "Beginner course",
  lesson_number: 1,
  content_id: "sample-video",
  title: "Public Relations for Drivers",
  kind: "video",
  sessions: 2,
  plays: 3,
  completed_sessions: 1,
  coverage: 0.96,
  active_ms: 90000,
  correct: 0,
  wrong: 0,
  timeouts: 0,
  first_correct: 0,
  first_total: 0,
  pauses: 1,
  seeks: 2,
  errors: 0,
  last_seen: "2026-09-11T06:00:00Z",
};
const quiz = {
  ...item,
  content_id: "sample-quiz",
  title: "Lesson 1 quiz",
  kind: "quiz",
  correct: 2,
  wrong: 1,
  timeouts: 1,
  first_correct: 1,
  first_total: 3,
};
const rows = [
  {
    learner_id: "sample-learner",
    name: "Sample Learner",
    phone: "******6756",
    videos_total: 2,
    videos_completed: 1,
    quizzes_total: 1,
    quizzes_completed: 1,
    sessions: 4,
    active_ms: 180000,
    correct: 2,
    wrong: 1,
    timeouts: 1,
    first_correct: 1,
    first_total: 3,
    last_seen: item.last_seen,
    items: [
      item,
      quiz,
      {
        ...item,
        content_id: "unseen",
        title: "3 seconds is all it takes",
        sessions: 0,
        plays: 0,
        completed_sessions: 0,
        coverage: 0,
        last_seen: null,
      },
    ],
  },
];
export const supabase = {
  rpc: async (name: string, args: any) => {
    if (name === "record_learning_session") {
      document.dispatchEvent(
        new CustomEvent("sample-analytics", { detail: args }),
      );
      return { data: null, error: null };
    }
    if (name === "get_learning_analytics")
      return {
        data: {
          rows: args.p_search === "missing" ? [] : rows,
          total_rows: args.p_search === "missing" ? 0 : 1,
          tracking_since: "2026-09-11T00:00:00Z",
        },
        error: null,
      };
    if (name === "get_learning_attempts")
      return {
        data: {
          rows: [
            {
              id: "sample-attempt",
              started_at: item.last_seen,
              updated_at: item.last_seen,
              kind: args.p_content_id === "sample-video" ? "video" : "quiz",
              completed: true,
              coverage: 0.96,
              snapshot: {
                ...emptySnapshot(),
                active_ms: 90000,
                plays: 2,
                pauses: 1,
                seeks: 1,
              },
              correct: 2,
              wrong: 1,
              timeouts: 1,
              responses: [
                {
                  question: "What should you do before moving off?",
                  selected: "Accelerate immediately",
                  correct_answer: "Check mirrors and blind spots",
                  correct: false,
                  elapsed_ms: 3000,
                },
                {
                  question: "What should you do before moving off?",
                  selected: "Check mirrors and blind spots",
                  correct_answer: "Check mirrors and blind spots",
                  correct: true,
                  elapsed_ms: 5000,
                },
              ],
            },
          ],
          total_rows: 1,
        },
        error: null,
      };
    return {
      data: { rows: [], total_rows: 0, tracking_since: "2026-09-11T00:00:00Z" },
      error: null,
    };
  },
};
