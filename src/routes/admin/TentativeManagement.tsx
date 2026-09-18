import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format, formatDate, parse, subDays } from "date-fns";
import {
  Delete,
  Filter,
  RefreshCcw,
  Search,
  Send,
  Trash2,
  UserPlus,
} from "lucide-react";
import { ArrowLeft } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { supabase } from "@/lib/supabaseClient";

import Schedule from "../schedule";
import { IncompletePaymentsCard } from "./IncompletePaymentsCard";

const TENTATIVE_CUSTOMERS_PAGE_SIZE = 10;

type TentativeCustomerPage = {
  customers: {
    groupId: string;
    schedulesStartDate: string;
    schedulesStartTime: string;
    schedules: {
      id: number;
      date: string;
      start_time: string;
      end_time: string;
      tentative_details: {
        name?: string;
        email?: string;
        pickup_location?: string;
        leadName?: string;
        description?: string;
      };
    }[];
  }[];
  total_count: number;
  page: number;
};

function TentativeSchedules() {
  const [learnerData, setLearnerData] = useState({
    name: "",
    email: "",
    phone: "",
    courseId: "",
    courseName: "",
    amount: 0,
    installmentType: "installment", // Default to installment
    installment1Amount: 0,
    installment2Amount: 0,
    unlockedLessons: [],
    has_a_DL: false,
    address_change_required: false,
  });

  const [searchQuery, setSearchQuery] = useState("");

  const navigate = useNavigate();

  return (
    <div
      className="min-h-screen bg-white p-8"
      style={{
        backgroundImage: 'url("/assets/bg_pattern.svg")',
        backgroundRepeat: "repeat",
        backgroundSize: "cover",
        backgroundAttachment: "fixed", // This prevents the background from getting cut off
      }}
    >
      <div className="container mx-auto">
        <div className="mb-8">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/admin")}
            className="h-10 w-10"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-4xl font-bold tracking-tight">
            Tentative Schedule Management
          </h1>
          <p className="mt-2 text-lg text-muted-foreground">
            Tentative schedules search
          </p>
        </div>
        <div className="mb-6">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <Input
                placeholder="Search by name, phone, email or area..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button variant="outline" className="gap-2">
              <Filter className="h-4 w-4" />
              Filter
            </Button>
          </div>
        </div>
        <div className="grid gap-6">
          {/* Class Schedule */}
          <LearnerNotificationCard />
        </div>
      </div>
    </div>
  );
}

