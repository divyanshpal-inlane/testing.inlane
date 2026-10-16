import { useEffect, useMemo, useRef, useState } from "react";

import type { QuestionGame } from "@/components/lesson/trivia";
import { Button } from "@/components/ui/button";
import { PaintedText } from "@/components/ui/paint-text";
import { useQuizAnalytics } from "@/hooks/useQuizAnalytics";
import type { LearningContext } from "@/lib/learning-analytics/model";
import { prepareLessonQuestions } from "@/utils/prepareLessonQuestions";

export default function QuestionTrivia({
  game,
  context,
  finishGame,
}: {
  game: QuestionGame;
  context: LearningContext;
  finishGame: () => void;
}) {
  const analytics = useQuizAnalytics(context);
  const timedOutIndex = useRef(-1);
  const questions = useMemo(() => prepareLessonQuestions(game.games), [game]);
  const [index, setIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(15);
  const question = questions[index];
  const timedOut = timeLeft === 0 && selectedAnswer === null;
  const answered = selectedAnswer !== null;
  const correct = selectedAnswer === question?.correctAnswer;

  useEffect(() => {
    if (answered || timeLeft === 0 || !question) return;
    const timer = setTimeout(
      () => setTimeLeft((left) => Math.max(0, left - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [answered, timeLeft, question]);

  useEffect(() => {
    if (timedOut && question && timedOutIndex.current !== index) {
      timedOutIndex.current = index;
      analytics.answer(question.question, null, 15000);
    }
  }, [timedOut, index, question]);

  const nextQuestion = () => {
    if (index + 1 === questions.length) {
      analytics.finish();
      finishGame();
      return;
    }
    setIndex((current) => current + 1);
    setSelectedAnswer(null);
    setTimeLeft(15);
  };

  if (!question) {
    return (
      <div className="p-6">
        <p>No questions available for this lesson.</p>
        <Button onClick={finishGame}>Back to lesson</Button>
      </div>
    );
  }

  return (
    <section
      aria-label="Lesson trivia"
      className="mx-auto flex max-h-full w-full max-w-lg flex-col overflow-y-auto rounded-3xl bg-white p-4 text-gray-900 shadow-lg sm:p-6"
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-purple-700">Trivia time</h2>
          <p className="mt-1 text-sm text-gray-500">
            Question {index + 1} of {questions.length}
          </p>
        </div>
        <span
          aria-label={`${timeLeft} seconds remaining`}
          className={`whitespace-nowrap rounded-full px-3 py-1 text-sm font-semibold ${timeLeft <= 5 ? "bg-red-50 text-red-700" : "bg-purple-50 text-purple-700"}`}
        >
          {timeLeft} secs
        </span>
      </header>
      <fieldset disabled={answered || timedOut} className="min-w-0 space-y-3">
        <legend className="mb-4 text-lg font-semibold leading-relaxed">
          {question.question}
        </legend>
        {question.answers.map((answer, optionIndex) => {
          const answerNumber = optionIndex + 1;
          const isSelected = selectedAnswer === answerNumber;
          return (
            <label
              key={answerNumber}
              className={`mb-3 flex w-full items-start gap-3 text-left font-semibold leading-relaxed ${answered || timedOut ? "" : "cursor-pointer"}`}
            >
              <input
                type="radio"
                name={`lesson-question-${index}`}
                value={answerNumber}
                checked={isSelected}
                onChange={() => {
                  if (!answered && !timedOut) {
                    analytics.answer(
                      question.question,
                      answer,
                      (15 - timeLeft) * 1000,
                    );
                    setSelectedAnswer(answerNumber);
                  }
                }}
                className="mt-1 shrink-0 accent-purple-600"
              />
              <PaintedText
                variant={isSelected ? (correct ? "green" : "red") : null}
              >
                {answer}
              </PaintedText>
            </label>
          );
        })}
      </fieldset>
      {(answered || timedOut) && (
        <div
          role="status"
          className={`mt-4 space-y-3 rounded-xl p-4 ${correct ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-950"}`}
        >
          <p className="font-semibold">
            {timedOut
              ? "Time’s up"
              : correct
                ? "You are correct"
                : "Not quite — try again"}
          </p>
          {(timedOut || !correct) && (
            <p className="text-sm">
              <strong>Correct answer:</strong>{" "}
              {question.answers[question.correctAnswer - 1]}
            </p>
          )}
          {question.explanation && (
            <p className="text-sm leading-relaxed">{question.explanation}</p>
          )}
          <Button
            className="w-full"
            onClick={
              answered && !correct
                ? () => setSelectedAnswer(null)
                : nextQuestion
            }
          >
            {answered && !correct
              ? "Try again"
              : index + 1 === questions.length
                ? "Finish quiz"
                : "Next question"}
          </Button>
        </div>
      )}
    </section>
  );
}
