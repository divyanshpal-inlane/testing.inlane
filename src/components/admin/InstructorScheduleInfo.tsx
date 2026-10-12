import { useQuery } from "@tanstack/react-query";
import { addHours, formatDistanceToNow, parseISO } from "date-fns";
import { format } from "date-fns";
import { ArrowLeft, Filter, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { fetchInstructorModuleSchedules } from "@/lib/admin-schedules";

import { Badge } from "../ui/badge";

type ScheduleInfoData = {
  date: Date;
  hour: number;
  instructorId: string;
  lessonId: string;
  lessonNumber: number;
  start_time: string;
  end_time: string;
  isTentative: boolean;
  tentative_details?: {
    name?: string;
    description?: string;
    paid_info?: string;
    leadName?: string;
    pickup_location?: string;
  };
};

interface SearchInstructorScheduleInfoProps {
  instructorId: string;
  openFlag: boolean;
  closeAction: () => void;
}

export const SearchInstructorScheduleInfo: React.FC<
  SearchInstructorScheduleInfoProps
> = ({ instructorId, openFlag, closeAction }) => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [schedulesList, setSchedulesList] = useState<any>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // const queryClient = useQueryClient();

  useEffect(() => {
    console.log("Component called with ", instructorId, openFlag);
  }, [instructorId]);
  // Call useQuery to fetch the schedules of the instructor
  // Fetch all tentative schedule whose instructor_id matches the provided instructorId
  // in ascending order of schedule data
  const { data: scheduleData, isLoading } = useQuery({
    queryKey: ["Schedule", instructorId],
    queryFn: async () => {
      // Phone-free read path: the edge function strips learner and tentative
      // phone numbers before the browser ever sees them.
      const rows = await fetchInstructorModuleSchedules(instructorId);
      return rows as unknown as ScheduleInfoData[];
    },
    // onSuccess: () => {
    //   queryClient.invalidateQueries({ queryKey: ["Schedule", instructorId] });

    // }
  });

  // useEffect(() => {
  //   console.log(scheduleData);
  //   console.log('%c[] -> scheduleData : ', 'color: #ec51fb', scheduleData);
  // }, [scheduleData]);

  // Filter schedules based on search query
  const filteredScheduleData = scheduleData?.filter(
    (schedule) =>
      schedule.tentative_details?.name
        ?.toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      schedule.tentative_details?.description
        ?.toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      schedule.tentative_details?.leadName
        ?.toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      schedule.tentative_details?.paid_info
        ?.toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      schedule.tentative_details?.pickup_location
        ?.toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      format(schedule.date, "yyyy-MM-dd").includes(searchQuery.toLowerCase()),
  );

  // useEffect(() => {
  //   console.log(filteredScheduleData);
  //   console.log('%c[] -> scheduleData : ', 'color: #ec51fb', scheduleData);
  // }, [filteredScheduleData]);

  const getTimeAgo = (day?: string, start_time?: string) => {
    if (!day || !start_time) return "N/A";
    const combinedDateTimeString = `${day}T${start_time}`;
    const parsedDate = parseISO(combinedDateTimeString);
    return formatDistanceToNow(new Date(parsedDate), {
      addSuffix: true,
      addSeconds: true,
    });
  };
  // render the component
  return (
    <div>
      {/* The ID sent {instructorId} */}
      {/* Card for each tentative schedule */}
      <div className="flex-1 p-6">
        <div className="mb-6">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <Input
                placeholder="Search by name, description, lead name, paid status or description..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button variant="outline" className="gap-2" disabled={isLoading}>
              <Filter className="h-4 w-4" />
              Filter
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card className="col-span-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Tentative schedules</CardTitle>
                <CardDescription>
                  {filteredScheduleData?.length || 0} schedules found
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {isLoading ? (
              <div className="flex items-center justify-center p-8">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
              </div>
            ) : filteredScheduleData?.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No schedules found matching your search
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {filteredScheduleData?.map((schedule) => (
                  <div
                    key={schedule.id}
                    className="cursor-pointer rounded-lg border p-4 transition-colors hover:bg-gray-50"
                    onClick={() => handleScheduleSelect(schedule)}
                  >
                    <div className="flex items-start gap-4">
                      <Avatar className="h-12 w-12">
                        <AvatarFallback className="bg-primary/10 text-primary">
                          {schedule.tentative_details?.name}
                        </AvatarFallback>
                      </Avatar>
                      <div className="grid flex-1 grid-cols-1 gap-2 md:grid-cols-3">
                        <div>
                          <h3 className="text-lg font-medium">
                            {schedule.tentative_details?.name}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {schedule.tentative_details?.pickup_location ||
                              "No area specified"}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm">
                            <span className="font-medium">Lead Name:</span>{" "}
                            {schedule.tentative_details?.leadName || "N/A"}
                          </p>
                          <p className="text-sm">
                            {/* <span className="font-medium">Paid status:</span>{" "} */}
                            {schedule.tentative_details?.paid_info || "N/A"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground">
                            {schedule.tentative_details?.description}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Scheduled{" "}
                            {getTimeAgo(schedule.date, schedule.start_time)}
                          </p>
                        </div>
                        {schedule.isTentative ? (
                          <Badge
                            variant="outline"
                            className="border-orange-200 bg-orange-50 text-orange-700"
                          >
                            Tentative
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-blue-200 bg-blue-50 text-blue-700"
                          >
                            Booked
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
