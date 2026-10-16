import { Dialog } from "@radix-ui/react-dialog";
import { SelectValue } from "@radix-ui/react-select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  differenceInDays,
  format,
  getMonth,
  getYear,
  isBefore,
  set,
  setMonth,
  setYear,
  subDays,
} from "date-fns";
import { ArrowLeft, Search } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import {
  LearnerInfo,
  LearnerInfoDialog,
} from "@/components/admin/LearnerInfoCard";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
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
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { supabase } from "@/lib/supabaseClient";

const POST_LL_PAGE_SIZE = 15;

// Animated Search Bar Component
const AnimatedSearchBar = ({ value, onChange, placeholder }) => {
  const searchTerms = [
    "Search by name...",
    "Search by phone...",
    "Search by LL ID...",
  ];
  const [currentTermIndex, setCurrentTermIndex] = useState(0);
  const [currentText, setCurrentText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [showCursor, setShowCursor] = useState(true);

  useEffect(() => {
    const currentTerm = searchTerms[currentTermIndex];

    const timeout = setTimeout(
      () => {
        if (!isDeleting && currentText.length < currentTerm.length) {
          setCurrentText(currentTerm.slice(0, currentText.length + 1));
        } else if (isDeleting && currentText.length > 0) {
          setCurrentText(currentText.slice(0, -1));
        } else if (!isDeleting && currentText.length === currentTerm.length) {
          setTimeout(() => setIsDeleting(true), 2000);
        } else if (isDeleting && currentText.length === 0) {
          setIsDeleting(false);
          setCurrentTermIndex((prev) => (prev + 1) % searchTerms.length);
        }
      },
      isDeleting ? 50 : 100,
    );

    return () => clearTimeout(timeout);
  }, [currentText, isDeleting, currentTermIndex, searchTerms]);

  useEffect(() => {
    const cursorInterval = setInterval(() => {
      setShowCursor((prev) => !prev);
    }, 500);

    return () => clearInterval(cursorInterval);
  }, []);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-gray-400" />
      <Input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={value ? "" : `${currentText}${showCursor ? "|" : ""}`}
        className="rounded-lg border-2 border-gray-200 py-2 pl-10 pr-4 transition-all duration-200 focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
};

const LearnerDetails = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpenTestDate, setDialogOpenTestDate] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
  const isSearchPending = searchTerm !== debouncedSearchTerm;
  const [isBookedTestDateDialogOpen, setIsBookedTestDateDialogOpen] =
    useState(false);
  const [bookedTest, setBookedTest] = useState("");
  const [selectedLearner, setSelectedLearner] = useState<LearnerInfo | null>(
    null,
  );
  const [dialogOpen, setDialogOpen] = useState(false);

  // Query for past LL approved applications
  const {
    data: pastLLApplicationsPage,
    isLoading: isPastLLLoading,
    isFetching: isPastLLFetching,
    isError: isPastLLError,
  } = useQuery({
    queryKey: [
      "learners",
      "pastLLApplications",
      "postLL",
      page,
      debouncedSearchTerm,
    ],
    enabled: !isSearchPending,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const from = (page - 1) * POST_LL_PAGE_SIZE;
      let query = supabase
        .from("Learner")
        .select("*, schedule_preferences!left(learner_id)", { count: "exact" })
        .in("has_postLL_done", [true, false])
        .is("LL_result", true)
        .is("LL_application_approved", true)
        .is("LL_received", true)
        .order("has_a_DL")
        .order("id")
        .range(from, from + POST_LL_PAGE_SIZE - 1)
        .abortSignal(signal);

      if (debouncedSearchTerm) {
        // Escape regex and quote the filter value to preserve literal,
        // case-insensitive substring searches, including punctuation.
        const searchPattern = JSON.stringify(
          debouncedSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        );
        query = query.or(
          `name.imatch.${searchPattern},phone.imatch.${searchPattern},LL_application_id.imatch.${searchPattern}`,
        );
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { applications: data ?? [], totalCount: count ?? 0 };
    },
  });

  const pastLLApplications = pastLLApplicationsPage?.applications;
  const totalPages = Math.max(
    1,
    Math.ceil((pastLLApplicationsPage?.totalCount ?? 0) / POST_LL_PAGE_SIZE),
  );

  useEffect(() => {
    if (
      pastLLApplicationsPage &&
      !isSearchPending &&
      !isPastLLFetching &&
      page > totalPages
    ) {
      setPage(totalPages);
    }
  }, [
    pastLLApplicationsPage,
    isSearchPending,
    isPastLLFetching,
    page,
    totalPages,
  ]);

  const updateLearnerMutation = useMutation({
    mutationFn: async ({
      learnerId,
      updates,
    }: {
      learnerId: string;
      updates: Partial<any>;
    }) => {
      const { error } = await supabase
        .from("Learner")
        .update(updates)
        .eq("id", learnerId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Learner details updated successfully.",
      });
      // TODO: seperate query keys to be added and called
      queryClient.invalidateQueries({ queryKey: ["learners", "llDetails"] });
      queryClient.invalidateQueries({
        queryKey: ["learners", "pastLLApplications"],
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const sendAdminEmail = async (subject: string, message: string) => {
    try {
      const { data, error } = await supabase.functions.invoke(
        "send-admin-email",
        {
          body: { subject, message },
        },
      );

      if (error) throw error;
      return data;
    } catch (error) {
      console.error("Error sending admin email:", error);
      throw error;
    }
  };

  const updateLearnerPostLLMutation = useMutation({
    mutationFn: async ({
      learnerId,
      updates,
    }: {
      learnerId: string;
      updates: Partial<any>;
    }) => {
      const { error } = await supabase
        .from("Learner")
        .update(updates)
        .eq("id", learnerId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Learner LL details updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["learners", "llDetails"] });
      queryClient.invalidateQueries({
        queryKey: ["learners", "pastLLApplications"],
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleLearnerSelect = (learner: LearnerInfo) => {
    setSelectedLearner(learner);
    setDialogOpen(true);
  };
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  };
  const handleSaveBookedTestDate = (learnerId: string) => {
    // console.log("learnerId", learnerId);

    updateLearnerPostLLMutation.mutate(
      {
        // 1. Mutation Variables (The Payload)
        learnerId: learnerId,
        updates: {
          DL_test_date: bookedTest,
        },
      },
      {
        // 2. Mutation Options Object (The Callbacks)
        onSuccess: () => {
          toast({
            title: "Success",
            description: "Learner details updated successfully.",
          });
        },
        onError: (error) => {
          toast({
            title: "Error",
            description: error.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  const calculateLesson10Start = (learner) => {
    if (!learner.DL_test_date) {
      return null;
    }
    return format(subDays(new Date(learner.DL_test_date), 7), "yyyy-MM-dd");
  };

  const handleCloseBookedTestDate = () => {
    setIsBookedTestDateDialogOpen(false);
  };

  const isLesson10ButtonDisabled = (learner): boolean => {
    const calculatedStartDate = calculateLesson10Start(learner);

    if (!calculatedStartDate) {
      return true;
    }

    // Disabled if the current date is before the calculated start date
    return isBefore(new Date(), calculatedStartDate);
  };

  const handleLesson10Click = (learner) => {
    if (!learner) return;
    supabase.functions.invoke("send-message", {
      body: {
        message_type: "WEBAPP_SCHEDULE_LESSON_10",
        learner_id: learner.id,
      },
    });
    toast({
      title: "Success",
      description: "Lesson 10 booking notification sent.",
    });
  };

  const handleTestPass = (learner, isPass) => {
    if (!learner) return;
    // console.log("handleTestPass called with learner:", learner);

    updateLearnerMutation.mutate(
      {
        learnerId: learner.id,
        updates: {
          DL_result: isPass,
        },
      },
      {
        onSuccess: async () => {
          toast({
            title: "Success",
            description: "Driving test information updated.",
          });
        },
      },
    );
  };

  const handleProcessFinish = (learner) => {
    if (!learner) return;
    updateLearnerMutation.mutate(
      {
        learnerId: learner.id,
        updates: {
          // TODO: set licenceid to argument appointmentId2,
          has_postLL_done: true,
          has_a_DL: true,
          DL_received_date: new Date().toISOString(),
        },
      },
      {
        onSuccess: async () => {
          // await supabase.functions.invoke("send-message", {
          //   body: {
          //     // message_type: "LL_APPLICATION_UPDATE",
          //     learner_id: learner.id,
          //   },
          // });
          // Todo send final message
          // await sendAdminEmail(
          //   "Schedule DL Test Date - LL Approved",
          //   `Learner's License has been approved for ${selectedLearner.name} (Phone: ${selectedLearner.phone}).Please schedule a driving test date for this learner in the DL Test Dates section.`,
          // );
          toast({
            title: "Success",
            // TODO
            // description: "Learner record closed and notifications sent.",
            description: "Learner record closed.",
          });
        },
      },
    );
  };

  return (
    <div
      className="min-h-screen bg-gray-50"
      style={{
        backgroundImage: 'url("/assets/bg_pattern.svg")',
        backgroundRepeat: "repeat",
        backgroundSize: "cover",
      }}
    >
      {/* Header */}
      <div className="border-b bg-white shadow-sm">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/admin")}
              className="h-10 w-10 hover:bg-gray-100"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-2xl font-bold text-gray-900">
              Post-LL Application Management
            </h1>
          </div>
        </div>
      </div>

      {/* Post LL applications */}
      <div className="px-6 pb-6">
        <Card className="border-0 shadow-lg">
          <CardHeader className="border-b bg-gradient-to-r from-orange-50 to-amber-50">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl font-semibold text-gray-800">
                Pending Applications
              </CardTitle>
              <div className="w-80">
                <AnimatedSearchBar
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isSearchPending || isPastLLLoading ? (
              <div className="py-12 text-center">
                <div className="text-lg">Loading past applications...</div>
              </div>
            ) : isPastLLError ? (
              <div className="py-12 text-center text-red-500">
                <div className="text-lg">Error loading past applications</div>
              </div>
            ) : pastLLApplications?.length === 0 ? (
              <div className="py-12 text-center text-gray-500">
                <div className="text-lg font-medium">
                  {searchTerm
                    ? "No matching applications found"
                    : "No past LL applications found"}
                </div>
                {searchTerm && (
                  <div className="mt-2 text-sm">
                    Try adjusting your search criteria
                  </div>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b bg-gray-50">
                    <tr>
                      <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider text-gray-700">
                        Name
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider text-gray-700">
                        Mobile
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider text-gray-700">
                        LL Application ID
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider text-gray-700">
                        LL licence number
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider text-gray-700">
                        Schedule Preferences given ?
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider text-gray-700">
                        Date of LL issued
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider text-gray-700">
                        Start day of DL test (after 30 days from LL)
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider text-gray-700">
                        Booked Test date
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider text-gray-700">
                        10th lesson booking start (before 7 days of test)
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider text-gray-700">
                        10th lesson booked ?
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider text-gray-700">
                        DL test Pass/Fail
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider text-gray-700">
                        DL Issued ?
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {pastLLApplications?.map((learner, index) => (
                      <tr
                        key={learner.id}
                        className={`transition-colors duration-150 hover:bg-gray-50 ${
                          index % 2 === 0 ? "bg-white" : "bg-gray-25"
                        }`}
                      >
                        {/* 🛠️ FIX APPLIED HERE: The entire clickable section is now inside a <td> */}
                        <td
                          className="cursor-pointer whitespace-nowrap px-6 py-4"
                          onClick={() =>
                            handleLearnerSelect({
                              id: learner.id || "",
                              name: learner.name || "",
                              phone: learner.phone || "",
                              email: learner.email || "",
                              area: learner.area || "",
                              pick_up_location: learner.pick_up_location,
                              pincode: learner.pincode,
                              signed_up: learner.signed_up,
                              created_at: learner.created_at,
                              address_lat: learner.address_lat,
                              address_lng: learner.address_lng,
                              preferred_start_date:
                                learner.preferred_start_date,
                              preferred_completion_days:
                                learner.preferred_completion_days,
                              prefers_two_hour_classes:
                                learner.prefers_two_hour_classes,
                              preferred_two_hour_days: learner.two_hour_days,
                              DL_test_date: learner.DL_test_date,
                            })
                          }
                        >
                          <div className="flex items-center gap-3">
                            <Avatar className="h-12 w-12">
                              <AvatarFallback className="bg-primary/10 text-primary">
                                {getInitials(learner.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="font-medium text-gray-900">
                              {learner.name}
                            </div>
                          </div>
                        </td>
                        {/* End of Name/Avatar cell */}

                        <td className="whitespace-nowrap px-6 py-4">
                          <div className="text-gray-700">{learner.phone}</div>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <div className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800">
                            {learner.LL_application_id || "N/A"}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <div
                            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
                              learner.LL_id
                                ? "bg-green-100 text-green-800"
                                : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {learner.LL_id || "N/A"}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          {
                            <div
                              className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
                                learner?.schedule_preferences?.length > 0
                                  ? "bg-green-100 text-green-800"
                                  : "bg-red-100 text-red-800"
                              } `}
                            >
                              {learner?.schedule_preferences?.length > 0
                                ? "Yes"
                                : "No"}
                            </div>
                          }
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <div
                            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
                              learner.LL_received_date
                                ? "bg-green-100 text-green-800"
                                : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {learner.LL_received_date || "N/A"}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <div
                            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
                              learner.LL_received_date
                                ? "bg-green-100 text-green-800"
                                : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {learner.LL_received_date
                              ? format(
                                  addDays(
                                    new Date(learner.LL_received_date),
                                    30,
                                  ),
                                  "yyyy-MM-dd",
                                )
                              : "N/A"}
                          </div>
                        </td>

                        {/* Schedule Preferences cell (fixed from your previous query) */}
                        {/* <td className="whitespace-nowrap px-6 py-4">
                        <div
                          className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium
                            ${
                              learner?.schedule_preferences?.length > 0
                                ? "bg-green-100 text-green-800"
                                : "bg-red-100 text-red-800"
                            }
                          `}
                        >
                          {learner?.schedule_preferences?.length > 0
                            ? "Yes"
                            : "No"
                          }
                        </div>
                      </td> */}

                        <td className="whitespace-nowrap px-6 py-4">
                          <div
                            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
                              learner.DL_test_date
                                ? "bg-green-100 text-green-800"
                                : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {learner.DL_test_date
                              ? learner.DL_test_date
                              : "N/A"}
                          </div>
                          <div className="mt-2">
                            <button
                              onClick={() =>
                                setIsBookedTestDateDialogOpen(true)
                              }
                              className="text-sm font-medium text-indigo-600 hover:text-indigo-900 focus:outline-none"
                              title="Update Test Date"
                            >
                              {learner.DL_test_date
                                ? "Change test date"
                                : "Add test date"}
                            </button>
                          </div>
                          {/* Dialog components remain valid here */}
                          <Dialog
                            open={isBookedTestDateDialogOpen}
                            onOpenChange={setIsBookedTestDateDialogOpen}
                          >
                            <DialogContent className="sm:max-w-[425px]">
                              <DialogHeader>
                                <DialogTitle>
                                  Enter Booked test date
                                </DialogTitle>
                              </DialogHeader>
                              <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                  <Label
                                    htmlFor="app-booked_test"
                                    className="text-right"
                                  >
                                    Test Date
                                  </Label>
                                  <Input
                                    id="booked_test-date"
                                    type="date"
                                    value={bookedTest || ""}
                                    onChange={(e) => {
                                      setBookedTest(e.target.value);
                                    }}
                                    disabled={
                                      updateLearnerPostLLMutation.isPending
                                    }
                                    className="col-span-3"
                                  />
                                </div>
                              </div>
                              <DialogFooter>
                                <Button
                                  onClick={handleCloseBookedTestDate}
                                  variant="secondary"
                                >
                                  Close
                                </Button>
                                <Button
                                  onClick={() =>
                                    handleSaveBookedTestDate(learner.id)
                                  }
                                >
                                  Save
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </td>

                        <td className="whitespace-nowrap px-6 py-4">
                          <div
                            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
                              calculateLesson10Start(learner)
                                ? "bg-green-100 text-green-800"
                                : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {calculateLesson10Start(learner) || "N/A"}
                          </div>

                          {!isLesson10ButtonDisabled(learner) && (
                            <button
                              onClick={() => {
                                handleLesson10Click(learner);
                              }}
                              className="inline-flex items-center rounded-full bg-blue-500 px-3 py-1 text-sm font-medium text-white shadow transition-colors hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                            >
                              Send notification
                            </button>
                          )}
                        </td>

                        <td className="whitespace-nowrap px-6 py-4">
                          <div
                            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
                              learner.has_lesson10_booked === true
                                ? "bg-green-100 text-green-800"
                                : learner.has_lesson10_booked === false
                                  ? "bg-red-100 text-red-800"
                                  : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {learner.has_lesson10_booked === true
                              ? "Yes"
                              : learner.has_lesson10_booked === false
                                ? "No"
                                : "N/A"}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <div
                            className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
                              learner.DL_result === true
                                ? "bg-green-100 text-green-800"
                                : learner.DL_result === false
                                  ? "bg-red-100 text-red-800"
                                  : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {learner.DL_result === true
                              ? "PASS"
                              : learner.DL_result === false
                                ? "FAIL"
                                : "N/A"}
                          </div>
                          {!learner.DL_result && (
                            <button
                              onClick={() => {
                                handleTestPass(learner, true);
                              }}
                              className="inline-flex items-center rounded-full bg-blue-500 px-3 py-1 text-sm font-medium text-white shadow transition-colors hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                            >
                              Yes
                            </button>
                          )}
                          {!(
                            learner.DL_result && learner.DL_result === false
                          ) && (
                            <button
                              onClick={() => {
                                handleTestPass(learner, false);
                              }}
                              className="inline-flex items-center rounded-full bg-blue-500 px-3 py-1 text-sm font-medium text-white shadow transition-colors hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                            >
                              No
                            </button>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <button
                            onClick={() => {
                              handleProcessFinish(learner);
                              // resetSelectedLearnerState();
                            }}
                            className={
                              learner.has_postLL_done
                                ? "inline-flex cursor-not-allowed items-center rounded-full bg-gray-400 px-3 py-1 text-sm font-medium text-white shadow"
                                : "inline-flex items-center rounded-full bg-blue-500 px-3 py-1 text-sm font-medium text-white shadow transition-colors hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                            }
                            disabled={learner.has_a_DL}
                          >
                            {learner?.has_a_DL && learner?.has_postLL_done
                              ? "Done"
                              : "Yes (Click here)"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center justify-between border-t px-6 py-4">
              <Button
                variant="outline"
                onClick={() => setPage((currentPage) => currentPage - 1)}
                disabled={page === 1 || isSearchPending || isPastLLFetching}
              >
                Previous
              </Button>
              <span className="text-sm text-gray-600" aria-live="polite">
                Page {page}
                {pastLLApplicationsPage &&
                  !isSearchPending &&
                  ` of ${totalPages}`}
              </span>
              <Button
                variant="outline"
                onClick={() => setPage((currentPage) => currentPage + 1)}
                disabled={
                  !pastLLApplicationsPage ||
                  page >= totalPages ||
                  isSearchPending ||
                  isPastLLFetching
                }
              >
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {selectedLearner && (
        <LearnerInfoDialog
          learner={selectedLearner}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
};

export default LearnerDetails;

const BookedTestDateInputDialog = ({
  learnerId,
  currentTestDate,
  onClose,
  // onSave,
}) => {
  console.log(
    "%c ~ file: src\routesadminLearnerDetails.tsx:543 : ",
    "color: #d83349",
    { learnerId, currentTestDate, onClose },
  );

  const [date, setDate] = useState<Date>();

  const [currentDate, setCurrentDate] = useState(setYear(new Date(), 2010));
  const { mutate: learnerMutate, isPending: isUpdatePending } =
    useLearnerUpdateById(learnerId);

  const years = Array.from(
    { length: 61 },
    (_, i) => getYear(new Date()) - 60 + i,
  );

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

  const handleYearChange = (year: string) => {
    setCurrentDate(setYear(currentDate, parseInt(year)));
  };

  const handleMonthChange = (month: string) => {
    setCurrentDate(setMonth(currentDate, months.indexOf(month)));
  };

  const handleBookedDateSave = useCallback(
    () => {
      learnerMutate(
        {
          DL_test_date: format(date, "yyyy-MM-dd"),
        },
        {
          onSuccess: () => {
            toast({
              title: "Success",
              description: "Booked test date of the user updated",
              variant: "destructive",
            });
            onClose();
          },
          onError: (error) => {
            toast({
              title: "Failed to set booked test date",
              description:
                error instanceof Error ? error.message : "An error occurred",
              variant: "destructive",
            }); // toast ends
          }, // on Error ends
        },
      ); // learn mutate ends
    }, // call back func arg ends
    [date, learnerMutate], // callback dependency arr
  ); // callback hook ends

  return (
    <div className="mt-8 flex grow flex-col justify-between bg-white p-4">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <Select
            onValueChange={handleYearChange}
            value={getYear(currentDate).toString()}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent>
              {years.map((year) => (
                <SelectItem key={year} value={year.toString()}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            onValueChange={handleMonthChange}
            value={months[getMonth(currentDate)]}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Month" />
            </SelectTrigger>
            <SelectContent>
              {months.map((month) => (
                <SelectItem key={month} value={month}>
                  {month}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Calendar
          mode="single"
          selected={date}
          onSelect={setDate}
          month={currentDate}
          onMonthChange={setCurrentDate}
          className="rounded-lg border border-border p-4"
          initialFocus
        />
      </div>
      <Button
        onClick={handleBookedDateSave}
        className="w-full"
        disabled={isUpdatePending}
      >
        Continue
      </Button>
    </div>
  );
};

function useLearnerUpdateById(learnerId: string) {
  const queryClient = useQueryClient();
  const mutate = useMutation({
    mutationFn: async (data: PartialLearner) => {
      const { error } = await supabase
        .from("Learner")
        .update(data)
        .eq("id", learnerId);
      if (error) throw new Error(error.message);
      return null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["learner", learnerId],
      });
    },
  });
  return mutate;
}
