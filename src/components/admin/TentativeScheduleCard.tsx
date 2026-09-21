import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  BookOpen,
  Calendar,
  Car,
  Clock,
  Info,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Save,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { TIME_SLOT_LABELS } from "@/types/schedule";

import { LearnerLLDisplay } from "./LLDisplay";

export interface TentativeScheduleInfo {
  id: number;
  learner_id: string;
  instructor_id: string;
  course_id: string;
  learner_name: string;
  learner_paid_info: string;
  leadName: string;
  tentative_date?: string;
  start_time?: string;
  end_time?: string;
  pick_up_location?: string; // Added pickup address field
}

export interface LearnerInfo {
  id: string;
  name: string;
  phone: string;
  email: string;
  area: string;
  pincode?: string;
  signed_up?: string;
  created_at?: string;
  address_lat?: number;
  address_lng?: number;
  preferred_start_date?: string;
  preferred_completion_days?: number;
  prefers_two_hour_classes?: boolean;
  two_hour_days?: string;
  pick_up_location?: string; // Added pickup address field
  comments?: string; // Added comments field
}

interface SchedulePreference {
  day_of_week: number;
  time_slot: string;
}

interface LearnerSchedule {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  instructor_id: string;
  lesson_id: string;
  course_id: string;
  status: string;
  instructor_name?: string;
  lesson_number?: number;
  course_name?: string;
}

interface CourseInfo {
  id: string;
  name: string;
  total_lessons: number;
}

interface TentativeScheduleInfoDialogProps {
  tentativeSchedule: TentativeScheduleInfo;
  open: boolean;
  onClose: () => void;
}

