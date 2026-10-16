import { describe } from "node:test";

import { useQuery } from "@tanstack/react-query";
import { ControlPosition } from "@vis.gl/react-google-maps";
import {
  addDays,
  addMinutes,
  endOfWeek,
  format,
  isSameDay,
  set,
  startOfWeek,
  subDays,
} from "date-fns";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  MapPin,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  LearnerInfo,
  LearnerInfoDialog,
} from "@/components/admin/LearnerInfoCard";
import MapWithRoute from "@/components/mapWithRoute";
import InstructorSelectionDialog from "@/components/scheduling/InstructorSelectionDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { demoLessonOffsetFor } from "@/constants/courses";
import { fetchInstructorDynamicLocation } from "@/hooks/useInstructorLocations";
import { useTentativeScheduleData } from "@/hooks/useScheduleData";
import { sendMultiEventCalendarInvite } from "@/lib/calendarUtils";
import { supabase } from "@/lib/supabaseClient";
import { generateRandomOTP } from "@/lib/utils";
import { useCompletedDemoCount } from "@/queries/payment";
import { SchedulingRequests, usePreferences } from "@/queries/preferences";
import { Schedule } from "@/routes/admin/schedules";
import { SlotConfig, TIME_SLOTS, TimeSlot } from "@/types/schedule";
import { googleMapsLoader } from "@/utils/googleMaps";

import { TentativeScheduleDialog } from "../admin/TentativeScheduleCard";
import LearnerScheduleSelector from "./schedule";

interface TimeSlotState {
  isAvailable: boolean;
  isSelected: boolean;
  isPreferred: boolean;
  isCurrentSchedule: boolean;
  isLearnerSchedule: boolean;
  existingSchedule?: {
    slot_start_time: string;
    learner_name: string | null;
    learner_area: string | null;
    pickup_address: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  availableInstructors: string[];
  isCurrentInstrUnavailable: boolean | false;
}
interface HourlySlot {
  timestamp: Date;
  timeSlot: TimeSlot | null;
  state: TimeSlotState;
}

type DaySchedule = HourlySlot[];

interface TimeSlotSelectionDialogProps {
  open: boolean;
  onClose: () => void;
  slot: HourlySlot | null;
  date: Date | null;
  instructors: any[] | null;
  onConfirm: (instructorId: string, duration: number) => void;
}
// Add interface for instructor with distance information
interface InstructorWithDistance {
  id_instructor: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  radius: number | null;
  areas: string[];
  distance: number | null;
  isWithinRadius: boolean;
}

// Function to calculate distance between two points using Haversine formula (as the crow flies)
function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

// Function to fetch driving distance using Google Maps Distance Matrix API
export async function getDrivingDistanceViaSDK(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): Promise<number | null> {
  try {
    await googleMapsLoader.load();
    // console.log("SDK", originLat, originLng, destLat, destLng);
    const origin = new google.maps.LatLng(originLat, originLng);
    const destination = new google.maps.LatLng(destLat, destLng);

    const service = new google.maps.DistanceMatrixService();

    return new Promise((resolve) => {
      service.getDistanceMatrix(
        {
          origins: [origin],
          destinations: [destination],
          travelMode: google.maps.TravelMode.DRIVING,
        },
        (response, status) => {
          if (
            status === "OK" &&
            response?.rows?.[0]?.elements?.[0]?.status === "OK"
          ) {
            const meters = response.rows[0].elements[0].distance.value;
            resolve(meters / 1000); // return distance in km
          } else {
            console.error("DistanceMatrix failed:", status, response);
            resolve(null);
          }
        },
      );
    });
  } catch (err) {
    console.error("Error loading Maps SDK or calculating distance:", err);
    return null;
  }
}

interface CreateScheduleProps {
  learnerId: string;
  learnerArea: string;
  request: SchedulingRequests[number];
  onScheduleCreate: (
    schedules: Schedule[],
    courseId: string | null,
  ) => void | Promise<void>;
  learnerDetails?: {
    address_lat: number;
    address_lng: number;
    has_a_DL?: boolean | null;
  } | null;
}

// Check if learner has marked a time slot as unavailable
// Defined outside components so it can be used by both CreateScheduleWithInstructor and CreateSchedule
function isLearnerTimeSlotUnavailable(
  learnerUnavailability: any,
  day: Date,
  hour: number,
  minute: number,
): boolean {
  if (!learnerUnavailability) return false;

  // Make sure unavailability is an array
  const unavailability = Array.isArray(learnerUnavailability)
    ? learnerUnavailability
    : typeof learnerUnavailability === "string"
      ? JSON.parse(learnerUnavailability)
      : [];

  if (unavailability.length === 0) return false;

  const currentTime = new Date(day);
  currentTime.setHours(hour, minute);
  const dayOfWeek = format(day, "EEEE").toLowerCase();
  const formattedDate = format(day, "yyyy-MM-dd");

  return unavailability.some((u: any) => {
    // Case 1: Single day, all day
    if (u.booked_date && u.all_day) {
      return formattedDate === u.booked_date;
    }

    // Case 2: Single day, specific time slot
    if (
      u.booked_date &&
      u.booked_start_time &&
      u.booked_end_time &&
      !u.all_day
    ) {
      const unavailableStart = new Date(
        `${u.booked_date}T${u.booked_start_time}`,
      );
      const unavailableEnd = new Date(`${u.booked_date}T${u.booked_end_time}`);
      return (
        formattedDate === u.booked_date &&
        currentTime >= unavailableStart &&
        currentTime < unavailableEnd
      );
    }

    // Case 3a: Weekly recurring on specific day of week (all day)
    if (u.day_of_week && u.all_day) {
      return u.day_of_week === dayOfWeek;
    }

    // Case 3b: Weekly recurring on specific day of week (specific time)
    if (
      u.day_of_week &&
      u.booked_start_time &&
      u.booked_end_time &&
      !u.all_day
    ) {
      if (u.day_of_week === dayOfWeek) {
        const [startHour, startMinute] = u.booked_start_time
          .split(":")
          .map(Number);
        const [endHour, endMinute] = u.booked_end_time.split(":").map(Number);

        const unavailableStart = new Date(day);
        unavailableStart.setHours(startHour, startMinute);

        const unavailableEnd = new Date(day);
        unavailableEnd.setHours(endHour, endMinute);

        return currentTime >= unavailableStart && currentTime < unavailableEnd;
      }
    }

    // Case 4a: Date range (all day)
    if (u.start_date && u.end_date && u.range_all_day) {
      const rangeStart = new Date(u.start_date);
      const rangeEnd = new Date(u.end_date);
      rangeEnd.setHours(23, 59, 59);
      return currentTime >= rangeStart && currentTime <= rangeEnd;
    }

    // Case 4b: Date range (specific time)
    if (
      u.start_date &&
      u.end_date &&
      !u.range_all_day &&
      u.range_start_time &&
      u.range_end_time
    ) {
      const rangeStart = new Date(u.start_date);
      const rangeEnd = new Date(u.end_date);
      rangeEnd.setHours(23, 59, 59);

      if (currentTime >= rangeStart && currentTime <= rangeEnd) {
        const [startHour, startMinute] = u.range_start_time
          .split(":")
          .map(Number);
        const [endHour, endMinute] = u.range_end_time.split(":").map(Number);

        const todayStart = new Date(day);
        todayStart.setHours(startHour, startMinute);

        const todayEnd = new Date(day);
        todayEnd.setHours(endHour, endMinute);

        return currentTime >= todayStart && currentTime < todayEnd;
      }
    }

    return false;
  });
}

export default function CreateScheduleWithInstructor({
  learnerId,
  learnerArea,
  request,
  onScheduleCreate,
}: CreateScheduleProps) {
  const [selectedInstructorId, setSelectedInstructorId] = useState<
    string | null
  >(null);
  // Use state to track custom date range instead of week start
  const [currentRangeStart, setCurrentRangeStart] = useState(new Date());
  const [instructorsWithDistance, setInstructorsWithDistance] = useState<
    InstructorWithDistance[]
  >([]);
  const [isLoadingDistances, setIsLoadingDistances] = useState(false);
  const [selectedLearner, setSelectedLearner] = useState<LearnerInfo | null>(
    null,
  );
  const [showLearnerDialog, setShowLearnerDialog] = useState(false);
  const [selectedTentativeSchedule, setSelectedTentativeSchedule] =
    useState<LearnerInfo | null>(null);
  const [showTentativeScheduleDialog, setShowTentativeScheduleDialog] =
    useState(false);
  const { toast } = useToast();

  // Calender settings
  // Note: these should match the TIME_SLOTS
  // console.log("numSlotsPerDay, numMinutesPerSlot, numHoursPerDay", SlotConfig.numSlotsPerDay, SlotConfig.numMinutesPerSlot, SlotConfig.numHoursPerDay);
  // Fetch learner details to get pickup location coordinates
  const {
    data: learnerDetails,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["learnerDetails", learnerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Learner")
        .select("*")
        .eq("id", learnerId)
        .single();

      if (error) {
        console.error("Error fetching learner details", err);
        throw error;
      }
      return data;
    },
  });

