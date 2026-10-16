import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import GameAnalytics from "../../src/routes/admin/GameAnalytics";
import QuestionTrivia from "../../src/components/lesson/question-trivia";
import TrackedVideo from "../../src/components/lesson/tracked-video";
import "../../src/index.css";
const client = new QueryClient();
const game = {
  type: "question" as const,
  games: [
    {
      question: "Choose the safe action",
      answers: ["Check mirrors", "Close eyes"],
      correctAnswer: 1,
    },
  ],
};
function Harness() {
  const [event, setEvent] = useState<any>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const listener = (e: Event) => setEvent((e as CustomEvent).detail);
    document.addEventListener("sample-analytics", listener);
    return () => document.removeEventListener("sample-analytics", listener);
  }, []);
  const view = new URLSearchParams(location.search).get("view");
  return (
    <>
      <p className="bg-amber-100 p-2 text-center">
        Local test · synthetic data only
      </p>
      <nav className="flex gap-5 p-3">
        <a href="?view=admin">Admin report</a>
        <a href="?view=quiz">Quiz test</a>
        <a href="?view=video">Video test</a>
      </nav>
      {view === "quiz" ? (
        <>
          <QuestionTrivia
            game={game}
            context={{
              courseId: "sample",
              lessonNumber: 1,
              contentId: "sample-quiz",
            }}
            finishGame={() => setDone(true)}
          />
          {done && <p>Quiz finished</p>}
        </>
      ) : view === "video" ? (
        <TrackedVideo
          src="/assets/parallel-parking.mp4"
          title="Test video"
          context={{
            courseId: "sample",
            lessonNumber: 1,
            contentId: "sample-video",
          }}
        />
      ) : (
        <GameAnalytics />
      )}
      {view !== "admin" && event && (
        <pre aria-label="Recorded snapshot">
          {JSON.stringify(event, null, 2)}
        </pre>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Harness />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