export const TentativeScheduleDialog = ({
  tentativeSchedule,
  open,
  onClose,
}: TentativeScheduleInfoDialogProps) => {
  const [schedulePreferences, setSchedulePreferences] = useState<
    SchedulePreference[]
  >([]);
  const [currentSchedules, setCurrentSchedules] =
    useState<TentativeScheduleInfo | null>(null);
  const [courseInfo, setCourseInfo] = useState<CourseInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(false);
  const [isLoadingCourse, setIsLoadingCourse] = useState(false);

  const queryClient = useQueryClient();
  const [editableSchedule, setEditableSchedule] = useState(tentativeSchedule);
  const tentativeScheduleExist = tentativeSchedule && tentativeSchedule.id;
  const [leadName, setLeadName] = useState<string>(""); // it must be null unless set by user
  const [leadNameDialogOpen, setLeadNameDialogOpen] = useState(false);
  const { toast } = useToast();

  const mapToScheduleTableSchema = (scheduleData: any) => {
    return {
      instructor_id: scheduleData.instructor_id,
      learner_id: scheduleData.id, // Assuming 'id' in newSchedule maps to 'learner_id'
      date: scheduleData.tentative_date,
      start_time: scheduleData.start_time,
      end_time: scheduleData.end_time,
      course_id: scheduleData.course_id,
      enabled: true,
      isTentative: true,
      status: "hold",
      leadName: scheduleData.leadName,
    };
  };

  const addTentativeScheduleMutation = useMutation({
    mutationFn: async ({
      newSchedule,
    }: {
      newSchedule: Partial<TentativeScheduleInfo>;
    }) => {
      const mappedScheduleData = mapToScheduleTableSchema(newSchedule);
      console.log("Mapped schedule data to insert:", mappedScheduleData);

      const { data, error } = await supabase
        .from("Schedule")
        .insert([mappedScheduleData])
        .select();
      if (error) {
        console.error("Supabase insert error:", error);
        throw new Error("Supabase insert error");
      }
      return data;
    },
    onSuccess: () => {
      console.log("Successfully inserted new schedule");
      toast({
        title: "Success",
        description: "Successfully added new tentative schedule",
        variant: "default",
      });
      // You would typically close the dialog here
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to add new tentative schedule: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const updateTentativeScheduleMutation = useMutation({
    mutationFn: async ({ updates }: { updates: Partial<any> }) => {
      const { error } = await supabase
        .from("Schedule")
        .update(updates)
        .eq("id", tentativeSchedule.id)
        .select();
      if (error) {
        console.error("Supabase error:", error);
        throw new Error("Supabase error");
      }

      // return updatedData;
    },
    onSuccess: () => {
      // Invalidate queries or update cache
      // queryClient.invalidateQueries({ queryKey: ['some-key'] });
      // You can also close the dialog here, so it closes only on success
      // onClose();
      console.log("Successfully updated data");
      toast({
        title: "Success",
        description: `Successfully updated tentative schedule`,
        variant: "destructive",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to update tentative schedule: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    setEditableSchedule(tentativeSchedule);
  }, [tentativeSchedule]);

  // setCurrentSchedules(tentativeSchedule);
  useEffect(() => {
    console.log(
      "Tentative schedule compomnent got the arguments as",
      tentativeSchedule,
    );

    const fetchCurrentSchedules = async () => {
      if (!tentativeSchedule.learner_id || !open) return;

      setIsLoadingSchedules(true);
      try {
        // First, get the enrollment information for this learner
        const { data: enrollmentData, error: enrollmentError } = await supabase
          .from("enrollment")
          .select("course_id, status")
          .eq("learner_id", tentativeSchedule.learner_id)
          .eq("course_id", tentativeSchedule.course_id)
          .order("created_at", { ascending: false })
          .limit(1);

        if (enrollmentError) throw enrollmentError;

        // If we have an active enrollment, use that course_id
        const paidStatus =
          enrollmentData && enrollmentData.length > 0
            ? enrollmentData[0].status
            : null;

        if (tentativeSchedule.course_id) {
          // Fetch course information including total lessons
          setIsLoadingCourse(true);
          const { data: courseDetailData, error: courseDetailError } =
            await supabase
              .from("Courses")
              .select("id, name, total_lessons")
              .eq("id", tentativeSchedule.course_id)
              .single();

          if (!courseDetailError && courseDetailData) {
            setCourseInfo(courseDetailData);
          }
          setIsLoadingCourse(false);
        }

        // Fetch course names
        const { data: courseData, error: courseError } = await supabase
          .from("Courses")
          .select("id, name")
          .eq("id", tentativeSchedule.course_id);

        if (courseError) throw courseError;

        // Combine all data
        const enrichedTentativeSchedules = {
          ...tentativeSchedule,
          learner_paid_info: paidStatus || "Unknown",
        };
        console.log("Setting additional info to current schedules");
        // setCurrentSchedules(enrichedTentativeSchedules);
      } catch (error) {
        console.error("Error fetching current schedules:", error);
      } finally {
        setIsLoadingSchedules(false);
      }
    };
  }, [tentativeSchedule.id, open]);

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  };

  const handleLeadNameDialogClose = () => {
    // set dialog close
    setLeadNameDialogOpen(false);
    return;
  };
  const handleLeadNameDialogSave = () => {
    // Validate the leadName
    if (!leadName) {
      alert("Enter a valid leadName");
      return;
    }
    if (tentativeScheduleExist) {
      // call mutate
      updateTentativeScheduleMutation.mutate({
        updates: {
          leadName: leadName,
        },
      });
    } else {
      addTentativeScheduleMutation.mutate({
        newSchedule: editableSchedule,
      });
    }
  };
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-4xl">
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle className="text-xl font-bold text-primary">
            Tentative Schedule Details
          </DialogTitle>
          <DialogClose />
        </DialogHeader>

        {tentativeScheduleExist && (
          <div
            className="mt-4 overflow-y-auto pr-2"
            style={{ maxHeight: "calc(80vh - 80px)" }}
          >
            <div className="mb-6 flex items-start gap-6">
              <div className="flex-1">
                <h2 className="text-2xl font-bold">
                  {tentativeSchedule.learner_name}
                </h2>
                <div className="h-full w-full rounded-lg bg-gray-50 p-5 shadow-sm transition-shadow hover:shadow-md">
                  <h3 className="mb-4 border-b pb-2 text-lg font-semibold text-primary">
                    Contact Information
                  </h3>
                  <div className="space-y-4">
                    <div className="ml-8 flex items-start gap-3">
                      Customer Name: {tentativeSchedule.learner_name}
                    </div>
                    <div className="flex items-center gap-3">
                      <Phone className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium">Phone</p>
                        <p className="text-gray-700">{"00000"}</p>
                      </div>
                    </div>
                    <div className="ml-8 flex items-start gap-3">
                      Paid information:{" "}
                      {tentativeSchedule.learner_paid_info || "Not available"}
                    </div>
                    <div className="ml-8 flex items-start gap-3">
                      Pickup location:{" "}
                      {tentativeSchedule.pick_up_location || "Not available"}
                    </div>
                    <div className="ml-8 flex items-start gap-3">
                      Lead Name: {tentativeSchedule.leadName || "Not available"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* leadName Dialog */}
        <Dialog open={leadNameDialogOpen} onOpenChange={setLeadNameDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Enter Lead Details</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="app-number" className="text-right">
                  Lead Name
                </Label>
                <Input
                  id="tentative-lead-name"
                  value={leadName}
                  onChange={(e) => setLeadName(e.target.value)}
                  maxLength={128}
                  className="col-span-3"
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleLeadNameDialogClose} variant="secondary">
                Close
              </Button>
              <Button onClick={handleLeadNameDialogSave}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {!tentativeScheduleExist && (
          <Button className="mt-4" onClick={() => setLeadNameDialogOpen(true)}>
            Add schedule
          </Button>
        )}

        {tentativeScheduleExist && (
          <Button className="mt-4" onClick={() => setLeadNameDialogOpen(true)}>
            Update schedule
          </Button>
        )}

        {courseInfo && (
          <div className="mt-3 flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            <div className="rounded-md bg-primary/10 px-3 py-1">
              <span className="font-medium text-primary">
                {courseInfo.name}
              </span>
              <span className="ml-2 text-sm text-gray-600">
                ({courseInfo.total_lessons} lessons total)
              </span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
