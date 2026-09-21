import { useQuery } from "@tanstack/react-query";
import { ChevronDown, RefreshCw } from "lucide-react";
import { Fragment, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { COURSES_DATA } from "@/constants/courses";
import {
  fetchLearningAnalytics,
  fetchLearningAttempts,
  type LearningItem,
} from "@/queries/learningAnalytics";

const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "—";
const duration = (ms: number) =>
  `${Math.floor(ms / 60000)}m ${Math.floor(ms / 1000) % 60}s`;
const percent = (n: number) => `${Math.round(n * 100)}%`;
const ratio = (n: number, total: number) =>
  total ? `${n} / ${total}` : "No assigned content";
const accuracy = (right: number, total: number) =>
  total ? percent(right / total) : "—";
const selectClass = "h-10 rounded-md border bg-white px-3 text-sm";

export default function LearningAnalytics({
  accessKey,
}: {
  accessKey: string;
}) {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [activity, setActivity] = useState("all");
  const [course, setCourse] = useState("");
  const [lesson, setLesson] = useState("");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const report = useQuery({
    queryKey: [
      "learningAnalytics",
      accessKey,
      search,
      activity,
      course,
      lesson,
      page,
    ],
    queryFn: () =>
      fetchLearningAnalytics(search, activity, course, lesson, page),
    retry: false,
  });
  const reset = () => {
    setPage(0);
    setExpanded(null);
  };
  return (
    <section className="space-y-5" aria-label="Video and quiz analytics">
      <div className="rounded-xl border bg-white p-5">
        <h2 className="text-xl font-semibold">Lesson videos & quizzes</h2>
        <p className="mt-2 text-sm text-gray-600">
          Video completion means at least 90% of the timeline played while the
          tab was visible, combined across visits. Seeking past content does not
          count. First-try accuracy includes timeouts; retries remain in the
          answer history.
        </p>
        {report.data && (
          <p className="mt-2 text-xs text-gray-500">
            Tracking since {date(report.data.tracking_since)}. Earlier activity
            is unavailable. Counts cover all recorded activity for the selected
            course and lesson.
          </p>
        )}
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(input.trim());
          reset();
        }}
      >
        <label className="grid gap-1 text-sm">
          Learner name or permitted phone
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search learners"
          />
        </label>
        <Button type="submit">Search</Button>
        <label className="grid gap-1 text-sm">
          Course
          <select
            className={selectClass}
            value={course}
            onChange={(e) => {
              setCourse(e.target.value);
              setLesson("");
              reset();
            }}
          >
            <option value="">All courses</option>
            {Object.values(COURSES_DATA).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Lesson
          <select
            className={selectClass}
            value={lesson}
            onChange={(e) => {
              setLesson(e.target.value);
              reset();
            }}
          >
            <option value="">All lessons</option>
            {Array.from(
              { length: course ? COURSES_DATA[course].hours : 10 },
              (_, i) => (
                <option key={i} value={i + 1}>
                  Lesson {i + 1}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Progress
          <select
            className={selectClass}
            value={activity}
            onChange={(e) => {
              setActivity(e.target.value);
              reset();
            }}
          >
            <option value="all">All learners</option>
            <option value="active">Recorded activity</option>
            <option value="unrecorded">No recorded activity</option>
            <option value="incomplete">Content remaining</option>
            <option value="complete">All content completed</option>
          </select>
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={report.isFetching}
          onClick={() => void report.refetch()}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </form>
      {report.isPending ? (
        <p role="status">Loading learning activity…</p>
      ) : report.isError ? (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">
          Unable to load learning activity. Check access and apply the learning
          analytics migrations, then refresh.
        </p>
      ) : (
        report.data && (
          <>
            <p className="text-sm text-gray-600">
              {report.data.total_rows}{" "}
              {report.data.total_rows === 1
                ? "learner matches"
                : "learners match"}
              . Expand a learner for each video and quiz.
            </p>
            <div className="overflow-x-auto rounded-xl border bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    {[
                      "Learner",
                      "Videos completed",
                      "Quizzes completed",
                      "Correct / wrong / timeout",
                      "First-try accuracy",
                      "Active time",
                      "Last activity",
                    ].map((h) => (
                      <th key={h} scope="col" className="whitespace-nowrap p-3">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.data.rows.map((row) => (
                    <Fragment key={row.learner_id}>
                      <tr className="border-t align-top">
                        <td className="p-3">
                          <button
                            className="flex items-center gap-2 text-left font-medium"
                            aria-expanded={expanded === row.learner_id}
                            onClick={() =>
                              setExpanded(
                                expanded === row.learner_id
                                  ? null
                                  : row.learner_id,
                              )
                            }
                          >
                            <ChevronDown
                              className={`h-4 w-4 ${expanded === row.learner_id ? "rotate-180" : ""}`}
                            />
                            {row.name || "Unnamed learner"}
                          </button>
                          <p className="mt-1 pl-6 text-xs text-gray-500">
                            {row.phone}
                          </p>
                        </td>
                        <td className="p-3">
                          {ratio(row.videos_completed, row.videos_total)}
                        </td>
                        <td className="p-3">
                          {ratio(row.quizzes_completed, row.quizzes_total)}
                        </td>
                        <td className="p-3">
                          {row.correct} / {row.wrong} / {row.timeouts}
                        </td>
                        <td className="p-3">
                          {accuracy(row.first_correct, row.first_total)}
                        </td>
                        <td className="whitespace-nowrap p-3">
                          {duration(row.active_ms)}
                        </td>
                        <td className="p-3">{date(row.last_seen)}</td>
                      </tr>
                      {expanded === row.learner_id && (
                        <tr>
                          <td colSpan={7} className="border-t bg-gray-50 p-4">
                            <div className="space-y-3">
                              <h3 className="font-semibold">
                                Learning activity for {row.name || row.phone}
                              </h3>
                              {row.items.length === 0 ? (
                                <p>
                                  No configured content for this learner’s
                                  enrolled courses.
                                </p>
                              ) : (
                                row.items.map((item) => (
                                  <ContentActivity
                                    key={`${item.course_id}/${item.lesson_number}/${item.content_id}`}
                                    learnerId={row.learner_id}
                                    item={item}
                                    accessKey={accessKey}
                                  />
                                ))
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {report.data.rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-gray-500">
                        No learners match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <nav
              className="flex items-center gap-3"
              aria-label="Learning report pages"
            >
              <Button
                variant="outline"
                disabled={page === 0}
                onClick={() => {
                  setPage(page - 1);
                  setExpanded(null);
                }}
              >
                Previous
              </Button>
              <span className="text-sm">
                Page {page + 1} of{" "}
                {Math.max(1, Math.ceil(report.data.total_rows / 50))}
              </span>
              <Button
                variant="outline"
                disabled={(page + 1) * 50 >= report.data.total_rows}
                onClick={() => {
                  setPage(page + 1);
                  setExpanded(null);
                }}
              >
                Next
              </Button>
            </nav>
          </>
        )
      )}
    </section>
  );
}

function ContentActivity({
  learnerId,
  item,
  accessKey,
}: {
  learnerId: string;
  item: LearningItem;
  accessKey: string;
}) {
  const [open, setOpen] = useState(false);
  const isVideo = item.kind === "video";
  const completed = isVideo
    ? item.coverage >= 0.9
    : item.completed_sessions > 0;
  return (
    <article className="rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-gray-500">
            {item.course_title} · Lesson {item.lesson_number} ·{" "}
            {isVideo ? "Video" : "Quiz"}
          </p>
          <h4 className="mt-1 font-semibold">{item.title}</h4>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-xs ${completed ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}
        >
          {completed
            ? "Completed"
            : item.sessions
              ? "In progress"
              : "No recorded activity"}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {isVideo ? (
          <>
            <span>
              Watched: <strong>{percent(item.coverage)}</strong>
            </span>
            <span>
              Viewing sessions: <strong>{item.sessions}</strong>
            </span>
            <span>
              Play / resume: <strong>{item.plays}</strong>
            </span>
            <span>
              Completed sessions: <strong>{item.completed_sessions}</strong>
            </span>
            <span>Pauses: {item.pauses}</span>
            <span>Seeks: {item.seeks}</span>
            <span>Playback errors: {item.errors}</span>
          </>
        ) : (
          <>
            <span>
              Attempts: <strong>{item.sessions}</strong>
            </span>
            <span>
              Finished: <strong>{item.completed_sessions}</strong>
            </span>
            <span>
              Correct: <strong>{item.correct}</strong>
            </span>
            <span>
              Wrong: <strong>{item.wrong}</strong>
            </span>
            <span>
              Timeouts: <strong>{item.timeouts}</strong>
            </span>
            <span>
              First-try accuracy:{" "}
              <strong>{accuracy(item.first_correct, item.first_total)}</strong>
            </span>
          </>
        )}
        <span>Active time: {duration(item.active_ms)}</span>
        <span>Last activity: {date(item.last_seen)}</span>
      </div>
      {item.sessions > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide" : "View"}{" "}
          {isVideo ? "viewing sessions" : "attempts & answers"}
        </Button>
      )}
      {open && (
        <AttemptHistory
          learnerId={learnerId}
          item={item}
          accessKey={accessKey}
        />
      )}
    </article>
  );
}
function AttemptHistory({
  learnerId,
  item,
  accessKey,
}: {
  learnerId: string;
  item: LearningItem;
  accessKey: string;
}) {
  const [page, setPage] = useState(0);
  const report = useQuery({
    queryKey: [
      "learningAttempts",
      accessKey,
      learnerId,
      item.course_id,
      item.lesson_number,
      item.content_id,
      page,
      item.last_seen,
    ],
    queryFn: () => fetchLearningAttempts(learnerId, item, page),
    retry: false,
  });
  if (report.isPending)
    return (
      <p role="status" className="mt-3">
        Loading attempts…
      </p>
    );
  if (report.isError)
    return (
      <p role="alert" className="mt-3 text-red-700">
        Unable to load attempts.{" "}
        <button className="underline" onClick={() => void report.refetch()}>
          Retry
        </button>
      </p>
    );
  return (
    <div className="mt-4 space-y-3 border-t pt-3">
      {report.data.rows.map((attempt) => (
        <div key={attempt.id} className="rounded-lg bg-gray-50 p-3 text-sm">
          <p className="font-medium">
            {date(attempt.started_at)} ·{" "}
            {attempt.completed ? "Completed" : "Not completed"} ·{" "}
            {duration(attempt.snapshot.active_ms)} active
          </p>
          {attempt.kind === "video" ? (
            <p className="mt-1">
              Watched {percent(attempt.coverage)} · {attempt.snapshot.plays}{" "}
              play / resume · {attempt.snapshot.pauses} pauses ·{" "}
              {attempt.snapshot.seeks} seeks · {attempt.snapshot.errors} errors
            </p>
          ) : (
            <>
              <p className="mt-1">
                {attempt.correct} correct · {attempt.wrong} wrong ·{" "}
                {attempt.timeouts} timeouts
              </p>
              <ol className="mt-3 space-y-2">
                {attempt.responses.map((answer, i) => (
                  <li key={i} className="rounded border bg-white p-3">
                    <p className="font-medium">
                      {i + 1}. {answer.question}
                    </p>
                    <p
                      className={`mt-1 ${answer.correct ? "text-green-700" : "text-red-700"}`}
                    >
                      {answer.selected === null
                        ? "Timed out"
                        : `Answer: ${answer.selected} — ${answer.correct ? "Correct" : "Wrong"}`}
                    </p>
                    {!answer.correct && (
                      <p>Correct answer: {answer.correct_answer}</p>
                    )}
                    <p className="mt-1 text-xs text-gray-500">
                      Question timer elapsed: {duration(answer.elapsed_ms)}
                    </p>
                  </li>
                ))}
              </ol>
              {attempt.responses.length === 0 && (
                <p className="mt-2 text-gray-500">
                  Opened without a recorded answer.
                </p>
              )}
            </>
          )}
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          Previous attempts
        </Button>
        <span className="text-xs">
          Page {page + 1} of{" "}
          {Math.max(1, Math.ceil(report.data.total_rows / 20))}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={(page + 1) * 20 >= report.data.total_rows}
          onClick={() => setPage(page + 1)}
        >
          Next attempts
        </Button>
      </div>
    </div>
  );
}
