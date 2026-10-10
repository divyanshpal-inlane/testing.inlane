import { getYear } from "date-fns";
import React, { useCallback, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUser } from "@/context/auth-context";
import { useLearner, useLearnerUpdate } from "@/queries/learner";

const days = Array.from({ length: 31 }, (_, i) => i + 1);

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Most recent year first so birthdays are quicker to reach.
const years = Array.from({ length: 61 }, (_, i) => getYear(new Date()) - i);

export default function Birthday() {
  const [day, setDay] = useState<string>("");
  const [month, setMonth] = useState<string>("");
  const [year, setYear] = useState<string>("");
  const [error, setError] = useState<string>("");
  const { mutate, isPending } = useLearnerUpdate();
  const navigate = useNavigate();
  const { phone } = useUser();
  const { data: learner, isLoading: learnerLoading, refetch } = useLearner();

  // Refetch learner data on mount to ensure we have the latest DOB status
  // This prevents the issue where cached data shows no DOB but DB has it
  React.useEffect(() => {
    console.log("[BIRTHDAY] Refetching learner data to ensure fresh DOB status");
    refetch();
  }, [refetch]);

  // Guard: If learner already has DOB, redirect to next step
  // This uses the same cached data that /home uses for navigation
  if (!learnerLoading && learner?.dob) {
    console.log("[BIRTHDAY] Learner already has DOB, redirecting to aadhar");
    return <Navigate to="/onboard/aadhar" replace />;
  }

  const handleContinueClick = useCallback(async () => {
    setError("");

    if (!day || !month || !year) {
      setError("Please select your full date of birth");
      return;
    }

    const dayNum = parseInt(day);
    const monthIndex = months.indexOf(month);
    const yearNum = parseInt(year);

    // Guard against impossible dates (e.g. 31 Feb).
    const candidate = new Date(yearNum, monthIndex, dayNum);
    if (
      candidate.getFullYear() !== yearNum ||
      candidate.getMonth() !== monthIndex ||
      candidate.getDate() !== dayNum
    ) {
      setError("That date doesn't exist. Please check the day and month.");
      return;
    }

    // ── VERIFY PHONE EXISTS ──────────────────────────────────────────────
    if (!phone) {
      setError("Phone number not found. Please log in again.");
      return;
    }

    console.log("[BIRTHDAY] Proceeding with DOB update for phone:", phone);

    try {
      const dob = `${yearNum}-${String(monthIndex + 1).padStart(2, "0")}-${String(
        dayNum,
      ).padStart(2, "0")}`;

      console.log("[BIRTHDAY] Updating learner DOB with phone:", {
        phone,
        dob,
      });

      // Update the existing learner record created during signup
      mutate(
        { dob },
        {
          onSuccess: () => {
            console.log("[BIRTHDAY] ✅ DOB updated successfully");
            navigate("/onboard/aadhar");
          },
          onError: (error) => {
            console.error("[BIRTHDAY] ❌ Failed to update DOB:", error);
            setError("Failed to save your date of birth. Please try again.");
          },
        },
      );
    } catch (err: any) {
      console.error("[BIRTHDAY] ❌ Error during DOB update:", err);
      setError(
        err.message ||
          "An error occurred while updating your information. Please try again.",
      );
    }
  }, [day, month, year, mutate, navigate, phone]);

  return (
    <div className="flex h-full w-full flex-col rounded-md">
      <div className="flex flex-col rounded-b-[20px] bg-primary">
        <div className="flex items-center justify-end p-4">
          <span className="text-lg font-semibold text-primary-foreground">
            1/3
          </span>
        </div>
        <div className="relative z-10 rounded-b-[40px] bg-primary p-6 text-primary-foreground">
          <h1 className="mb-2 text-2xl font-semibold">
            When&apos;s your birthday?
          </h1>
          <p>We use this to check your eligibility to drive</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-white p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <div className="mt-4 flex items-start gap-3">
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-sm text-muted-foreground">Day</span>
            <Select value={day} onValueChange={setDay}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="DD" />
              </SelectTrigger>
              <SelectContent>
                {days.map((d) => (
                  <SelectItem key={d} value={d.toString()}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-[1.4] flex-col gap-1">
            <span className="text-sm text-muted-foreground">Month</span>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="MM" />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-sm text-muted-foreground">Year</span>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="YYYY" />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={y.toString()}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 border-t bg-white p-4">
        <Button
          onClick={handleContinueClick}
          className="w-full"
          disabled={isPending}
        >
          {isPending ? "Saving..." : "Continue"}
        </Button>
      </div>
    </div>
  );
}