  // Fetch instructors for the learner's area.
  // Inactive instructors (enabled === false) are hidden from new assignments.
  const { data: instructors } = useQuery({
    queryKey: ["instructors", learnerArea],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Instructor")
        .select("*")
        .or("enabled.is.null,enabled.eq.true");

      if (error) throw error;
      return data;
    },
  });

  // Fetch testative schedules for the learner's area
  const { data: tentativeSchedules } = useQuery({
    queryKey: ["tentative_schedules", selectedInstructorId, learnerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Schedule")
        .select("*")
        .eq("isTentative", true)
        .eq("learner_id", learnerId)
        .eq("instructor_id", selectedInstructorId)
        .order("created_at", { ascending: false });
      // Note that there can be multiple tentative schedules for different slots

      if (error) {
        if (error.code === "PGRST116") {
          // ignore null output of query
          return null;
        }
        throw error;
      }
      return data;
    },
    enabled: !!selectedInstructorId, // The query will run only when selectedInstructorId is not-null
  });

  // Calculate distances between learner and instructors
  useEffect(() => {
    const calculateDistances = async () => {
      if (!instructors || !learnerDetails) {
        return;
      }
      // Demo / new learners often have no pickup coords yet — instead of
      // bailing out (which leaves the instructor dropdown empty), populate
      // the list without distance info so the dialog still works.
      if (!learnerDetails.address_lat || !learnerDetails.address_lng) {
        const fallback: InstructorWithDistance[] = instructors.map(
          (instructor) => ({
            ...instructor,
            distance: null,
            isWithinRadius: false,
          }),
        );
        const safeArea = (learnerArea || "").toLowerCase();
        fallback.sort((a, b) => {
          const aMatchesArea = a.areas?.some(
            (area: string) => area.toLowerCase() === safeArea,
          );
          const bMatchesArea = b.areas?.some(
            (area: string) => area.toLowerCase() === safeArea,
          );
          if (aMatchesArea && !bMatchesArea) return -1;
          if (!aMatchesArea && bMatchesArea) return 1;
          return (a.name || "").localeCompare(b.name || "");
        });
        setInstructorsWithDistance(fallback);
        setIsLoadingDistances(false);
        return;
      }

      setIsLoadingDistances(true);

      const learnerLat = learnerDetails.address_lat;
      const learnerLng = learnerDetails.address_lng;

      const instructorsWithDistanceData: InstructorWithDistance[] = [];

      // Process instructors in batches to avoid rate limiting
      for (const instructor of instructors) {
        if (instructor.latitude && instructor.longitude) {
          // First calculate straight-line distance as a quick filter
          const straightLineDistance = calculateHaversineDistance(
            learnerLat,
            learnerLng,
            instructor.latitude,
            instructor.longitude,
          );

          // Only fetch driving distance if straight-line distance is within a reasonable range
          // (e.g., 1.5x the instructor's radius) to save API calls
          let drivingDistance: number | null = null;
          const maxRetryDistanceAPICallCount = 10;
          let retryDistanceAPICallCount = 0;

          // console.log("lat, lng, instructor", learnerLat, learnerLng, instructor.latitude, instructor.longitude, instructor);
          while (
            !(drivingDistance === null) &&
            retryDistanceAPICallCount < maxRetryDistanceAPICallCount
          ) {
            try {
              // console.log("Call distance API retry: ", retryDistanceAPICallCount)
              drivingDistance = await getDrivingDistanceViaSDK(
                learnerLat,
                learnerLng,
                instructor.latitude,
                instructor.longitude,
              );
            } catch (error) {
              console.error("Error fetching driving distance:", error);
              // Fall back to straight-line distance if API fails
              // Update: Remove setting straight line distance as it causes faulty
              // results when slider set to small value
              // drivingDistance = straightLineDistance;
            } finally {
              retryDistanceAPICallCount++;
            }
          }

          if (
            !(drivingDistance === null) &&
            retryDistanceAPICallCount >= maxRetryDistanceAPICallCount
          ) {
            console.error(
              "Distance API failed after " +
                maxRetryDistanceAPICallCount +
                " retries",
            );

            // set to straight line distance to avoid UI failure
            drivingDistance = straightLineDistance;
            // TODO: handle the error
            // throw new Error("Cannot calculate driving distance.");
          }

          instructorsWithDistanceData.push({
            ...instructor,
            distance: drivingDistance || straightLineDistance,
            isWithinRadius:
              (drivingDistance || straightLineDistance) <=
              (instructor.radius || 0),
          });
        } else {
          // If instructor doesn't have coordinates, add with null distance
          instructorsWithDistanceData.push({
            ...instructor,
            distance: null,
            isWithinRadius: false,
          });
        }
      }

      // Sort instructors:
      //   1. within radius first (and if both within radius, nearest first)
      //   2. then matches learner's area
      //   3. then alphabetical by name
      const sortedInstructors = instructorsWithDistanceData.sort((a, b) => {
        if (a.isWithinRadius && !b.isWithinRadius) return -1;
        if (!a.isWithinRadius && b.isWithinRadius) return 1;

        if (a.isWithinRadius && b.isWithinRadius) {
          if (a.distance != null && b.distance != null) {
            return a.distance - b.distance;
          }
          if (a.distance == null) return 1;
          if (b.distance == null) return -1;
        }

        const aMatchesArea = a.areas.some(
          (area) => area.toLowerCase() === learnerArea.toLowerCase(),
        );
        const bMatchesArea = b.areas.some(
          (area) => area.toLowerCase() === learnerArea.toLowerCase(),
        );
        if (aMatchesArea && !bMatchesArea) return -1;
        if (!aMatchesArea && bMatchesArea) return 1;

        return (a.name || "").localeCompare(b.name || "");
      });

      setInstructorsWithDistance(sortedInstructors);
      setIsLoadingDistances(false);
    };

    calculateDistances();
  }, [instructors, learnerDetails, learnerArea]);

  // Fetch the selected instructor's schedule
  const { data: instructorSchedule } = useQuery({
    queryKey: ["instructorSchedule", selectedInstructorId, currentRangeStart],
    queryFn: async () => {
      if (!selectedInstructorId) return [];
      const start = format(currentRangeStart, "yyyy-MM-dd");
      // Calculate end date (start date + 6 days)
      const end = format(addDays(currentRangeStart, 6), "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("Schedule")
        .select("*, learner:learner_id(name, area)")
        .eq("instructor_id", selectedInstructorId)
        .gte("date", start)
        .lte("date", end)
        .neq("status", "paused");

      if (error) throw error;
      return data;
    },
    enabled: !!selectedInstructorId,
  });
  // Add these helper functions before your component

  // Function to get day name from index
  const getDayName = (dayIndex: number): string => {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    return days[dayIndex];
  };

  // Function to get day index from name
  const getDayIndex = (dayName: string): number => {
    const days = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    return days.indexOf(dayName.toLowerCase());
  };

  // Function to format time in 12-hour format
  const formatTime = (timeString: string): string => {
    const [hourStr, minuteStr] = timeString.split(":");
    const hour = parseInt(hourStr);
    const minute = parseInt(minuteStr);

    const period = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 === 0 ? 12 : hour % 12;
    return `${displayHour}:${minute.toString().padStart(2, "0")} ${period}`;
  };

  // Function to parse time string to minutes since midnight
  const timeToMinutes = (timeString: string): number => {
    const [hours, minutes] = timeString.split(":").map(Number);
    return hours * 60 + minutes;
  };

  // Function to convert minutes since midnight to time string
  const minutesToTime = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
  };

  // Function to calculate working hours for an instructor
  // Function to calculate working hours for an instructor
  const calculateWorkingHours = (
    unavailability: Unavailability[] | null | undefined,
  ) => {
    // Default working hours: 6 AM to 9 PM for all days
    const defaultWorkingHours = Array(7)
      .fill(null)
      .map(() => {
        return {
          // Each day has one continuous working period by default
          periods: [{ start: "06:00", end: "21:00" }],
        };
      });

    if (
      !unavailability ||
      !Array.isArray(unavailability) ||
      unavailability.length === 0
    ) {
      return defaultWorkingHours;
    }

    // Deep copy the default working hours
    const workingHours = JSON.parse(JSON.stringify(defaultWorkingHours));

    // Process each unavailability entry
    unavailability.forEach((entry) => {
      // Handle recurring weekly unavailability (all day)
      if (entry.day_of_week && entry.all_day) {
        const dayIndex = getDayIndex(entry.day_of_week);

        if (dayIndex !== -1) {
          // If all day, remove all periods for that day
          workingHours[dayIndex].periods = [];
        }
      }
      // Handle recurring weekly unavailability (specific time)
      else if (entry.day_of_week && !entry.all_day) {
        const dayIndex = getDayIndex(entry.day_of_week);

        if (
          dayIndex !== -1 &&
          entry.booked_start_time &&
          entry.booked_end_time
        ) {
          // Remove the unavailable time from the working hours
          workingHours[dayIndex].periods = subtractTimeRange(
            workingHours[dayIndex].periods,
            entry.booked_start_time,
            entry.booked_end_time,
          );
        }
      }

      // Handle specific date unavailability
      else if (entry.booked_date) {
        // For full day unavailability
        if (entry.all_day) {
          // We'll mark this in a separate structure for specific dates
          const date = new Date(entry.booked_date);
          const dayIndex = date.getDay();

          // For the UI, we'll just note that there are exceptions to the regular schedule
          workingHours[dayIndex].hasExceptions = true;
        }
        // For specific time range on a specific date
        else if (entry.booked_start_time && entry.booked_end_time) {
          const date = new Date(entry.booked_date);
          const dayIndex = date.getDay();

          // For the UI, we'll just note that there are exceptions to the regular schedule
          workingHours[dayIndex].hasExceptions = true;
        }
      }

      // Handle date range unavailability (all day)
      else if (entry.start_date && entry.end_date && entry.range_all_day) {
        // For the UI, we'll just note that there are exceptions to the regular schedule
        for (let i = 0; i < 7; i++) {
          workingHours[i].hasExceptions = true;
        }
      }

      // Handle date range unavailability (specific time)
      else if (
        entry.start_date &&
        entry.end_date &&
        !entry.range_all_day &&
        entry.range_start_time &&
        entry.range_end_time
      ) {
        // For the UI, we'll just note that there are exceptions to the regular schedule
        for (let i = 0; i < 7; i++) {
          workingHours[i].hasExceptions = true;
        }
      }

      // Handle old format date range unavailability
      else if (entry.start_date && entry.end_date) {
        // For the UI, we'll just note that there are exceptions to the regular schedule
        for (let i = 0; i < 7; i++) {
          workingHours[i].hasExceptions = true;
        }
      }
    });

    return workingHours;
  };

  // Function to subtract a time range from a list of time periods
  const subtractTimeRange = (
    periods: { start: string; end: string }[],
    startTime: string,
    endTime: string,
  ) => {
    const unavailableStart = timeToMinutes(startTime);
    const unavailableEnd = timeToMinutes(endTime);

    // If invalid time range, return original periods
    if (unavailableStart >= unavailableEnd) {
      return periods;
    }

    const result: { start: string; end: string }[] = [];

    periods.forEach((period) => {
      const periodStart = timeToMinutes(period.start);
      const periodEnd = timeToMinutes(period.end);

      // If period is completely before or after unavailable time, keep it as is
      if (periodEnd <= unavailableStart || periodStart >= unavailableEnd) {
        result.push(period);
        return;
      }

      // If unavailable time completely covers the period, skip it
      if (unavailableStart <= periodStart && unavailableEnd >= periodEnd) {
        return;
      }

      // If unavailable time is in the middle of the period, split into two periods
      if (unavailableStart > periodStart && unavailableEnd < periodEnd) {
        result.push({
          start: period.start,
          end: minutesToTime(unavailableStart),
        });
        result.push({
          start: minutesToTime(unavailableEnd),
          end: period.end,
        });
        return;
      }

      // If unavailable time overlaps with the start of the period
      if (unavailableStart <= periodStart && unavailableEnd < periodEnd) {
        result.push({
          start: minutesToTime(unavailableEnd),
          end: period.end,
        });
        return;
      }

      // If unavailable time overlaps with the end of the period
      if (unavailableStart > periodStart && unavailableEnd >= periodEnd) {
        result.push({
          start: period.start,
          end: minutesToTime(unavailableStart),
        });
        return;
      }
    });

    return result;
  };

  // Function to format working hours for display
  const formatWorkingHours = (workingHours: any[]) => {
    return workingHours.map((dayHours, index) => {
      const dayName = getDayName(index);

      if (dayHours.periods.length === 0) {
        return { day: dayName, hours: "Not available" };
      }

      // Sort periods by start time
      const sortedPeriods = [...dayHours.periods].sort(
        (a, b) => timeToMinutes(a.start) - timeToMinutes(b.start),
      );

      // Format each period
      const timeRanges = sortedPeriods
        .map(
          (period) => `${formatTime(period.start)} - ${formatTime(period.end)}`,
        )
        .join(", ");

      let displayHours = timeRanges;

      // Add note about exceptions if needed
      if (dayHours.hasExceptions) {
        displayHours += "";
      }

      return { day: dayName, hours: displayHours };
    });
  };

  const handleOccupiedSlotClick = async (schedule: any) => {
    if (!schedule || !schedule.learner_id) return;

    try {
      // Fetch the learner details
      const { data: learnerData, error } = await supabase
        .from("Learner")
        .select("*")
        .eq("id", schedule.learner_id)
        .single();

      if (error) throw error;

      // Format the learner data to match LearnerInfo interface
      const learnerInfo: LearnerInfo = {
        id: learnerData.id,
        name: learnerData.name,
        phone: learnerData.phone,
        email: learnerData.email || "",
        area: learnerData.area,
        pincode: learnerData.pincode,
        signed_up: learnerData.signed_up,
        created_at: learnerData.created_at,
        address_lat: learnerData.address_lat,
        address_lng: learnerData.address_lng,
        preferred_start_date: learnerData.preferred_start_date,
        preferred_completion_days: learnerData.preferred_completion_days,
        prefers_two_hour_classes: learnerData.prefers_two_hour_classes,
        preferred_two_hour_days: learnerData.two_hour_days,
        pick_up_location: learnerData.pick_up_location,
        DL_test_date: learnerData.DL_test_date,
      };

      console.log("T5 Learner passed", learnerInfo);
      setSelectedLearner(learnerInfo);
      setShowLearnerDialog(true);
    } catch (error) {
      console.error("Error fetching learner details:", error);
    }
  };

  // Case-insensitive matching for instructor locations
  const [matchingInstructors, otherInstructors] = useMemo(() => {
    if (!instructors) return [[], []];

    return instructors.reduce(
      ([matching, others], instructor) => {
        if (
          instructor.areas.some(
            (area: string) => area.toLowerCase() === learnerArea.toLowerCase(), // Case-insensitive comparison
          )
        ) {
          matching.push(instructor);
        } else {
          others.push(instructor);
        }
        return [matching, others];
      },
      [[], []],
    );
  }, [instructors, learnerArea]);

  // Modified to advance or go back by exactly 7 days (not tied to week concept)
  const handleDateRangeChange = (direction: "prev" | "next") => {
    setCurrentRangeStart((prev) =>
      direction === "next" ? addDays(prev, 7) : addDays(prev, -7),
    );
  };
  // Add this helper function before your return statement
  const isTimeSlotUnavailable = (
    instructorId,
    instructorsWithDistanceData,
    day,
    hour,
    minute,
  ) => {
    if (!instructorId || !instructorsWithDistanceData) return false;

    // Find the selected instructor
    const selectedInstructor = instructorsWithDistanceData.find(
      (instructor) => instructor.id_instructor === selectedInstructorId,
    );

    // If no instructor is selected or unavailability isn't defined, return false
    if (!selectedInstructor || !selectedInstructor.unavailability) return false;

    const unavailabilityData = selectedInstructor.unavailability;

    // Make sure unavailability is an array (it should be if stored as jsonb)
    const unavailability = Array.isArray(unavailabilityData)
      ? unavailabilityData
      : JSON.parse(unavailabilityData);

    const currentTime = new Date(day);
    currentTime.setHours(hour, minute);
    const dayOfWeek = format(day, "EEEE").toLowerCase();
    const formattedDate = format(day, "yyyy-MM-dd");

    return unavailability.some((u) => {
      // Case 1: Single day, all day
      if (u.booked_date && u.all_day) {
        return formattedDate === u.booked_date;
      }

      // Case 2: Single day, specific time slot
      if (
        u.booked_date &&
        u.booked_start_time &&
        u.booked_end_time &&
        !u.all_day
      ) {
        const unavailableStart = new Date(
          `${u.booked_date}T${u.booked_start_time}`,
        );
        const unavailableEnd = new Date(
          `${u.booked_date}T${u.booked_end_time}`,
        );
        return (
          formattedDate === u.booked_date &&
          currentTime >= unavailableStart &&
          currentTime < unavailableEnd
        );
      }

      // Case 3a: Weekly recurring on specific day of week (all day)
      if (u.day_of_week && u.all_day) {
        return u.day_of_week === dayOfWeek;
      }

      // Case 3b: Weekly recurring on specific day of week (specific time)
      if (
        u.day_of_week &&
        u.booked_start_time &&
        u.booked_end_time &&
        !u.all_day
      ) {
        if (u.day_of_week === dayOfWeek) {
          const [startHour, startMinute] = u.booked_start_time
            .split(":")
            .map(Number);
          const [endHour, endMinute] = u.booked_end_time.split(":").map(Number);

          const unavailableStart = new Date(day);
          unavailableStart.setHours(startHour, startMinute);

          const unavailableEnd = new Date(day);
          unavailableEnd.setHours(endHour, endMinute);

          return (
            currentTime >= unavailableStart && currentTime < unavailableEnd
          );
        }
      }

      // Case 4a: Date range (all day)
      if (u.start_date && u.end_date && u.range_all_day) {
        const rangeStart = new Date(u.start_date);
        const rangeEnd = new Date(u.end_date);
        rangeEnd.setHours(23, 59, 59); // Set to end of day
        return currentTime >= rangeStart && currentTime <= rangeEnd;
      }

      // Case 4b: Date range (specific time)
      if (
        u.start_date &&
        u.end_date &&
        !u.range_all_day &&
        u.range_start_time &&
        u.range_end_time
      ) {
        const rangeStart = new Date(u.start_date);
        const rangeEnd = new Date(u.end_date);
        rangeEnd.setHours(23, 59, 59); // Set to end of day

        if (currentTime >= rangeStart && currentTime <= rangeEnd) {
          // Check if current time falls within the specified time range
          const [startHour, startMinute] = u.range_start_time
            .split(":")
            .map(Number);
          const [endHour, endMinute] = u.range_end_time.split(":").map(Number);

          const todayStart = new Date(day);
          todayStart.setHours(startHour, startMinute);

          const todayEnd = new Date(day);
          todayEnd.setHours(endHour, endMinute);

          return currentTime >= todayStart && currentTime < todayEnd;
        }
      }

      // For backward compatibility, handle the old date range format
      if (
        u.start_date &&
        u.end_date &&
        !u.range_all_day &&
        !u.range_start_time
      ) {
        const rangeStart = new Date(u.start_date);
        const rangeEnd = new Date(u.end_date);
        rangeEnd.setHours(23, 59, 59); // Set to end of day
        return currentTime >= rangeStart && currentTime <= rangeEnd;
      }

      return false;
    });
  };

  // ADD THESE NEW STATE VARIABLES
  const [instructorDialogOpen, setInstructorDialogOpen] = useState(false);
  const [selectedSlotForDialog, setSelectedSlotForDialog] =
    useState<Date | null>(null);
  const [dynamicInstructorsForDialog, setDynamicInstructorsForDialog] =
    useState<InstructorWithDistance[]>([]);

  const [showInstructorDetails, setShowInstructorDetails] = useState(false);
  if (isLoading) {
    return <div>Loading...</div>;
  }
  if (error) {
    return <div>Error loading learner details</div>;
  }
  if (!learnerDetails) {
    return <div>No learner details found</div>;
  }

  const handleAvailableSlotClick = (
    learnerData,
    selectedInstructorId,
    instructorsWithDistance,
    tentativeSchedules,
    day,
    hour,
    minute,
  ) => {
    console.log(learnerData);

    console.log("tentativeSchedules, ", tentativeSchedules);

    // Filter schedule for the given slot if any
    // tentativeSchedulesOfSlot = tentativeSchedules.filter((s) => )

    // Find the schedule for the current day and time
    const currentTime = new Date(day);
    currentTime.setHours(hour, minute);
    const tentativeSchedulesOfSlot = tentativeSchedules?.find((s) => {
      const scheduleStart = new Date(`${s.date}T${s.start_time}`);
      const scheduleEnd = new Date(`${s.date}T${s.end_time}`);
      return (
        isSameDay(scheduleStart, day) &&
        currentTime >= scheduleStart &&
        currentTime < scheduleEnd
      );
    });

    console.log(
      "tentativeSchedulesOfSlot, ",
      tentativeSchedulesOfSlot,
      currentTime,
      hour,
      minute,
    );

    // Format the learner data to match LearnerInfo interface
    const learnerInfo: LearnerInfo = {
      id: learnerData.id,
      name: learnerData.name,
      phone: learnerData.phone,
      email: learnerData.email || "",
      area: learnerData.area,
      pincode: learnerData.pincode,
      signed_up: learnerData.signed_up,
      created_at: learnerData.created_at,
      address_lat: learnerData.address_lat,
      address_lng: learnerData.address_lng,
      preferred_start_date: learnerData.preferred_start_date,
      preferred_completion_days: learnerData.preferred_completion_days,
      prefers_two_hour_classes: learnerData.prefers_two_hour_classes,
      pick_up_location: learnerData.pick_up_location,
    };

    setSelectedTentativeSchedule(learnerInfo);
    setShowTentativeScheduleDialog(true);
    // display data if exist

    // define state hooks on the component side and use them directly here for updating
    // Call mutate function for updating the state

    // const formData = { /* Gather your form data here */ };
    // try {
    //   // 3. Call the mutate function within the handler.
    //   // This triggers the async operation defined in mutationFn.
    //   await myMutation.mutateAsync(formData);
    // } catch (error) {
    //   console.error('Mutation failed:', error.message);
    // }
  };

  const getBookedDetailsForShow = (schedule) => {
    // console.log("Fetch learner from ", schedule);
    const learnerDetails = schedule.learner;
    return (
      <>
        {/* Learner name (bold), area (optional) */}
        <span className="text-base font-bold leading-tight">
          {learnerDetails?.name}
        </span>
        {learnerDetails?.area && (
          <span className="text-xs text-white/90">{learnerDetails?.area}</span>
        )}
        {/* Time range */}
        <span className="mt-1 text-xs font-medium">
          {schedule.start_time.slice(0, 5)} - {schedule.end_time.slice(0, 5)}
        </span>
      </>
    );
  };

  // useEffect(() => {
  //   console.log("instructorsWithDistance", instructorsWithDistance);
  // }, [instructorsWithDistance]);
  return (
    <div className="flex space-x-4">
      {/* Left Panel: Instructor's Schedule */}
      <div className="w-1/2">
        <Card className="mb-4">
          <CardContent>
            <h3 className="mb-4 mt-4 font-medium">Select Instructor</h3>
            <Select
              value={selectedInstructorId || ""}
              onValueChange={(value) => setSelectedInstructorId(value)}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    isLoadingDistances
                      ? "Calculating distances..."
                      : "Select an instructor"
                  }
                />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {isLoadingDistances ? (
                  <div className="flex items-center justify-center p-4">
                    <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
                    <span>Calculating distances...</span>
                  </div>
                ) : (
                  instructorsWithDistance.map((instructor) => (
                    <SelectItem
                      key={instructor.id_instructor}
                      value={instructor.id_instructor}
                      className="w-full"
                    >
                      <div className="flex w-full flex-wrap items-center justify-between">
                        {/* Name + badges container */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span>
                            {instructor.name}
                            {instructor.areas && instructor.areas.length > 0
                              ? ` (${instructor.areas.join(", ")})`
                              : ""}
                          </span>

                          {instructor.areas.some(
                            (area) =>
                              area.toLowerCase() === learnerArea.toLowerCase(),
                          ) && (
                            <Badge
                              variant="outline"
                              className="border-blue-200 bg-blue-50 text-blue-700"
                            >
                              Matching Area
                            </Badge>
                          )}

                          {instructor.isWithinRadius && true && (
                            <Badge
                              variant="outline"
                              className="border-green-200 bg-green-50 text-green-700"
                            >
                              Matching Radius
                            </Badge>
                          )}
                        </div>

                        {/* Distance is a sibling element, to avoid overflow masking*/}
                        {instructor.distance !== null && (
                          <div className="text-xs text-gray-500">
                            {instructor.distance.toFixed(1)}km
                          </div>
                        )}
                      </div>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            {/* Schedule Header and Navigation */}
            <h3 className="mb-3 text-xl font-bold text-black">
              Instructor's Schedule
            </h3>
            <div className="mb-4 flex items-center justify-between">
              <Button
                variant="outline"
                size="icon"
                onClick={() => handleDateRangeChange("prev")}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="text-lg font-medium">
                {format(currentRangeStart, "MMM d, yyyy")} -{" "}
                {format(addDays(currentRangeStart, 6), "MMM d, yyyy")}
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => handleDateRangeChange("next")}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Schedule Table */}
            <div className="w-full overflow-x-auto">
              <table className="table-fixed border-collapse border border-gray-200">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 min-w-24 border border-gray-200 bg-white p-2 text-base font-semibold text-gray-700">
                      Time
                    </th>
                    {Array.from({ length: 7 }).map((_, index) => {
                      const day = addDays(currentRangeStart, index);
                      return (
                        <th
                          key={index}
                          className="min-w-24 border border-gray-200 p-2 text-center text-base font-semibold text-gray-700"
                        >
                          <div>{format(day, "EEE")}</div>
                          <div className="text-sm text-gray-500">
                            {format(day, "MMM d")}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: SlotConfig.numSlotsPerDay }).map(
                    (_, timeIndex) => {
                      const hour =
                        Math.floor(timeIndex / SlotConfig.numSlotsPerHour) +
                        SlotConfig.startHourOfDay; // Start from 5 AM
                      const minute =
                        (SlotConfig.numMinutesPerSlot *
                          (timeIndex % SlotConfig.numSlotsPerHour)) %
                        60;
                      // console.log("Learner slot", hour, minute);
                      return (
                        <tr key={timeIndex} className="h-10">
                          <td className="sticky left-0 z-10 border border-gray-200 bg-white px-2 py-0 text-center text-base text-gray-700">
                            {format(
                              new Date().setHours(hour, minute),
                              "h:mm a",
                            )}
                          </td>
                          {Array.from({ length: 7 }).map((_, dayIndex) => {
                            const day = addDays(currentRangeStart, dayIndex);

                            // Find the schedule for the current day and time
                            const schedule = instructorSchedule?.find((s) => {
                              const scheduleStart = new Date(
                                `${s.date}T${s.start_time}`,
                              );
                              const scheduleEnd = new Date(
                                `${s.date}T${s.end_time}`,
                              );
                              const currentTime = new Date(day);
                              currentTime.setHours(hour, minute);
                              return (
                                isSameDay(scheduleStart, day) &&
                                currentTime >= scheduleStart &&
                                currentTime < scheduleEnd
                              );
                            });

                            const unavailable = isTimeSlotUnavailable(
                              selectedInstructorId,
                              instructorsWithDistance,
                              day,
                              hour,
                              minute,
                            );

                            // Determine if this cell is the start of a schedule
                            const isScheduleStart =
                              schedule &&
                              parseInt(schedule.start_time.split(":")[0]) ===
                                hour &&
                              parseInt(schedule.start_time.split(":")[1]) ===
                                minute;

                            return (
                              <td
                                key={dayIndex}
                                className={`h-12 max-h-12 border border-gray-200 px-2 py-0 text-center align-middle ${
                                  schedule
                                    ? schedule.isTentative
                                      ? "bg-orange-200 text-white"
                                      : "bg-green-500 text-white"
                                    : unavailable
                                      ? "bg-gray-300 text-red-800"
                                      : ""
                                } ${schedule ? "cursor-pointer hover:opacity-80" : ""}`}
                                onClick={() => {
                                  if (schedule && !schedule.isTentative) {
                                    handleOccupiedSlotClick(schedule);
                                  } else {
                                    if (schedule?.isTentative) {
                                      // Show message to user to manage tentative schedules from Instructor management
                                      toast({
                                        title: "Tentative Schedule",
                                        description:
                                          "Tentative schedules can be updated from Instructor management panel",
                                        variant: "destructive",
                                      });
                                      return;
                                    }

                                    // The following can be implemented to create the schedules also from the Intructor calender
                                    // However, it can be done from the Learner panel by selecting the same slot hence it is added functionality not must have
                                    // handleAvailableSlotClick(request.Learner, selectedInstructorId, instructorsWithDistance, tentativeSchedules, day, hour, minute);
                                  }
                                }}
                              >
                                <div className="flex h-full flex-col items-center justify-center">
                                  {isScheduleStart &&
                                  schedule &&
                                  !schedule.isTentative ? (
                                    getBookedDetailsForShow(
                                      schedule,
                                      learnerDetails,
                                    )
                                  ) : isScheduleStart &&
                                    schedule &&
                                    schedule.isTentative ? (
                                    <span className="text-base leading-tight text-gray-500">
                                      <ul className="text-left text-xs">
                                        <li>
                                          <strong>
                                            {schedule.tentative_details?.name ||
                                              "Tentative"}
                                          </strong>
                                        </li>
                                        <li>
                                          Lead Name:{" "}
                                          {schedule.tentative_details
                                            ?.leadName || "N/A"}
                                        </li>
                                        <li>
                                          Phone:{" "}
                                          {schedule.tentative_details?.phone ||
                                            "N/A"}
                                        </li>
                                        <li className="overflow-hidden text-ellipsis whitespace-nowrap">
                                          Description:{" "}
                                          {schedule.tentative_details
                                            ?.description || "N/A"}
                                        </li>
                                        <li>
                                          Paid Info:{" "}
                                          {schedule.tentative_details
                                            ?.paid_info || "N/A"}
                                        </li>
                                        <li>
                                          {schedule.tentative_details
                                            ?.latitude &&
                                          schedule.tentative_details
                                            ?.longitude ? (
                                            <a
                                              href={`https://www.google.com/maps?q=${schedule.tentative_details.latitude},${schedule.tentative_details.longitude}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="flex items-center gap-1 truncate text-xs underline hover:text-blue-800"
                                            >
                                              {/* {`https://www.google.com/maps?q=${schedule.tentative_details.latitude},${schedule.tentative_details.longitude}`} */}
                                              Map link
                                            </a>
                                          ) : (
                                            <span className="text-muted-foreground">
                                              Map N/A
                                            </span>
                                          )}
                                        </li>
                                      </ul>
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
      {/* Tentative schedule dialog */}
      {/* <TentativeScheduleDialog
        isOpen={instructorDialogOpen}
        onClose={() => setInstructorDialogOpen(false)}
        selectedDateTime={selectedSlotForDialog}
        /> */}
      {/* Right Panel: Learner's Schedule Selection */}
      <div className="w-1/2">
        <Card className="mb-4">
          <CardContent>
            <div className="mb-[18px] mt-10">
              <Button
                variant="outline"
                className="flex w-full justify-between"
                onClick={() => setShowInstructorDetails(!showInstructorDetails)}
              >
                Instructor Details
                {showInstructorDetails ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
              {showInstructorDetails && selectedInstructorId && (
                <div className="mt-2 grid grid-cols-2 gap-1 rounded bg-gray-50 p-2">
                  <div>
                    <p className="mb-1 text-sm">
                      <span className="font-bold">Address:</span>
                      <span className="ml-2">
                        {
                          instructorsWithDistance.find(
                            (instructor) =>
                              instructor.id_instructor === selectedInstructorId,
                          )?.address
                        }
                      </span>
                    </p>
                  </div>
                  <div className="items-right ml-10 flex">
                    <p className="mb-1 text-sm">
                      <span className="font-bold">Radius:</span>
                      <span className="ml-2">
                        {
                          instructorsWithDistance.find(
                            (instructor) =>
                              instructor.id_instructor === selectedInstructorId,
                          )?.radius
                        }{" "}
                        km
                      </span>
                    </p>
                  </div>
                  <div className="col-span-2">
                    <p className="mt-1 text-sm">
                      <span className="font-bold">Areas:</span>
                      <span className="ml-2">
                        {instructorsWithDistance
                          .find(
                            (instructor) =>
                              instructor.id_instructor === selectedInstructorId,
                          )
                          ?.areas.join(", ")}
                      </span>
                    </p>
                  </div>
                  <div className="col-span-2">
                    <p className="mt-1 text-sm">
                      <span className="font-bold">Distance from learner:</span>
                      <span className="ml-2">
                        {instructorsWithDistance
                          .find(
                            (instructor) =>
                              instructor.id_instructor === selectedInstructorId,
                          )
                          ?.distance?.toFixed(1) || "Unknown"}{" "}
                        km
                      </span>
                      {instructorsWithDistance.find(
                        (instructor) =>
                          instructor.id_instructor === selectedInstructorId,
                      )?.isWithinRadius && (
                        <Badge className="ml-2 border-green-200 bg-green-50 text-green-700">
                          Within serviceable radius
                        </Badge>
                      )}
                    </p>
                  </div>
                  <div className="col-span-2 mt-3">
                    <p className="mb-2 font-bold">Regular Working Hours:</p>
                    <div className="max-h-40 overflow-y-auto rounded border border-gray-200 p-2">
                      {(() => {
                        const selectedInstructor = instructorsWithDistance.find(
                          (instructor) =>
                            instructor.id_instructor === selectedInstructorId,
                        );

                        // Parse unavailability if it's a string
                        let unavailabilityData =
                          selectedInstructor?.unavailability;
                        if (typeof unavailabilityData === "string") {
                          try {
                            unavailabilityData = JSON.parse(unavailabilityData);
                          } catch (e) {
                            console.error(
                              "Error parsing unavailability data:",
                              e,
                            );
                            unavailabilityData = [];
                          }
                        }

                        const workingHours =
                          calculateWorkingHours(unavailabilityData);
                        const formattedHours = formatWorkingHours(workingHours);

                        return (
                          <table className="w-full text-sm">
                            <tbody>
                              {formattedHours.map((dayHours, index) => (
                                <tr
                                  key={index}
                                  className={
                                    index % 2 === 0 ? "bg-gray-50" : ""
                                  }
                                >
                                  <td
                                    className="py-1 pr-2 font-medium"
                                    style={{ width: "100px" }}
                                  >
                                    {dayHours.day}
                                  </td>
                                  <td className="py-1">{dayHours.hours}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        );
                      })()}
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                      Note: Working hours may vary on specific dates due to
                      instructor unavailability. Check the calendar view for the
                      most accurate availability.
                    </p>
                  </div>
                </div>
              )}
              {showInstructorDetails &&
                selectedInstructorId &&
                learnerDetails && (
                  <MapWithRoute
                    origin={{
                      lat: learnerDetails.address_lat,
                      lng: learnerDetails.address_lng,
                    }}
                    destination={{
                      lat: instructorsWithDistance.find(
                        (instructor) =>
                          instructor.id_instructor === selectedInstructorId,
                      )?.latitude,
                      lng: instructorsWithDistance.find(
                        (instructor) =>
                          instructor.id_instructor === selectedInstructorId,
                      )?.longitude,
                    }}
                    apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
                    instructorName={
                      instructorsWithDistance.find(
                        (instructor) =>
                          instructor.id_instructor === selectedInstructorId,
                      )?.name
                    }
                  />
                )}
              {/* <div>A is the location of Learner<br>B is the location of Instructor</br></div> */}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <h3 className="mb-4 mt-4 font-medium">Create learner Schedule</h3>
            <CreateSchedule
              learnerId={learnerId}
              learnerArea={learnerArea}
              request={request}
              onScheduleCreate={onScheduleCreate}
              defaultInstructorId={selectedInstructorId}
              currentRangeStart={currentRangeStart} // Pass the range start instead of week start
              onDateChange={(newDate) => setCurrentRangeStart(newDate)} // Add this prop to sync dates
              instructorsWithDistance={instructorsWithDistance} // Pass the instructors with distance info
              defaultInstructorSchedule={instructorSchedule}
              unavailabilityDataChecker={isTimeSlotUnavailable}
              learnerDetails={learnerDetails}
            />
          </CardContent>
        </Card>
      </div>

      {selectedLearner && (
        <LearnerInfoDialog
          learner={selectedLearner}
          open={showLearnerDialog}
          onClose={() => setShowLearnerDialog(false)}
        />
      )}

      {/* {selectedTentativeSchedule && (
        <TentativeScheduleDialog
          learner={selectedTentativeSchedule}
          open={showTentativeScheduleDialog}
          onClose={() => setShowTentativeScheduleDialog(false)}
        />
      )} */}
    </div>
  );
}

// Update the CreateSchedule component to accept defaultInstructorId and instructorsWithDistance
function CreateSchedule({
  learnerId,
  learnerArea,
  request,
  onScheduleCreate,
  defaultInstructorId,
  currentRangeStart,
  onDateChange,
  instructorsWithDistance,
  defaultInstructorSchedule,
  unavailabilityDataChecker,
  learnerDetails,
}: CreateScheduleProps & {
  defaultInstructorId: string | null;
  currentRangeStart: Date;
  onDateChange: (date: Date) => void;
  instructorsWithDistance: InstructorWithDistance[];
  defaultInstructorSchedule?: Schedule[] | null;
  unavailabilityDataChecker?: any;
  learnerDetails?: CreateScheduleProps["learnerDetails"];
}) {
  const { data: preferences } = usePreferences(learnerId);
  const [startDate, setStartDate] = useState(currentRangeStart);
  const [selectedSlots, setSelectedSlots] = useState<
    Array<Omit<Schedule, "lessonId"> & { minutes: number; slotGroupId: string }>
  >([]);
  // Track duration (1 or 2 hours) per slotGroupId
  const [slotDurations, setSlotDurations] = useState<Map<string, number>>(
    new Map(),
  );
  const [scheduleDetails, setScheduleDetails] = useState<
    TimeSlotState["existingSchedule"] | null
  >(null);
  const [isSendingInvites, setIsSendingInvites] = useState(false);
  // console.log("The default instr and their schedule", defaultInstructorId, defaultInstructorSchedule)
  // Dialog state for instructor selection
  const [selectionDialogOpen, setSelectionDialogOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<HourlySlot | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedInstructorId, setSelectedInstructorId] = useState<
    string | null
  >(defaultInstructorId);
  const { toast } = useToast();

  // const numSlotsPerHour = 2;
  // const numHoursPerDay = 18; // 5 AM to 11:59 PM in half-hour slots
  // const numSlotsPerDay = Math.ceil(numSlotsPerHour * numHoursPerDay);

  // get Unvailability of default instructor
  const defaultInstructorUnavailability = useMemo(() => {
    // showing instructorWithDistance
    // Find the selected instructor
    const selectedInstructor = instructorsWithDistance.find(
      (instructor) => instructor.id_instructor === defaultInstructorId,
    );
    // console.log('%c ~ file: CreateSchedule.tsx [] -> selectedInstructor?.unavailability; : ', selectedInstructor?.unavailability);
    return selectedInstructor?.unavailability;
  }, [defaultInstructorId]);

  // Sync startDate with currentRangeStart from parent
  useEffect(() => {
    setStartDate(currentRangeStart);
  }, [currentRangeStart]);

  // check selectedInstrScheduleAndUnavailibi
  const checkInstrctrScheduleAndUnavailability = () => {
    // const variable used, but not passed as arguments - defaultInstructorUnavailability
    // required selected instrutor id and distancedata - both are available
    return unavailabilityDataChecker(
      defaultInstructorId,
      instructorsWithDistance,
      day,
      hour,
      minute,
    );
    return true;
  };

  // Ensure the selected instructor is updated when defaultInstructorId changes
  useEffect(() => {
    setSelectedInstructorId(defaultInstructorId);
  }, [defaultInstructorId]);

  // Fetch instructors for the learner's area.
  // Inactive instructors (enabled === false) are hidden from new assignments.
  const { data: instructors } = useQuery({
    queryKey: ["instructors", learnerArea],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Instructor")
        .select("*")
        .or("enabled.is.null,enabled.eq.true");

      if (error) throw error;
      return data;
    },
  });

  const { data: prevSchedules } = useQuery({
    queryKey: ["prevSchedules", startDate],
    queryFn: async () => {
      if (!startDate) return null;
      const windowRange = 10;
      const prevWindowEnd = addDays(startDate, windowRange);
      const prevWindowStart = subDays(startDate, 0);
      prevWindowStart.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("Schedule")
        .select(
          ` date, start_time, end_time, learner_id, instructor_id, isTentative, Learner(name, area, pick_up_location, address_lat, address_lng)`,
        )
        .gte("date", format(prevWindowStart, "yyyy-MM-dd"))
        .lte("date", format(prevWindowEnd, "yyyy-MM-dd"))
        .order("date", { ascending: false })
        .order("end_time", { ascending: false })
        .neq("status", "paused");

      if (error) throw error;
      // console.log("Fetched instructor schedules in time range:", prevWindowStart, prevWindowEnd, data);
      return data;
    },
    enabled: !!startDate,
  });

  const getInstructorDynamicLocation = async (
    instructorId: string,
    slotTime: Date,
  ) => {
    const endDate = subDays(slotTime.getTime(), 0).setHours(0, 0, 0, 0);
    // console.log("EndDate", new Date(endDate));
    // const numHoursWindowForPrevLoc = 12;
    // const nHourBefore = new Date(
    //   slotTime.getTime() - 60 * 60 * 1000 * numHoursWindowForPrevLoc,
    // );

    // Find if instructor has any booking wothin the numHoursWindowForPrevLoc
    // hours before the selected slot
    // Searching on other shcedules assumes the instructor might not have class for the
    // same instructor
    // another query should be made to fetch last schedule of the instructor before the current slot

    const previousBooking = prevSchedules?.find((schedule) => {
      if (schedule.instructor_id !== instructorId || schedule.isTentative)
        return false;

      const scheduleEndTime = new Date(`${schedule.date}T${schedule.end_time}`);
      const scheduleStartTime = new Date(
        `${schedule.date}T${schedule.start_time}`,
      );
      // console.log(`T7_1 ${scheduleEndTime} > ${endDate} (${scheduleEndTime >= endDate }) \n
      //   && ${scheduleEndTime} <= ${slotTime} (${scheduleEndTime <= slotTime}) \n
      //   = (${scheduleEndTime >= endDate && scheduleEndTime <= slotTime})`);
      // Check if the schedule ends within 1 hour before our slot
      return scheduleEndTime >= endDate && scheduleEndTime <= slotTime;
    });
    // console.log("previousBooking", previousBooking, prevSchedules, instructorId);
    if (previousBooking && previousBooking.Learner) {
      // Use previous learner's location if instructor was busy before
      // console.log("Using prev location of Instructor", selectedInstructorId);
      return {
        lat: previousBooking.Learner.address_lat,
        lng: previousBooking.Learner.address_lng,
        source: "previous_booking",
      };
    }
    // Not for instructors other than seelcted, there are not schedules avilable, hence code will reach here
    // console.log("previousBooking NA now calculating default distance (it's not expeccted to reach here");
    // Use instructor's default location if free
    const instructor = instructorsWithDistance.find(
      (i) => i.id_instructor === instructorId,
    );
    // console.log("Using base location of Instructor", selectedInstructorId, instructor?.name);
    return {
      lat: instructor?.latitude,
      lng: instructor?.longitude,
      source: "default",
    };
  };
  // Check if this is a demo/custom course with virtual lesson IDs
  const isVirtualLessons =
    request.lesson_ids.length > 0 &&
    request.lesson_ids[0]?.startsWith?.("virtual-lesson-");

  // The learner's latest active enrollment. Drives both the virtual-lesson
  // hour count below and whether demo hours are credited against this request.
  //
  // Only the LATEST active enrollment counts: a learner who finishes a custom
  // course and then buys a top-up still has the (active) custom enrollment on
  // file, and its hours must not override the top-up's own correct lesson_ids.
  const { data: latestEnrollment } = useQuery({
    queryKey: ["latest-active-enrollment", learnerId],
    queryFn: async () => {
      const { data } = await supabase
        .from("enrollment")
        .select("progress")
        .eq("learner_id", learnerId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const progress = data?.progress as {
        type?: string;
        total_hours?: number;
      } | null;
      return {
        type: progress?.type ?? null,
        totalHours: Math.ceil(Number(progress?.total_hours) || 0),
      };
    },
    enabled: !!learnerId,
  });

  // Fetch lessons for the selected course
  const { data: allLessons } = useQuery({
    queryKey: [
      "lessons",
      request.lesson_ids,
      isVirtualLessons,
      learnerId,
      latestEnrollment,
    ],
    // Wait for the enrollment before synthesizing virtual lessons — deriving
    // the count from a stale request while it loads would flash a wrong
    // required-hours number at the admin.
    enabled: !isVirtualLessons || latestEnrollment !== undefined,
    queryFn: async () => {
      // For demo/custom courses with virtual lesson IDs, create mock lesson objects
      if (isVirtualLessons) {
        // A custom course has no Courses/Lesson rows to fall back on, so the
        // hour count would otherwise come solely from request.lesson_ids — and
        // that list can be stale. A demo -> custom upgrade leaves the demo's
        // 1-entry ["virtual-lesson-1"] request behind, which made every custom
        // course look like a single 1-hour lesson here no matter how many hours
        // were actually bought. The enrollment is the source of truth, so read
        // the hour count from it instead.
        //
        // Custom courses are always scheduled in full, even when only the first
        // installment is paid — hence total_hours rather than unlocked_lessons.
        // This is the PURCHASED hour count; any demo credit comes off it via
        // demoLessonOffset below, exactly as it does for a real course.
        const customHours =
          latestEnrollment?.type === "custom" ? latestEnrollment.totalHours : 0;

        const virtualCount =
          customHours > 0 ? customHours : request.lesson_ids.length;

        return Array.from({ length: virtualCount }, (_, index) => ({
          // Reuse the request's own ids where they exist so any downstream
          // intersection with request.lesson_ids still matches.
          id: request.lesson_ids[index] ?? `virtual-lesson-${index + 1}`,
          number: index + 1,
          course_id: null,
          name: `Lesson ${index + 1}`,
          created_at: new Date().toISOString(),
        }));
      }

      const { data: lesson1, error: lesson1Error } = await supabase
        .from("Lesson")
        .select("*")
        .eq("id", request.lesson_ids[0])
        .single();
      if (lesson1Error) throw lesson1Error;
      const courseId = lesson1.course_id;
      if (!courseId) throw new Error("Course ID not found");

      // Fetch course to get total_lessons
      const { data: course } = await supabase
        .from("Courses")
        .select("total_lessons")
        .eq("id", courseId)
        .single();
      const courseTotalLessons = course?.total_lessons;

      const { data, error } = await supabase
        .from("Lesson")
        .select("*")
        .eq("course_id", courseId)
        // Secondary sort on id makes "first record per number" deterministic.
        // Without it, two separate queries can order same-number duplicate rows
        // differently, so this dedup and the learner-side useLessons dedup keep
        // DIFFERENT ids for a number — then request.lesson_ids and allLessons
        // no longer intersect on that number, triggering "not enough lessons".
        .order("number", { ascending: true })
        .order("id", { ascending: true });

      if (error) throw error;
      // Deduplicate lessons by number - keep only the first record per lesson number
      // This handles cases where duplicate lesson records exist for the same course
      const seen = new Set<number>();
      const deduped = (data ?? []).filter((lesson) => {
        if (seen.has(lesson.number)) return false;
        seen.add(lesson.number);
        return true;
      });

      // Limit to course's total_lessons if available (handles extra lesson records in DB)
      return courseTotalLessons
        ? deduped.slice(0, courseTotalLessons)
        : deduped;
    },
  });

  // Completed demos count toward the upgraded course: each completed demo
  // (1 hr) stands in for one of the course's first lessons. So a 10-lesson
  // course after 1 completed demo is scheduled as lessons 2..10 (9 lessons),
  // mirroring the demo credit the upgrade applies to the price.
  const { data: completedDemoCount = 0 } = useCompletedDemoCount(learnerId);

  // find the minimum lesson number that needs to be re-scheduled from
  // all the lessons that are requested
  const lessons = allLessons?.filter((l) => request.lesson_ids.includes(l.id));

  // For "new" schedule requests, use the deduplicated course lesson count
  // (request.lesson_ids may be inflated due to duplicate lesson records from old migrations)
  // For reschedule/lesson10 requests, lesson_ids come from actual schedules so they're correct
  const totalCourseHours = allLessons?.length ?? request.lesson_ids.length;

  // Demo hours are credited against every upgrade target — Beginner, specialty
  // and custom alike — because the demo's price is deducted from all of them.
  // Excluded: reschedules (the hours were already paid and scheduled), and
  // demo/topup requests, whose virtual lessons ARE the purchased hours. That
  // last exclusion matters because a demo payment reads as "completed" while
  // the demo itself is still being scheduled — without it a learner's own demo
  // would cancel out the lesson they're waiting on.
  const creditsDemoHours = isVirtualLessons
    ? latestEnrollment?.type === "custom"
    : true;
  const demoLessonOffset =
    request.type === "new" && creditsDemoHours
      ? demoLessonOffsetFor(totalCourseHours, completedDemoCount)
      : 0;

  // Required lessons to schedule
  const requiredLessonCount =
    request.type === "new"
      ? Math.max(1, totalCourseHours - demoLessonOffset)
      : request.lesson_ids.length;

  const minLessonNumber =
    lessons && lessons.length > 0
      ? lessons.reduce(
          (min, lesson) => Math.min(min, lesson.number ?? 0),
          Infinity,
        )
      : 0;

  // Fetch existing schedules for the date range
  const { data: existingSchedules } = useQuery({
    queryKey: ["schedules", startDate],
    queryFn: async () => {
      const endDate = addDays(startDate, 9);
      const { data, error } = await supabase
        .from("Schedule")
        .select(
          "*,calendar_uid,calendar_sequence, Learner(name, area, pick_up_location, address_lat, address_lng)",
        )
        .gte("date", startDate.toISOString().split("T")[0])
        .lte("date", endDate.toISOString().split("T")[0])
        .neq("status", "paused");

      if (error) throw error;
      return data;
    },
  });

  const { data: existingLearnerSchedules } = useQuery({
    queryKey: ["schedules", learnerId],
    queryFn: async () => {
      // const endDate = addDays(startDate, 9);
      const { data, error } = await supabase
        .from("Schedule")
        .select(
          `
          *,
          Learner (
            name, 
            area, 
            pick_up_location, 
            address_lat, 
            address_lng
          )
        `,
        )
        .eq("learner_id", learnerId)
        .not("status", "in", '("completed","paused")');

      if (error) throw error;
      console.log(data);
      return data;
    },
  });

  const [schedulesToChange, laterScheduleOfLearnerToChange, otherSchedules] =
    useMemo(() => {
      if (!existingLearnerSchedules) return [[], [], []];

      // from all requests, filter matching current learner request
      const toChange = existingLearnerSchedules.filter(
        (s) =>
          request.lesson_ids.includes(s.lesson_id ?? "") &&
          s.learner_id === learnerId,
      );

      // from the minimum lesson number that's requested for the current learner,
      // filter other later lessons that were scheduled after the minimum requested
      // but are not part of the request list.
      const laterScheduleOfLearnerToChange = existingLearnerSchedules.filter(
        (s) =>
          s.learner_id === learnerId &&
          s.lesson_id &&
          !request.lesson_ids.includes(s.lesson_id ?? "") &&
          allLessons?.find((l) => l.id === s.lesson_id)?.number >
            minLessonNumber,
      );

      console.log(
        "The other schedules that are affected from the reschedule out of ",
        existingLearnerSchedules,
        " are ",
        laterScheduleOfLearnerToChange,
      );
      if (!existingSchedules)
        return [toChange, laterScheduleOfLearnerToChange, []];

      // For instructor availability checking, we need ALL schedules (not just other learners)
      // This ensures we don't double-book an instructor even if the same learner has another booking
      // Filter out only the schedules that are being changed (to allow rescheduling those specific slots)
      const schedulesToChangeIds = toChange.map((s) => s.id);
      const others = existingSchedules.filter(
        (s) => !schedulesToChangeIds.includes(s.id),
      );

      return [toChange, laterScheduleOfLearnerToChange, others];
    }, [
      existingSchedules,
      request.lesson_ids,
      learnerId,
      allLessons,
      minLessonNumber,
    ]);
  // console.log("T7_5 other schedules calculated", otherSchedules);
  // Calculate hourly slots for each day
  const calculateDaySchedule = (date: Date): DaySchedule => {
    const daySchedule: DaySchedule = [];
    const dateStr = format(date, "yyyy-MM-dd");
    // From the re-schedule requests, none should fall on same day
    const isDayBlocked = schedulesToChange.some(
      (s) =>
        format(new Date(s.date), "yyyy-MM-dd") === dateStr && !s.isTentative,
    );
    const isToday = isSameDay(date, new Date());
    const currentTime = new Date();

    for (
      let hour = SlotConfig.startHourOfDay;
      hour <= SlotConfig.endHourOfDay;
      hour++
    ) {
      for (const minute of [0, Math.ceil(60 / SlotConfig.numSlotsPerHour)]) {
        const timestamp = new Date(date);
        timestamp.setHours(hour, minute);
        // console.log("hour and minute", hour, minute, schedulesToChange);
        // Admin can schedule in past or future — no date restriction
        const isInPast = false;
        // console.log("inPast",
        //   isInPast,
        //   timestamp,
        //   startOfDay(subDays(new Date(), 30)),
        // );
        // Find which time slot this time belongs to
        const timeSlot = TIME_SLOTS.find((slot) => {
          const [start, end] = slot.split("-");
          return parseInt(start) <= hour && parseInt(end) > hour;
        });

        if (!timeSlot) continue;

        // Get schedules that overlap with this time slot
        const slotTimeStr = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}:00`;
        const slotEndHour = (hour + 1) % 24;
        const slotEndTimeStr = `${slotEndHour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}:00`;
        const slotSchedules =
          otherSchedules?.filter((s) => {
            if (s.date !== dateStr) return false;
            // Check overlap: existing schedule overlaps if it starts before slot ends AND ends after slot starts
            return s.start_time < slotEndTimeStr && s.end_time > slotTimeStr;
          }) ?? [];

        // Get learner preferences for this slot
        const isPreferred = preferences?.some(
          (p) => p.day_of_week === date.getDay() && p.time_slot === timeSlot,
        );

        // Check if this slot is currently scheduled for rescheduling (overlap check)
        const isCurrentSchedule = schedulesToChange?.some(
          (s) =>
            s.date === dateStr &&
            s.start_time < slotEndTimeStr &&
            (s.end_time || s.start_time) > slotTimeStr,
        );

        // Check if this slot has other schedules for the same learner (overlap check)
        const isLearnerSchedule = existingSchedules?.some(
          (s) =>
            s.date === dateStr &&
            s.start_time < slotEndTimeStr &&
            s.end_time > slotTimeStr &&
            s.learner_id === learnerId &&
            !request.lesson_ids.includes(s.lesson_id ?? ""),
        );

        // Check if learner has marked this time slot as unavailable
        const isLearnerUnavailable = isLearnerTimeSlotUnavailable(
          learnerDetails?.unavailability,
          date,
          hour,
          minute,
        );

        // console.log("selectedInstr: ", defaultInstructorId);
        // Get available instructors for this slot
        // Note that it only checks the unavailability
        // Filter to only include instructors within their service radius
        let selectedInstrUnvailable = false; //assum instructors are available unless blocked

        const availableInstructors =
          instructorsWithDistance
            ?.filter((instructor) => {
              const instrBookedForSlot = slotSchedules.some(
                (s) =>
                  s.instructor_id === instructor.id_instructor &&
                  !s.isTentative,
              );
              // TODO: move code to seperate function
              // It's only added here to avoid running another loop
              if (instructor.id_instructor === selectedInstructorId) {
                // console.log("availability for slot ", hour, minute, instructor);
                selectedInstrUnvailable =
                  unavailabilityDataChecker(
                    defaultInstructorId,
                    instructorsWithDistance,
                    date,
                    hour,
                    minute,
                  ) || instrBookedForSlot;

                // if (dateStr === "2025-10-10" && hour === 6) console.log("selectedInstrAvailable updated to", selectedInstrUnvailable);
              }
              // move above code to seperate function

              return !instrBookedForSlot;
            })
            .map((i) => i.id_instructor) ?? [];

        // if (dateStr === "2025-10-10" && hour === 6) {

        //   console.log(dateStr, hour, minute);
        //   console.log("ID and schedules", selectedInstructorId, availableInstructors, instructorsWithDistance);
        //   // assuming availableInstructors's a list of IDs
        //   selectedInstrUnvailable = !availableInstructors.some(
        //     (availInstrId) =>
        //       (availInstrId === selectedInstructorId)
        //   );
        //   console.log("Unvailasble", selectedInstrUnvailable);
        // }

        const existingSchedule =
          !isLearnerSchedule &&
          !isCurrentSchedule &&
          availableInstructors.length === 0 &&
          slotSchedules.length > 0 &&
          slotSchedules[0].Learner
            ? {
                slot_start_time: slotSchedules[0].start_time,
                learner_name: slotSchedules[0].Learner.name,
                learner_area: slotSchedules[0].Learner.area,
                pickup_address: slotSchedules[0].Learner.pick_up_location,
                latitude: slotSchedules[0].Learner.address_lat,
                longitude: slotSchedules[0].Learner.address_lng,
              }
            : undefined;
        // console.log("selectedInstructorId, selectedInstructorUnavailable", selectedInstructorId, selectedInstrUnvailable);
        // const available = (              availableInstructors.length > 0 &&
        //             !selectedInstrUnvailable &&
        //             !isLearnerSchedule &&
        //             !isDayBlocked &&
        //             !isInPast);
        // if (date.getDate() === 2 && hour === 10) {

        //   console.log(
        //     "availableInstructors.length, selectedInstrUnvailable, isLearnerSchedule, isDayBlocked, isInPast, hour",
        //     availableInstructors.length, selectedInstrUnvailable, isLearnerSchedule, isDayBlocked, isInPast, hour);
        //     console.log(available ? "AVAILABLE" : "NOT AVAILABLE");
        //   }

        daySchedule.push({
          timestamp,
          timeSlot: timeSlot as TimeSlot | null,
          state: {
            isAvailable:
              availableInstructors.length > 0 &&
              !selectedInstrUnvailable &&
              !isLearnerSchedule &&
              !isLearnerUnavailable && // Check learner's blocked times
              // !isDayBlocked && // same day re-scheduling available
              !isInPast, // Add this condition to prevent selecting past slots
            isSelected: selectedSlots.some(
              (s) =>
                format(s.date, "yyyy-MM-dd") === dateStr &&
                s.hour === hour &&
                s.minutes === minute,
            ),
            isPreferred: !!isPreferred,
            isCurrentSchedule,
            isLearnerSchedule,
            isLearnerUnavailable, // Add to state for UI indication
            existingSchedule,
            availableInstructors,
            isCurrentInstrUnavailable: selectedInstrUnvailable,
          },
        });
      }
    }

    return daySchedule;
  };

  // Instructor selection dialog component
  // REPLACE YOUR EXISTING InstructorSelectionDialog WITH THIS
  // REPLACE YOUR EXISTING InstructorSelectionDialog WITH THIS ENHANCED VERSION
  const EnhancedInstructorSelectionDialog = ({
    open,
    onClose,
    slot,
    date,
    instructorsWithDistance,
    otherSchedules,
    onConfirm,
  }: TimeSlotSelectionDialogProps & {
    instructorsWithDistance: InstructorWithDistance[];
  }) => {
    const [instructorId, setInstructorId] = useState<string>(
      selectedInstructorId || slot?.state.availableInstructors[0] || "",
    );
    const [classDuration, setClassDuration] = useState(1);
    const [dynamicInstructors, setDynamicInstructors] = useState<any[]>([]);
    const [isLoadingLocations, setIsLoadingLocations] = useState(false);

    // NEW: Filter and search states
    const [searchTerm, setSearchTerm] = useState("");
    const [locationFilter, setLocationFilter] = useState<
      "all" | "office" | "previous"
    >("previous");
    const [maxDistance, setMaxDistance] = useState<number>(50); // km
    const [maxTime, setMaxTime] = useState<number>(120); // minutes

    // NEW: State to store travel times for sorting
    const [instructorsWithTravelData, setInstructorsWithTravelData] = useState<
      any[]
    >([]);

    // Fetch learner details for the map
    const { data: learnerDetails } = useQuery({
      queryKey: ["learnerDetails", learnerId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("Learner")
          .select("*")
          .eq("id", learnerId)
          .single();
        if (error) throw error;
        return data;
      },
    });

    // Calculate dynamic locations when dialog opens
    useEffect(() => {
      if (open && slot && date && instructorsWithDistance.length > 0) {
        setIsLoadingLocations(true);
        const calculateDynamicLocations = async () => {
          const slotDateTime = new Date(date);
          slotDateTime.setHours(
            slot.timestamp.getHours(),
            slot.timestamp.getMinutes(),
          );

          const instructorsWithDynamicLocations = await Promise.all(
            instructorsWithDistance
              .filter((instructor) =>
                slot.state.availableInstructors.includes(
                  instructor.id_instructor,
                ),
              )
              .map(async (instructor) => {
                const dynamicLocation = await getInstructorDynamicLocation(
                  instructor.id_instructor,
                  slotDateTime,
                );
                return {
                  ...instructor,
                  currentLocation: {
                    lat: dynamicLocation.lat,
                    lng: dynamicLocation.lng,
                  },
                  locationSource: dynamicLocation.source,
                };
              }),
          );

          setDynamicInstructors(instructorsWithDynamicLocations);
          setIsLoadingLocations(false);
        };

        calculateDynamicLocations();
      }
    }, [open, slot, date, instructorsWithDistance]);

    // Build travel data synchronously from the straight-line distance already
    // computed in calculateDistances. No Google API round-trip → dialog opens
    // instantly. travelDistance/travelTime are used by the sort + filter; the
    // straight-line km is good enough for ordering and the maxDistance filter.
    useEffect(() => {
      if (dynamicInstructors.length > 0) {
        const instructorsWithTravel = dynamicInstructors.map((instructor) => ({
          ...instructor,
          travelDistance: instructor.distance ?? 0,
          travelTime: 30,
          travelDistanceText:
            instructor.distance != null
              ? `${instructor.distance.toFixed(1)} km`
              : "—",
          travelTimeText: "~30 mins",
        }));

        const learnerArea = learnerDetails?.area?.toLowerCase() || "";
        const sortedInstructors = instructorsWithTravel.sort((a, b) => {
          if (a.isWithinRadius && !b.isWithinRadius) return -1;
          if (!a.isWithinRadius && b.isWithinRadius) return 1;

          if (a.isWithinRadius && b.isWithinRadius) {
            const aDist = a.distance;
            const bDist = b.distance;
            if (aDist != null && bDist != null) return aDist - bDist;
            if (aDist == null) return 1;
            if (bDist == null) return -1;
          }

          const aMatchesArea = a.areas?.some(
            (area: string) => area.toLowerCase() === learnerArea,
          );
          const bMatchesArea = b.areas?.some(
            (area: string) => area.toLowerCase() === learnerArea,
          );
          if (aMatchesArea && !bMatchesArea) return -1;
          if (!aMatchesArea && bMatchesArea) return 1;

          return (a.name || "").localeCompare(b.name || "");
        });
        setInstructorsWithTravelData(sortedInstructors);
      }
    }, [dynamicInstructors, learnerDetails]);

    // Single batched DistanceMatrix call: 1 origin → many destinations.
    const getBatchedDrivingData = async (
      originLat: number,
      originLng: number,
      destinations: { lat: number; lng: number }[],
    ): Promise<Array<{
      distance: number;
      duration: number;
      distanceText: string;
      durationText: string;
    } | null> | null> => {
      if (destinations.length === 0) return [];
      try {
        await googleMapsLoader.load();
        const origin = new google.maps.LatLng(originLat, originLng);
        const dests = destinations.map(
          (d) => new google.maps.LatLng(d.lat, d.lng),
        );
        const service = new google.maps.DistanceMatrixService();
        return await new Promise((resolve) => {
          service.getDistanceMatrix(
            {
              origins: [origin],
              destinations: dests,
              travelMode: google.maps.TravelMode.DRIVING,
              drivingOptions: {
                departureTime: new Date(),
                trafficModel: google.maps.TrafficModel.BEST_GUESS,
              },
            },
            (response, status) => {
              if (status !== "OK" || !response?.rows?.[0]?.elements) {
                resolve(null);
                return;
              }
              resolve(
                response.rows[0].elements.map((el) => {
                  if (el.status !== "OK") return null;
                  return {
                    distance: el.distance.value / 1000,
                    duration: Math.ceil(el.duration.value / 60),
                    distanceText: el.distance.text,
                    durationText: el.duration.text,
                  };
                }),
              );
            },
          );
        });
      } catch (error) {
        console.error("Error in getBatchedDrivingData:", error);
        return null;
      }
    };

    // NEW: Enhanced Google Maps function to get both distance and time
    const getDrivingDistanceAndTime = async (
      originLat,
      originLng,
      destLat,
      destLng,
    ) => {
      try {
        await googleMapsLoader.load();

        const origin = new google.maps.LatLng(originLat, originLng);
        const destination = new google.maps.LatLng(destLat, destLng);
        const service = new google.maps.DistanceMatrixService();

        return new Promise((resolve) => {
          service.getDistanceMatrix(
            {
              origins: [origin],
              destinations: [destination],
              travelMode: google.maps.TravelMode.DRIVING,
              drivingOptions: {
                departureTime: new Date(),
                trafficModel: google.maps.TrafficModel.BEST_GUESS,
              },
            },
            (response, status) => {
              if (
                status === "OK" &&
                response?.rows?.[0]?.elements?.[0]?.status === "OK"
              ) {
                const element = response.rows[0].elements[0];
                resolve({
                  distance: element.distance.value / 1000, // convert to km
                  duration: Math.ceil(element.duration.value / 60), // convert to minutes
                  distanceText: element.distance.text,
                  durationText: element.duration.text,
                });
              } else {
                resolve(null);
              }
            },
          );
        });
      } catch (error) {
        console.error("Error in getDrivingDistanceAndTime:", error);
        return null;
      }
    };

    // NEW: Apply filters and search
    const filteredInstructors = useMemo(() => {
      let filtered = instructorsWithTravelData;

      // Apply search filter
      if (searchTerm) {
        filtered = filtered.filter(
          (instructor) =>
            instructor.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            instructor.areas.some((area) =>
              area.toLowerCase().includes(searchTerm.toLowerCase()),
            ),
        );
      }

      // Apply location source filter
      // if (locationFilter !== "all") {
      //   filtered = filtered.filter((instructor) => {
      //     if (locationFilter === "office")
      //       return instructor.locationSource === "default";
      //     if (locationFilter === "previous")
      //       return instructor.locationSource === "previous_booking";
      //     return true;
      //   });
      // }

      // Apply distance filter
      filtered = filtered.filter(
        (instructor) => instructor.travelDistance <= maxDistance,
      );

      // Apply time filter
      filtered = filtered.filter(
        (instructor) => instructor.travelTime <= maxTime,
      );

      return filtered;
    }, [
      instructorsWithTravelData,
      searchTerm,
      locationFilter,
      maxDistance,
      maxTime,
    ]);

    // Hours still needed for this request, so we never offer a 2-hour class
    // when only 1 hour remains (which would overshoot requiredLessonCount and
    // leave a selection that can't be submitted).
    const remainingHours = Math.max(
      0,
      requiredLessonCount - countUniqueHourlySlots(selectedSlots),
    );
    const canSelectTwoHours = remainingHours >= 2;

    const handleConfirm = () => {
      const duration = canSelectTwoHours ? classDuration : 1;
      onConfirm(instructorId, duration);
      setClassDuration(1);
      onClose();
    };

    // Don't bail when coords are missing (e.g. fresh demo learners) — the
    // map cards inside already degrade gracefully via MapWithRoute. Returning
    // null here was the reason demo slot clicks rendered nothing visible.

    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-h-[90vh] max-w-6xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              Select Instructor for{" "}
              {date && slot
                ? `${format(date, "MMM d, yyyy")} at ${format(slot.timestamp, "h:mm a")}`
                : ""}
            </DialogTitle>
          </DialogHeader>

          {/* NEW: Filters and Search Controls */}
          <div className="space-y-4 border-b pb-4">
            {/* Search Bar */}
            <div>
              <input
                type="text"
                placeholder="Search instructors by name or area..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Filter Controls */}
            <div className="grid grid-cols-4 gap-4">
              {/* Location Source Filter - removed (always previous+default)*/}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Location
                </label>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  (Note: Previous location is set when last booking was within
                  12 hours, otherwise office location)
                </label>
              </div>

              {/* Distance Filter */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Max Distance: {maxDistance} km
                </label>
                <input
                  type="range"
                  min="5"
                  max="100"
                  step="5"
                  value={maxDistance}
                  onChange={(e) => setMaxDistance(Number(e.target.value))}
                  className="w-full"
                />
              </div>

              {/* Time Filter */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Max Time: {maxTime} mins
                </label>
                <input
                  type="range"
                  min="10"
                  max="180"
                  step="10"
                  value={maxTime}
                  onChange={(e) => setMaxTime(Number(e.target.value))}
                  className="w-full"
                />
              </div>

              {/* Results Count */}
              <div className="flex items-end">
                <Badge variant="outline" className="px-3 py-2">
                  {filteredInstructors.length} instructor
                  {filteredInstructors.length !== 1 ? "s" : ""} found
                </Badge>
              </div>
            </div>
          </div>

          {/* Loading State */}
          {isLoadingLocations ? (
            <div className="flex items-center justify-center p-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
              <span className="ml-2">Loading instructor locations...</span>
            </div>
          ) : (
            /* Instructors List */
            <div className="max-h-[60vh] space-y-4 overflow-y-auto">
              {filteredInstructors.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  No instructors match your current filters. Try adjusting the
                  search criteria.
                </div>
              ) : (
                filteredInstructors.map((instructor, index) => (
                  <Card
                    key={instructor.id_instructor}
                    className={`border-2 ${instructorId === instructor.id_instructor ? "border-blue-500 bg-blue-50" : "border-gray-200"}`}
                  >
                    <CardContent className="p-4">
                      <div className="grid grid-cols-[2fr_1fr] gap-6">
                        {/* Map Section */}
                        <div className="min-h-[300px]">
                          <MapWithRoute
                            origin={{
                              lat: learnerDetails?.address_lat,
                              lng: learnerDetails?.address_lng,
                            }}
                            destination={instructor.currentLocation}
                            apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
                            instructorName={instructor.name}
                          />
                        </div>

                        {/* Instructor Info & Selection */}
                        <div className="flex flex-col justify-between">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <h3 className="text-lg font-semibold">
                                {instructor.name}
                              </h3>
                              {index === 0 && (
                                <Badge className="border-green-300 bg-green-100 text-green-800">
                                  🚀 Fastest Route
                                </Badge>
                              )}
                            </div>

                            <Badge
                              variant={
                                instructor.locationSource === "default"
                                  ? "secondary"
                                  : "outline"
                              }
                            >
                              {instructor.locationSource === "default"
                                ? "📍 At Office"
                                : "🚗 From Previous Lesson"}
                            </Badge>

                            {/* Travel Info */}
                            <div className="space-y-2 rounded-lg bg-gray-50 p-3">
                              <div className="flex justify-between text-sm">
                                <span className="font-medium">Distance:</span>
                                <span className="font-semibold text-blue-600">
                                  {instructor.travelDistanceText}
                                </span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span className="font-medium">
                                  Travel Time:
                                </span>
                                <span className="font-semibold text-green-600">
                                  {instructor.travelTimeText}
                                </span>
                              </div>
                            </div>

                            {/* Areas */}
                            <div className="space-y-1 text-sm text-gray-600">
                              <p>
                                <strong>Areas Covered:</strong>
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {instructor.areas.map((area) => (
                                  <Badge
                                    key={area}
                                    variant={
                                      area.toLowerCase() ===
                                      learnerArea.toLowerCase()
                                        ? "default"
                                        : "outline"
                                    }
                                    className="text-xs"
                                  >
                                    {area}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="space-y-2">
                            {/* Selection Radio */}
                            <label className="flex cursor-pointer items-center space-x-2 rounded border p-2 hover:bg-gray-50">
                              <input
                                type="radio"
                                name="instructor"
                                value={instructor.id_instructor}
                                checked={
                                  instructorId === instructor.id_instructor
                                }
                                onChange={() =>
                                  setInstructorId(instructor.id_instructor)
                                }
                                className="h-4 w-4 text-blue-600"
                              />
                              <span className="text-sm font-medium">
                                Select this instructor
                              </span>
                            </label>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}

          {/* Duration + Action Buttons */}
          <div className="flex items-center justify-between border-t pt-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-700">
                Class duration:
              </span>
              <div className="flex gap-1">
                <button
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    classDuration === 1
                      ? "bg-primary text-white"
                      : "border bg-white text-gray-600 hover:bg-gray-100"
                  }`}
                  onClick={() => setClassDuration(1)}
                >
                  1 Hour
                </button>
                <button
                  disabled={!canSelectTwoHours}
                  title={
                    canSelectTwoHours
                      ? undefined
                      : "Only 1 hour left for this request"
                  }
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    classDuration === 2 && canSelectTwoHours
                      ? "bg-primary text-white"
                      : "border bg-white text-gray-600 hover:bg-gray-100"
                  } ${!canSelectTwoHours ? "cursor-not-allowed opacity-50" : ""}`}
                  onClick={() => canSelectTwoHours && setClassDuration(2)}
                >
                  2 Hours
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={!instructorId || filteredInstructors.length === 0}
              >
                Confirm Selection
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  };
  // Check if the numSlots can be selected without overlapping end of the day
  const checkOverlapEndOfDay = (
    hour: number,
    minute: number,
    numSlots: number,
  ) => {
    // Calculate total minutes to add based on number of slots
    const minutesToAdd = numSlots * SlotConfig.numMinutesPerSlot;

    // Compute absolute minutes from midnight for start and end
    const startTotalMinutes = hour * 60 + minute;
    const endTotalMinutes = startTotalMinutes + minutesToAdd;

    // Convert end time to total minutes for comparison
    const maxAllowedMinutes = SlotConfig.endHourOfDay * 60;

    // If end time exceeds the configured end time -> overlap
    return endTotalMinutes > maxAllowedMinutes;
  };
  const handleSlotClick = (date: Date, slot: HourlySlot) => {
    if (!slot?.state) {
      toast({
        title: "Slot data not ready",
        description: "Wait for distances to finish loading and try again.",
      });
      return;
    }

    if (slot.state.isSelected) {
      // Deselect if already selected (and clean up slotDurations).
      const hour = slot.timestamp.getHours();
      const minute = slot.timestamp.getMinutes();
      const dateStr = format(date, "yyyy-MM-dd");
      const groupId = selectedSlots.find(
        (s) =>
          format(s.date, "yyyy-MM-dd") === dateStr &&
          s.hour === hour &&
          s.minutes === minute,
      )?.slotGroupId;
      if (groupId) {
        setSlotDurations((prev) => {
          const next = new Map(prev);
          next.delete(groupId);
          return next;
        });
      }
      setSelectedSlots((prev) => prev.filter((s) => s.slotGroupId !== groupId));
      return;
    }

    if (!slot.state.isAvailable && !slot.state.isCurrentInstrUnavailable) {
      toast({
        title: "Slot unavailable",
        description:
          "Either there's already a schedule on this slot, no instructor is free, or the learner has marked this time as unavailable.",
        variant: "destructive",
      });
      return;
    }

    const currentUniqueSlots = countUniqueHourlySlots(selectedSlots);
    const hour = slot.timestamp.getHours();
    const minute = slot.timestamp.getMinutes();

    if (currentUniqueSlots >= requiredLessonCount) {
      toast({
        title: "Slot limit reached",
        description: `You've already selected ${requiredLessonCount} hour(s) — the required count for this request.`,
        variant: "destructive",
      });
      return;
    }
    if (checkOverlapEndOfDay(hour, minute, 2)) {
      toast({
        title: "End-of-day overlap",
        description: "This slot would extend past the configured end of day.",
        variant: "destructive",
      });
      return;
    }

    setSelectedSlot(slot);
    setSelectedDate(date);
    setSelectionDialogOpen(true);
  };

  // Handle instructor selection from dialog (with duration: 1 or 2 hours)
  const handleInstructorSelect = (
    instructorId: string,
    duration: number = 1,
  ) => {
    if (!selectedSlot || !selectedDate) return;

    const hour = selectedSlot.timestamp.getHours();
    const minute = selectedSlot.timestamp.getMinutes();
    const isStartSlot = minute === 0;

    // Validate end-of-day for the selected duration
    const numHalfHourSlots = duration * 2;
    if (checkOverlapEndOfDay(hour, minute, numHalfHourSlots)) {
      alert("Cannot select this duration: lesson would exceed end of day.");
      return;
    }

    // Guard against overshooting the required lesson count. handleSlotClick only
    // checks the count BEFORE the duration is known, so a 2-hour pick with a
    // single hour remaining would push the selection past requiredLessonCount —
    // leaving a selection that can never equal it and can't be submitted.
    const alreadySelectedHours = countUniqueHourlySlots(selectedSlots);
    if (alreadySelectedHours + duration > requiredLessonCount) {
      toast({
        title: "Not enough hours remaining",
        description: `Only ${requiredLessonCount - alreadySelectedHours} hour(s) left for this request — choose a 1-hour class.`,
        variant: "destructive",
      });
      return;
    }

    // Generate truly unique ID using timestamp + random + date/hour to prevent collisions
    const dateStr = format(selectedDate, "yyyy-MM-dd");
    const slotGroupId = `${dateStr}-${hour}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Track this slot group's duration
    setSlotDurations((prev) => new Map(prev).set(slotGroupId, duration));

    setSelectedSlots((prev) => {
      // Build all half-hour slots for the selected duration
      const startMinutes = isStartSlot ? 0 : 30;
      const startTotalMinutes = hour * 60 + startMinutes;
      const slots = [];

      for (let i = 0; i < numHalfHourSlots; i++) {
        const totalMin = startTotalMinutes + i * 30;
        slots.push({
          date: selectedDate,
          hour: Math.floor(totalMin / 60),
          minutes: totalMin % 60,
          instructorId,
          slotGroupId,
        });
      }

      return [...prev, ...slots];
    });
  };

  // Helper function to count total class hours (a 2hr slot = 2 classes)
  const countUniqueHourlySlots = (
    slots: Array<
      Omit<Schedule, "lessonId"> & { minutes: number; slotGroupId?: string }
    >,
  ) => {
    const uniqueGroups = new Set(
      slots.map((s) => s.slotGroupId).filter(Boolean),
    );
    // Sum durations: each group counts as its duration (1 or 2 hours)
    return Array.from(uniqueGroups).reduce(
      (sum, gid) => sum + (slotDurations.get(gid) || 1),
      0,
    );
  };

  const handleDateChange = (direction: "prev" | "next") => {
    const newDate = addDays(startDate, direction === "next" ? 7 : -7);
    setStartDate(newDate);
    onDateChange(newDate); // Sync with parent component
  };

  const handleCreateSchedule = async () => {
    if (selectedSlots.length === 0) {
      alert("Please select at least one time slot");
      return;
    }

    if (!lessons || lessons.length < countUniqueHourlySlots(selectedSlots)) {
      alert("Not enough lessons available for the course");
      return;
    }

    if (!instructorsWithDistance || instructorsWithDistance.length === 0) {
      alert("No instructors available for this area");
      return;
    }

    // For demo/custom courses with virtual lessons, pass null as courseId
    const courseIdToPass = isVirtualLessons
      ? null
      : (allLessons?.[0]?.course_id ?? "");

    // Get all existing schedules for the course (excluding ones being rescheduled)
    const existingCourseSchedules =
      existingLearnerSchedules?.filter(
        (s) =>
          s.learner_id === learnerId &&
          !request.lesson_ids.includes(s.lesson_id ?? "") &&
          allLessons?.some((l) => l.id === s.lesson_id),
      ) ?? [];

    // Get completed lessons to maintain their numbers
    // Update: also consider lessons from past that are not in completed status
    const completedLessons = existingCourseSchedules.filter(
      (s) => s.status === "completed",
      // new Date(s.date).setHours(parseInt(s.start_time.split(":")[0])) <
      // new Date().getTime(),
    );

    // Group selected slots by their slotGroupId
    const selectedSlotGroups = groupBy(
      selectedSlots,
      (slot) => slot.slotGroupId || "",
    );

    // DEBUG: Log slot grouping details
    console.log("=== SLOT GROUPING DEBUG ===");
    console.log("Total selectedSlots entries:", selectedSlots.length);
    console.log("Unique slotGroupIds:", Object.keys(selectedSlotGroups).length);
    console.log("===========================");

    // Convert each group of 30-minute slots into a single entry with duration
    // We'll use the first slot in each group as the starting point
    const newSlots = Object.entries(selectedSlotGroups).map(
      ([groupId, group]) => {
        // Sort the slots to ensure the earlier one comes first
        const sortedGroup = [...group].sort((a, b) => {
          const timeA = new Date(a.date).setHours(a.hour, a.minutes);
          const timeB = new Date(b.date).setHours(b.hour, b.minutes);
          return timeA - timeB;
        });

        // Use the first slot as the start time
        const firstSlot = sortedGroup[0];
        return {
          date: firstSlot.date,
          hour: firstSlot.hour,
          minutes: firstSlot.minutes,
          instructorId: firstSlot.instructorId,
          duration: slotDurations.get(groupId) || 1,
          isNew: true as const,
        };
      },
    );

    console.log("newSlots count after grouping:", newSlots.length);

    // Get upcoming slots
    const upcomingSlots = [
      // New selected slots (only one entry per hour)
      ...newSlots,

      // Existing upcoming schedules that aren't being changed
      ...existingCourseSchedules
        .filter(
          (s) =>
            new Date(s?.date).setHours(
              parseInt(s?.start_time?.split(":")[0]),
            ) >= new Date().getTime(),
        )
        .map((schedule) => ({
          date: new Date(schedule.date),
          hour: parseInt(schedule.start_time.split(":")[0]),
          minutes: parseInt(schedule.start_time.split(":")[1] || "0"),
          instructorId: schedule.instructor_id ?? "",
          lessonId: schedule.lesson_id ?? "",
          isNew: false as const,
        })),
    ];

    // Sort upcoming slots chronologically
    const chronologicallySortedUpcomingSlots = upcomingSlots.sort((a, b) => {
      const timeA = new Date(a.date).setHours(a.hour, a.minutes);
      const timeB = new Date(b.date).setHours(b.hour, b.minutes);
      return timeA - timeB;
    });

    // Get all lessons for the course
    const courseLessons = allLessons
      ? [...allLessons].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
      : [];

    // Find the next lesson number after completed lessons. Completed demos are
    // treated as the course's first lesson(s), so scheduling starts after them
    // (e.g. lessons 2..10 for a 10-lesson course + 1 demo).
    const maxCompletedLessonNumber = Math.max(
      ...completedLessons.map(
        (s) => courseLessons.find((l) => l.id === s.lesson_id)?.number ?? 0,
      ),
      0,
      demoLessonOffset,
    );

    // Get available lessons for upcoming slots
    // IMPORTANT: For reschedule/lesson10 requests, ONLY use the lessons being rescheduled (from request.lesson_ids)
    // For new schedule requests, use all lessons after the completed ones
    const isRescheduleRequest =
      request.type === "reschedule" || request.type === "lesson10";

    const availableLessons = courseLessons.filter((l) => {
      // For reschedule/lesson10 requests, only include lessons that are being rescheduled
      if (isRescheduleRequest) {
        return request.lesson_ids.includes(l.id);
      }

      // For new schedule requests, filter by completed lesson number
      const lessonNumber = l.number ?? 0;
      // If no completed lessons, include all lessons
      if (maxCompletedLessonNumber === 0) {
        return true;
      }
      // Otherwise, include only lessons after the last completed one
      return lessonNumber > maxCompletedLessonNumber;
    });

    console.log(
      "╔════════════════════════════════════════════════════════════════╗",
    );
    console.log(
      "║              RESCHEDULE DEBUG - CRITICAL INFO                  ║",
    );
    console.log(
      "╠════════════════════════════════════════════════════════════════╣",
    );
    console.log("║ REQUEST INFO:");
    console.log("║   request.id:", request.id);
    console.log("║   request.type:", request.type);
    console.log("║   request.learner_id:", request.learner_id);
    console.log("║   request.lesson_ids:", JSON.stringify(request.lesson_ids));
    console.log(
      "╠════════════════════════════════════════════════════════════════╣",
    );
    console.log("║ CONDITION CHECK:");
    console.log(
      "║   isRescheduleRequest (request.type === 'reschedule'):",
      isRescheduleRequest,
    );
    console.log(
      "╠════════════════════════════════════════════════════════════════╣",
    );
    console.log("║ COURSE LESSONS (all lessons in course):");
    courseLessons.forEach((l, i) => {
      const isInRequest = request.lesson_ids.includes(l.id);
      console.log(
        `║   [${i}] id: ${l.id}, number: ${l.number} ${isInRequest ? "← IN REQUEST" : ""}`,
      );
    });
    console.log(
      "╠════════════════════════════════════════════════════════════════╣",
    );
    console.log(
      "║ AVAILABLE LESSONS (for reschedule: should ONLY be from request.lesson_ids):",
    );
    console.log("║   availableLessons count:", availableLessons.length);
    if (availableLessons.length === 0) {
      console.log("║   ⚠️ WARNING: availableLessons is EMPTY!");
    }
    availableLessons.forEach((l, i) => {
      console.log(`║   [${i}] id: ${l.id}, number: ${l.number}`);
    });
    console.log(
      "╠════════════════════════════════════════════════════════════════╣",
    );
    console.log("║ MATCHING CHECK:");
    request.lesson_ids.forEach((reqId, i) => {
      const found = courseLessons.find((l) => l.id === reqId);
      const inAvailable = availableLessons.find((l) => l.id === reqId);
      console.log(`║   request.lesson_ids[${i}] = "${reqId}"`);
      console.log(
        `║     → In courseLessons: ${found ? `YES (number: ${found.number})` : "NO ⚠️"}`,
      );
      console.log(
        `║     → In availableLessons: ${inAvailable ? `YES (number: ${inAvailable.number})` : "NO ⚠️"}`,
      );
    });
    console.log(
      "╚════════════════════════════════════════════════════════════════╝",
    );

    // Check if a 9+1 course type (learner doesn't have a driver's license)
    const { data: learner, error: learnerError } = await supabase
      .from("Learner")
      .select("*")
      .eq("id", learnerId)
      .single();

    if (learnerError) {
      console.error("Error fetching learner:", learnerError);
    }

    // Create a map of current lesson assignments
    console.log("Creating map of current lesson assignments...");

    // Get all existing schedules including ones being rescheduled
    const allExistingSchedules = [
      ...existingCourseSchedules,
      ...(schedulesToChange || []),
    ];

    // Create a map to store lesson ID -> {lessonNumber, schedule}
    const currentLessonMap = new Map();

    // Populate the map with all lesson information
    allExistingSchedules.forEach((schedule) => {
      if (!schedule.lesson_id) return;

      const lesson = courseLessons.find((l) => l.id === schedule.lesson_id);
      if (lesson && lesson.number !== undefined) {
        currentLessonMap.set(schedule.lesson_id, {
          lessonId: schedule.lesson_id,
          currentNumber: lesson.number,
          schedule: schedule,
        });
      }
    });

    // Sort available lessons by number for sequential assignment
    const sortedAvailableLessons = [...availableLessons].sort(
      (a, b) => (a.number ?? 0) - (b.number ?? 0),
    );

    // Count only NEW slots for proper lesson assignment
    const newSlotsOnly = chronologicallySortedUpcomingSlots.filter(
      (s) => s.isNew,
    );
    const totalNewSlots = newSlotsOnly.length;

    // Debug logging for scheduling
    console.log("=== SCHEDULING DEBUG ===");
    console.log("Total course lessons:", courseLessons.length);
    console.log("Max completed lesson number:", maxCompletedLessonNumber);
    console.log("Available lessons count:", availableLessons.length);
    console.log(
      "Available lesson numbers:",
      sortedAvailableLessons.map((l) => l.number),
    );
    console.log("Total NEW slots to schedule:", totalNewSlots);
    console.log("========================");

    // Track which new slot index we're at
    let newSlotCounter = 0;

    const schedulesWithIds = chronologicallySortedUpcomingSlots.map(
      (slot, index) => {
        // For existing slots (not new), preserve their existing lesson assignment
        if (!slot.isNew && "lessonId" in slot && slot.lessonId) {
          const existingLesson = courseLessons.find(
            (l) => l.id === slot.lessonId,
          );
          return {
            date: slot.date,
            hour: slot.hour,
            minutes: slot.minutes,
            instructorId: slot.instructorId,
            lessonId: slot.lessonId,
            lessonNumber: existingLesson?.number ?? 0,
            isNew: slot.isNew,
          };
        }

        // Get the current new slot index and increment by duration
        // A 2hr slot consumes 2 lessons
        const currentNewSlotIndex = newSlotCounter;
        const slotDuration = ("duration" in slot ? slot.duration : 1) || 1;
        newSlotCounter += slotDuration;

        // For all cases, assign lessons by position in the sorted available lessons list
        // This handles both sequential (1,2,3...) and non-sequential lesson numbering
        const lesson = sortedAvailableLessons[currentNewSlotIndex];

        console.log(`=== ASSIGNING LESSON TO NEW SLOT ===`);
        console.log(`  New slot date: ${slot.date}`);
        console.log(`  currentNewSlotIndex: ${currentNewSlotIndex}`);
        console.log(
          `  sortedAvailableLessons.length: ${sortedAvailableLessons.length}`,
        );
        console.log(
          `  sortedAvailableLessons:`,
          sortedAvailableLessons.map((l) => ({ id: l.id, number: l.number })),
        );
        console.log(
          `  Assigned lesson: ${lesson ? `id=${lesson.id}, number=${lesson.number}` : "NONE"}`,
        );
        console.log(`====================================`);

        if (!lesson) {
          console.error(
            `No available lesson found for new slot index ${currentNewSlotIndex}. ` +
              `Available lessons: ${sortedAvailableLessons.length}, Total new slots: ${totalNewSlots}`,
          );
        }

        return {
          date: slot.date,
          hour: slot.hour,
          minutes: slot.minutes,
          instructorId: slot.instructorId,
          lessonId: lesson?.id ?? "",
          lessonNumber: lesson?.number ?? 0,
          duration: slotDuration,
          isNew: slot.isNew,
        };
      },
    );

    // Create a map of the NEW lesson numbers
    const newLessonNumberMap = new Map();

    schedulesWithIds.forEach((schedule) => {
      if (schedule.lessonId) {
        newLessonNumberMap.set(schedule.lessonId, {
          lessonNumber: schedule.lessonNumber,
          date: schedule.date,
          hour: schedule.hour,
          minutes: schedule.minutes,
        });
      }
    });

    // Identify lessons whose numbers or timings have changed
    const lessonIdsWithChanges = [];

    // Check each lesson in the current map against its new assignment
    currentLessonMap.forEach((data, lessonId) => {
      const newAssignment = newLessonNumberMap.get(lessonId);

      // Only include lessons that are still in the upcoming schedule
      if (newAssignment) {
        // Check if the number changed or the timing changed
        const oldDate = new Date(data.schedule.date);
        const oldHour = parseInt(data?.schedule?.start_time?.split(":")[0]);
        const oldMinutes = parseInt(
          data?.schedule?.start_time?.split(":")[1] || "0",
        );

        const newDate = newAssignment.date;
        const newHour = newAssignment.hour;
        const newMinutes = newAssignment.minutes;

        const numberChanged = data.currentNumber !== newAssignment.lessonNumber;
        const timingChanged =
          oldDate.toDateString() !== newDate.toDateString() ||
          oldHour !== newHour ||
          oldMinutes !== newMinutes;

        if (numberChanged || timingChanged) {
          console.log(
            `Lesson ${lessonId} at ${data.schedule.date} ${data.schedule.start_time} has changes: number change=${numberChanged}, timing change=${timingChanged}`,
          );
          lessonIdsWithChanges.push(lessonId);
        }
      }
    });

    // Get schedules that were explicitly requested to be rescheduled
    const schedulesToCancel = schedulesToChange || [];

    // Filter out only the schedules that need to be created/updated
    // IMPORTANT: Only include schedules for lessons that are EXPLICITLY being rescheduled
    // Do NOT include lessons just because their number changed - those should keep their original schedule
    console.log("=== RESCHEDULE DEBUG ===");
    console.log("request.lesson_ids:", request.lesson_ids);
    console.log("schedulesWithIds:", schedulesWithIds);
    console.log(
      "schedulesWithIds with isNew:",
      schedulesWithIds.filter((s) => s.isNew),
    );

    const schedulesToUpdate = schedulesWithIds.filter((schedule) => {
      // Include if it's a new slot (admin selected new time slots for the reschedule)
      if (schedule.isNew) return true;

      // Include if it's one of the lessons being explicitly rescheduled
      // This preserves existing schedule slots that are part of the reschedule request
      if (schedule.lessonId && request.lesson_ids.includes(schedule.lessonId))
        return true;

      return false;
    });

    console.log("schedulesToUpdate:", schedulesToUpdate);
    console.log("========================");

    // Create final schedules array
    const finalSchedules = schedulesToUpdate
      .filter((schedule) => schedule.lessonId) // Only include schedules with valid lesson IDs
      .map((schedule) => {
        // Format the start_time correctly with hours and minutes
        const formattedHour = String(schedule.hour).padStart(2, "0");
        const formattedMinutes = String(schedule.minutes || 0).padStart(2, "0");
        // Calculate end time based on duration (1 or 2 hours)
        const dur = ("duration" in schedule ? schedule.duration : 1) || 1;
        const startTotalMinutes = schedule.hour * 60 + (schedule.minutes || 0);
        const endTotalMinutes = startTotalMinutes + dur * 60;
        const endHour = Math.floor(endTotalMinutes / 60) % 24;
        const endMinutes = endTotalMinutes % 60;

        return {
          date: schedule.date,
          hour: schedule.hour,
          instructorId: schedule.instructorId,
          lessonId: schedule.lessonId,
          lessonNumber: schedule.lessonNumber,
          start_time: `${formattedHour}:${formattedMinutes}:00`,
          end_time: `${String(endHour).padStart(2, "0")}:${String(endMinutes).padStart(2, "0")}:00`,
          status: "booked",
          otp: generateRandomOTP(),
          otp_end: generateRandomOTP(),
          calendar_uid: "", // Will be populated for schedules only
          duration: dur,
        };
      });

    console.log("========== FINAL SCHEDULES TO CREATE ==========");
    console.log("finalSchedules count:", finalSchedules.length);
    finalSchedules.forEach((s, i) => {
      console.log(
        `  [${i}] date: ${s.date}, lessonId: ${s.lessonId}, lessonNumber: ${s.lessonNumber}`,
      );
    });
    console.log(
      "These lesson IDs will be DELETED and recreated with new dates",
    );
    console.log("================================================");

    // STEP 1 (real): Save schedules to the database FIRST, before any
    // calendar-invite preparation. The pre-existing flow nominally claimed
    // to do this, but the actual onScheduleCreate call lived ~200 lines
    // deep inside the calendar-prep try block, so any earlier failure
    // (e.g. instructor fetch returning an error and `return`-ing) would
    // silently kill the DB write. Demo learners hit this path because
    // their lessons are virtual placeholders, which can confuse downstream
    // calendar-event construction.
    try {
      console.log("Creating schedules in the database first...");
      await onScheduleCreate(finalSchedules, courseIdToPass);
    } catch (error) {
      console.error("Failed to save schedules:", error);
      // The mutation threw; toast was raised by the parent handler. Don't
      // proceed to calendar invites for schedules that don't exist.
      return;
    }

    setIsSendingInvites(true);
    try {
      // Fetch learner details
      const { data: learnerData } = await supabase
        .from("Learner")
        .select(
          "email, pick_up_location, address_lat, address_lng, name,phone,id",
        )
        .eq("id", learnerId)
        .single();

      if (!learnerData?.email) {
        console.warn("Learner has no email — calendar invites will be skipped");
      }

      // Create a map to track which lesson IDs are being rescheduled
      const rescheduledLessonIds = new Set(request.lesson_ids);

      // Map to store calendar UIDs from cancelled lessons to reuse
      const lessonIdToCalendarUid = new Map();
      const lessonIdToSequence = new Map();

      // First, collect all the calendar UIDs from lessons being rescheduled
      for (const scheduleToCancel of schedulesToCancel) {
        if (scheduleToCancel.lesson_id && scheduleToCancel.calendar_uid) {
          lessonIdToCalendarUid.set(
            scheduleToCancel.lesson_id,
            scheduleToCancel.calendar_uid,
          );
          lessonIdToSequence.set(
            scheduleToCancel.lesson_id,
            scheduleToCancel.calendar_sequence || 0,
          );
        }
      }

      // Fetch all instructor details we'll need
      const instructorIds = new Set(finalSchedules.map((s) => s.instructorId));
      // console.log("instructor ids ", instructorIds, finalSchedules);
      const { data: instructorsData, error: instructorsError } = await supabase
        .from("Instructor")
        .select("id_instructor, name, email, phone")
        .in("id_instructor", Array.from(instructorIds));

      if (instructorsError) {
        console.error("Error fetching instructors:", instructorsError);
        return;
      }

      // Create a map of instructor details for easy lookup
      const instructorsMap = new Map();
      instructorsData?.forEach((instructor) => {
        instructorsMap.set(instructor.id_instructor, instructor);
      });

      // Prepare cancellation events for all affected lessons
      const cancellationEvents = [];

      // 1. Process explicitly requested reschedules
      for (const scheduleToCancel of schedulesToCancel) {
        // Skip if no calendar UID (can't cancel what wasn't in the calendar)
        if (!scheduleToCancel.calendar_uid || !scheduleToCancel.lesson_id) {
          continue;
        }

        // Create start and end date objects for the cancelled lesson
        const startDate = new Date(scheduleToCancel.date);
        const [startHour, startMinute] = scheduleToCancel.start_time
          .split(":")
          .map(Number);
        startDate.setHours(startHour, startMinute, 0);

        const endDate = new Date(scheduleToCancel.date);
        const [endHour, endMinute] = scheduleToCancel.end_time
          .split(":")
          .map(Number);
        endDate.setHours(endHour, endMinute, 0);

        // Get lesson details
        const { data: lessonData } = await supabase
          .from("Lesson")
          .select("number, id")
          .eq("id", scheduleToCancel.lesson_id)
          .single();

        // Get instructor details for this cancelled lesson
        const instructorId = scheduleToCancel.instructor_id;
        const instructorDetails = instructorsMap.get(instructorId) || {
          name: "Unknown Instructor",
          phone: "Contact InLane for details",
          email: "",
        };

        // Determine pickup location
        const pickupLocation =
          learnerData.pick_up_location ||
          (learnerData.address_lat && learnerData.address_lng
            ? `${learnerData.address_lat},${learnerData.address_lng}`
            : "To be confirmed");

        console.log(
          `Cancelling lesson ${scheduleToCancel.lesson_id}, lesson number ${lessonData?.number || scheduleToCancel.lesson_number}`,
        );
        cancellationEvents.push({
          startTime: startDate,
          endTime: endDate,
          lessonNumber: lessonData?.number || scheduleToCancel.lesson_number,
          pickupLocation: pickupLocation,
          uid: scheduleToCancel.calendar_uid,
          sequence: (scheduleToCancel.calendar_sequence || 0) + 1,
          isCancellation: true,
          instructorId: instructorId,
          instructorName: instructorDetails.name,
          instructorPhone: instructorDetails.phone,
          instructorEmail: instructorDetails.email,
        });
      }

      // NOTE: We no longer send cancellation events for lessons that only have number changes
      // but weren't explicitly rescheduled. Those lessons keep their original schedule,
      // so we shouldn't send any calendar updates for them.

      console.log(`Total cancellation events: ${cancellationEvents.length}`);

      // Prepare new/updated events
      const newEvents = finalSchedules.map((schedule) => {
        // Get matching lesson being rescheduled (if any)
        const matchingLesson = courseLessons.find(
          (l) => l.id === schedule.lessonId,
        );

        const matchingLessonId = matchingLesson?.id;

        // Create start and end date objects
        const startDate = new Date(schedule.date);
        const [startHour, startMinute] = schedule.start_time
          .split(":")
          .map(Number);
        startDate.setHours(startHour, startMinute, 0);

        const endDate = new Date(schedule.date);
        const [endHour, endMinute] = schedule.end_time.split(":").map(Number);
        endDate.setHours(endHour, endMinute, 0);

        // Get instructor details for this lesson
        const instructorDetails = instructorsMap.get(schedule.instructorId) || {
          name: "Unknown Instructor",
          phone: "Contact InLane for details",
          email: "",
        };

        // Determine pickup location
        const pickupLocation =
          learnerData.pick_up_location ||
          (learnerData.address_lat && learnerData.address_lng
            ? `${learnerData.address_lat},${learnerData.address_lng}`
            : "To be confirmed");

        // Determine if this is a rescheduled event
        // Only consider explicitly rescheduled lessons, not lessons with just number changes
        const isRescheduled =
          matchingLessonId && rescheduledLessonIds.has(matchingLessonId);

        const sequenceNumber = isRescheduled
          ? (lessonIdToSequence.get(matchingLessonId) || 0) + 1
          : 0;

        return {
          startTime: startDate,
          endTime: endDate,
          lessonNumber: schedule.lessonNumber,
          pickupLocation: pickupLocation,
          uid: undefined,
          sequence: sequenceNumber,
          isCancellation: false,
          instructorId: schedule.instructorId,
          instructorName: instructorDetails.name,
          instructorPhone: instructorDetails.phone,
          instructorEmail: instructorDetails.email,
        };
      });

      // Combine all events (cancellations and new/updated)
      const allEvents = [...cancellationEvents, ...newEvents];

      // STEP 2: SEND CALENDAR INVITES (only if both instructor and learner have emails)
      // Schedules were already saved above before this try block ran.
      if (allEvents.length > 0 && learnerData?.email) {
        console.log(
          `Sending ${allEvents.length} calendar events (${cancellationEvents.length} cancellations, ${newEvents.length} new/updated)`,
        );
        const primaryInstructorEmail =
          instructorsData && instructorsData.length > 0
            ? instructorsData[0].email
            : "";
        if (!primaryInstructorEmail) {
          console.warn(
            "Skipping calendar invites — instructor has no email",
            instructorsData,
          );
        } else {
          // Wait a moment to ensure database write is complete
          await new Promise((resolve) => setTimeout(resolve, 1000));

          console.log("Now sending calendar invites...");

          try {
            // SEND CANCELLATION EVENTS FIRST (if any)
            if (cancellationEvents.length > 0) {
              console.log(
                `Sending ${cancellationEvents.length} cancellation events`,
              );
              try {
                await sendMultiEventCalendarInvite(
                  `${learnerData.email}`,
                  primaryInstructorEmail,
                  cancellationEvents,
                  instructorsData[0]?.name || "Your Instructor",
                  learnerData.name || "Student",
                  learnerData.phone,
                  "cancellation",
                  learnerData.id,
                );
              } catch (cancelError) {
                console.error(
                  "Error sending cancellation events:",
                  cancelError,
                );
              }
            }

            // THEN SEND NEW EVENTS
            if (newEvents.length > 0) {
              console.log(`Sending ${newEvents.length} new events`);
              try {
                const uidMap = await sendMultiEventCalendarInvite(
                  `${learnerData.email}`,
                  primaryInstructorEmail,
                  newEvents,
                  instructorsData[0]?.name || "Your Instructor",
                  learnerData.name || "Student",
                  learnerData.phone,
                  "new",
                  learnerData.id,
                );

                // Update database with calendar UIDs if we got them back
                if (uidMap) {
                  console.log("Updating schedules with calendar UIDs");
                  for (const schedule of finalSchedules) {
                    if (uidMap[schedule.lessonNumber]) {
                      await supabase
                        .from("Schedule")
                        .update({
                          calendar_uid: uidMap[schedule.lessonNumber],
                          calendar_sequence: 0, // Reset sequence for new UIDs
                        })
                        .eq("lesson_id", schedule.lessonId);
                    }

                    // if it lesson 10, set the flag has_lesson10_booked
                    if (schedule.lessonNumber == 10) {
                      console.log("Setting lesson10 booked for learner");
                      await supabase
                        .from("Learner")
                        .update({
                          has_lesson10_booked: true,
                        })
                        .eq("id", learnerData.id);
                    }
                  }
                }
              } catch (newEventError) {
                console.error("Error sending new events:", newEventError);
              }
            }
          } catch (error) {
            console.error("Error handling calendar invites:", error);
          }
        }
      }
    } catch (error) {
      // Calendar-invite preparation failed, but schedules are already saved
      // (onScheduleCreate ran before this try block). Surface the error in
      // the console so devs can investigate, but don't block the user — the
      // booking is real, calendar invites are best-effort.
      console.error("Error in handleCreateSchedule (post-save):", error);
    } finally {
      // Always reset loading state when done
      setIsSendingInvites(false);
    }
  };

  // Utility function to group array items by a key
  function groupBy<T>(array: T[], keyFn: (item: T) => string) {
    return array.reduce((result: Record<string, T[]>, item) => {
      const key = keyFn(item);
      if (!result[key]) {
        result[key] = [];
      }
      result[key].push(item);
      return result;
    }, {});
  }

  const getSlotColor = (slot: HourlySlot) => {
    // console.trace("getSlotColor called for slot:", slot, slot.state)
    // console.log("schedulesToChange", schedulesToChange);
    if (!slot.timeSlot) return "bg-gray-50";

    const dateStr = format(slot.timestamp, "yyyy-MM-dd");
    const hour = slot.timestamp.getHours();
    const minutes = slot.timestamp.getMinutes();
    const isToday = isSameDay(slot.timestamp, new Date());
    const isInPast = false;

    const checkSlotOverlap = (s: Schedule) => {
      const scheduleStartHour = parseInt(s.start_time.split(":")[0]);
      const scheduleStartMinute = parseInt(s.start_time.split(":")[1] || "0");
      const scheduleEndHour = parseInt(s.end_time.split(":")[0]);

      return (
        s.date === dateStr &&
        // Check if the current time is between the start and end times
        ((hour === scheduleStartHour && minutes >= scheduleStartMinute) ||
          (hour === scheduleEndHour &&
            minutes < parseInt(s.end_time.split(":")[1] || "0")) ||
          (hour > scheduleStartHour && hour < scheduleEndHour))
      );
    };

    // Check if this slot or the adjacent slot (to make a full hour) is selected
    const isSelected =
      minutes === 0
        ? selectedSlots.some(
            (s) =>
              format(s.date, "yyyy-MM-dd") === dateStr &&
              s.hour === hour &&
              s.minutes === 0,
          )
        : selectedSlots.some(
            (s) =>
              format(s.date, "yyyy-MM-dd") === dateStr &&
              s.hour === hour &&
              s.minutes === 30,
          );

    // Check if this slot is part of a current schedule to be rescheduled
    const isCurrentSchedule = schedulesToChange?.some((s) => {
      if (s?.isTentative) return false; // Ignore tentative schedules for current schedule check
      const scheduleStartHour = parseInt(s?.start_time?.split(":")[0]);
      const scheduleStartMinute = parseInt(s?.start_time?.split(":")[1] || "0");
      const scheduleEndHour = parseInt(s?.end_time?.split(":")[0]);

      // Check if this slot falls within the scheduled time
      return (
        s.date === dateStr &&
        // Check if the current time is between the start and end times
        ((hour === scheduleStartHour && minutes >= scheduleStartMinute) ||
          (hour === scheduleEndHour &&
            minutes < parseInt(s.end_time.split(":")[1] || "0")) ||
          (hour > scheduleStartHour && hour < scheduleEndHour))
      );
    });
    // Check if this slot is part of another existing learner schedule
    const isLearnerSchedule = existingSchedules?.some((s) => {
      if (!s.isTentative) {
        if (
          s.learner_id !== learnerId ||
          request.lesson_ids.includes(s.lesson_id ?? "")
        ) {
          return false;
        }

        const scheduleStartHour = parseInt(s.start_time.split(":")[0]);
        const scheduleStartMinute = parseInt(s.start_time.split(":")[1] || "0");
        const scheduleEndHour = parseInt(s.end_time.split(":")[0]);

        // Check if this slot falls within the scheduled time
        return (
          s.date === dateStr &&
          // Check if the current time is between the start and end times
          ((hour === scheduleStartHour && minutes >= scheduleStartMinute) ||
            (hour === scheduleEndHour &&
              minutes < parseInt(s.end_time.split(":")[1] || "0")) ||
            (hour > scheduleStartHour && hour < scheduleEndHour))
        );
      }
      return false;
    });
    const isAtleastOneTentativeForLearnerForSlot = existingSchedules?.some(
      (s) => {
        if (!selectedInstructorId) return false;
        if (
          !checkSlotOverlap(s) ||
          !s?.isTentative ||
          s?.instructor_id != selectedInstructorId
        )
          return false;
        // if (s.id === 1207) console.log("showing all ids ", s.id);
        return s.learner_id === learnerId || s.isTentative;
      },
    );

    const isOnlyTentativeSchedulesForSlotForLearner = schedulesToChange.every(
      (s) => {
        if (!checkSlotOverlap(s)) return true;
        return s.learner_id != learnerId || s.isTentative;
      },
    );
    // Check if this slot is unavailable due to other schedules
    const hasExistingSchedule =
      selectedInstructorId &&
      otherSchedules?.some(
        (s) =>
          s.isTentative === false &&
          s.instructor_id === selectedInstructorId &&
          s.date === dateStr &&
          // Check if the current time is between the start and end times
          ((hour === parseInt(s.start_time.split(":")[0]) &&
            minutes >= parseInt(s.start_time.split(":")[1] || "0")) ||
            (hour === parseInt(s.end_time.split(":")[0]) &&
              minutes < parseInt(s.end_time.split(":")[1] || "0")) ||
            (hour > parseInt(s.start_time.split(":")[0]) &&
              hour < parseInt(s.end_time.split(":")[0]))),
      );

    // coloring priority - Past , Learner state, instructor state, learner tentative, learner previous preferences
    if (isInPast) return "bg-gray-400"; // Add a distinct color for past slots
    if (isLearnerSchedule) return "bg-blue-200";
    if (isCurrentSchedule) return "bg-yellow-200";
    if (!slot.state.isAvailable && !slot.state.isCurrentInstrUnavailable)
      return "bg-gray-300";
    if (isSelected) return "bg-primary";
    if (selectedInstructorId && slot.state.isCurrentInstrUnavailable)
      return "bg-gray-300";
    if (hasExistingSchedule) return "bg-gray-300"; // Instructor has other schedule
    if (isAtleastOneTentativeForLearnerForSlot) return "bg-orange-200"; // Tentative schedules are prefferred over onboarding preferences
    if (slot.state.isPreferred) return "bg-primary/30";
    return "bg-white";
  };

  // Format the time for display
  const formatTimeDisplay = (timestamp: Date) => {
    return format(timestamp, "h:mm a");
  };

  return (
    <div className="w-full space-y-4">
      {/* Show alert for reschedule requests */}
      {request.type === "reschedule" && lessons && lessons.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-amber-100 p-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 text-amber-600"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-amber-800">
                Reschedule Request
              </h3>
              <p className="mt-1 text-sm text-amber-700">
                Rescheduling{" "}
                <span className="font-bold">
                  Lesson {lessons.map((l) => l.number).join(", ")}
                </span>
                {schedulesToChange && schedulesToChange.length > 0 && (
                  <span>
                    {" "}
                    from{" "}
                    <span className="font-medium">
                      {format(
                        new Date(schedulesToChange[0]?.date ?? ""),
                        "MMM d, yyyy",
                      )}
                      {" at "}
                      {schedulesToChange[0]?.start_time?.substring(0, 5)}
                    </span>
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs text-amber-600">
                Select new time slot(s) below for the lesson(s)
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Show lesson 10 request info */}
      {request.type === "lesson10" && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-blue-100 p-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 text-blue-600"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-blue-800">
                Lesson 10 Scheduling Request
              </h3>
              <p className="mt-1 text-sm text-blue-700">
                Schedule the <span className="font-bold">10th lesson</span> for
                this learner
              </p>
              <p className="mt-1 text-xs text-blue-600">
                Select a time slot below for Lesson 10
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => handleDateChange("prev")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="font-medium">
            {format(startDate, "MMM d")} -{" "}
            {format(addDays(startDate, 6), "MMM d, yyyy")}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => handleDateChange("next")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="relative">
        <div className="mt-4 flex space-x-4">
          {Array.from({ length: 7 }).map((_, index) => {
            // console.log('%c ~ file: CreateSchedule.tsx:2725 index=%d: ', 'color: #c0f89c', index);
            const date = addDays(startDate, index);
            const daySchedule = calculateDaySchedule(date);
            // console.log("daySchedule", daySchedule);
            return (
              <Card key={index} className="w-[120px] flex-shrink-0">
                <CardContent className="p-4">
                  <div className="mb-3 text-sm font-medium">
                    {format(date, "EEE, MMM d")}
                  </div>
                  <div className="space-y-2">
                    {daySchedule.map((slot, idx) => (
                      <button
                        key={idx}
                        className={`h-10 w-full rounded ${getSlotColor(slot)} hover:opacity-80 ${
                          !slot.timeSlot ? "cursor-default" : "cursor-pointer"
                        }`}
                        onClick={() => handleSlotClick(date, slot)}
                        title={
                          slot.timestamp
                            ? `${formatTimeDisplay(slot.timestamp)} ${
                                slot.state.existingSchedule
                                  ? `- Scheduled for ${slot.state.existingSchedule.learner_name}`
                                  : ""
                              }`
                            : undefined
                        }
                      >
                        {formatTimeDisplay(slot.timestamp)}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded bg-primary/30" />
            <span>Preferred</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded bg-primary" />
            <span>Selected</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded bg-yellow-200" />
            <span>Reschedule Requests</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded bg-blue-200" />
            <span>Scheduled Lessons</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded bg-gray-300" />
            <span>Unavailable</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded bg-gray-400" />
            <span>Past Time </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded bg-orange-200" />
            <span>Tentative Schedule</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-500"></div>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="text-md flex flex-col text-gray-500">
          <span>
            Selected: {selectedSlots.length / 2} of {requiredLessonCount} hours
          </span>
        </div>
        <Button
          onClick={async () => {
            await handleCreateSchedule();
            window.location.reload();
          }}
          disabled={
            selectedSlots.length / 2 !== requiredLessonCount || isSendingInvites
          }
          className="whitespace-nowrap"
        >
          {isSendingInvites ? (
            <>
              <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
              Sending Invites...
            </>
          ) : (
            "Create Schedule"
          )}
        </Button>
      </div>

      <Dialog
        open={!!scheduleDetails}
        onOpenChange={() => setScheduleDetails(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule Details</DialogTitle>
          </DialogHeader>
          {scheduleDetails && (
            <div className="space-y-4">
              <div>
                <div className="font-medium">
                  {scheduleDetails.learner_name}
                </div>
                <div className="text-sm text-gray-500">
                  {scheduleDetails.learner_area}
                </div>
              </div>
              <div className="flex items-start gap-2">
                <MapPin className="mt-1 h-4 w-4 text-gray-500" />
                <div>
                  <div className="text-sm">
                    {scheduleDetails.pickup_address}
                  </div>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${scheduleDetails.latitude},${scheduleDetails.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline"
                  >
                    View on Google Maps
                  </a>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Render the instructor selection dialog */}
      <EnhancedInstructorSelectionDialog
        open={selectionDialogOpen}
        onClose={() => setSelectionDialogOpen(false)}
        slot={selectedSlot}
        date={selectedDate}
        instructorsWithDistance={instructorsWithDistance}
        otherSchedules={otherSchedules}
        onConfirm={handleInstructorSelect}
      />
    </div>
  );
}

// Update the TimeSlotSelectionDialogProps interface
interface TimeSlotSelectionDialogProps {
  open: boolean;
  onClose: () => void;
  slot: HourlySlot | null;
  date: Date | null;
  instructorsWithDistance: InstructorWithDistance[];
  otherSchedules: any[];
  onConfirm: (instructorId: string, duration: number) => void;
  learnerDetails: {
    // Add proper type definition
    address_lat: number;
    address_lng: number;
  };
}