function LearnerNotificationCard() {
  const [incompletePayments, setIncompletePayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [schedulesList, setSchedulesList] = useState([]);
  const [reschduleFinalTimeSetDialogOpen, setReschduleFinalTimeSetDialogOpen] =
    useState(false);
  const [rescheduleFinalTime, setRescheduleFinalTime] = useState("");

  const maxDaysWindowToFetch = 1;
  // Array of status of each sending event
  // Each state corresponsds to reminder type
  // Each state's is an array corresponding to the number of schedules
  const [
    sendingLearnerLessonReminderStatuses,
    setSendingLearnerLessonReminderStatuses,
  ] = useState({});
  const [
    sendingLearnerReschdWindowReminderStatuses,
    setSendingLearnerReschdWindowReminderStatuses,
  ] = useState({});
  const [
    sendingInstrLessonReminderStatuses,
    setSendingInstrLessonReminderStatuses,
  ] = useState({});

  const { toast } = useToast();

  const fetchSchedulesForReminder = async () => {
    const startDate = new Date();
    const endDate = addDays(startDate, maxDaysWindowToFetch);
    setLoading(true);
    try {
      // Query to get schedules of next maxDaysWindowToFetch days
      const { data, error } = await supabase
        .from("Schedule")
        .select(
          `
          *,
          Learner(name, phone, pick_up_location), 
          Courses(name, duration), 
          Lesson(description)`,
        )
        .gte("date", startDate.toISOString().split("T")[0])
        .eq("isTentative", true)
        .order("date", { ascending: true })
        .order("start_time", { ascending: true });

      console.log(data);
      if (error) throw error;

      setSchedulesList(data);
      return data;
    } catch (err) {
      console.error("Error fetching schedules:", err);
      toast({
        title: "Error",
        description: "Failed to fetch schedules",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedulesForReminder();
  }, []);

  return (
    <div
      className="min-h-screen bg-gray-50"
      style={{
        backgroundImage: 'url("/assets/bg_pattern.svg")',
        backgroundRepeat: "repeat",
        backgroundSize: "cover",
      }}
    >
      <Card className="mt-6 transition-all hover:shadow-lg">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-xl">
              Tentative schedules from today
            </CardTitle>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={fetchSchedulesForReminder}
            disabled={loading}
          >
            <RefreshCcw size={16} className={loading ? "animate-spin" : ""} />
          </Button>
        </CardHeader>
        <CardContent>
          {}
          {schedulesList.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground">
              {loading
                ? "Loading schedules..."
                : `No tentative schedules found`}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left">Learner</th>
                    <th className="px-2 py-2 text-left">Phone</th>
                    <th className="px-2 py-2 text-right">Date</th>
                    <th className="px-2 py-2 text-center">Booked time</th>
                    <th className="px-2 py-2 text-left">Lead Name</th>
                    <th className="px-2 py-2 text-left">Description</th>
                    <th className="px-2 py-2 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {schedulesList.map((scheduleData) => (
                    <tr
                      key={scheduleData.id}
                      className="border-b hover:bg-muted/50"
                    >
                      <td className="px-2 py-2">
                        <div className="font-medium">
                          {scheduleData.tentative_details?.name || "Unknown"}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <>
                          {scheduleData.tentative_details?.phone ||
                            "Unknown Course"}
                        </>
                      </td>
                      <td className="px-2 py-2 text-right">
                        {scheduleData.date || "Unknown"}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium`}
                        >
                          {
                            // Check if start_time exists before processing
                            scheduleData.start_time
                              ? // Split by colon, take the first two elements (HH and MM), and rejoin.
                                scheduleData.start_time
                                  .split(":")
                                  .slice(0, 2)
                                  .join(":")
                              : "Unknown"
                          }
                          -
                          {
                            // Check if start_time exists before processing
                            scheduleData.end_time
                              ? // Split by colon, take the first two elements (HH and MM), and rejoin.
                                scheduleData.end_time
                                  .split(":")
                                  .slice(0, 2)
                                  .join(":")
                              : "Unknown"
                          }
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <div className="font-medium">
                          {scheduleData.tentative_details?.leadName ||
                            "Unknown"}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="font-medium">
                          {scheduleData.tentative_details?.description ||
                            "Unknown"}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() =>
                            handleDeleteTentative(String(scheduleData.id))
                          }
                          disabled={deletingId === String(scheduleData.id)}
                        >
                          {deletingId === String(scheduleData.id) ? (
                            <RefreshCcw className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function TentativeScheduleInfo2() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [startDate] = useState(
    () => subDays(new Date(), 30).toISOString().split("T")[0],
  );
  const debouncedSearch = useDebouncedValue(searchQuery.toLowerCase());
  const isSearchPending = debouncedSearch !== searchQuery.toLowerCase();
  const [selectedLearner, setSelectedLearner] = useState<LearnerInfo | null>(
    null,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedSchedules, setSelectedSchedules] = useState<any[]>([]);
  const [schedulesDialogOpen, setSchedulesDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Delete tentative schedule mutation
  const deleteTentativeMutation = useMutation({
    mutationFn: async (scheduleId: string) => {
      const { error } = await supabase
        .from("Schedule")
        .delete()
        .eq("id", Number(scheduleId));
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learnersWithTentative"] });
      toast({
        title: "Success",
        description: "Tentative schedule deleted successfully.",
      });
      setDeletingId(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete schedule.",
        variant: "destructive",
      });
      setDeletingId(null);
    },
  });

  const handleDeleteTentative = (scheduleId: string) => {
    if (!scheduleId) {
      toast({
        title: "Error",
        description: "Schedule ID is missing",
        variant: "destructive",
      });
      return;
    }
    setDeletingId(scheduleId);
    deleteTentativeMutation.mutate(scheduleId);
  };

  const handleTentativeShow = (schedules: any[]) => {
    setSelectedSchedules(schedules);
    setSchedulesDialogOpen(true);
  };

  // Select customer groups in the database, then load all slots for that page.
  const {
    data: customerPage,
    isLoading: isLoadingTentativeSchedulesByLearners,
    isFetching,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["learnersWithTentative", startDate, debouncedSearch, page],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .rpc("get_tentative_customers_paginated", {
          p_start_date: startDate,
          p_search: debouncedSearch,
          p_page: page,
        })
        .abortSignal(signal);

      if (error) throw error;
      return data as unknown as TentativeCustomerPage;
    },
    // Search and page reset happen together; wait for the final search term
    // so page 1 is never fetched with the previous search while typing.
    enabled: !isSearchPending,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const schedulesGrouped = customerPage?.customers ?? [];
  const totalCount = customerPage?.total_count ?? 0;
  const totalPages = Math.max(
    1,
    Math.ceil(totalCount / TENTATIVE_CUSTOMERS_PAGE_SIZE),
  );
  const currentPage = customerPage?.page ?? page;
  const isPagePending = isFetching || isSearchPending;

  const handleLearnerSelect = (learner: LearnerInfo) => {
    setSelectedLearner(learner);
    setDialogOpen(true);
  };

  const getTimeAgo = (dateString?: string) => {
    if (!dateString) return "N/A";
    return formatDistanceToNow(new Date(dateString), { addSuffix: true });
  };

  // rendeing helpers
  const getDueAmount = (learner) => {
    console.log("Calculating due amount for learner:", learner);
    if (
      !learner ||
      learner.enrollment == null ||
      learner.enrollment.installment_mode == null ||
      learner.enrollment.amount == null ||
      learner.enrollment.installment1_amount == null
    ) {
      console.log(
        "Insufficient data to calculate due amount.",
        learner?.enrollement,
      );
      return "N/A";
    }
    if (learner.enrollment.installment_mode != "first_half") {
      return "0";
    }
    const dueAmount =
      Number(learner.enrollment.amount) -
      Number(learner.enrollment.installment1_amount);
    return String(dueAmount);
  };

  return (
    <div
      className="h-flex flex min-h-screen flex-col bg-white p-8"
      style={{
        backgroundImage: 'url("/assets/bg_pattern.svg")',
        backgroundRepeat: "repeat",
        backgroundSize: "cover",
      }}
    >
      <div className="border-b bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/admin")}
              className="h-10 w-10"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-2xl font-bold">Tentative Schedules</h1>
          </div>
        </div>
      </div>

      <div className="flex-1 p-6">
        <div className="mb-6">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <Input
                placeholder="Search by name, phone, email or area..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <Button
              variant="outline"
              className="gap-2 transition-all duration-100 active:scale-[0.99] active:shadow-inner"
            >
              <Filter className="h-4 w-4" />
              Filter
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6">
          <Card className="col-span-1">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Customers</CardTitle>
                  <CardDescription>
                    {totalCount} customers found
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {isLoadingTentativeSchedulesByLearners || isSearchPending ? (
                <div className="flex items-center justify-center p-8">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
                </div>
              ) : isError ? (
                <div className="p-8 text-center text-gray-500">
                  <p>Failed to fetch tentative schedules.</p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => refetch()}
                    disabled={isPagePending}
                  >
                    Retry
                  </Button>
                </div>
              ) : schedulesGrouped.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  No customers found matching your search
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {schedulesGrouped.map((schedulesGroup) => {
                    // 1. Safely access the first schedule and its details
                    const firstSchedule = schedulesGroup.schedules?.[0];
                    const details = firstSchedule?.tentative_details;

                    // 2. Use the dedicated groupId property, defaulting to a safe string
                    const groupId =
                      schedulesGroup.groupId || "Unknown Group ID";

                    // Skip rendering if essential details are missing
                    if (!details) return null;

                    return (
                      <div
                        // Use the safe groupId property for the key
                        key={groupId}
                        className="rounded-lg border p-4 transition-colors hover:bg-gray-50"
                      >
                        <div className="flex items-start gap-4">
                          {/* Use groupId for getInitials */}
                          <div className="grid flex-1 grid-cols-1 gap-2 md:grid-cols-4">
                            {/* Column 1: Learner Contact Info (Displaying the GroupId/Name) */}
                            <div>
                              <h3 className="text-lg font-medium">{groupId}</h3>
                              <p className="text-sm">{details.name || "N/A"}</p>
                              <p className="text-sm">
                                <span className="font-medium">Email:</span>{" "}
                                {details.email || "N/A"}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {details.pickup_location || "No area specified"}
                              </p>
                            </div>

                            {/* Column 2: Schedules list and Start Date */}
                            <div>
                              <p className="text-sm font-semibold">
                                {schedulesGroup.schedules.length} Tentative Slot
                                {schedulesGroup.schedules.length > 1 ? "s" : ""}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                Starting from:{" "}
                                {schedulesGroup.schedulesStartDate}{" "}
                                {schedulesGroup.schedulesStartTime.slice(0, 5)}
                              </p>
                              <p className="text-muted-foreground">
                                Lead Name:{" "}
                                {schedulesGroup.schedules[0].tentative_details
                                  .leadName || "N/A"}
                              </p>
                            </div>

                            <div className="space-y-2 md:col-span-2">
                              <p className="border-b pb-1 text-sm font-semibold">
                                Tentative Slots
                              </p>

                              {schedulesGroup.schedules.map((schedule) => {
                                const startTimeDate = parse(
                                  schedule.start_time.slice(0, 5), // Directly use the sliced 'HH:mm' string
                                  "HH:mm",
                                  new Date(), // Base date for parsing the time
                                );
                                const displayStartTime = format(
                                  startTimeDate,
                                  "h:mm a",
                                ); // e.g., "2:30 PM"

                                // 2. Convert End Time (24h string -> 12h formatted string)
                                const endTimeDate = parse(
                                  schedule.end_time.slice(0, 5), // Directly use the sliced 'HH:mm' string
                                  "HH:mm",
                                  new Date(),
                                );
                                const displayEndTime = format(
                                  endTimeDate,
                                  "h:mm a",
                                ); // e.g., "3:45 PM"

                                const displayDate = format(
                                  schedule.date,
                                  "dd MMM yyyy",
                                );
                                return (
                                  <div
                                    key={schedule.id}
                                    className="flex items-center justify-between rounded-md bg-gray-100 p-2 text-xs"
                                  >
                                    <p className="flex-1">
                                      {/* The schedule description and date are now broken into parts to match the new template */}
                                      <span className="font-medium">
                                        {schedule.tentative_details
                                          .description || "N/A"}
                                      </span>
                                      {/* 2. Time Range: "from <start> PM to <end> PM" (Assuming your displayStartTime/EndTime already includes the AM/PM suffix) */}
                                      {/* NOTE: If your 'displayStartTime' already includes 'AM/PM', you would remove the hardcoded 'PM' below. */}
                                      &nbsp; from &nbsp;
                                      {displayStartTime} &nbsp; to &nbsp;
                                      {displayEndTime}
                                      {/* 3. Date: "on DD <month 3 char> Year" */}
                                      &nbsp; on &nbsp;
                                      {displayDate}
                                    </p>
                                    <Button
                                      variant="destructive"
                                      size="sm"
                                      className="ml-2 h-6 px-2"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteTentative(
                                          String(schedule.id),
                                        );
                                      }}
                                      disabled={
                                        deletingId === String(schedule.id)
                                      }
                                    >
                                      {deletingId === String(schedule.id) ? (
                                        <RefreshCcw className="h-3 w-3 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-3 w-3" />
                                      )}
                                    </Button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  Page {currentPage} of {totalPages} ({totalCount} customers)
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setPage(currentPage - 1)}
                    disabled={isPagePending || isError || currentPage <= 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setPage(currentPage + 1)}
                    disabled={
                      isPagePending || isError || currentPage >= totalPages
                    }
                  >
                    Next
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// <AnimatePresence>
//   <motion.div
//     key="session-details"
//     initial={false}
//     animate={{
//       height: isSessionDetailsMinimized ? "auto" : "auto",
//       opacity: 1,
//     }}
//     exit={{ height: 0, opacity: 0 }}
//     transition={{ type: "spring", stiffness: 300, damping: 30 }}
//     className="mx-4 mb-4 rounded-3xl bg-[#FFFFF0] p-4"
//   >
//     <div className="mb-2 flex items-center justify-between">
//       <h3 className="text-lg font-semibold">Session Details</h3>
//       <Button
//         size="sm"
//         variant="ghost"
//         onClick={() =>
//           setIsSessionDetailsMinimized(!isSessionDetailsMinimized)
//         }
//       >
//         {isSessionDetailsMinimized ? <ChevronDown /> : <ChevronUp />}
//       </Button>
//     </div>
//     <motion.div
//       initial={false}
//       animate={{
//         height: isSessionDetailsMinimized ? 0 : "auto",
//         opacity: isSessionDetailsMinimized ? 0 : 1,
//       }}
//       transition={{ duration: 0.3 }}
//       className="overflow-hidden"
//     >
//       <div className="grid grid-cols-2 gap-4">
//         {/* Row 1 */}
//         <div className="flex flex-col gap-0">
//           <p className="text-sm font-light">Date</p>
//           <p className="text-base">
//             {schedule
//               ? format(new Date(schedule.date), "EEE, do MMM")
//               : "Not available"}
//           </p>
//         </div>
//         <div className="flex flex-col gap-0">
//           <p className="text-sm font-light">Time</p>
//           <p className="text-base">{timeString}</p>
//         </div>

//         {/* Row 2 */}
//         <div className="flex flex-col gap-0">
//           <p className="text-sm font-light">Instructor Name</p>
//           <p className="text-base">
//             {schedule?.Instructor?.name
//               ? schedule?.Instructor?.name
//               : "Not available"}
//           </p>
//         </div>
//         <div className="flex flex-col gap-0">
//           <p className="text-sm font-light">Mobile number</p>
//           <p className="text-base">
//             {schedule?.Instructor?.phone
//               ? schedule?.Instructor?.phone
//               : "Not available"}
//           </p>
//         </div>

//         {/* Row 3 */}
//         <div className="flex flex-col gap-0">
//           <p className="text-sm font-light">Car Model</p>
//           <p className="text-base">
//             {schedule?.Instructor?.car_make
//               ? schedule?.Instructor?.car_make
//               : "Not available"}
//           </p>
//         </div>
//         <div className="flex flex-col gap-0">
//           <p className="text-sm font-light">Car Number</p>
//           <p className="text-base">
//             {schedule?.Instructor?.car_number
//               ? schedule?.Instructor?.car_number
//               : "Not available"}
//           </p>
//         </div>
//         <div className="flex flex-col gap-0">
//           <p className="text-sm font-light">Pick Up location</p>

//           <Popover>
//             <PopoverTrigger>
//               <p className="truncate text-base">
//                 {learner?.pick_up_location
//                   ? learner?.pick_up_location
//                   : "Not available"}
//               </p>
//             </PopoverTrigger>
//             <PopoverContent>
//               {learner?.pick_up_location}
//             </PopoverContent>
//           </Popover>
//         </div>
//       </div>
//     </motion.div>
//     {isSessionDetailsMinimized && (
//       <div className="flex flex-col gap-1">
//         <motion.p
//           initial={{ opacity: 0 }}
//           animate={{ opacity: 1 }}
//           exit={{ opacity: 0 }}
//           className="text-base font-light"
//         >
//           <span className="font-medium">Date:</span>{" "}
//           {schedule
//             ? format(new Date(schedule.date), "EEE, do MMM")
//             : "Not available"}
//         </motion.p>
//         <motion.p
//           initial={{ opacity: 0 }}
//           animate={{ opacity: 1 }}
//           exit={{ opacity: 0 }}
//           className="text-base font-light"
//         >
//           <span className="font-medium">Time: </span>
//           {timeString}
//         </motion.p>
//       </div>
//     )}
//   </motion.div>
// </AnimatePresence>
