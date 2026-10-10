import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useLearner, useLearnerUpdate } from "@/queries/learner";

export default function OnboardingQuestions() {
  const navigate = useNavigate();
  const { data: learner } = useLearner();
  const { mutate: updateLearner, isPending, error } = useLearnerUpdate();
  const seededRef = useRef(false);

  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [canTakeTwoHourClasses, setCanTakeTwoHourClasses] =
    useState<boolean>(false);

  // New state for selected days (use an array)
  const [selectedTwoHourDays, setSelectedTwoHourDays] = useState<string[]>([]);

  // Array of all days for mapping
  const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  useEffect(() => {
    if (!learner || seededRef.current) return;
    seededRef.current = true;
    if (learner.preferred_start_date) {
      setStartDate(new Date(`${learner.preferred_start_date}T00:00:00`));
    }
    setCanTakeTwoHourClasses(learner.prefers_two_hour_classes ?? false);
    setSelectedTwoHourDays(learner.two_hour_days?.split(", ") ?? []);
  }, [learner]);

  const handleSubmit = () => {
    if (isPending || !startDate) return;
    updateLearner(
      {
        preferred_start_date: startDate
          ? format(startDate, "yyyy-MM-dd")
          : null,
        prefers_two_hour_classes: canTakeTwoHourClasses,
        two_hour_days: canTakeTwoHourClasses
          ? selectedTwoHourDays.join(", ") // Convert the array of days (e.g., ["Mon", "Wed"]) to a string ("Mon, Wed")
          : null,
      },
      {
        onSuccess: () => {
          navigate("/createSchedule/uploadLL");
        },
      },
    );
  };

  const handleDayToggle = (day: string) => {
    setSelectedTwoHourDays(
      (prevDays) =>
        prevDays.includes(day)
          ? prevDays.filter((d) => d !== day) // Remove day if already selected
          : [...prevDays, day], // Add day if not selected
    );
  };

  return (
    <div className="flex h-full w-full flex-col rounded-md">
      <div className="flex flex-col rounded-b-[40px] bg-primary">
        <div className="flex items-center justify-between p-4">
          <Button
            variant="ghost"
            size="icon"
            className="text-primary-foreground"
          >
            <Link to="/createSchedule/details">
              <ArrowLeft className="h-6 w-6" />
            </Link>
          </Button>
          <span className="text-lg font-semibold text-primary-foreground">
            2/4
          </span>
        </div>
        <div className="relative z-10 rounded-b-[40px] bg-primary p-6 text-primary-foreground">
          <h1 className="mb-1 text-xl font-semibold">
            Let's customize your learning experience
          </h1>
          <p className="">
            Answer a few questions to help us plan your lessons
          </p>
        </div>
      </div>

      <div className="scrollbar-hide flex-1 overflow-y-auto bg-white p-6">
        <div className="mt-4 w-full space-y-8">
          {/* Question 1: Start Date */}
          <div className="space-y-2">
            <h3 className="text-lg font-medium">
              When do you want to start your lessons?
            </h3>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !startDate && "text-muted-foreground",
                  )}
                >
                  {startDate ? format(startDate, "PPP") : "Select a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={startDate}
                  onSelect={setStartDate}
                  initialFocus
                  disabled={(date) => date < new Date()}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Question 2: Two-hour Classes Checkbox */}
          <div className="space-y-2">
            <h3 className="text-lg font-medium">
              Can you take classes for more than 2 hours any day?
            </h3>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="can-take-two-hour"
                checked={canTakeTwoHourClasses}
                onChange={() =>
                  setCanTakeTwoHourClasses(!canTakeTwoHourClasses)
                }
              />
              <Label htmlFor="can-take-two-hour">Yes</Label>
            </div>

            {canTakeTwoHourClasses && (
              <div>
                <Label htmlFor="two-hour-days" className="mt-16">
                  Which day(s) can you take classes for more than 2 hours?
                </Label>
                <div
                  id="two-hour-days"
                  className="mt-2 flex justify-between space-x-2"
                >
                  {DAYS_OF_WEEK.map((day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => handleDayToggle(day)}
                      className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                        selectedTwoHourDays.includes(day)
                          ? "bg-blue-600 text-white shadow-md hover:bg-blue-700"
                          : "bg-gray-100 text-gray-800 hover:bg-gray-200"
                      } `}
                    >
                      {day}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  Selected:{" "}
                  {selectedTwoHourDays.length > 0
                    ? selectedTwoHourDays.join(", ")
                    : "None"}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 border-t bg-white p-4">
        {error && (
          <p role="alert" className="mb-3 text-sm text-red-600">
            Unable to save your lesson details. Please try again.
          </p>
        )}
        <Button
          className="w-full"
          onClick={handleSubmit}
          disabled={isPending || !startDate}
        >
          {isPending ? "Saving..." : "Continue"}
        </Button>
      </div>
    </div>
  );
}
