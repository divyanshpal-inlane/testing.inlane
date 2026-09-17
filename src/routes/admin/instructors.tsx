import { describe } from "node:test";

import {
  InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  addDays,
  addHours,
  addMinutes,
  addWeeks,
  differenceInMinutes,
  endOfWeek,
  format,
  isSameDay,
  parse,
  parseISO,
  startOfDay,
  startOfWeek,
  subDays,
  subWeeks,
} from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Badge,
  Calendar,
  CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Info,
  Loader2,
  MapPin,
  Phone,
  Plus,
  PlusCircle,
  Search,
  Trash2,
  User,
  Wrench,
  X,
} from "lucide-react";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { SearchInstructorScheduleInfo } from "@/components/admin/InstructorScheduleInfo";
import { CalendarImport } from "@/components/instructor/CalendarImport";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import {
  INSTRUCTOR_STATUSES,
  InstructorStatus,
  instructorStatusMeta,
  instructorStatusToEnabled,
  resolveInstructorStatus,
} from "@/constants/instructorStatus";
import { usePhoneVisibility } from "@/context/phone-visibility-context";
import { useAdminImportedCalendar } from "@/hooks/useAdminImportedCalendar";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import { useCurrentAdmin } from "@/queries/adminPermissions";
import { checkInstructorAvailability } from "@/queries/instructor";
import { useCurrentUser } from "@/queries/userManagement";
import { SlotConfig } from "@/types/schedule";
import { maskCarNumber, maskPhoneNumber } from "@/utils/phoneMasking";

import { Schedule } from "./schedules";

// Define a type for the instructor data that comes from the database
interface Unavailability {
  booked_date?: string;
  booked_start_time?: string;
  booked_end_time?: string;
  all_day?: boolean;
  day_of_week?: string;
  start_date?: string;
  end_date?: string;
  range_all_day?: boolean;
  range_start_time?: string;
  range_end_time?: string;
}
interface InstructorFromDB {
  id_instructor: string;
  name: string;
  phone: string;
  areas: string[];
  car_license: string | null;
  car_make: string | null;
  car_mode: string | null;
  car_number: string | null;
  created_at: string;
  DL_number: string | null;
  email: string | null;
  [key: string]: unknown; // Allow other properties with unknown type
  address: string | null;
  latitude: number | null; // Added for storing coordinates
  longitude: number | null; // Added for storing coordinates
  experience: number | null;
  radius: number | null;
  car_fuel_type: "petrol" | "diesel" | "ev" | "cng" | "lpg" | null;
  unavailability: Unavailability[];
  enabled?: boolean | null;
  status?: string | null;
}

interface InstructorData {
  id_instructor?: string;
  name: string;
  phone: string;
  email: string;
  DL_number: string;
  car_make: string;
  car_mode: string;
  experience: number;
  car_number: string;
  areas: string[];
  address: string;
  latitude: number | null; // Added for storing coordinates
  longitude: number | null; // Added for storing coordinates
  radius: number;
  car_fuel_type: "petrol" | "diesel" | "ev" | "cng" | "lpg" | null;
  unavailability: Unavailability[];
}

interface ServiceableArea {
  id: string;
  name: string;
  postal_code?: string;
}

const INSTRUCTOR_PAGE_SIZE = 6;
type InstructorStatusFilter = "all" | InstructorStatus;

interface InstructorListPage {
  instructors: (InstructorFromDB & { schedules: Schedule[] })[];
  hasMore: boolean;
  nextOffset: number;
}

interface InstructorListReturnState {
  statusFilter: InstructorStatusFilter;
  searchTerm: string;
  debouncedSearchTerm: string;
  listSession: number;
  scrollY: number;
  data: InfiniteData<InstructorListPage, number>;
  dataUpdatedAt: number;
}

// One pending return from View Schedule; retain pages even if the query expires.
let instructorListReturnState: InstructorListReturnState | undefined;

const INSTRUCTOR_STATUS_FILTERS = [
  {
    value: "all" as const,
    label: "All",
    badgeClass: "bg-primary/10 text-primary",
    dotClass: "bg-primary",
  },
  ...INSTRUCTOR_STATUSES,
];

// Supabase's `.or()` accepts raw PostgREST filter syntax, so strip the
// characters that can break an individual filter expression before using a
// user-entered search term in it.
const instructorSearchFilter = (searchTerm: string) => {
  const safeTerm = searchTerm
    .trim()
    .replace(/[(),"\\]/g, " ")
    .replace(/\s+/g, " ");

  if (!safeTerm) return "";

  return [
    `name.ilike.*${safeTerm}*`,
    `phone.ilike.*${safeTerm}*`,
    `car_make.ilike.*${safeTerm}*`,
    `car_mode.ilike.*${safeTerm}*`,
    `car_number.ilike.*${safeTerm}*`,
    `areas.cs.{"${safeTerm}"}`,
  ].join(",");
};

// Three-way status setter (Active / On Break / Inactive) shared by the list
// cards and the instructor profile header. Updates Instructor.status, keeps
// the `enabled` booking gate in sync (only Inactive is removed from
// scheduling pickers — On Break stays bookable), and writes an audit row.
// Switching to Inactive asks for confirmation since it has downstream
// consequences the other statuses don't.
function InstructorStatusControl({
  instructorId,
  status,
  size = "default",
}: {
  instructorId: string;
  status: InstructorStatus;
  size?: "default" | "compact";
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: currentAdmin } = useCurrentAdmin();
  const [pendingInactive, setPendingInactive] = useState(false);

  const statusMutation = useMutation({
    mutationFn: async (newStatus: InstructorStatus) => {
      const { error } = await supabase
        .from("Instructor")
        .update({
          status: newStatus,
          enabled: instructorStatusToEnabled(newStatus),
        } as any)
        .eq("id_instructor", instructorId);
      if (error) throw new Error(error.message);

      const changedBy = currentAdmin
        ? `${currentAdmin.name} (${currentAdmin.phone})`
        : "unknown";
      const { error: logError } = await supabase
        .from("instructor_status_log")
        .insert({
          instructor_id: instructorId,
          old_status: status,
          new_status: newStatus,
          changed_by: changedBy,
        } as any);
      // The status change itself succeeded — don't roll the UI back over a
      // failed audit write.
      if (logError) console.error("Failed to log status change:", logError);

      return newStatus;
    },
    onSuccess: (newStatus) => {
      queryClient.invalidateQueries({ queryKey: ["instructors"] });
      queryClient.invalidateQueries({ queryKey: ["all-instructors"] });
      queryClient.invalidateQueries({
        queryKey: ["instructors-for-migration"],
      });
      queryClient.invalidateQueries({ queryKey: ["instructor-full"] });
      toast({
        title: `Marked ${instructorStatusMeta(newStatus).label}`,
        description:
          newStatus === "inactive"
            ? "Instructor is hidden from scheduling lists. Existing schedules are unaffected."
            : newStatus === "on_break"
              ? "Instructor is tagged as temporarily away but remains bookable."
              : "Instructor is available and appears in scheduling lists.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSelect = (value: string) => {
    const next = value as InstructorStatus;
    if (next === status) return;
    if (next === "inactive") {
      setPendingInactive(true);
      return;
    }
    statusMutation.mutate(next);
  };

  const meta = instructorStatusMeta(status);

  return (
    <>
      <Select
        value={status}
        onValueChange={handleSelect}
        disabled={statusMutation.isPending}
      >
        <SelectTrigger
          className={cn(
            size === "compact" ? "h-8 text-xs" : "h-9 text-sm",
            "w-[130px]",
          )}
        >
          <span className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", meta.dotClass)} />
            {meta.label}
          </span>
        </SelectTrigger>
        <SelectContent>
          {INSTRUCTOR_STATUSES.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              <span className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full", s.dotClass)} />
                {s.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {pendingInactive && (
        <Dialog open={true} onOpenChange={() => setPendingInactive(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Mark Instructor Inactive?</DialogTitle>
              <DialogDescription>
                Inactive instructors are removed from the booking pool and
                hidden from scheduling lists. Existing schedules are not
                affected. If the instructor is only temporarily away, use "On
                Break" instead.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setPendingInactive(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setPendingInactive(false);
                  statusMutation.mutate("inactive");
                }}
              >
                Mark Inactive
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

const initialInstructorData: InstructorData = {
  name: "",
  phone: "",
  email: "",
  DL_number: "",
  car_make: "",
  car_mode: "",
  experience: 0,
  car_number: "",
  areas: [],
  address: "",
  latitude: null,
  longitude: null,
  radius: 0,
  car_fuel_type: null,
  unavailability: [],
};

// Google Maps Autocomplete Component
// Update the AddressAutocomplete component
// const AddressAutocomplete = memo(({
//   value,
//   onChange,
// }: {
//   value: string;
//   onChange: (address: string, lat: number | null, lng: number | null) => void;
// }) => {
//   const inputRef = useRef<HTMLInputElement>(null);
//   const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
//   const [isScriptLoaded, setIsScriptLoaded] = useState(false);
//   const [selectedAddress, setSelectedAddress] = useState<string>(value);

//   // Update internal state when prop value changes
//   useEffect(() => {
//     setSelectedAddress(value);
//   }, [value]);

//   useEffect(() => {
//     // Check if the script is already loading or loaded
//     const existingScript = document.querySelector(
//       'script[src*="maps.googleapis.com/maps/api/js"]',
//     );

//     if (!window.google?.maps?.places && !existingScript) {
//       const googleMapScript = document.createElement("script");
//       googleMapScript.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&libraries=places`;
//       googleMapScript.async = true;
//       googleMapScript.defer = true;

//       googleMapScript.onload = () => {
//         setIsScriptLoaded(true);
//       };

//       document.head.appendChild(googleMapScript);
//     } else if (window.google?.maps?.places) {
//       setIsScriptLoaded(true);
//     }
//   }, []);

//   useEffect(() => {
//     if (!inputRef.current || !isScriptLoaded || !window.google?.maps?.places)
//       return;

//     try {
//       // Clear previous instance if it exists
//       if (autocompleteRef.current) {
//         google.maps.event.clearInstanceListeners(autocompleteRef.current);
//       }

//       // Create new autocomplete instance with specific options
//       const options: google.maps.places.AutocompleteOptions = {
//         componentRestrictions: { country: "IN" },
//         fields: ["address_components", "formatted_address", "geometry"],
//       };

//       autocompleteRef.current = new window.google.maps.places.Autocomplete(
//         inputRef.current,
//         options,
//       );

//       // Add place_changed listener
//       autocompleteRef.current.addListener("place_changed", () => {
//         const place = autocompleteRef.current?.getPlace();
//         if (!place?.formatted_address || !place.geometry?.location) return;

//         const lat = place.geometry.location.lat();
//         const lng = place.geometry.location.lng();

//         // Update internal state first
//         setSelectedAddress(place.formatted_address);

//         // Then call the parent's onChange
//         onChange(place.formatted_address, lat, lng);
//       });
//     } catch (error) {
//       console.error("Error initializing Google Places Autocomplete:", error);
//     }
//   }, [isScriptLoaded, onChange]);

//   // Add CSS to ensure the dropdown is visible and clickable
//   useEffect(() => {
//     const style = document.createElement("style");
//     style.innerHTML = `
//       .pac-container {
//         z-index: 10000 !important;
//         pointer-events: auto !important;
//       }
//       .pac-item {
//         cursor: pointer !important;
//       }
//     `;
//     document.head.appendChild(style);

//     return () => {
//       document.head.removeChild(style);
//     };
//   }, []);

//   // Handle manual input changes
//   const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
//     const newValue = e.target.value;
//     setSelectedAddress(newValue);
//     // Only update parent state when user is typing manually
//     // (not when autocomplete is filling the field)
//     onChange(newValue, null, null);
//   };

//   // Ensure the input value reflects the selected address
//   useEffect(() => {
//     if (inputRef.current && selectedAddress !== inputRef.current.value) {
//       inputRef.current.value = selectedAddress;
//     }
//   }, [selectedAddress]);

//   return (
//     <div className="relative w-full" onClick={(e) => e.stopPropagation()}>
//       <Input
//         ref={inputRef}
//         value={selectedAddress}
//         onChange={handleInputChange}
//         placeholder="Enter address"
//         className="w-full"
//         autoComplete="off"
//         // Prevent clicks from propagating to parent elements
//         onClick={(e) => e.stopPropagation()}
//       />
//       {!isScriptLoaded && (
//         <div className="mt-1 text-sm text-gray-500">
//           Loading address autocomplete...
//         </div>
//       )}
//     </div>
//   );
// });

// Updated version: handles lat,lng from mouse click also
// Fixed: proper script loading + useRef for onChange to prevent stale closure
const AddressAutocomplete = memo(
  ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (address: string, lat: number | null, lng: number | null) => void;
  }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(
      null,
    );
    const onChangeRef = useRef(onChange);
    const [isScriptLoaded, setIsScriptLoaded] = useState(false);
    const [internalValue, setInternalValue] = useState(value);

    // Keep onChange ref updated to avoid stale closure
    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    // Sync internal value with prop
    useEffect(() => {
      setInternalValue(value);
    }, [value]);

    // Script loading logic - properly load Google Maps Places API
    useEffect(() => {
      // Check if already loaded
      if (window.google?.maps?.places) {
        setIsScriptLoaded(true);
        return;
      }

      // Check if script is already being loaded
      const existingScript = document.querySelector(
        'script[src*="maps.googleapis.com/maps/api/js"]',
      );

      if (existingScript) {
        // Wait for existing script to load
        const checkLoaded = setInterval(() => {
          if (window.google?.maps?.places) {
            setIsScriptLoaded(true);
            clearInterval(checkLoaded);
          }
        }, 100);

        // Cleanup interval after 10 seconds
        setTimeout(() => clearInterval(checkLoaded), 10000);
        return;
      }

      // Load the script
      const googleMapScript = document.createElement("script");
      googleMapScript.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&libraries=places`;
      googleMapScript.async = true;
      googleMapScript.defer = true;

      googleMapScript.onload = () => {
        setIsScriptLoaded(true);
      };

      googleMapScript.onerror = () => {
        console.error("Failed to load Google Maps script");
      };

      document.head.appendChild(googleMapScript);
    }, []);

    // Add CSS to ensure the dropdown is visible
    useEffect(() => {
      const style = document.createElement("style");
      style.innerHTML = `
        .pac-container {
          z-index: 10000 !important;
          pointer-events: auto !important;
        }
        .pac-item {
          cursor: pointer !important;
        }
      `;
      document.head.appendChild(style);

      return () => {
        document.head.removeChild(style);
      };
    }, []);

    useEffect(() => {
      if (!inputRef.current || !isScriptLoaded || !window.google?.maps?.places)
        return;

      // Clear previous instance if it exists
      if (autocompleteRef.current) {
        google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }

      // Initialize Autocomplete once
      autocompleteRef.current = new window.google.maps.places.Autocomplete(
        inputRef.current,
        {
          componentRestrictions: { country: "IN" },
          fields: ["formatted_address", "geometry"],
        },
      );

      // Handle Selection - use ref to always get latest onChange
      const listener = autocompleteRef.current.addListener(
        "place_changed",
        () => {
          const place = autocompleteRef.current?.getPlace();

          if (place?.geometry?.location) {
            const addr = place.formatted_address || "";
            const lat = place.geometry.location.lat();
            const lng = place.geometry.location.lng();

            setInternalValue(addr);
            onChangeRef.current(addr, lat, lng);
          }
        },
      );

      return () => {
        if (listener) google.maps.event.removeListener(listener);
      };
    }, [isScriptLoaded]);

    const handleManualTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setInternalValue(val);
      // When typing manually, we clear lat/lng
      onChangeRef.current(val, null, null);
    };

    return (
      <div className="relative w-full">
        <Input
          ref={inputRef}
          value={internalValue}
          onChange={handleManualTyping}
          placeholder="Search address..."
          className="w-full"
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
        />
        {!isScriptLoaded && (
          <div className="mt-1 text-xs text-gray-500">
            Loading address autocomplete...
          </div>
        )}
      </div>
    );
  },
);

export default function InstructorsManagement() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Keep list filters in the route so returning from a schedule restores them.
  const searchTerm = searchParams.get("search") ?? "";
  const statusFilter: InstructorStatusFilter =
    INSTRUCTOR_STATUS_FILTERS.find(
      ({ value }) => value === searchParams.get("status"),
    )?.value ?? "all";

  const updateListFilter = (key: "search" | "status", value: string) => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  const { data: currentAdmin } = useCurrentAdmin();
  const { data: currentUser } = useCurrentUser();
  const canViewUnmaskedPhoneNumbers =
    currentAdmin?.is_super_admin ||
    currentAdmin?.permissions?.includes("view_unmasked_phone_numbers") ||
    currentUser?.permissions?.includes("view_unmasked_phone_numbers") ||
    false;
  const canViewUnmaskedCarNumbers =
    currentAdmin?.is_super_admin ||
    currentAdmin?.permissions?.includes("view_unmasked_car_numbers") ||
    currentUser?.permissions?.includes("view_unmasked_car_numbers") ||
    false;
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formMode, setFormMode] = useState<"add" | "edit">("add");
  const [instructorData, setInstructorData] = useState<InstructorData>(
    initialInstructorData,
  );

  const [newArea, setNewArea] = useState<string>("");
  const [areaSearchQuery, setAreaSearchQuery] = useState<string>("");
  const [isAddingCustomArea, setIsAddingCustomArea] = useState<boolean>(false);
  const [openScheduleDialogId, setOpenScheduleDialogId] = useState<
    string | null
  >(null); // Track which instructor's schedule dialog is open
  const [openSearchScheduleDialogId, setOpenSearchScheduleDialogId] = useState<
    string | null
  >(null); // Track which instructor's schedule dialog is open
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isAddingUnavailability, setIsAddingUnavailability] = useState(false);
  const [unavailabilityType, setUnavailabilityType] = useState<
    "single" | "recurring" | "range"
  >("single");
  const [unavailabilityData, setUnavailabilityData] = useState<
    Partial<Unavailability>
  >({});

  // Delete instructor
  const [deleteConfirmInstructorId, setDeleteConfirmInstructorId] = useState<
    string | null
  >(null);

  const deleteInstructorMutation = useMutation({
    mutationFn: async (instructorId: string) => {
      const today = new Date().toISOString().split("T")[0];

      // 1. Get all future booked/ongoing schedules for this instructor
      const { data: futureSchedules, error: fetchError } = await supabase
        .from("Schedule")
        .select("id, learner_id, status")
        .eq("instructor_id", instructorId)
        .gte("date", today)
        .in("status", ["booked"]);

      if (fetchError) throw new Error(fetchError.message);

      // 2. Collect unique learner IDs that need rescheduling
      const learnerIds = [
        ...new Set(
          (futureSchedules || []).map((s: any) => s.learner_id).filter(Boolean),
        ),
      ];

      // 3. Delete the future booked schedules
      if (futureSchedules && futureSchedules.length > 0) {
        const scheduleIds = futureSchedules.map((s: any) => s.id);
        const { error: deleteScheduleError } = await supabase
          .from("Schedule")
          .delete()
          .in("id", scheduleIds);

        if (deleteScheduleError) throw new Error(deleteScheduleError.message);
      }

      // 4. Set needs_scheduling = true for affected learners
      if (learnerIds.length > 0) {
        const { error: learnerUpdateError } = await supabase
          .from("Learner")
          .update({ needs_scheduling: true } as any)
          .in("id", learnerIds);

        if (learnerUpdateError) throw new Error(learnerUpdateError.message);
      }

      // 5. Delete the instructor
      const { error: deleteError } = await supabase
        .from("Instructor")
        .delete()
        .eq("id_instructor", instructorId);

      if (deleteError) throw new Error(deleteError.message);

      return {
        deletedSchedules: futureSchedules?.length || 0,
        affectedLearners: learnerIds.length,
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["instructors"] });
      toast({
        title: "Instructor Deleted",
        description: `Instructor deleted. ${result.deletedSchedules} upcoming schedule(s) removed. ${result.affectedLearners} learner(s) marked for rescheduling.`,
      });
      setDeleteConfirmInstructorId(null);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const [returnState] = useState(() =>
    instructorListReturnState?.statusFilter === statusFilter &&
    instructorListReturnState.searchTerm === searchTerm
      ? instructorListReturnState
      : undefined,
  );
  const [listSession, setListSession] = useState(returnState?.listSession ?? 0);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(
    returnState?.debouncedSearchTerm ?? searchTerm,
  );
  const pendingScrollRestorationRef = useRef(returnState);

  const selectStatusFilter = (status: InstructorStatusFilter) => {
    queryClient.cancelQueries({ queryKey: ["instructors", "list"] });
    updateListFilter("status", status === "all" ? "" : status);
    setListSession((session) => session + 1);
  };

  const clearStatusFilter = () => {
    selectStatusFilter("all");
  };

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedSearchTerm(searchTerm),
      300,
    );
    return () => window.clearTimeout(timeout);
  }, [searchTerm]);

  // Add tentative schedule info
  // Fetch all servicable areas for suggestions
  const { data: serviceableAreas, isLoading: areasLoading } = useQuery({
    queryKey: ["serviceable-areas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Serviceable_Areas")
        .select("id, name")
        .order("name");

      if (error) throw error;
      return data as ServiceableArea[];
    },
  });

  // Filtered areas based on search query
  const filteredAreas =
    serviceableAreas?.filter((area) =>
      area.name.toLowerCase().includes(areaSearchQuery.toLowerCase()),
    ) || [];

  // Handle selecting an area from the dropdown
  const handleSelectArea = (area: ServiceableArea) => {
    if (!instructorData.areas.includes(area.name)) {
      setInstructorData({
        ...instructorData,
        areas: [...instructorData.areas, area.name],
      });
    } else {
      toast({
        title: "Area already exists",
        description: "This area is already added",
        variant: "destructive",
      });
    }
    setAreaSearchQuery("");
  };

  // Handle adding a custom area that's not in the suggestions
  const handleAddCustomArea = () => {
    if (!areaSearchQuery.trim()) return;

    // Check if area already exists in instructor's areas
    if (instructorData.areas.includes(areaSearchQuery.trim())) {
      toast({
        title: "Area already exists",
        description: "This area is already added to the instructor",
        variant: "destructive",
      });
      return;
    }

    // Add to instructor's areas in local state only
    setInstructorData({
      ...instructorData,
      areas: [...instructorData.areas, areaSearchQuery.trim()],
    });

    setAreaSearchQuery("");
    setIsAddingCustomArea(false);
  };

  const handleCarFuelChange = (
    value: "petrol" | "diesel" | "ev" | "cng" | "lpg" | null,
  ) => {
    if (value === "ev") {
      setInstructorData({
        ...instructorData,
        car_fuel_type: value,
        car_make: "Automatic",
      });
    } else {
      setInstructorData({ ...instructorData, car_fuel_type: value });
    }
  };

  // Handle address change with coordinates
  const handleAddressChange = useCallback(
    (address: string, lat: number | null, lng: number | null) => {
      console.log("Address changed:", address, lat, lng); // Add this for debugging

      setInstructorData((prevData) => ({
        ...prevData,
        address,
        latitude: lat,
        longitude: lng,
      }));
    },
    [],
  );

  const searchFilter = useMemo(
    () => instructorSearchFilter(debouncedSearchTerm),
    [debouncedSearchTerm],
  );

  // Counts are independent HEAD requests: Postgres returns only each exact
  // count, never the instructor rows used by the card list.
  const {
    data: statusCounts = { all: 0, active: 0, on_break: 0, inactive: 0 },
    isLoading: areStatusCountsLoading,
    isError: areStatusCountsError,
  } = useQuery({
    queryKey: ["instructors", "status-counts"],
    queryFn: async () => {
      const entries = await Promise.all(
        INSTRUCTOR_STATUS_FILTERS.map(async ({ value }) => {
          let query = supabase
            .from("Instructor")
            .select("id_instructor", { count: "exact", head: true });

          if (value !== "all") query = query.eq("status", value);

          const { count, error } = await query;
          if (error) throw error;
          return [value, count ?? 0] as const;
        }),
      );

      return Object.fromEntries(entries) as Record<
        InstructorStatusFilter,
        number
      >;
    },
  });

  const isReturningToList =
    returnState?.statusFilter === statusFilter &&
    returnState.debouncedSearchTerm === debouncedSearchTerm &&
    returnState.listSession === listSession;

  const {
    data: instructorPages,
    dataUpdatedAt,
    isLoading: isInstructorListLoading,
    isError: isInstructorListError,
    error: instructorListError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<
    InstructorListPage,
    Error,
    InfiniteData<InstructorListPage, number>,
    (string | number)[],
    number
  >({
    queryKey: [
      "instructors",
      "list",
      statusFilter,
      debouncedSearchTerm,
      listSession,
    ],
    initialData: isReturningToList ? returnState.data : undefined,
    initialDataUpdatedAt: isReturningToList
      ? returnState.dataUpdatedAt
      : undefined,
    // Reuse the loaded pages on return, but still refresh explicitly invalidated data.
    refetchOnMount: (query) => !isReturningToList || query.state.isInvalidated,
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      // Fetch one extra row so we can detect another page without running an
      // additional count query for the card list.
      let query = supabase
        .from("Instructor")
        .select("*")
        .order("name")
        .order("id_instructor")
        .range(pageParam, pageParam + INSTRUCTOR_PAGE_SIZE)
        .abortSignal(signal);

      if (statusFilter !== "all") query = query.eq("status", statusFilter);
      if (searchFilter) query = query.or(searchFilter);

      const { data, error } = await query;
      if (error) throw error;

      // Schedule-heavy detail views fetch their own data. Keeping schedules
      // out of the card query prevents one instructor page from expanding
      // into an unbounded schedule download.
      const rows = (data ?? []).map((instructor) => ({
        ...instructor,
        schedules: [] as Schedule[],
      })) as unknown as (InstructorFromDB & { schedules: Schedule[] })[];

      return {
        instructors: rows.slice(0, INSTRUCTOR_PAGE_SIZE),
        hasMore: rows.length > INSTRUCTOR_PAGE_SIZE,
        nextOffset: pageParam + INSTRUCTOR_PAGE_SIZE,
      };
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextOffset : undefined,
  });

  const instructors = useMemo(
    () => instructorPages?.pages.flatMap((page) => page.instructors) ?? [],
    [instructorPages],
  );

  useLayoutEffect(() => {
    const saved = pendingScrollRestorationRef.current;
    if (!saved || !instructorPages || isInstructorListLoading) return;

    if (
      saved.statusFilter === statusFilter &&
      saved.searchTerm === searchTerm
    ) {
      window.scrollTo({ top: saved.scrollY, behavior: "instant" });
    }
    pendingScrollRestorationRef.current = undefined;
    if (instructorListReturnState === saved)
      instructorListReturnState = undefined;
  }, [instructorPages, isInstructorListLoading, searchTerm, statusFilter]);

  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !hasNextPage) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "0px 0px 200px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  // Add or update an instructor
  const mutation = useMutation({
    mutationFn: async (data: InstructorData) => {
      // First, check for any new areas that need to be added to Serviceable_Areas table
      const newAreas = [];
      for (const area of data.areas) {
        const { data: existingArea } = await supabase
          .from("Serviceable_Areas")
          .select("id, name")
          .ilike("name", area)
          .maybeSingle();

        if (!existingArea) {
          newAreas.push(area);
        }
      }

      // Add any new areas to the Serviceable_Areas table
      if (newAreas.length > 0) {
        const areasToInsert = newAreas.map((area) => ({ name: area }));
        await supabase.from("Serviceable_Areas").insert(areasToInsert);
      }

      // Now proceed with instructor update/insert
      if (formMode === "add") {
        const { data: newInstructor, error } = await supabase
          .from("Instructor")
          .insert([
            {
              name: data.name,
              phone: data.phone,
              email: data.email,
              DL_number: data.DL_number,
              car_make: data.car_make,
              car_mode: data.car_mode,
              experience: data.experience,
              car_number: data.car_number,
              areas: data.areas,
              address: data.address,
              latitude: data.latitude,
              longitude: data.longitude,
              radius: data.radius,
              car_fuel_type: data.car_fuel_type,
              unavailability: data.unavailability,
            },
          ])
          .select();

        if (error) throw error;
        return newInstructor;
      } else {
        if (!data.id_instructor) {
          throw new Error("Instructor ID is missing");
        }

        const { data: updatedInstructor, error } = await supabase
          .from("Instructor")
          .update({
            name: data.name,
            phone: data.phone,
            email: data.email,
            DL_number: data.DL_number,
            car_make: data.car_make,
            car_mode: data.car_mode,
            experience: data.experience,
            car_number: data.car_number,
            areas: data.areas,
            address: data.address,
            latitude: data.latitude,
            longitude: data.longitude,
            radius: data.radius,
            car_fuel_type: data.car_fuel_type,
            unavailability: data.unavailability,
          })
          .eq("id_instructor", data.id_instructor)
          .select();

        if (error) throw error;
        return updatedInstructor;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructors"] });
      queryClient.invalidateQueries({ queryKey: ["serviceable-areas"] });
      setIsDialogOpen(false);
      resetForm();
      toast({
        title: formMode === "add" ? "Instructor Added" : "Instructor Updated",
        description:
          formMode === "add"
            ? "New instructor has been added successfully"
            : "Instructor details have been updated successfully",
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate form
    if (!instructorData.name.trim()) {
      toast({
        title: "Error",
        description: "Name is required",
        variant: "destructive",
      });
      return;
    }

    // --- Email Validation Check ---
    const isValidEmail = (email) => {
      // Regex to check for a basic email structure (e.g., user@domain.com)
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(email);
    };
    if (instructorData.email && !isValidEmail(instructorData.email)) {
      toast({
        title: "Error",
        description: "Invalid email address.",
        variant: "destructive",
      });
      return;
    }

    if (!instructorData.phone.trim()) {
      toast({
        title: "Error",
        description: "Phone number is required",
        variant: "destructive",
      });
      return;
    }

    if (instructorData.phone.length != 10) {
      toast({
        title: "Error",
        description: "Invalid phone number",
        variant: "destructive",
      });
      return;
    }

    if (instructorData.areas.length === 0) {
      toast({
        title: "Error",
        description: "At least one area is required",
        variant: "destructive",
      });
      return;
    }

    if (!instructorData.latitude || !instructorData.longitude) {
      toast({
        title: "Error",
        description: "Enter a valid address from the search bar",
        variant: "destructive",
      });
      return;
    }

    mutation.mutate(instructorData);
  };

  const handleEditInstructor = (instructor: InstructorFromDB) => {
    setFormMode("edit");
    setInstructorData({
      id_instructor: instructor.id_instructor,
      name: instructor.name,
      phone: instructor.phone,
      email: instructor.email || "",
      DL_number: instructor.DL_number || "",
      car_make: instructor.car_make || "",
      car_mode: instructor.car_mode || "",
      experience: instructor.experience || 0,
      car_number: instructor.car_number || "",
      areas: instructor.areas || [],
      address: instructor.address || "",
      latitude: instructor.latitude || null,
      longitude: instructor.longitude || null,
      radius: instructor.radius || 0,
      car_fuel_type: instructor.car_fuel_type as
        | "petrol"
        | "diesel"
        | "ev"
        | "cng"
        | "lpg"
        | null,
      unavailability: instructor.unavailability || [],
    });
    setIsDialogOpen(true);
  };

  const handleAddNewInstructor = () => {
    // Navigate to the comprehensive instructor onboarding wizard
    navigate("/admin/instructor-onboarding");
  };

  const handleQuickAddInstructor = () => {
    setFormMode("add");
    resetForm();
    setIsDialogOpen(true);
  };

  const resetForm = () => {
    setInstructorData(initialInstructorData);
    setNewArea("");
    setAreaSearchQuery("");
    setIsAddingCustomArea(false);
  };

  const handleRemoveArea = (areaToRemove: string) => {
    setInstructorData({
      ...instructorData,
      areas: instructorData.areas.filter((area) => area !== areaToRemove),
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddCustomArea();
    }
  };

  const handleOpenScheduleDialog = (id: string) => {
    console.log("Open schedule fo id`", id);
    if (instructorPages) {
      instructorListReturnState = {
        statusFilter,
        searchTerm,
        debouncedSearchTerm,
        listSession,
        scrollY: window.scrollY,
        data: instructorPages,
        dataUpdatedAt,
      };
    }
    navigate({ pathname: id, search: searchParams.toString() });
    // setOpenScheduleDialogId(id); // Set the ID of the instructor whose dialog is open
  };

  const handleCloseScheduleDialog = () => {
    setOpenScheduleDialogId(null); // Close the dialog
  };

  const handleOpenSearchScheduleDialog = (id: string) => {
    console.log("Search for events of id", id);
    setOpenSearchScheduleDialogId(id); // Set the ID of the instructor whose dialog is open
  };

  const handleCloseSearchScheduleDialog = () => {
    setOpenSearchScheduleDialogId(null); // Close the dialog
  };

  return (
    <div
      className="container mx-auto min-h-screen bg-white p-8"
      style={{
        backgroundImage: 'url("/assets/bg_pattern.svg")',
        backgroundRepeat: "repeat",
        backgroundSize: "cover",
      }}
    >
      <div className="mb-6 flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/admin")}
          className="h-10 w-10"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">Instructor Management</h1>
        <div className="flex gap-2">
          <Button onClick={handleAddNewInstructor}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Onboard Instructor
          </Button>
          <Button variant="outline" onClick={handleQuickAddInstructor}>
            <Plus className="mr-2 h-4 w-4" />
            Quick Add
          </Button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search instructors by name, phone, car, or area..."
            value={searchTerm}
            onChange={(e) => updateListFilter("search", e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Each status opens its own paginated instructor list. */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">
          Status:
        </span>
        {INSTRUCTOR_STATUS_FILTERS.map((s) => {
          const selected = statusFilter === s.value;
          const displayedCount = areStatusCountsLoading
            ? "…"
            : areStatusCountsError
              ? "—"
              : statusCounts[s.value];

          return (
            <div
              key={s.value}
              className={cn(
                "inline-flex items-center overflow-hidden rounded-full border text-sm transition-colors",
                selected
                  ? cn(s.badgeClass, "border-transparent font-semibold")
                  : "border-input bg-white text-muted-foreground",
              )}
            >
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => selectStatusFilter(s.value)}
                className={cn(
                  "flex items-center gap-2 py-1 pl-3 pr-2 transition-colors",
                  !selected && "hover:bg-muted",
                )}
              >
                {selected && <Check className="h-3.5 w-3.5" />}
                <span className={cn("h-2 w-2 rounded-full", s.dotClass)} />
                {s.label}
              </button>
              <button
                type="button"
                disabled={areStatusCountsLoading}
                onClick={() => selectStatusFilter(s.value)}
                aria-label={`Load ${s.label} instructors (${displayedCount})`}
                title={`Load ${s.label} instructors`}
                className="hover:ring-current/20 mr-1 cursor-pointer rounded-full bg-white/60 px-1.5 text-xs font-semibold transition-shadow hover:ring-2 disabled:cursor-wait"
              >
                {displayedCount}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={clearStatusFilter}
          className="flex items-center gap-1 text-sm text-muted-foreground underline-offset-2 hover:underline"
        >
          <X className="h-3.5 w-3.5" />
          Clear filter
        </button>
      </div>
      {isInstructorListLoading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent">
            <ChevronsUpDown> </ChevronsUpDown>
          </div>
        </div>
      ) : isInstructorListError ? (
        <div className="flex h-48 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 text-center text-sm text-destructive">
          {instructorListError instanceof Error
            ? instructorListError.message
            : "Unable to load instructors."}
        </div>
      ) : instructors.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-lg border border-dashed bg-white/70 px-6 text-center text-sm text-muted-foreground">
          No instructors match the selected status and search.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {instructors.map((instructor) => (
              <Card
                key={instructor.id_instructor}
                className="flex h-full flex-col overflow-hidden rounded-lg shadow-lg"
              >
                <CardHeader className="bg-primary p-4 text-white">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-lg font-bold">
                        {instructor.name}
                      </CardTitle>
                      <p className="text-sm">
                        {instructor.email || "No email provided"}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
                        instructorStatusMeta(
                          resolveInstructorStatus(instructor),
                        ).badgeClass,
                      )}
                    >
                      {
                        instructorStatusMeta(
                          resolveInstructorStatus(instructor),
                        ).label
                      }
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 p-4">
                  <div className="space-y-2">
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">
                        Phone:
                      </span>
                      <p>
                        {canViewUnmaskedPhoneNumbers
                          ? instructor.phone
                          : maskPhoneNumber(instructor.phone)}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">
                        Address:
                      </span>
                      <p>{instructor.address || "No address provided"}</p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">
                        Radius:
                      </span>
                      <p>
                        {instructor.radius
                          ? `${instructor.radius} km`
                          : "No radius provided"}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">
                        DL Number:
                      </span>
                      <p>{instructor.DL_number || "Not provided"}</p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">
                        Car Details:
                      </span>
                      <p>
                        {instructor.car_make || "N/A"} -{" "}
                        {instructor.car_mode || "N/A"} (
                        {instructor.car_number
                          ? canViewUnmaskedCarNumbers
                            ? instructor.car_number
                            : maskCarNumber(instructor.car_number)
                          : "N/A"}
                        )
                      </p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">
                        Experience:
                      </span>
                      <p>{instructor.experience || "Not provided"}</p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">
                        Areas:
                      </span>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {instructor.areas?.map((area: string) => (
                          <span
                            key={area}
                            className="inline-block rounded bg-muted px-2 py-1 text-xs"
                          >
                            {area}
                          </span>
                        )) || "No areas assigned"}
                      </div>
                    </div>
                  </div>
                </CardContent>
                {/* View Schedule Button */}
                <div className="mt-auto flex flex-col gap-2 p-4">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      handleOpenScheduleDialog(instructor.id_instructor)
                    }
                  >
                    View Schedule
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() =>
                      handleOpenSearchScheduleDialog(instructor.id_instructor)
                    }
                  >
                    Search Schedule
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => handleEditInstructor(instructor)}
                  >
                    Edit Details
                  </Button>
                  <div className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-1.5">
                    <span className="text-sm text-muted-foreground">
                      Status
                    </span>
                    <InstructorStatusControl
                      instructorId={instructor.id_instructor}
                      status={resolveInstructorStatus(instructor)}
                      size="compact"
                    />
                  </div>
                  <Button
                    variant="destructive"
                    className="w-full"
                    onClick={() =>
                      setDeleteConfirmInstructorId(instructor.id_instructor)
                    }
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Instructor
                  </Button>
                </div>

                {/* Delete Confirmation Dialog */}
                {deleteConfirmInstructorId === instructor.id_instructor && (
                  <Dialog
                    open={true}
                    onOpenChange={() => setDeleteConfirmInstructorId(null)}
                  >
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Delete Instructor</DialogTitle>
                        <DialogDescription>
                          Are you sure you want to delete{" "}
                          <strong>{instructor.name}</strong>? This will:
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-left">
                            <li>
                              Remove all upcoming booked schedules for this
                              instructor
                            </li>
                            <li>
                              Mark affected learners as needing rescheduling
                            </li>
                            <li>Permanently delete the instructor record</li>
                          </ul>
                          <p className="mt-2 font-semibold text-destructive">
                            This action cannot be undone.
                          </p>
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter className="gap-2">
                        <Button
                          variant="outline"
                          onClick={() => setDeleteConfirmInstructorId(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={deleteInstructorMutation.isPending}
                          onClick={() =>
                            deleteInstructorMutation.mutate(
                              instructor.id_instructor,
                            )
                          }
                        >
                          {deleteInstructorMutation.isPending
                            ? "Deleting..."
                            : "Delete"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}

                {/* Schedule Dialog */}
                {openScheduleDialogId === instructor.id_instructor && (
                  <Dialog open={true} onOpenChange={handleCloseScheduleDialog}>
                    <DialogContent className="p-4 sm:max-w-[1200px]">
                      <DialogHeader className="mb-0 p-0">
                        <DialogTitle className="p-0 text-base font-semibold">
                          {instructor.name}'s Weekly Schedule
                        </DialogTitle>
                      </DialogHeader>
                      <div className="mt-1">
                        <WeeklyScheduleView
                          instructor_id={instructor.id_instructor}
                          instructorName={instructor.name}
                          // Pass schedules and unavailability to the schedule view
                          schedules={instructor.schedules}
                          unavailability={instructor.unavailability || []}
                        />
                      </div>
                      {/* <DialogFooter className="pt-0 p-0 mt-2 flex justify-end">  */}
                      {/* Reduced vertical padding (p-0, pt-0) and kept small top margin (mt-2) */}
                      {/* <Button
                        variant="outline"
                        size="xs" 
                        className="h-6 px-2 py-0 text-xs" // Explicitly set height, horizontal padding, zero vertical padding, and smallest text size
                        onClick={handleCloseScheduleDialog}
                      >
                        Close
                      </Button> */}
                      {/* </DialogFooter> */}
                    </DialogContent>
                  </Dialog>
                )}
                {/* Search schedule dialog */}
                {openSearchScheduleDialogId === instructor.id_instructor && (
                  <Dialog
                    key={instructor.id_instructor}
                    open={true}
                    onOpenChange={handleCloseSearchScheduleDialog}
                  >
                    <DialogContent className="sm:max-w-[1200px]">
                      <DialogHeader>
                        <DialogTitle>
                          Search {instructor.name}'s Schedule
                        </DialogTitle>
                      </DialogHeader>
                      <div className="mt-4">
                        {/* {instructor.id_instructor} */}
                        <SearchInstructorScheduleInfo
                          instructorId={instructor.id_instructor}
                          openFlag={!!openSearchScheduleDialogId}
                          closeAction={() =>
                            setOpenSearchScheduleDialogId(null)
                          }
                        />
                      </div>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={handleCloseSearchScheduleDialog}
                        >
                          Close
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </Card>
            ))}
          </div>
          <div
            ref={loadMoreSentinelRef}
            className="flex min-h-16 items-center justify-center py-4 text-sm text-muted-foreground"
          >
            {isFetchingNextPage ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading more instructors…
              </>
            ) : hasNextPage ? (
              "Scroll to load more"
            ) : (
              `All ${instructors.length} matching instructor${instructors.length === 1 ? "" : "s"} loaded`
            )}
          </div>
        </>
      )}

      {/* Add/Edit Instructor Dialog */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          // Only close if explicitly set to false
          if (!open) {
            setIsDialogOpen(false);
          }
        }}
      >
        <DialogContent
          className="scrollbar-none h-[calc(100vh-50px)] max-h-[80vh] overflow-y-auto sm:max-w-[500px]"
          style={{ scrollbarWidth: "none" }}
          // Prevent clicks inside from closing the dialog
          onPointerDownOutside={(e) => {
            const target = e.target as HTMLElement;
            if (
              target.closest(".pac-container") ||
              target.closest(".pac-item")
            ) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {formMode === "add"
                ? "Add New Instructor"
                : "Edit Instructor Details"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right">
                  Name<span className="text-red-500">*</span>
                </Label>
                <Input
                  id="name"
                  value={instructorData.name}
                  onChange={(e) =>
                    setInstructorData({
                      ...instructorData,
                      name: e.target.value,
                    })
                  }
                  className="col-span-3"
                  required
                />
              </div>
              {canViewUnmaskedPhoneNumbers && (
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="phone" className="text-right">
                    Phone<span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="phone"
                    value={instructorData.phone}
                    onChange={(e) =>
                      setInstructorData({
                        ...instructorData,
                        phone: e.target.value,
                      })
                    }
                    className="col-span-3"
                    required
                  />
                </div>
              )}
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="address" className="text-right">
                  Address
                </Label>
                <div className="col-span-3">
                  <AddressAutocomplete
                    // Add static key to avoid re-rendering from top level DOM
                    key="tentative-schedule-address"
                    value={instructorData.address}
                    onChange={handleAddressChange}
                  />
                </div>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="radius" className="text-right">
                  Radius (km)
                </Label>
                <Input
                  id="radius"
                  type="number"
                  value={instructorData.radius}
                  onChange={(e) =>
                    setInstructorData({
                      ...instructorData,
                      radius: parseFloat(e.target.value) || 0,
                    })
                  }
                  min={0}
                  className="col-span-3"
                  onWheel={(e) => e.currentTarget.blur()}
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="email" className="text-right">
                  Email
                </Label>
                <Input
                  id="email"
                  value={instructorData.email}
                  onChange={(e) =>
                    setInstructorData({
                      ...instructorData,
                      email: e.target.value,
                    })
                  }
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="DL_number" className="text-right">
                  DL Number
                </Label>
                <Input
                  id="DL_number"
                  value={instructorData.DL_number}
                  onChange={(e) =>
                    setInstructorData({
                      ...instructorData,
                      DL_number: e.target.value,
                    })
                  }
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="car_fuel" className="text-right">
                  Car Fuel
                </Label>
                <Select
                  value={instructorData.car_fuel_type || undefined}
                  onValueChange={(value) =>
                    handleCarFuelChange(
                      value as
                        | "petrol"
                        | "diesel"
                        | "ev"
                        | "cng"
                        | "lpg"
                        | null,
                    )
                  }
                >
                  <SelectTrigger className="col-span-3">
                    <SelectValue placeholder="Select Car Fuel" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="petrol">Petrol</SelectItem>
                    <SelectItem value="diesel">Diesel</SelectItem>
                    <SelectItem value="ev">EV</SelectItem>
                    <SelectItem value="cng">CNG</SelectItem>
                    <SelectItem value="lpg">LPG</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="car_make" className="text-right">
                  Car Make
                </Label>
                <Select
                  value={instructorData.car_make || ""}
                  onValueChange={(value) =>
                    setInstructorData({ ...instructorData, car_make: value })
                  }
                >
                  <SelectTrigger className="col-span-3">
                    <SelectValue placeholder="Select Car Make" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Manual">Manual</SelectItem>
                    <SelectItem value="Automatic">Automatic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="car_mode" className="text-right">
                  Car Model
                </Label>
                <Input
                  id="car_mode"
                  value={instructorData.car_mode}
                  onChange={(e) =>
                    setInstructorData({
                      ...instructorData,
                      car_mode: e.target.value,
                    })
                  }
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="experience" className="text-right">
                  Experience
                </Label>
                <Input
                  id="experience"
                  type="number"
                  value={instructorData.experience}
                  onChange={(e) =>
                    setInstructorData({
                      ...instructorData,
                      experience: parseFloat(e.target.value) || 0,
                    })
                  }
                  min={0}
                  className="col-span-3"
                  onWheel={(e) => e.currentTarget.blur()}
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="car_number" className="text-right">
                  Car Number
                </Label>
                <Input
                  id="car_number"
                  value={instructorData.car_number}
                  onChange={(e) =>
                    setInstructorData({
                      ...instructorData,
                      car_number: e.target.value,
                    })
                  }
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 gap-4">
                <Label className="pt-2 text-right">Servicable Areas</Label>
                <div className="col-span-3">
                  {/* Area search dropdown */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        className="w-full justify-between"
                      >
                        {areaSearchQuery || "Search areas..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-full p-0">
                      <div className="p-2">
                        <Input
                          placeholder="Search areas..."
                          value={areaSearchQuery}
                          onChange={(e) => setAreaSearchQuery(e.target.value)}
                          onKeyPress={handleKeyPress}
                          className="mb-2"
                        />
                      </div>

                      {areasLoading ? (
                        <div className="flex justify-center p-4">
                          <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
                        </div>
                      ) : filteredAreas.length > 0 ? (
                        <div
                          className="max-h-60 overflow-y-auto"
                          onWheel={(e) => e.stopPropagation()}
                        >
                          {filteredAreas.map((area) => (
                            <div
                              key={area.id}
                              className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm hover:bg-primary/10"
                              onClick={() => handleSelectArea(area)}
                            >
                              <span>{area.name}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="py-6 text-center">
                          {areaSearchQuery ? (
                            <div className="px-4 py-2">
                              <p className="mb-2 text-sm">
                                No matching areas found.
                              </p>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleAddCustomArea()}
                                className="w-full"
                              >
                                Add '{areaSearchQuery}' as new area
                              </Button>
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              Type to search areas
                            </p>
                          )}
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {instructorData.areas.map((area) => (
                      <div
                        key={area}
                        className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm"
                      >
                        {area}
                        <button
                          type="button"
                          onClick={() => handleRemoveArea(area)}
                          className="text-gray-500 hover:text-gray-700"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>

                  {instructorData.areas.length === 0 && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      No areas added. Please add at least one area.
                    </p>
                  )}
                </div>
              </div>
              {/* Add this inside the form's grid of inputs */}
              <div className="grid grid-cols-4 gap-4">
                <Label className="pt-2 text-right">Unavailability</Label>
                <div className="col-span-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsAddingUnavailability(true)}
                  >
                    Add Unavailability Period
                  </Button>

                  {instructorData.unavailability.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {instructorData.unavailability.map((period, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between rounded bg-muted p-2 text-sm"
                        >
                          <div>
                            {period.all_day && period.booked_date && (
                              <span>All day on {period.booked_date}</span>
                            )}
                            {period.day_of_week && period.all_day && (
                              <span>All day every {period.day_of_week}</span>
                            )}
                            {period.day_of_week && !period.all_day && (
                              <span>
                                Every {period.day_of_week}:{" "}
                                {period.booked_start_time} -{" "}
                                {period.booked_end_time}
                              </span>
                            )}
                            {!period.all_day &&
                              !period.day_of_week &&
                              period.booked_date && (
                                <span>
                                  {period.booked_date}:{" "}
                                  {period.booked_start_time} -{" "}
                                  {period.booked_end_time}
                                </span>
                              )}
                            {period.start_date &&
                              period.end_date &&
                              period.range_all_day && (
                                <span>
                                  All day from {period.start_date} to{" "}
                                  {period.end_date}
                                </span>
                              )}
                            {period.start_date &&
                              period.end_date &&
                              !period.range_all_day && (
                                <span>
                                  {period.start_date} to {period.end_date}:{" "}
                                  {period.range_start_time} -{" "}
                                  {period.range_end_time}
                                </span>
                              )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const updatedUnavailability = [
                                ...instructorData.unavailability,
                              ];
                              updatedUnavailability.splice(index, 1);
                              setInstructorData({
                                ...instructorData,
                                unavailability: updatedUnavailability,
                              });
                            }}
                          >
                            <X size={14} />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending
                  ? "Saving..."
                  : formMode === "add"
                    ? "Add Instructor"
                    : "Update Instructor"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {/* Add this outside the main Dialog but inside the component */}
      <Dialog
        open={isAddingUnavailability}
        onOpenChange={setIsAddingUnavailability}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Unavailability Period</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={unavailabilityType}
                onValueChange={(value) =>
                  setUnavailabilityType(
                    value as "single" | "recurring" | "range",
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single Day</SelectItem>
                  <SelectItem value="recurring">Weekly Recurring</SelectItem>
                  <SelectItem value="range">Date Range</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {unavailabilityType === "single" && (
              <>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={unavailabilityData.booked_date || ""}
                    onChange={(e) =>
                      setUnavailabilityData({
                        ...unavailabilityData,
                        booked_date: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="all-day"
                      checked={!!unavailabilityData.all_day}
                      onChange={(e) =>
                        setUnavailabilityData({
                          ...unavailabilityData,
                          all_day: e.target.checked,
                        })
                      }
                    />
                    <Label htmlFor="all-day">All Day</Label>
                  </div>
                </div>
                {!unavailabilityData.all_day && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Start Time</Label>
                      <Input
                        type="time"
                        step="1800"
                        value={unavailabilityData.booked_start_time || ""}
                        onChange={(e) =>
                          setUnavailabilityData({
                            ...unavailabilityData,
                            booked_start_time: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>End Time</Label>
                      <Input
                        type="time"
                        step="1800"
                        value={unavailabilityData.booked_end_time || ""}
                        onChange={(e) =>
                          setUnavailabilityData({
                            ...unavailabilityData,
                            booked_end_time: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {unavailabilityType === "recurring" && (
              <>
                <div className="space-y-2">
                  <Label>Day of Week</Label>
                  <Select
                    value={unavailabilityData.day_of_week || ""}
                    onValueChange={(value) =>
                      setUnavailabilityData({
                        ...unavailabilityData,
                        day_of_week: value,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select day" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monday">Monday</SelectItem>
                      <SelectItem value="tuesday">Tuesday</SelectItem>
                      <SelectItem value="wednesday">Wednesday</SelectItem>
                      <SelectItem value="thursday">Thursday</SelectItem>
                      <SelectItem value="friday">Friday</SelectItem>
                      <SelectItem value="saturday">Saturday</SelectItem>
                      <SelectItem value="sunday">Sunday</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="recurring-all-day"
                      checked={!!unavailabilityData.all_day}
                      onChange={(e) =>
                        setUnavailabilityData({
                          ...unavailabilityData,
                          all_day: e.target.checked,
                        })
                      }
                    />
                    <Label htmlFor="recurring-all-day">All Day</Label>
                  </div>
                </div>
                {!unavailabilityData.all_day && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Start Time</Label>
                      <Input
                        type="time"
                        step="1800"
                        value={unavailabilityData.booked_start_time || ""}
                        onChange={(e) =>
                          setUnavailabilityData({
                            ...unavailabilityData,
                            booked_start_time: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>End Time</Label>
                      <Input
                        type="time"
                        step="1800"
                        value={unavailabilityData.booked_end_time || ""}
                        onChange={(e) =>
                          setUnavailabilityData({
                            ...unavailabilityData,
                            booked_end_time: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {unavailabilityType === "range" && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Start Date</Label>
                    <Input
                      type="date"
                      value={unavailabilityData.start_date || ""}
                      onChange={(e) =>
                        setUnavailabilityData({
                          ...unavailabilityData,
                          start_date: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>End Date</Label>
                    <Input
                      type="date"
                      value={unavailabilityData.end_date || ""}
                      onChange={(e) =>
                        setUnavailabilityData({
                          ...unavailabilityData,
                          end_date: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="range-all-day"
                      checked={!!unavailabilityData.range_all_day}
                      onChange={(e) =>
                        setUnavailabilityData({
                          ...unavailabilityData,
                          range_all_day: e.target.checked,
                        })
                      }
                    />
                    <Label htmlFor="range-all-day">All Day</Label>
                  </div>
                </div>
                {!unavailabilityData.range_all_day && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Start Time</Label>
                      <Input
                        type="time"
                        step="1800"
                        value={unavailabilityData.range_start_time || ""}
                        onChange={(e) =>
                          setUnavailabilityData({
                            ...unavailabilityData,
                            range_start_time: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>End Time</Label>
                      <Input
                        type="time"
                        step="1800"
                        value={unavailabilityData.range_end_time || ""}
                        onChange={(e) =>
                          setUnavailabilityData({
                            ...unavailabilityData,
                            range_end_time: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsAddingUnavailability(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setInstructorData({
                  ...instructorData,
                  unavailability: [
                    ...instructorData.unavailability,
                    unavailabilityData,
                  ],
                });
                setUnavailabilityData({});
                setIsAddingUnavailability(false);
              }}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WeeklyScheduleView({
  instructor_id,
  schedules,
  unavailability,
}: {
  schedules: any[];
  unavailability: Unavailability[];
}) {
  const [currentWeekStart, setCurrentWeekStart] = useState(
    startOfWeek(new Date()),
  );
  const [isTentativeDialogOpen, setIsTentativeDialogOpen] = useState(false);
  const [isTentativeCopyDialogOpen, setIsTentativeCopyDialogOpen] =
    useState(false);
  const [formMode, setFormMode] = useState<"add" | "edit">("add");
  const [instructorId, setInstructorId] = useState(instructor_id);
  const [searchQuery, setSearchQuery] = useState("");
  const [tentativeSchedule, setTentativeSchedule] = useState<any>({
    id: "",
    date: "",
    start_time: "",
    end_time: "",
    enabled: true,
    isTentative: true,
    tentative_details: {
      name: "",
      phone: "",
      paid_info: "",
      pickup_location: "",
      description: "",
      leadName: "",
      address: "",
      latitude: "",
      longitude: "",
    },
  });
  // const [tentativeSchedule, setTentativeSchedule] = useState<any>(null);
  const [tentativeScheduleCopy, setTentativeScheduleCopy] = useState<any>({
    id: "",
    date: "",
    start_time: "",
    end_time: "",
    enabled: true,
    isTentative: true,
    tentative_details: {
      name: "",
      phone: "",
      paid_info: "",
      pickup_location: "",
      description: "",
      leadName: "",
      address: "",
      latitude: "",
      longitude: "",
    },
  });
  const MIN_DAYS = 1;
  const DEFAULT_DAYS = 7;
  const MAX_DAYS = 30;
  const [numDaysPerView, setNumDaysPerView] = useState(DEFAULT_DAYS);
  const isZoomedOut = numDaysPerView > 14;
  const isVeryZoomedOut = numDaysPerView > 21;

  // State for Hover Highlighting
  const [hoveredDayIndex, setHoveredDayIndex] = useState<number | null>(null);
  const [hoveredTimeIndex, setHoveredTimeIndex] = useState<number | null>(null);

  // Confirmation dialog state for tentative slot deletion
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Drag-to-create selection (Google-Calendar-style).
  // We mirror the drag into refs so the window-level mouse-up listener
  // (registered once on mount) can read the latest values without depending
  // on render-cycle timing — otherwise a fast single click finishes before
  // React re-runs the effect and the listener never sees it.
  const [dragStart, setDragStart] = useState<{
    dayIndex: number;
    timeIndex: number;
  } | null>(null);
  const [dragEnd, setDragEnd] = useState<{
    dayIndex: number;
    timeIndex: number;
  } | null>(null);
  const dragStartRef = useRef<typeof dragStart>(null);
  const dragEndRef = useRef<typeof dragEnd>(null);
  const currentWeekStartRef = useRef(currentWeekStart);
  const instructorIdRef = useRef(instructorId);
  useEffect(() => {
    dragStartRef.current = dragStart;
  }, [dragStart]);
  useEffect(() => {
    dragEndRef.current = dragEnd;
  }, [dragEnd]);
  useEffect(() => {
    currentWeekStartRef.current = currentWeekStart;
  }, [currentWeekStart]);
  useEffect(() => {
    instructorIdRef.current = instructorId;
  }, [instructorId]);

  // Whether a given (dayIndex, timeIndex) cell falls inside the active drag.
  const isInDragRange = (dayIndex: number, timeIndex: number) => {
    if (!dragStart || !dragEnd) return false;
    if (dayIndex !== dragStart.dayIndex) return false;
    const lo = Math.min(dragStart.timeIndex, dragEnd.timeIndex);
    const hi = Math.max(dragStart.timeIndex, dragEnd.timeIndex);
    return timeIndex >= lo && timeIndex <= hi;
  };
  const TIME_FORMAT = "HH:mm";
  const DATE_FORMAT = "yyyy-MM-dd";
  const WEEKDAY_NAMES = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  const columnWidthPercentage = 100 / numDaysPerView;

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // 2. For the Edit Tentative Schedule Dialog
  const memoizedTentativeAddressValue = useMemo(
    () => tentativeSchedule.tentative_details.pickup_location,
    [tentativeSchedule.tentative_details.pickup_location],
  );

  // Helper to change the number of days displayed (Zoom)
  const handleZoom = (direction: "+" | "-") => {
    setNumDaysPerView((prevNumDays) => {
      if (direction === "+") {
        // Zoom out (more days), capped at MAX_DAYS (30)
        return Math.min(MAX_DAYS, prevNumDays + 1);
      } else if (direction === "-") {
        // Zoom in (fewer days), capped at MIN_DAYS (7)
        return Math.max(MIN_DAYS, prevNumDays - 1);
      }
      return prevNumDays;
    });
  };

  // console.log("Initial state of tentative schedule and isTentativeDialogOpen", tentativeSchedule, isTentativeDialogOpen);
  const setScheduleHelper = (schedule) => {
    console.log(
      "Helper setting tentative details as",
      schedule.tentative_details,
    );
    setTentativeSchedule({
      id: schedule.id,
      date: schedule.date,
      start_time: schedule.start_time,
      end_time: schedule.end_time,
      enabled: schedule.enabled,
      isTentative: schedule.isTentative,
      instructor_id: instructorId,
      tentative_details: {
        name: schedule?.tentative_details?.name || "",
        phone: schedule?.tentative_details?.phone || "",
        paid_info: schedule?.tentative_details?.paid_info || "",
        pickup_location: schedule?.tentative_details?.pickup_location || "",
        description: schedule?.tentative_details?.description || "",
        leadName: schedule?.tentative_details?.leadName || "",
        latitude: schedule?.tentative_details?.latitude || "",
        longitude: schedule?.tentative_details?.longitude || "",
      },
    });
  };

  const initialTentativeSchedule = {
    id: "",
    date: "",
    start_time: "",
    end_time: "",
    enabled: true,
    isTentative: true,
    learner_id: "",
    instructor_id: instructorId,
    tentative_details: {
      name: "",
      phone: "",
      paid_info: "",
      pickup_location: "",
      description: "",
      address: "",
      latitude: "",
      longitude: "",
    },
  };
  const resetTentativeForm = () => {
    setTentativeSchedule(initialTentativeSchedule);
  };

  const resetTentativeCopyForm = () => {
    const initialTentativeCopySchedule = {
      id: "",
      date: "",
      start_time: "",
      end_time: "",
      enabled: true,
      isTentative: true,
      learner_id: "",
      instructor_id: instructorId,
      tentative_details: {
        name: "",
        phone: "",
        paid_info: "",
        pickup_location: "",
        description: "",
        address: "",
        latitude: "",
        longitude: "",
      },
    };
    setTentativeScheduleCopy(initialTentativeCopySchedule);
  };

  // Add or update a tentative schedule
  const tentativeScheduleMutation = useMutation({
    mutationFn: async (data: Schedule) => {
      // Now proceed with tentative schedule update/insert
      // console.log("tentativeSch at mutation", tentativeSchedule);
      if (formMode === "add") {
        const { data: newTentativeSchedule, error } = await supabase
          .from("Schedule")
          .insert([
            {
              date: tentativeSchedule.date,
              start_time: tentativeSchedule.start_time,
              end_time: tentativeSchedule.end_time,
              enabled: tentativeSchedule.enabled,
              isTentative: tentativeSchedule.isTentative,
              instructor_id: instructorId,
              tentative_details: {
                name: tentativeSchedule.tentative_details.name,
                phone: tentativeSchedule.tentative_details.phone,
                paid_info: tentativeSchedule.tentative_details.paid_info,
                pickup_location:
                  tentativeSchedule.tentative_details.pickup_location,
                latitude: tentativeSchedule.tentative_details.latitude,
                longitude: tentativeSchedule.tentative_details.longitude,
                description: tentativeSchedule.tentative_details.description,
                leadName: tentativeSchedule.tentative_details.leadName,
              },
            },
          ])
          .select();

        if (error) throw error;
        return newTentativeSchedule;
      } else {
        if (!data.id) {
          throw new Error("Schedule ID missing for added schedule");
        }

        const { data: updatedTentativeSchedule, error } = await supabase
          .from("Schedule")
          .update({
            date: tentativeSchedule.date,
            start_time: tentativeSchedule.start_time,
            end_time: tentativeSchedule.end_time,
            enabled: tentativeSchedule.enabled,
            isTentative: tentativeSchedule.isTentative,
            instructor_id: instructorId,
            tentative_details: {
              name: tentativeSchedule.tentative_details.name,
              phone: tentativeSchedule.tentative_details.phone,
              paid_info: tentativeSchedule.tentative_details.paid_info,
              pickup_location:
                tentativeSchedule.tentative_details.pickup_location,
              latitude: tentativeSchedule.tentative_details.latitude,
              longitude: tentativeSchedule.tentative_details.longitude,
              description: tentativeSchedule.tentative_details.description,
              leadName: tentativeSchedule.tentative_details.leadName,
            },
          })
          .eq("id", tentativeSchedule.id)
          .select();

        if (error) throw error;
        return updatedTentativeSchedule;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructors"] });
      setIsTentativeDialogOpen(false);
      resetTentativeForm();
      toast({
        title:
          formMode === "add" ? "Tentative Schedule Added" : "Schedule Updated",
        description:
          formMode === "add"
            ? "Tentative schedule has been added successfully"
            : "Tentative schedule details have been updated successfully",
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
  const handleWeekChange = (direction: "prev" | "next") => {
    setCurrentWeekStart((prev) =>
      direction === "next"
        ? addDays(prev, numDaysPerView)
        : addDays(prev, -numDaysPerView),
    );
  };

  const validateTentativeForm = (formDataSchedule): boolean => {
    console.log("Validating", formDataSchedule);
    // Validate form
    if (
      !formDataSchedule.date ||
      !(formDataSchedule.date instanceof Date) ||
      isNaN(formDataSchedule.date.getTime())
    ) {
      toast({
        title: "Error",
        description: "Cannot retrieve date info",
        variant: "destructive",
      });
      return false;
    }

    if (!formDataSchedule.start_time.trim()) {
      toast({
        title: "Error",
        description: "Cannot retreive start time",
        variant: "destructive",
      });
      return false;
    }

    if (!formDataSchedule.end_time.trim()) {
      toast({
        title: "Error",
        description: "Cannot retreive end time",
        variant: "destructive",
      });
      return false;
    }
    if (formDataSchedule.tentative_details.name.length === 0) {
      toast({
        title: "Error",
        description: "Customer name is required",
        variant: "destructive",
      });
      return false;
    }

    if (formDataSchedule.tentative_details.phone.length === 0) {
      toast({
        title: "Error",
        description: "Customer phone is required",
        variant: "destructive",
      });
      return false;
    }
    if (formDataSchedule.tentative_details.paid_info.length === 0) {
      toast({
        title: "Error",
        description: "Paid/Unpaid information is required",
        variant: "destructive",
      });
      return false;
    }

    if (formDataSchedule.tentative_details.pickup_location.length === 0) {
      toast({
        title: "Error",
        description: "Customer pickup location is required",
        variant: "destructive",
      });
      return false;
    }
    if (formDataSchedule.tentative_details.description.length > 1024) {
      toast({
        title: "Error",
        description: "Description length exceeded (1024 characters)",
        variant: "destructive",
      });
      return false;
    }
    if (formDataSchedule.tentative_details.leadName.length === 0) {
      toast({
        title: "Error",
        description: "Lead name is required",
        variant: "destructive",
      });
      return false;
    }

    return true;
  };
  const handleTentativeSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tentativeSchedule) {
      console.error("Tentative schedule is null");
      return;
    }

    if (!validateTentativeForm(tentativeSchedule)) return;

    tentativeScheduleMutation.mutate(tentativeSchedule);
  };

  const handleTentativeCopySave = (e: React.FormEvent) => {
    e.preventDefault();
    // alert("Saving copy data");
    if (!tentativeScheduleCopy) {
      console.error("Tentative schedule copy is null");
      return;
    }

    if (!validateTentativeForm(tentativeScheduleCopy)) {
      console.error("Copy form validation failed", tentativeScheduleCopy);
      return;
    }

    copyTentativeMutation.mutate(tentativeScheduleCopy);
    // tentativeScheduleMutation.mutate(tentativeScheduleCopy);
  };

  const handlePaidInfoChange = (
    value: "Unpaid" | "Half paid" | "Full paid" | null,
  ) => {
    setTentativeSchedule({
      ...tentativeSchedule,
      // Correctly update the nested 'tentative_details' object
      tentative_details: {
        ...tentativeSchedule.tentative_details,
        paid_info: value,
      },
    });
  };

  // Handle address change with coordinates - Tentative Schedule
  const handleAddressChangeTentative = useCallback(
    (address: string, lat: number | null, lng: number | null) => {
      console.log("Address changed:", address, lat, lng); // Add this for debugging
      // Use the functional update form of setTentativeSchedule
      setTentativeSchedule((prevSchedule) => ({
        ...prevSchedule,
        tentative_details: {
          ...prevSchedule.tentative_details, // Use prevSchedule here
          pickup_location: address,
          latitude: lat,
          longitude: lng,
        },
      }));
      // if (!lat || !lng) {console.log("Either lat or lng was null", lat, lng);
      // console.log('%c[] -> tentativeSchedule : ', 'color: #50952e', tentativeSchedule.tentative_details);
      // }
    },
    [], // No dependencies to avoid recreating this function
  );

  // Helper function to check if a time slot is unavailable
  const isTimeSlotUnavailable = (day: Date, hour: number, minute: number) => {
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

      return false;
    });
  };

  const formatDateForInput = (date: string | Date): string => {
    if (!date) {
      return "";
    }

    // Convert the input (which might be a Date object or string) into a Date object.
    const dateObj = new Date(date);

    // Check if the date conversion resulted in an invalid date
    if (isNaN(dateObj.getTime())) {
      console.error("Invalid date passed to formatter:", date);
      return "";
    }

    // The .toISOString() method returns a string like "2025-09-30T07:30:00.000Z".
    // We take the first 10 characters to get the required "YYYY-MM-DD" format.
    // NOTE: This will treat the date as a UTC date, which is standard practice
    // for date inputs unless specific local-time handling is needed.
    return dateObj.toISOString().substring(0, 10);
  };

  const handleOccupiedSlotClick = (schedule: Schedule) => {
    toast({
      title: "Booked",
      // description: `This slot is booked for ${schedule?.learner?.name || "a learner"}.`,
      description: `The slot is booked.`,
    });
    console.log("Occupied schedule details:", schedule);
  };
  const handleTentativeSlotClick = (
    schedule,
    day,
    hour,
    minute,
    endHour?: number,
    endMinute?: number,
  ) => {
    console.log("Tentative slot clicked:", {
      schedule,
      day,
      hour,
      minute,
      endHour,
      endMinute,
    });

    // Check if this is an existing tentative schedule (has id and tentative_details with data)
    if (schedule && schedule.id && schedule.isTentative) {
      // Editing existing tentative schedule
      setFormMode("edit");
      setTentativeSchedule({
        id: schedule.id,
        date: schedule.date,
        start_time: schedule.start_time,
        end_time: schedule.end_time,
        enabled: schedule.enabled,
        isTentative: true,
        instructor_id: instructorId,
        tentative_details: {
          name: schedule.tentative_details?.name || "",
          phone: schedule.tentative_details?.phone || "",
          paid_info: schedule.tentative_details?.paid_info || "",
          pickup_location: schedule.tentative_details?.pickup_location || "",
          description: schedule.tentative_details?.description || "",
          leadName: schedule.tentative_details?.leadName || "",
          latitude: schedule.tentative_details?.latitude || "",
          longitude: schedule.tentative_details?.longitude || "",
        },
      });
    } else {
      // Creating new tentative schedule.
      // If a drag range was supplied (endHour/endMinute), use it; otherwise
      // default to a 60-minute slot starting at the clicked cell.
      const tentativeStart = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        hour,
        minute,
      );
      const tentativeEnd =
        endHour !== undefined && endMinute !== undefined
          ? new Date(
              day.getFullYear(),
              day.getMonth(),
              day.getDate(),
              endHour,
              endMinute,
            )
          : addMinutes(tentativeStart, 60);
      setTentativeSchedule({
        ...initialTentativeSchedule,
        date: format(tentativeStart, "yyyy-MM-dd"),
        start_time: `${String(tentativeStart.getHours()).padStart(2, "0")}:${String(tentativeStart.getMinutes()).padStart(2, "0")}`,
        end_time: `${String(tentativeEnd.getHours()).padStart(2, "0")}:${String(tentativeEnd.getMinutes()).padStart(2, "0")}`,
        instructor_id: instructorId,
      });
      setFormMode("add");
    }
    setIsTentativeDialogOpen(true);
  };

  // Convert a slot index back to {hour, minute} for finalising the drag.
  const slotIndexToHourMinute = (idx: number) => {
    const hour =
      Math.floor(idx / SlotConfig.numSlotsPerHour) + SlotConfig.startHourOfDay;
    const minute =
      (SlotConfig.numMinutesPerSlot * (idx % SlotConfig.numSlotsPerHour)) % 60;
    return { hour, minute };
  };

  // Called on mouse-up: turn the drag range into a popup with prefilled times.
  // Single-cell drag (just a click) produces a default 60-min slot via
  // handleTentativeSlotClick's fallback. Multi-cell drag uses the exact range.
  const finalizeDrag = (
    start: { dayIndex: number; timeIndex: number },
    end: { dayIndex: number; timeIndex: number },
  ) => {
    if (start.dayIndex !== end.dayIndex) return;
    const day = addDays(currentWeekStart, start.dayIndex);
    const lo = Math.min(start.timeIndex, end.timeIndex);
    const hi = Math.max(start.timeIndex, end.timeIndex);
    const { hour, minute } = slotIndexToHourMinute(lo);
    if (lo === hi) {
      // Plain click → use the existing 60-min default.
      handleTentativeSlotClick(null, day, hour, minute);
    } else {
      // Drag covered (hi - lo + 1) cells; end time is the bottom of cell `hi`.
      const { hour: endHour, minute: endMinute } = slotIndexToHourMinute(
        hi + 1,
      );
      handleTentativeSlotClick(null, day, hour, minute, endHour, endMinute);
    }
  };

  // The mouse-up listener is registered ONCE on mount. It reads the latest
  // drag refs so a fast click (where mouseup fires before React re-runs an
  // effect tied to drag state) is still caught. The actual finalise routine
  // is held in a ref that we refresh on every render so it always uses the
  // current closures.
  const finalizeDragRef = useRef<() => void>(() => {});
  finalizeDragRef.current = () => {
    const start = dragStartRef.current;
    const end = dragEndRef.current;
    setDragStart(null);
    setDragEnd(null);
    if (!start || !end) return;
    finalizeDrag(start, end);
  };
  useEffect(() => {
    const handleUp = () => finalizeDragRef.current();
    window.addEventListener("mouseup", handleUp);
    return () => window.removeEventListener("mouseup", handleUp);
  }, []);

  // Clear the form when closed
  useEffect(() => {
    if (!isTentativeDialogOpen) {
      resetTentativeForm();
    }
  }, [isTentativeDialogOpen]);

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
      // This will automatically refetch the schedules list after a successful delete
      // queryClient.invalidateQueries({
      //   queryKey: ["Schedule", instructorId],
      // });
      // Reqire the following as the above does not refresh the modal
      queryClient.invalidateQueries({ queryKey: ["instructors"] });

      toast({
        title: "Success",
        description: "Tentative schedule deleted.",
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

  const handleDeleteTentative = (scheduleId: string) => {
    if (!scheduleId) {
      toast({
        title: "Error",
        description: "Schedule ID is missing",
        variant: "destructive",
      });
      return;
    }
    setDeleteConfirmId(scheduleId);
  };

  const copyTentativeMutation = useMutation({
    mutationFn: async (copyData: Schedule) => {
      // console.log("Mutation Copying data", copyData);
      // console.log("Current instructorId:", instructorId);
      const { data: copiedData, error } = await supabase
        .from("Schedule")
        .insert([
          {
            date: tentativeScheduleCopy.date,
            start_time: tentativeScheduleCopy.start_time,
            end_time: tentativeScheduleCopy.end_time,
            enabled: true,
            isTentative: true,
            instructor_id: instructorId,
            tentative_details: {
              name: tentativeScheduleCopy.tentative_details.name,
              phone: tentativeScheduleCopy.tentative_details.phone,
              paid_info: tentativeScheduleCopy.tentative_details.paid_info,
              pickup_location:
                tentativeScheduleCopy.tentative_details.pickup_location,
              latitude: tentativeScheduleCopy.tentative_details.latitude,
              longitude: tentativeScheduleCopy.tentative_details.longitude,
              description: tentativeScheduleCopy.tentative_details.description,
              leadName: tentativeScheduleCopy.tentative_details.leadName,
            },
          },
        ])
        .select();

      if (error) throw error;
      return copiedData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructors"] });
      setIsTentativeCopyDialogOpen(false);
      resetTentativeCopyForm();
      toast({
        title: "Tentative Schedule Copied",
        description: "New tentative schedule has been copied successfully",
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

  const handleCopyTentative = (scheduleToCopy) => {
    console.log("CopyTentative Arguments are ", scheduleToCopy);

    if (!scheduleToCopy) {
      toast({
        title: "Error",
        description: "Schedule, date or time missing",
        variant: "destructive",
      });
      return;
    }

    setTentativeScheduleCopy(scheduleToCopy);
    // set ID to null
    setTentativeScheduleCopy({
      ...scheduleToCopy,
      id: "",
    });

    console.log("Tentative schedule state set", tentativeScheduleCopy);
  };

  const calculateEndTime = (startTimeString) => {
    const TIME_FORMAT = "HH:mm";
    // 1. Create a base Date object for today.
    const today = new Date();

    // 2. Create the full date string: YYYY/MM/DD + HH:MM from the input.
    //    This ensures new Date() parses the time correctly for today.
    const dateString = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()} ${startTimeString}`;

    // 3. Parse the full string into a Date object.
    const startDate = new Date(dateString);

    // 4. Calculate the new date/time by adding 1 hour.
    const newDate = addHours(startDate, 1);

    // 5. Format the result back into the required string format ('HH:mm').
    return format(newDate, TIME_FORMAT);
  };

  const handleTimeChange = (e) => {
    const { name, value, type, checked } = e.target;
    console.log("", name, value, type, checked, "name", e.target.name);
    setTentativeScheduleCopy((prev) => {
      const updatedData = {
        ...prev,
        [name]: value,
      };

      // Auto-calculate end_time when start_time changes
      if (name === "tentative_copy_start_time") {
        updatedData.end_time = calculateEndTime(value);
        console.log(
          "handleTimeChange: end_time calculated as ",
          updatedData.end_time,
        );
      }

      return updatedData;
    });
  };

  // for logging copy steps
  useEffect(() => {
    console.log(
      "useEffect: Tentative schedule copy state set:",
      tentativeScheduleCopy,
    );
  }, [tentativeScheduleCopy]);

  const filteredSchedules =
    searchQuery === ""
      ? schedules
      : schedules.filter((schedule) => {
          // console.log("Filtering schedule:", schedule, "with searchQuery:", searchQuery);
          let nameMatch = false;
          let phoneMatch = false;
          if (!schedule?.isTentative) {
            nameMatch = schedule?.learner?.name
              ?.toLowerCase()
              .includes(searchQuery.toLowerCase());
            phoneMatch = schedule?.learner?.phone
              ?.toLowerCase()
              .includes(searchQuery.toLowerCase());
            return nameMatch || phoneMatch;
          } else {
            const tentativeDetails = schedule.tentative_details || {};
            // console.log("Filtering tentativeDetails:", tentativeDetails);
            nameMatch =
              tentativeDetails?.name
                ?.toLowerCase()
                .includes(searchQuery.toLowerCase()) ||
              tentativeDetails?.leadName
                ?.toLowerCase()
                .includes(searchQuery.toLowerCase());
            phoneMatch = tentativeDetails?.phone
              ?.toLowerCase()
              .includes(searchQuery.toLowerCase());
            const descriptionMatch = tentativeDetails?.description
              ?.toLowerCase()
              .includes(searchQuery.toLowerCase());
            return nameMatch || phoneMatch || descriptionMatch;
          }
          return false;
        });

  // console.log("Filtered schedules based on searchQuery:", filteredSchedules);

  // Assume necessary imports (format, endOfWeek, addDays, isSameDay, Input, Button, Copy, Trash2, Select, etc.) are present
  // Assuming Tailwind CSS classes are available.

  return (
    <div className="flex flex-col">
      <div className="mb-4 flex items-center justify-between">
        {/* LEFT SIDE: Navigation, Date Range, and Zoom Controls */}
        <div className="flex items-center space-x-2">
          {/* Navigation */}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setCurrentWeekStart(addDays(currentWeekStart, -numDaysPerView))
            }
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setCurrentWeekStart(addDays(currentWeekStart, numDaysPerView))
            }
          >
            Next
          </Button>

          {/* Date Range */}
          <span className="whitespace-nowrap text-sm font-medium">
            {format(currentWeekStart, "MMM dd")} -{" "}
            {format(
              addDays(currentWeekStart, numDaysPerView - 1),
              "MMM dd, yyyy",
            )}
          </span>

          {/* Separator */}
          <div className="mx-1 h-6 w-px bg-gray-300"></div>

          {/* Zoom Controls: '-' <numDays> '+' */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleZoom("-")}
            disabled={numDaysPerView === MIN_DAYS}
            className="h-7 w-7 p-1" // Smaller button size
          >
            -
          </Button>
          <span className="whitespace-nowrap text-sm font-medium">
            {numDaysPerView} days
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleZoom("+")}
            disabled={numDaysPerView === MAX_DAYS}
            className="h-7 w-7 p-1" // Smaller button size
          >
            +
          </Button>
        </div>

        {/* RIGHT SIDE: Search Input */}
        <Input
          type="search"
          placeholder="Search by name, sales lead, or description"
          value={searchQuery}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setSearchQuery(e.target.value)
          }
          className="h-8 w-64 px-3 py-1 text-sm"
        />
      </div>

      <div
        className="scrollbar-none h-[calc(100vh-50px)] max-h-96 overflow-x-auto overflow-y-auto p-4"
        style={{ scrollbarWidth: "none" }}
      >
        <table className="w-full border-collapse border border-gray-200">
          <thead className="sticky top-0 z-10 bg-white shadow-md">
            <tr>
              {/* Fixed width for Time column */}
              <th className="sticky left-0 z-20 w-14 border border-gray-200 bg-white p-0.5 py-0.5 text-xs">
                Time
              </th>
              {Array.from({ length: numDaysPerView }).map((_, index) => {
                const day = addDays(currentWeekStart, index);
                const isToday = isSameDay(day, new Date());
                // Dynamic width for day columns
                return (
                  <th
                    key={index}
                    className={cn(
                      "relative border border-gray-200 p-1 text-xs transition-colors",
                      // Only the hover effect applies to the whole <th> background
                      index === hoveredDayIndex
                        ? "bg-gray-800 text-white"
                        : "bg-white text-gray-600",
                    )}
                    style={{ width: `${columnWidthPercentage}%` }}
                  >
                    {/* This inner div creates the bubble effect */}
                    <div
                      className={cn(
                        "mx-auto flex flex-col items-center justify-center transition-all",
                        // Create a 36px x 36px circle if today
                        isToday ? "h-9 w-9 rounded-full shadow-sm" : "",
                      )}
                      style={{
                        // Only show purple bubble if today AND not hovered
                        backgroundColor:
                          isToday && index !== hoveredDayIndex
                            ? PALETTE.PURPLE_DARK
                            : "transparent",
                        // Ensure text is white inside the purple bubble
                        color:
                          isToday && index !== hoveredDayIndex
                            ? "white"
                            : "inherit",
                      }}
                    >
                      <span className="font-bold uppercase leading-tight">
                        {format(day, "EE")}
                      </span>
                      <div className="text-[0.6rem] leading-tight">
                        {format(day, "MMM d")}
                      </div>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="overflow-y-auto">
            {Array.from({ length: SlotConfig.numSlotsPerDay }).map(
              (_, timeIndex) => {
                const hour =
                  Math.floor(timeIndex / SlotConfig.numSlotsPerHour) +
                  SlotConfig.startHourOfDay;
                const minute =
                  (SlotConfig.numMinutesPerSlot *
                    (timeIndex % SlotConfig.numSlotsPerHour)) %
                  60;
                return (
                  <tr key={timeIndex}>
                    {/* Time Label - Fixed width */}
                    <td
                      className={`sticky left-0 z-10 flex h-full w-14 select-none items-center justify-center border border-gray-200 bg-white p-0 text-[0.6rem] ${
                        timeIndex === hoveredTimeIndex
                          ? "bg-gray-800 font-bold text-white"
                          : ""
                      }`}
                    >
                      {format(new Date(0, 0, 0, hour, minute), TIME_FORMAT)}
                    </td>

                    {Array.from({ length: numDaysPerView }).map(
                      (_, dayIndex) => {
                        const day = addDays(currentWeekStart, dayIndex);

                        const schedule = filteredSchedules.find((s) => {
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
                          day,
                          hour,
                          minute,
                        );

                        let isOverdueOngoing = false;

                        if (schedule && schedule.status != "completed") {
                          // 1. Get the Schedule End Time as a Date Object (includes the correct day)
                          const scheduleEndTime = new Date(day);
                          const [endHour, endMinute] = schedule.end_time
                            .split(":")
                            .map(Number);
                          scheduleEndTime.setHours(endHour, endMinute, 0, 0);

                          // 2. Define the real current time (Assuming 'nowTime' variable is available)
                          // If 'nowTime' is NOT available globally, define it here:
                          const realCurrentTime = new Date();

                          // 3. Check for the condition: Ongoing AND End time has passed the real current time
                          isOverdueOngoing =
                            scheduleEndTime.getTime() <=
                            realCurrentTime.getTime();
                        }

                        // Determine base styling for the <td> wrapper
                        const tdClasses = `
                          border border-gray-200 p-0
                          ${isSameDay(day, new Date()) ? "bg-blue-50" : ""}
                      `;

                        // Determine full styling for the inner <div>
                        let divClasses = `h-full w-full flex flex-col items-start justify-center relative p-1 text-xs overflow-hidden`;

                        if (schedule) {
                          divClasses += ` cursor-pointer`;
                          if (schedule.isTentative) {
                            // Tentative Schedule (Orange)
                            if (isOverdueOngoing) {
                              divClasses += ` bg-orange-200 text-black`; // Overdue tentative
                            } else {
                              divClasses += ` bg-orange-500 text-white`; // Normal tentative
                            }
                          } else {
                            // Confirmed Schedule — color by enrollment type so
                            // instructor can tell what they're teaching at a glance
                            const enrollmentType = (schedule as any)
                              .enrollmentType;
                            if (enrollmentType === "demo") {
                              divClasses += ` bg-blue-500 text-white`;
                            } else if (enrollmentType === "topup") {
                              divClasses += ` bg-purple-500 text-white`;
                            } else {
                              divClasses += ` bg-green-500 text-white`;
                            }
                          }
                        } else if (unavailable) {
                          // Unavailable Slot (Darker Slate Gray)
                          divClasses += ` bg-slate-700 text-white cursor-not-allowed`;
                        } else {
                          // Empty Slot (Hover effect)
                          divClasses += ` hover:bg-gray-100 cursor-pointer`;
                        }

                        const inDragRange = isInDragRange(dayIndex, timeIndex);
                        const isEmptyCell = !schedule && !unavailable;
                        return (
                          <td
                            key={dayIndex}
                            className={tdClasses}
                            style={{
                              width: `${columnWidthPercentage}%`,
                              height: "40px",
                            }} // Dynamic width and Fixed slot size
                            // Mouse Event Handlers for Highlighting + drag tracking
                            onMouseEnter={() => {
                              setHoveredDayIndex(dayIndex);
                              setHoveredTimeIndex(timeIndex);
                              // Extend the in-progress drag if we're still on
                              // the same day column. Read from the REF (not
                              // state) so a drag started in the same tick is
                              // visible immediately.
                              const curStart = dragStartRef.current;
                              if (curStart && curStart.dayIndex === dayIndex) {
                                const newEnd = { dayIndex, timeIndex };
                                dragEndRef.current = newEnd;
                                setDragEnd(newEnd);
                              }
                            }}
                            onMouseLeave={() => {
                              setHoveredDayIndex(null);
                              setHoveredTimeIndex(null);
                            }}
                            onMouseDown={(e) => {
                              // Only left-click on empty cells starts a drag.
                              if (e.button !== 0) return;
                              if (!isEmptyCell) return;
                              e.preventDefault(); // suppress text selection
                              const start = { dayIndex, timeIndex };
                              // Sync the refs immediately so the global
                              // mouse-up listener sees the drag even if it
                              // fires before React re-renders.
                              dragStartRef.current = start;
                              dragEndRef.current = start;
                              setDragStart(start);
                              setDragEnd(start);
                            }}
                          >
                            <div
                              className={`group relative flex h-full w-full flex-col items-center justify-between ${
                                schedule
                                  ? schedule.isTentative
                                    ? "bg-orange-300 text-black"
                                    : isOverdueOngoing
                                      ? "bg-yellow-200 text-black"
                                      : (schedule as any).enrollmentType ===
                                          "demo"
                                        ? "bg-blue-500 text-white"
                                        : (schedule as any).enrollmentType ===
                                            "topup"
                                          ? "bg-purple-500 text-white"
                                          : "bg-green-500 text-white"
                                  : unavailable
                                    ? "bg-gray-300 text-red-800"
                                    : inDragRange
                                      ? "bg-blue-200"
                                      : ""
                              } ${schedule ? "cursor-pointer" : ""} `}
                              onClick={() => {
                                // Empty-cell creation is handled entirely by
                                // the drag flow (mouseDown + window mouseUp →
                                // finalizeDrag). A plain click is a 1-cell
                                // drag, which still opens the popup with the
                                // 60-min default. We therefore only handle
                                // occupied / tentative cells here.
                                if (schedule && !schedule.isTentative) {
                                  handleOccupiedSlotClick(schedule);
                                } else if (schedule && schedule.isTentative) {
                                  handleTentativeSlotClick(
                                    schedule,
                                    day,
                                    hour,
                                    minute,
                                  );
                                }
                              }}
                            >
                              {/* onClick={() => {
                          setIsTentativeDialogOpen(false);
                          if (schedule && !schedule.isTentative) {
                            handleOccupiedSlotClick(schedule);
                          } else if (!schedule && unavailable) {
                            toast({
                              title: "Error",
                              description: "Not available instructor",
                              variant: "destructive",
                            });
                          } else if (schedule && schedule.isTentative) {
                            handleTentativeSlotClick(schedule, day, hour, minute);
                          }
                        }}
                      > */}
                              {/* Primary Slot Content (Always Visible) */}
                              {schedule ? (
                                <div className="flex w-full flex-grow flex-col items-start justify-center overflow-hidden leading-tight">
                                  {schedule.isTentative ? (
                                    // Tentative Details - Conditional Display Logic
                                    <>
                                      {/* Line 1: Name */}
                                      <div
                                        className={`w-full select-none truncate text-[0.6rem] font-medium ${isOverdueOngoing ? "text-black" : "text-white"}`}
                                      >
                                        {schedule.tentative_details?.name ||
                                          "Tentative"}
                                      </div>

                                      {/* Line 2: Description (Only if not too zoomed out) */}
                                      {!isZoomedOut && (
                                        <div
                                          className={`w-full select-none truncate text-[0.5rem] font-normal ${isOverdueOngoing ? "text-black" : "text-white"}`}
                                        >
                                          {schedule.tentative_details
                                            ?.description || "No Description"}
                                        </div>
                                      )}

                                      {/* Line 3: Paid Info and Map Link (Paid Info removed if very zoomed out) */}
                                      <div
                                        className={`w-full select-none truncate text-[0.5rem] font-normal ${isOverdueOngoing ? "text-black" : "text-white"} flex items-center justify-between`}
                                      >
                                        {!isVeryZoomedOut && (
                                          <span>
                                            {schedule.tentative_details
                                              ?.paid_info || "Unpaid"}
                                          </span>
                                        )}

                                        {/* Map Link/N/A */}
                                        <span
                                          className={`text-[0.5rem] font-normal ${isOverdueOngoing ? "text-black" : "text-white"} ml-auto`}
                                        >
                                          {schedule.tentative_details
                                            ?.latitude &&
                                          schedule.tentative_details
                                            ?.longitude ? (
                                            <a
                                              href={`https://maps.google.com/?q=$$${schedule.tentative_details.latitude},${schedule.tentative_details.longitude}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className={`hover:text-blue-200 ${isOverdueOngoing ? "text-black" : "text-white"} underline`}
                                              onClick={(e) =>
                                                e.stopPropagation()
                                              }
                                            >
                                              Map
                                            </a>
                                          ) : (
                                            "N/A"
                                          )}
                                        </span>
                                      </div>
                                    </>
                                  ) : (
                                    // Confirmed Details - Conditional Display Logic
                                    <>
                                      {/* Line 1: Name + type tag */}
                                      <div className="flex w-full select-none items-center gap-1 truncate text-[0.6rem] font-medium text-white">
                                        <span className="truncate">
                                          {schedule.learner?.name || "Booked"} (
                                          {schedule?.lesson?.number})
                                        </span>
                                        {((schedule as any).enrollmentType ===
                                          "demo" ||
                                          (schedule as any).enrollmentType ===
                                            "topup") && (
                                          <span className="rounded bg-white/20 px-1 text-[0.5rem] font-bold uppercase">
                                            {(schedule as any).enrollmentType}
                                          </span>
                                        )}
                                      </div>

                                      {/* Line 2: Status and Map Link (Status removed if very zoomed out) */}
                                      <div className="flex w-full select-none items-center justify-between truncate text-[0.5rem] font-normal text-white">
                                        {!isVeryZoomedOut && (
                                          <span>
                                            {schedule.status || "Booked"}
                                          </span>
                                        )}

                                        {/* Map Link/N/A */}
                                        <span className="ml-auto text-[0.5rem] font-normal text-white">
                                          {schedule.learner?.address_lat &&
                                          schedule.learner?.address_lng ? (
                                            <a
                                              href={`https://maps.google.com/?q=$$${schedule.learner.address_lat},${schedule.learner.address_lng}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-white underline hover:text-blue-200"
                                              onClick={(e) =>
                                                e.stopPropagation()
                                              }
                                            >
                                              Map
                                            </a>
                                          ) : (
                                            "N/A"
                                          )}
                                        </span>
                                      </div>
                                    </>
                                  )}
                                </div>
                              ) : unavailable ? (
                                // Unavailable Slot - Show prominent X
                                <div className="flex h-full w-full items-center justify-center">
                                  <X size={12} className="select-none" />
                                </div>
                              ) : (
                                // Empty Slot
                                <div className="flex h-full w-full items-center justify-center">
                                  {/* Keep empty */}
                                </div>
                              )}

                              {/* Action Buttons (Bottom - Only for Tentative Slots) - Removed if very zoomed out to save space */}
                              {schedule &&
                                schedule.isTentative &&
                                !isVeryZoomedOut && (
                                  <div className="mt-1 flex w-full items-center justify-around">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      // Change button text/icon color to white for visibility on orange-500
                                      className={`h-3 p-0 text-[0.5rem] ${isOverdueOngoing ? "text-black" : "text-white"} hover:bg-orange-200/50`}
                                      title="Copy"
                                      onClick={(e: React.MouseEvent) => {
                                        e.stopPropagation();
                                        setTentativeScheduleCopy({
                                          ...initialTentativeSchedule,
                                          ...schedule,
                                          tentative_details:
                                            schedule.tentative_details,
                                        });
                                        setIsTentativeCopyDialogOpen(true);
                                      }}
                                    >
                                      <Copy size={8} />
                                    </Button>
                                    <Button
                                      variant="destructive"
                                      size="sm"
                                      className={`h-3 p-0 text-[0.5rem] ${isOverdueOngoing ? "text-black" : "text-red-300"} hover:bg-orange-200/50`} // Use a lighter red for contrast on orange-500
                                      title="Delete"
                                      onClick={(e: React.MouseEvent) => {
                                        e.stopPropagation();
                                        handleDeleteTentative(schedule.id);
                                      }}
                                    >
                                      <Trash2 className="h-2 w-2" />
                                    </Button>
                                  </div>
                                )}

                              {/* --- 2. THE HOVER TOOLTIP (Full Info - Unchanged) --- */}
                              {schedule && (
                                <div className="absolute left-full top-0 z-50 ml-1 hidden w-64 rounded-md border border-gray-300 bg-white p-3 text-left text-black shadow-xl group-hover:block">
                                  {/* NOTE: Removed buttons from this section as they are now in the main view */}

                                  {schedule.isTentative ? (
                                    <div className="flex flex-col gap-1">
                                      <div className="mb-1 border-b pb-1 text-xs font-bold">
                                        Tentative Booking
                                      </div>
                                      <div className="text-xs">
                                        <span className="font-semibold">
                                          Name:
                                        </span>{" "}
                                        {schedule.tentative_details?.name ||
                                          "N/A"}
                                      </div>
                                      <div className="text-xs">
                                        <span className="font-semibold">
                                          Phone:
                                        </span>{" "}
                                        {schedule.tentative_details?.phone ||
                                          "N/A"}
                                      </div>
                                      <div className="text-xs">
                                        <span className="font-semibold">
                                          Desc:
                                        </span>{" "}
                                        {schedule.tentative_details
                                          ?.description || "N/A"}
                                      </div>

                                      {/* Map Link */}
                                      {schedule.tentative_details?.latitude &&
                                      schedule.tentative_details?.longitude ? (
                                        <a
                                          href={`http://maps.google.com?q=${schedule.tentative_details.latitude},${schedule.tentative_details.longitude}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="mt-1 block text-xs text-blue-600 underline"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          Open in Maps
                                        </a>
                                      ) : (
                                        <span className="text-xs text-gray-400">
                                          No Map Data
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    /* Occupied/Learner Details Hover View */
                                    <div className="flex flex-col gap-1">
                                      <div className="mb-1 border-b pb-1 text-xs font-bold text-green-700">
                                        Confirmed Booking
                                      </div>
                                      <div className="text-xs">
                                        <span className="font-semibold">
                                          Learner:
                                        </span>{" "}
                                        {schedule.learner?.name || "N/A"}
                                      </div>
                                      <div className="text-xs">
                                        <span className="font-semibold">
                                          Phone:
                                        </span>{" "}
                                        {schedule.learner?.phone || "N/A"}
                                      </div>

                                      {/* Map Link */}
                                      {schedule.learner?.address_lat &&
                                      schedule.learner?.address_lng ? (
                                        <a
                                          href={`http://maps.google.com?q=${schedule.learner.address_lat},${schedule.learner.address_lng}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="mt-1 block text-xs text-blue-600 underline"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          Open in Maps
                                        </a>
                                      ) : (
                                        <span className="text-xs text-gray-400">
                                          No Map Data
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      },
                    )}
                  </tr>
                );
              },
            )}
          </tbody>
        </table>
      </div>

      {/* Legend - Reduced Text Size from 'text-sm' to 'text-xs' */}
      <div className="mt-4 flex items-center justify-end space-x-4">
        <div className="flex items-center">
          <div className="mr-2 h-4 w-4 bg-green-500"></div>
          <span className="text-xs">Booked (Confirmed)</span>
        </div>
        <div className="flex items-center">
          <div className="mr-2 h-4 w-4 bg-yellow-200"></div>
          <span className="text-xs">Not completed on Schedule</span>
        </div>
        <div className="flex items-center">
          <div className="mr-2 h-4 w-4 bg-orange-300"></div>
          <span className="text-xs">Tentative</span>
        </div>
        <div className="flex items-center">
          <div className="mr-2 h-4 w-4 bg-gray-300"></div>
          <span className="text-xs">Unavailable</span>
        </div>
      </div>

      {/* Add/Edit Tentative Schedule Dialog - No size changes requested, keeping original code for context */}
      <Dialog
        open={isTentativeDialogOpen}
        onOpenChange={(open) => {
          // Only close if explicitly set to false
          if (!open) {
            setIsTentativeDialogOpen(false);
          }
        }}
      >
        <DialogContent
          className="scrollbar-none h-[calc(100vh-50px)] max-h-[80vh] overflow-y-auto sm:max-w-[500px]"
          style={{ scrollbarWidth: "none" }}
          // Prevent clicks inside from closing the dialog
          onPointerDownOutside={(e) => {
            const target = e.target as HTMLElement;
            if (
              target.closest(".pac-container") ||
              target.closest(".pac-item")
            ) {
              e.preventDefault();
            }
          }}
        >
          {/* The close button is rendered *inside* DialogContent. 
           You would need to modify the DialogContent component definition 
           to change its size. */}
          <DialogHeader>
            <DialogTitle>
              {formMode === "add"
                ? "Add Tentative Schedule"
                : "Edit Tentative Schedule Details"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleTentativeSave}>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="tentative_details-name" className="text-right">
                  Name<span className="text-red-500">*</span>
                </Label>
                <Input
                  id="tentative_details-name"
                  value={tentativeSchedule.tentative_details.name}
                  onChange={(e) =>
                    setTentativeSchedule({
                      ...tentativeSchedule,
                      // Correctly update the nested 'tentative_details' object
                      tentative_details: {
                        ...tentativeSchedule.tentative_details,
                        name: e.target.value,
                      },
                    })
                  }
                  className="col-span-3"
                  required
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="tentative_details-phone" className="text-right">
                  Phone<span className="text-red-500">*</span>
                </Label>
                <Input
                  id="tentative_details-phone"
                  value={tentativeSchedule.tentative_details.phone}
                  onChange={(e) =>
                    setTentativeSchedule({
                      ...tentativeSchedule,
                      // Correctly update the nested 'tentative_details' object
                      tentative_details: {
                        ...tentativeSchedule.tentative_details,
                        phone: e.target.value,
                      },
                    })
                  }
                  className="col-span-3"
                  required
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label
                  htmlFor="tentative_details-description"
                  className="text-right"
                >
                  Description<span className="text-red-500">*</span>
                </Label>
                <Input
                  id="tentative_details-description"
                  value={tentativeSchedule.tentative_details.description}
                  onChange={(e) =>
                    setTentativeSchedule({
                      ...tentativeSchedule,
                      // Correctly update the nested 'tentative_details' object
                      tentative_details: {
                        ...tentativeSchedule.tentative_details,
                        description: e.target.value,
                      },
                    })
                  }
                  className="col-span-3"
                  required
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label
                  htmlFor="tentative_details-paid_info"
                  className="text-right"
                >
                  Paid information
                </Label>
                <Select
                  value={
                    tentativeSchedule.tentative_details.paid_info || undefined
                  }
                  onValueChange={(value) =>
                    handlePaidInfoChange(
                      value as "Unpaid" | "Half paid" | "Full paid" | null,
                    )
                  }
                >
                  <SelectTrigger className="col-span-3">
                    <SelectValue placeholder="Select Paid info" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Unpaid">Unpaid</SelectItem>
                    <SelectItem value="Half paid">Half Paid</SelectItem>
                    <SelectItem value="Full paid">Full Paid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="tentative_details-address" className="text-right">
                Address
              </Label>
              <div className="col-span-3">
                <TentativeAddressInput
                  memoizedTentativeAddressValue={memoizedTentativeAddressValue}
                  handleAddressChangeTentative={handleAddressChangeTentative}
                />
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label
                htmlFor="tentative_details-leadName"
                className="text-right"
              >
                Lead Name<span className="text-red-500">*</span>
              </Label>
              <Input
                id="tentative_details-leadName"
                value={tentativeSchedule.tentative_details.leadName}
                onChange={(e) =>
                  setTentativeSchedule({
                    ...tentativeSchedule,
                    // Correctly update the nested 'tentative_details' object
                    tentative_details: {
                      ...tentativeSchedule.tentative_details,
                      leadName: e.target.value,
                    },
                  })
                }
                className="col-span-3"
                required
              />
            </div>
            {/* Inactive Date Fields filled automatically */}
            <div className="mt-4 grid grid-cols-4 items-center gap-4">
              <label
                htmlFor="tentative_details-date"
                className="text-right font-medium"
              >
                Date
              </label>
              <input
                id="tentative_details-date"
                type="date"
                value={formatDateForInput(tentativeSchedule.date)}
                className="col-span-3 cursor-not-allowed rounded-md border border-gray-300 bg-gray-100 px-3 py-2 focus:outline-none"
                readOnly
                onChange={() => {}} // Required for controlled input
              />
            </div>
            <div className="mt-4 grid grid-cols-4 items-center gap-4">
              <label htmlFor="start_time" className="text-right font-medium">
                Start Time
              </label>
              <input
                id="start_time"
                type="text"
                value={tentativeSchedule.start_time}
                className="col-span-3 cursor-not-allowed rounded-md border border-gray-300 bg-gray-100 px-3 py-2 focus:outline-none"
                readOnly
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <label htmlFor="end_time" className="text-right font-medium">
                End Time
              </label>
              <input
                id="end_time"
                type="text"
                value={tentativeSchedule.end_time}
                className="col-span-3 cursor-not-allowed rounded-md border border-gray-300 bg-gray-100 px-3 py-2 focus:outline-none"
                readOnly
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsTentativeDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={tentativeScheduleMutation.isPending}
              >
                {tentativeScheduleMutation.isPending
                  ? "Saving..."
                  : formMode === "add"
                    ? "Add Tentative Schedule"
                    : "Update Tentative Schedule"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Copy Tentative Schedule Dialog - No size changes requested, keeping original code for context */}
      <Dialog
        open={isTentativeCopyDialogOpen}
        onOpenChange={(open) => {
          // Only close if explicitly set to false
          if (!open) {
            setIsTentativeCopyDialogOpen(false);
          }
        }}
      >
        <DialogContent
          className="scrollbar-none h-[calc(100vh-50px)] max-h-[80vh] overflow-y-auto sm:max-w-[500px]"
          style={{ scrollbarWidth: "none" }}
          // Prevent clicks inside from closing the dialog
          onPointerDownOutside={(e) => {
            const target = e.target as HTMLElement;
            if (
              target.closest(".pac-container") ||
              target.closest(".pac-item")
            ) {
              e.preventDefault();
            }
          }}
        >
          {/* The close button is rendered *inside* DialogContent. 
           You would need to modify the DialogContent component definition 
           to change its size. */}
          <DialogHeader>
            <DialogTitle>Copy Tentative Schedule</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleTentativeCopySave}>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label
                  htmlFor="tentative_copy_details-name"
                  className="text-right"
                >
                  Name<span className="text-red-500">*</span>
                </Label>
                <Input
                  id="tentative_copy_details-name"
                  value={tentativeScheduleCopy.tentative_details.name}
                  disabled={true}
                  className="col-span-3"
                  required
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label
                  htmlFor="tentative_copy_details-phone"
                  className="text-right"
                >
                  Phone<span className="text-red-500">*</span>
                </Label>
                <Input
                  id="tentative_copy_details-phone"
                  value={tentativeScheduleCopy.tentative_details.phone}
                  disabled={true}
                  className="col-span-3"
                  required
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label
                  htmlFor="tentative_copy_details-description"
                  className="text-right"
                >
                  Description<span className="text-red-500">*</span>
                </Label>
                <Input
                  id="tentative_copy_details-description"
                  value={tentativeScheduleCopy.tentative_details.description}
                  disabled={false}
                  onChange={(e) => {
                    setTentativeScheduleCopy((prev) => ({
                      ...prev,
                      tentative_details: {
                        ...tentativeScheduleCopy.tentative_details,
                        description: e.target.value,
                      },
                    }));
                  }}
                  className="col-span-3"
                  required
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label
                  htmlFor="tentative_copy_details-paid_info"
                  className="text-right"
                >
                  Paid information
                </Label>
                <Select
                  value={
                    tentativeScheduleCopy.tentative_details.paid_info ||
                    undefined
                  }
                  disabled={true}
                >
                  <SelectTrigger className="col-span-3">
                    <SelectValue placeholder="Select Paid info" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Unpaid">Unpaid</SelectItem>
                    <SelectItem value="Half paid">Half Paid</SelectItem>
                    <SelectItem value="Full paid">Full Paid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label
                htmlFor="tentative_copy_details-address"
                className="text-right"
              >
                Address
              </Label>
              <Input
                id="tentative_copy_details-address"
                value={tentativeScheduleCopy.tentative_details.pickup_location}
                disabled={true}
                className="col-span-3"
                required
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label
                htmlFor="tentative_copy_details-leadName"
                className="text-right"
              >
                Lead Name<span className="text-red-500">*</span>
              </Label>
              <Input
                id="tentative_copy_details-leadName"
                value={tentativeScheduleCopy.tentative_details.leadName}
                disabled={true}
                className="col-span-3"
                required
              />
            </div>
            {/* Active Date Fields filled for copy*/}
            <div className="mt-4 grid grid-cols-4 items-center gap-4">
              <label
                htmlFor="tentative_copy_details-date"
                className="text-right font-medium"
              >
                Date
              </label>
              <input
                id="tentative_copy_details-date"
                type="date"
                // value={formatDateForInput(tentativeScheduleCopy.date)}
                value={tentativeScheduleCopy.date}
                onChange={(e) => {
                  setTentativeScheduleCopy((prev) => ({
                    ...prev,
                    date: e.target.value,
                  }));
                }}
                className="col-span-3"
              />
            </div>
            <div className="mt-4 grid grid-cols-4 items-center gap-4">
              <label
                htmlFor="tentative_copy_start_time"
                className="text-right font-medium"
              >
                Start Time
              </label>
              <input
                id="tentative_copy_start_time"
                type="text"
                value={tentativeScheduleCopy.start_time}
                // onChange={handleTimeChange} // can be tied to end_time
                onChange={(e) => {
                  setTentativeScheduleCopy((prev) => ({
                    ...prev,
                    start_time: e.target.value,
                  }));
                }}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <label
                htmlFor="tentative_copy_end_time"
                className="text-right font-medium"
              >
                End Time
              </label>
              <input
                id="tentative_copy_end_time"
                type="text"
                value={tentativeScheduleCopy.end_time}
                onChange={(e) => {
                  setTentativeScheduleCopy((prev) => ({
                    ...prev,
                    end_time: e.target.value,
                  }));
                }}
                className="col-span-3"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsTentativeCopyDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={copyTentativeMutation.isPending}>
                {copyTentativeMutation.isPending
                  ? "Saving..."
                  : "Copy Tentative Schedule"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Tentative Slot Confirmation Modal */}
      <Dialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => {
          if (!open && !deleteTentativeMutation.isPending) {
            setDeleteConfirmId(null);
          }
        }}
      >
        <DialogContent className="max-w-sm overflow-hidden p-0 sm:max-w-md">
          <div className="flex flex-col items-center gap-4 px-6 pb-2 pt-7 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 ring-8 ring-red-50/50">
              <AlertTriangle className="h-7 w-7 text-red-600" strokeWidth={2} />
            </div>
            <div className="space-y-1.5">
              <DialogTitle className="text-lg font-semibold text-gray-900">
                Delete this slot?
              </DialogTitle>
              <DialogDescription className="text-sm text-gray-500">
                This tentative slot will be permanently removed from the
                calendar and the time will be freed for new bookings.
              </DialogDescription>
            </div>
          </div>
          <div className="flex gap-2 border-t border-gray-100 bg-gray-50 px-6 py-4">
            <Button
              variant="outline"
              className="flex-1 bg-white"
              onClick={() => setDeleteConfirmId(null)}
              disabled={deleteTentativeMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1 gap-2"
              disabled={deleteTentativeMutation.isPending}
              onClick={() => {
                if (!deleteConfirmId) return;
                deleteTentativeMutation.mutate(deleteConfirmId, {
                  onSettled: () => setDeleteConfirmId(null),
                });
              }}
            >
              {deleteTentativeMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const TentativeAddressInput = memo(
  ({ memoizedTentativeAddressValue, handleAddressChangeTentative }) => {
    console.log("TentativeAddressInput start");
    return (
      <AddressAutocomplete
        value={memoizedTentativeAddressValue}
        onChange={handleAddressChangeTentative}
      />
    );
  },
);

// 1. Destructure the params from the function arguments (props)
export const AddTentativeSchedule = ({
  instructorId: propInstructorId,
  instructorName: propInstructorName,
  date: propDate,
  startTime: propStartTime,
  endTime: propEndTime,
}: {
  instructorId?: string;
  instructorName?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
} = {}) => {
  const testMode = false;
  const navigate = useNavigate();
  const { toast } = useToast();

  // 2. Get params from the URL
  const {
    instructorId: urlInstructorId,
    date: urlDate,
    startTime: urlStartTime,
  } = useParams();

  // 3. Use URL params first, fallback to prop params if URL is undefined
  const instructorId = urlInstructorId ?? propInstructorId;
  const date = urlDate ?? propDate;
  const startTime = urlStartTime ?? propStartTime;
  const endTime = propEndTime;

  // Fallback fetch for the deep-link route (/admin/tentative-add/...) where
  // the parent page isn't mounted and the name wasn't passed in.
  const { data: fetchedInstructor } = useQuery({
    queryKey: ["instructor-name", instructorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Instructor")
        .select("name")
        .eq("id_instructor", instructorId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!instructorId && !propInstructorName,
  });
  const instructorName = propInstructorName ?? fetchedInstructor?.name;

  const { data: courses } = useQuery({
    queryKey: ["courses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("Courses").select("*");
      if (error) throw error;
      return data;
    },
  });

  const [isAddingBulk, setIsAddingBulk] = useState(false);
  const [bulkType, setBulkType] = useState("single");
  const [repeatCount, setRepeatCount] = useState(1);
  const [addLessonNumber, setAddLessonNumber] = useState(false);

  const defaultDate = date || format(new Date(), "yyyy-MM-dd");
  const defaultStart = startTime || "09:00";
  const defaultEnd =
    endTime ||
    (startTime
      ? format(addHours(parseISO(`2024-01-01T${startTime}`), 1), "HH:mm")
      : "10:00");

  const [newSlotDate, setNewSlotDate] = useState(defaultDate);
  const [newSlotTimes, setNewSlotTimes] = useState({
    start: defaultStart,
    end: defaultEnd,
  });

  const [slots, setSlots] = useState([
    {
      date: defaultDate,
      start_time: defaultStart,
      end_time: defaultEnd,
      description: "",
    },
  ]);

  const [tentativeDetails, setTentativeDetails] = useState({
    name: "",
    phone: "",
    paid_info: "Unpaid",
    pickup_location: "",
    leadName: "",
    address: "",
    course_id: "none",
    lat: null as number | null,
    lng: null as number | null,
  });

  const [availabilityMap, setAvailabilityMap] = useState<Record<string, any>>(
    {},
  );

  useEffect(() => {
    const validateAllSlots = async () => {
      if (!instructorId || slots.length === 0) return;

      try {
        // 1. Local Duplicate Check (Identify slots with identical Date + Start Time)
        const seenSlots = new Set();
        const localDuplicates: Record<string, boolean> = {};

        slots.forEach((s, index) => {
          const key = `${s.date}-${s.start_time}`;
          if (seenSlots.has(key)) {
            localDuplicates[index] = true; // Mark this specific index as a duplicate
          }
          seenSlots.add(key);
        });

        if (testMode) {
          const mockMap: Record<string, any> = {};
          slots.forEach((s, i) => {
            const key = `${s.date}-${s.start_time}`;
            mockMap[key] = localDuplicates[i]
              ? { available: false, reason: "Duplicate Slot in List" }
              : { available: true, reason: "" };
          });
          setAvailabilityMap(mockMap);
        } else {
          // 2. Fetch Instructor Conflicts from DB
          const result = await checkInstructorAvailability(slots, instructorId);

          // 3. Merge Results: Local duplicates take priority over DB status
          const mergedResult: Record<string, any> = { ...result };
          slots.forEach((s, i) => {
            if (localDuplicates[i]) {
              const key = `${s.date}-${s.start_time}`;
              mergedResult[key] = {
                available: false,
                reason: "Duplicate Slot: Already added to this list",
              };
            }
          });

          setAvailabilityMap(mergedResult);
        }
      } catch (err) {
        console.error("Availability Check Failed:", err);
      }
    };

    validateAllSlots();
  }, [slots, instructorId, testMode]);

  const stats = useMemo(() => {
    const total = slots.length;
    const blocked = slots.filter((s) => {
      const status = availabilityMap[`${s.date}-${s.start_time}`];
      return status?.available === false;
    }).length;
    return { total, blocked };
  }, [slots, availabilityMap]);

  const getValidationErrors = () => {
    const errors = [];
    const cleanPhone = tentativeDetails.phone.replace(/\D/g, "");
    if (!tentativeDetails.name.trim()) errors.push("Name is required");
    if (cleanPhone.length !== 10) errors.push("Phone must be 10 digits");
    if (!tentativeDetails.leadName.trim())
      errors.push("Sales Lead is required");
    if (stats.blocked > 0) errors.push("Remove blocked slots");
    return errors;
  };

  const validationErrors = getValidationErrors();
  const isFormValid = validationErrors.length === 0;

  const handleStartTimeChange = (newStart: string) => {
    const startParsed = parseISO(`2024-01-01T${newStart}`);
    setNewSlotTimes({
      start: newStart,
      end: format(addHours(startParsed, 1), "HH:mm"),
    });
  };

  const handleApplyBulkSchedules = () => {
    const baseDateObj = parseISO(newSlotDate);
    const newSlotsList = [...slots];
    const count = bulkType === "single" ? 1 : repeatCount;

    // Start loop from 0 for "single", but if bulk,
    // we ensure sDate/sStart increments based on the loop index.
    for (let i = 0; i < count; i++) {
      let sDate = newSlotDate;
      let sStart = newSlotTimes.start;
      let sEnd = newSlotTimes.end;

      if (bulkType === "daily") {
        // Change: i + 1 to start from the NEXT day
        sDate = format(addDays(baseDateObj, i + 1), "yyyy-MM-dd");
      } else if (bulkType === "hourly") {
        const bStart = parseISO(`${newSlotDate}T${newSlotTimes.start}`);
        const bEnd = parseISO(`${newSlotDate}T${newSlotTimes.end}`);
        // Change: i + 1 to start from the NEXT hour
        sStart = format(addHours(bStart, i + 1), "HH:mm");
        sEnd = format(addHours(bEnd, i + 1), "HH:mm");
      }

      newSlotsList.push({
        date: sDate,
        start_time: sStart,
        end_time: sEnd,
        description: "",
      });
    }
    setSlots(newSlotsList);
    setIsAddingBulk(false);
  };

  const getCourseName = useCallback(() => {
    if (tentativeDetails.course_id === "none") return "";
    if (tentativeDetails.course_id === "topup") return "Topup";
    return (
      courses?.find((c) => c.id.toString() === tentativeDetails.course_id)
        ?.name || ""
    );
  }, [tentativeDetails.course_id, courses]);

  useEffect(() => {
    const baseName = getCourseName();
    setSlots((prev) =>
      prev.map((slot, idx) => {
        const lessonLabel = `Lesson ${idx + 1}`;
        let autoPart = "";
        if (baseName && addLessonNumber)
          autoPart = `${baseName} - ${lessonLabel}`;
        else if (baseName) autoPart = baseName;
        else if (addLessonNumber) autoPart = lessonLabel;

        const isAuto =
          !slot.description ||
          slot.description.includes("Lesson") ||
          (baseName && slot.description.includes(baseName));
        return isAuto ? { ...slot, description: autoPart } : slot;
      }),
    );
  }, [
    tentativeDetails.course_id,
    addLessonNumber,
    slots.length,
    getCourseName,
  ]);

  const AddTentativeScheduleMutation = useMutation({
    mutationFn: async () => {
      const schedulesToInsert = slots.map((slot) => ({
        date: slot.date,
        start_time: slot.start_time,
        end_time: slot.end_time,
        instructor_id: instructorId,
        isTentative: true,
        course_id:
          tentativeDetails.course_id === "none" ||
          tentativeDetails.course_id === "topup"
            ? null
            : parseInt(tentativeDetails.course_id),
        tentative_details: {
          ...tentativeDetails,
          description: slot.description,
        },
      }));
      const { error } = await supabase
        .from("Schedule")
        .insert(schedulesToInsert);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Tentative schedules added",
        variant: "success",
      });
      //navigate('/admin/instructors/' + instructorId);
      window.location.reload();
    },
  });

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-4xl rounded-xl border border-border bg-background p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between border-b pb-4">
          <div>
            <h1 className="text-l font-bold">Add Tentative Schedules</h1>
            {instructorName && (
              <p className="mt-0.5 text-xs text-slate-500">
                Instructor:{" "}
                <span className="font-semibold text-slate-700">
                  {instructorName}
                </span>
              </p>
            )}
          </div>
          {/* <Button variant="ghost" size="icon" onClick={() => navigate('/admin/instructors/' + instructorId)}>✕</Button> */}
        </div>
        <div className="space-y-6 text-sm">
          {/* Input Fields - Stacked on separate lines with smaller font */}
          <div className="flex max-w-md flex-col gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Name*</Label>
              <Input
                className="h-8 text-xs"
                value={tentativeDetails.name}
                onChange={(e) =>
                  setTentativeDetails({
                    ...tentativeDetails,
                    name: e.target.value,
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Phone Number*</Label>
              <Input
                className="h-8 text-xs"
                value={tentativeDetails.phone}
                onChange={(e) =>
                  setTentativeDetails({
                    ...tentativeDetails,
                    phone: e.target.value,
                  })
                }
                maxLength={10}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sales lead name*</Label>
              <Input
                className="h-8 text-xs"
                value={tentativeDetails.leadName}
                onChange={(e) =>
                  setTentativeDetails({
                    ...tentativeDetails,
                    leadName: e.target.value,
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Payment Status</Label>
              <Select
                value={tentativeDetails.paid_info}
                onValueChange={(v) =>
                  setTentativeDetails({ ...tentativeDetails, paid_info: v })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Unpaid" className="text-xs">
                    Unpaid
                  </SelectItem>
                  <SelectItem value="Half paid" className="text-xs">
                    Half paid
                  </SelectItem>
                  <SelectItem value="Full paid" className="text-xs">
                    Full paid
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="max-w-md space-y-1">
            <Label className="text-xs">Address / Pickup Location</Label>
            <AddressAutocomplete
              className="h-8 text-xs"
              value={tentativeDetails.address}
              onChange={(addr, lat, lng) => {
                // console.log("Incoming Autocomplete Data:", { addr, lat, lng });
                setTentativeDetails((prev) => {
                  const updatedState = {
                    ...prev,
                    address: addr,
                    pickup_location: addr,
                    lat: lat,
                    lng: lng,
                  };
                  // console.log("Merged State:", updatedState);
                  return updatedState;
                });
              }}
            />
          </div>

          {/* Course Selection stacked on separate lines */}
          <div className="flex max-w-md flex-col gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Course Selection</Label>
              <Select
                value={tentativeDetails.course_id}
                onValueChange={(v) =>
                  setTentativeDetails({ ...tentativeDetails, course_id: v })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select Course" />
                </SelectTrigger>
                <SelectContent className="text-xs">
                  <SelectItem value="none">None</SelectItem>
                  {courses?.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="topup">Topup</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2 pt-1">
              <Checkbox
                id="lesson-number"
                checked={addLessonNumber}
                onCheckedChange={(v) => setAddLessonNumber(!!v)}
              />
              <Label htmlFor="lesson-number" className="text-xs">
                Add Lesson number
              </Label>
            </div>
          </div>

          {/* Preview Table Section */}
          <div className="border-t border-dashed pt-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Label className="text-xs font-bold">
                  Scheduled Slots Preview
                </Label>
                <div className="flex items-center gap-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">
                  <span>Total: {stats.total}</span>
                  {stats.blocked > 0 && (
                    <span className="border-l border-border pl-2 font-bold text-destructive">
                      Blocked: {stats.blocked}
                    </span>
                  )}
                </div>
              </div>
              <Button
                type="button"
                onClick={() => setIsAddingBulk(true)}
                size="xs"
                variant="outline"
                className="h-7 text-xs"
              >
                <Plus className="mr-1 h-3 w-3" /> Add schedules
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {slots.map((slot, idx) => {
                const status =
                  availabilityMap[`${slot.date}-${slot.start_time}`];
                const isUnavail = status?.available === false;

                return (
                  <div
                    key={idx}
                    className={`flex flex-col gap-3 rounded-lg border p-3 transition-all ${
                      isUnavail
                        ? "border-destructive/30 bg-destructive/5 shadow-sm"
                        : "border-primary/20 bg-primary/5"
                    }`}
                  >
                    {/* TOP ROW: Date/Time and Actions */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className={`rounded px-2 py-1 text-[10px] font-black uppercase tracking-wider ${
                            isUnavail
                              ? "bg-destructive/10 text-destructive"
                              : "bg-primary/10 text-primary"
                          }`}
                        >
                          {format(parseISO(slot.date), "MMM do")}
                        </div>
                        <div className="text-[11px] font-bold text-slate-600">
                          {slot.start_time} — {slot.end_time}
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        {isUnavail && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex cursor-help items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-destructive">
                                  <Info className="h-3.5 w-3.5" />
                                  <span className="text-[9px] font-bold uppercase">
                                    Conflict
                                  </span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">
                                  {status.reason || "Slot Conflict"}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}

                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setSlots(slots.filter((_, i) => i !== idx))
                          }
                          className="h-7 w-7 text-slate-400 transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* BOTTOM ROW: Full-width Description Input with hover */}
                    <div className="relative">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Input
                              className="h-9 border-slate-200 bg-background/80 text-xs transition-all focus:border-primary"
                              placeholder="Add description or notes for this specific slot..."
                              value={slot.description}
                              onChange={(e) => {
                                const updated = [...slots];
                                updated[idx].description = e.target.value;
                                setSlots(updated);
                              }}
                            />
                          </TooltipTrigger>
                          {/* Tooltip appears if text is long to ensure it's always readable */}
                          {slot.description && slot.description.length > 30 && (
                            <TooltipContent
                              side="bottom"
                              className="max-w-[400px] break-words"
                            >
                              <p className="text-xs">{slot.description}</p>
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="flex flex-col items-end gap-3 border-t pt-4">
            <div className="flex justify-end gap-3">
              {/* <Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate('/admin/instructors/' + instructorId)}>
                                Cancel
                            </Button> */}
              <Button
                size="sm"
                onClick={() => AddTentativeScheduleMutation.mutate()}
                disabled={AddTentativeScheduleMutation.isPending}
                className="px-6 text-xs font-bold"
              >
                Confirm Tentative Schedules
              </Button>
            </div>

            {!isFormValid && (
              <div className="w-full rounded-lg border border-destructive/20 bg-destructive/10 p-2 text-destructive md:max-w-md">
                <p className="mb-1 text-[10px] font-bold">
                  Check the following:
                </p>
                <ul className="list-inside list-disc space-y-0.5 text-[10px]">
                  {validationErrors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Bulk Dialog remains the same */}
        <Dialog open={isAddingBulk} onOpenChange={setIsAddingBulk}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Bulk Add Schedules</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Bulk Action</Label>
                <Select value={bulkType} onValueChange={setBulkType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Single Schedule</SelectItem>
                    <SelectItem value="daily">Bulk Daily</SelectItem>
                    <SelectItem value="hourly">Bulk Hourly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={newSlotDate}
                  onChange={(e) => setNewSlotDate(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Time</Label>
                  <Input
                    type="time"
                    step="1800"
                    value={newSlotTimes.start}
                    onChange={(e) => handleStartTimeChange(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>End Time</Label>
                  <Input
                    type="time"
                    step="1800"
                    value={newSlotTimes.end}
                    onChange={(e) =>
                      setNewSlotTimes({ ...newSlotTimes, end: e.target.value })
                    }
                  />
                </div>
              </div>
              {bulkType !== "single" && (
                <div className="space-y-2">
                  <Label>Number of copies</Label>
                  <Input
                    type="number"
                    value={repeatCount}
                    onChange={(e) =>
                      setRepeatCount(parseInt(e.target.value) || 1)
                    }
                    min="1"
                    max="15"
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button className="w-full" onClick={handleApplyBulkSchedules}>
                Add to Preview
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
};

export const EditTentativeSchedule = ({
  schedule,
  instructorName,
}: {
  schedule: any;
  instructorName?: string;
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const instructorId = schedule?.instructor_id;

  // --- DEBUG LOGS ---
  useEffect(() => {
    console.log("🛠️ EditTentativeSchedule - Received Schedule Prop:", schedule);

    if (schedule) {
      console.log("📝 Mapping Tentative Details:", schedule.tentative_details);

      // Define the new state objects
      const newSlots = [
        {
          date: schedule.date || "",
          start_time: schedule.start_time || "",
          end_time: schedule.end_time || "",
          description: schedule.tentative_details?.description || "",
        },
      ];

      const newDetails = {
        name: schedule.tentative_details?.name || "",
        phone: schedule.tentative_details?.phone || "",
        paid_info: schedule.tentative_details?.paid_info || "N/A",
        pickup_location: schedule.tentative_details?.pickup_location || "",
        leadName: schedule.tentative_details?.leadName || "",
        address: schedule.tentative_details?.address || "",
        course_id: schedule.course_id?.toString() || "none",
        lat: schedule.tentative_details?.lat ?? null,
        lng: schedule.tentative_details?.lng ?? null,
      };

      setSlots(newSlots);
      setTentativeDetails(newDetails);

      console.log("✅ State has been set to:", { newSlots, newDetails });
    } else {
      console.warn("⚠️ Schedule prop is NULL or UNDEFINED");
    }
  }, [schedule]); // This will fire every time the 'schedule' object reference changes
  // 1. Initial State Hooks
  const [slots, setSlots] = useState([]);
  const [tentativeDetails, setTentativeDetails] = useState({
    name: "",
    phone: "",
    paid_info: "Unpaid",
    pickup_location: "",
    leadName: "",
    address: "",
    course_id: null as string | null,
    lat: null as number | null,
    lng: null as number | null,
  });

  const { data: courses } = useQuery({
    queryKey: ["courses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("Courses").select("*");
      if (error) throw error;
      return data;
    },
  });

  // 2. Reset Logic: Sync state when schedule prop changes
  useEffect(() => {
    if (schedule) {
      setSlots([
        {
          date: schedule.date || "",
          start_time: schedule.start_time || "",
          end_time: schedule.end_time || "",
          description: schedule.tentative_details?.description || "",
        },
      ]);

      setTentativeDetails({
        name: schedule.tentative_details?.name || "",
        phone: schedule.tentative_details?.phone || "",
        paid_info: schedule.tentative_details?.paid_info || "Unpaid",
        pickup_location: schedule.tentative_details?.pickup_location || "",
        leadName: schedule.tentative_details?.leadName || "",
        address: schedule.tentative_details?.address || "",
        course_id: schedule.course_id?.toString() || "none",
        lat: schedule.tentative_details?.lat ?? null,
        lng: schedule.tentative_details?.lng ?? null,
      });
    }
  }, [schedule]);

  const [availabilityMap, setAvailabilityMap] = useState<Record<string, any>>(
    {},
  );

  useEffect(() => {
    const validateAllSlots = async () => {
      if (!instructorId || slots.length === 0) return;
      try {
        const result = await checkInstructorAvailability(slots, instructorId);
        setAvailabilityMap(result);
      } catch (err) {
        console.error("Availability Check Failed:", err);
      }
    };
    validateAllSlots();
  }, [slots, instructorId]);

  const stats = useMemo(() => {
    const total = slots.length;
    const blocked = slots.filter((s) => {
      const status = availabilityMap[`${s.date}-${s.start_time}`];
      return status?.available === false;
    }).length;
    return { total, blocked };
  }, [slots, availabilityMap]);

  const validationErrors = useMemo(() => {
    const errors = [];
    const cleanPhone = (tentativeDetails.phone || "").replace(/\D/g, "");
    if (!tentativeDetails.name?.trim()) errors.push("Name is required");
    if (cleanPhone.length !== 10) errors.push("Phone must be 10 digits");
    if (!tentativeDetails.leadName?.trim())
      errors.push("Sales Lead is required");
    if (stats.blocked > 0) errors.push("Remove blocked slots");
    return errors;
  }, [tentativeDetails, stats.blocked]);

  const isFormValid = validationErrors.length === 0;

  const UpdateTentativeScheduleMutation = useMutation({
    mutationFn: async () => {
      if (!slots[0]) return;

      const updatedData = {
        date: slots[0].date,
        start_time: slots[0].start_time,
        end_time: slots[0].end_time,
        // SANITIZE HERE: If it's a special string, send null to the DB
        course_id:
          tentativeDetails.course_id === "none" ||
          tentativeDetails.course_id === "topup"
            ? null
            : tentativeDetails.course_id,
        tentative_details: {
          ...tentativeDetails,
          description: slots[0].description,
        },
      };

      const { error } = await supabase
        .from("Schedule")
        .update(updatedData)
        .eq("id", schedule.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Updated",
        description: "Schedule updated successfully",
        variant: "success",
      });
      navigate({
        pathname: "/admin/instructors/" + instructorId,
        search: location.search,
      });
      window.location.reload();
    },
  });

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-4xl rounded-xl border border-border bg-background p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between border-b pb-4">
          <div>
            <h1 className="text-l font-bold">Edit Tentative Schedule</h1>
            {instructorName && (
              <p className="mt-0.5 text-xs text-slate-500">
                Instructor:{" "}
                <span className="font-semibold text-slate-700">
                  {instructorName}
                </span>
              </p>
            )}
          </div>
          {/* <Button variant="ghost" size="icon" onClick={() => navigate('/admin/instructors/' + instructorId)}>✕</Button> */}
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Name*</Label>
              <Input
                value={tentativeDetails.name}
                onChange={(e) =>
                  setTentativeDetails({
                    ...tentativeDetails,
                    name: e.target.value,
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Phone Number*</Label>
              <Input
                value={tentativeDetails.phone}
                onChange={(e) =>
                  setTentativeDetails({
                    ...tentativeDetails,
                    phone: e.target.value,
                  })
                }
                maxLength={10}
              />
            </div>
            <div className="space-y-2">
              <Label>Sales lead name*</Label>
              <Input
                value={tentativeDetails.leadName}
                onChange={(e) =>
                  setTentativeDetails({
                    ...tentativeDetails,
                    leadName: e.target.value,
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Payment Status</Label>
              <Select
                value={tentativeDetails.paid_info}
                onValueChange={(v) =>
                  setTentativeDetails({ ...tentativeDetails, paid_info: v })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Unpaid">Unpaid</SelectItem>
                  <SelectItem value="Half paid">Half paid</SelectItem>
                  <SelectItem value="Full paid">Full paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Address / Pickup Location</Label>
            <AddressAutocomplete
              value={tentativeDetails.address}
              onChange={(addr, lat, lng) =>
                setTentativeDetails({
                  ...tentativeDetails,
                  address: addr,
                  pickup_location: addr,
                  lat,
                  lng,
                })
              }
            />
          </div>

          <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Course Selection</Label>
              <Select
                value={tentativeDetails.course_id || "none"}
                onValueChange={(v) => {
                  // 1. Determine the display name for the description
                  let displayName = "";
                  let finalCourseId = v;

                  if (v === "topup") {
                    displayName = "Topup";
                  } else if (v === "none") {
                    displayName = "";
                    finalCourseId = "none";
                  } else {
                    const selectedCourse = courses?.find(
                      (c) => c.id.toString() === v,
                    );
                    displayName = selectedCourse ? selectedCourse.name : "";
                    finalCourseId = selectedCourse
                      ? selectedCourse.id.toString()
                      : v;
                  }

                  // 2. Update the tentativeDetails (the course ID)
                  setTentativeDetails({
                    ...tentativeDetails,
                    course_id: finalCourseId,
                  });

                  // 3. Update the description in the slots state
                  if (slots.length > 0) {
                    const updatedSlots = [...slots];
                    updatedSlots[0] = {
                      ...updatedSlots[0],
                      description: displayName, // Clears old text and sets course name
                    };
                    setSlots(updatedSlots);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Course" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {courses?.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="topup">Topup</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="border-t border-dashed pt-6">
            <Label className="mb-4 block text-sm font-bold">
              Schedule Details
            </Label>
            <div className="grid grid-cols-1 gap-4">
              {slots.map((slot, idx) => (
                <div
                  key={idx}
                  className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4"
                >
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      type="date"
                      value={slot.date}
                      onChange={(e) => {
                        const updated = [...slots];
                        updated[idx].date = e.target.value;
                        setSlots(updated);
                      }}
                    />
                    <Input
                      type="time"
                      step="1800"
                      value={slot.start_time}
                      onChange={(e) => {
                        const updated = [...slots];
                        updated[idx].start_time = e.target.value;
                        setSlots(updated);
                      }}
                    />
                    <Input
                      type="time"
                      step="1800"
                      value={slot.end_time}
                      onChange={(e) => {
                        const updated = [...slots];
                        updated[idx].end_time = e.target.value;
                        setSlots(updated);
                      }}
                    />
                  </div>
                  <Input
                    placeholder="Description/Lesson Info"
                    value={slot.description}
                    onChange={(e) => {
                      const updated = [...slots];
                      updated[idx].description = e.target.value;
                      setSlots(updated);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col items-end gap-3 border-t pt-6">
            <div className="flex justify-end gap-3">
              {/* <Button variant="ghost" onClick={() => navigate('/admin/instructors/' + instructorId)}>
                                Cancel
                            </Button> */}
              <Button
                onClick={() => UpdateTentativeScheduleMutation.mutate()}
                disabled={UpdateTentativeScheduleMutation.isPending}
                className="px-8 font-bold"
              >
                {UpdateTentativeScheduleMutation.isPending
                  ? "Updating..."
                  : "Update Schedule"}
              </Button>
            </div>

            {!isFormValid && (
              <div className="w-full rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-destructive md:max-w-md">
                <ul className="list-inside list-disc text-[11px]">
                  {validationErrors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
};

function isTimeUnavailable(
  unavailability: any[] | null | undefined,
  day: Date,
  hour: number,
  minute: number,
): boolean {
  if (
    !unavailability ||
    !Array.isArray(unavailability) ||
    unavailability.length === 0
  ) {
    return false;
  }

  const currentTime = new Date(day);
  currentTime.setHours(hour, minute);
  const dayOfWeek = format(day, "EEEE").toLowerCase();
  const formattedDate = format(day, "yyyy-MM-dd");

  return unavailability.some((u) => {
    if (u.booked_date && u.all_day) {
      return formattedDate === u.booked_date;
    }

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

    if (u.day_of_week && u.all_day) {
      return u.day_of_week === dayOfWeek;
    }

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

    if (u.start_date && u.end_date && u.range_all_day) {
      const rangeStart = new Date(u.start_date);
      const rangeEnd = new Date(u.end_date);
      rangeEnd.setHours(23, 59, 59);
      return currentTime >= rangeStart && currentTime <= rangeEnd;
    }

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

    if (u.start_date && u.end_date && !u.range_all_day && !u.range_start_time) {
      const rangeStart = new Date(u.start_date);
      const rangeEnd = new Date(u.end_date);
      rangeEnd.setHours(23, 59, 59);
      return currentTime >= rangeStart && currentTime <= rangeEnd;
    }

    return false;
  });
}

// Check if a time slot is blocked by an imported calendar event
function isBlockedByImportedEvent(
  importedEvents: any[] | null | undefined,
  day: Date,
  hour: number,
  minute: number,
): boolean {
  if (
    !importedEvents ||
    !Array.isArray(importedEvents) ||
    importedEvents.length === 0
  ) {
    return false;
  }

  const currentTime = new Date(day);
  currentTime.setHours(hour, minute, 0, 0);
  const formattedDate = format(day, "yyyy-MM-dd");

  return importedEvents.some((event) => {
    // Check if event is on this date
    const eventDateStr = event.start?.dateTime || event.start?.date;
    if (!eventDateStr) return false;

    const eventDate = eventDateStr.split("T")[0];
    if (eventDate !== formattedDate) return false;

    // All-day event
    if (event.start?.date && !event.start?.dateTime) {
      return true;
    }

    // Timed event - check if current time falls within event
    if (event.start?.dateTime && event.end?.dateTime) {
      const eventStart = new Date(event.start.dateTime);
      const eventEnd = new Date(event.end.dateTime);
      return currentTime >= eventStart && currentTime < eventEnd;
    }

    return false;
  });
}

// Get imported calendar events for a specific hour slot
function getImportedEventsForSlot(
  importedEvents: any[] | null | undefined,
  day: Date,
  hour: number,
): any[] {
  if (
    !importedEvents ||
    !Array.isArray(importedEvents) ||
    importedEvents.length === 0
  ) {
    return [];
  }

  const formattedDate = format(day, "yyyy-MM-dd");
  const slotStart = new Date(day);
  slotStart.setHours(hour, 0, 0, 0);
  const slotEnd = new Date(day);
  slotEnd.setHours(hour + 1, 0, 0, 0);

  return importedEvents.filter((event) => {
    const eventDateStr = event.start?.dateTime || event.start?.date;
    if (!eventDateStr) return false;

    const eventDate = eventDateStr.split("T")[0];
    if (eventDate !== formattedDate) return false;

    // All-day event - show in all slots
    if (event.start?.date && !event.start?.dateTime) {
      return hour === 8; // Only show all-day events in 8 AM slot to avoid duplication
    }

    // Timed event - check if event starts in this hour slot
    if (event.start?.dateTime) {
      const eventStart = new Date(event.start.dateTime);
      return eventStart >= slotStart && eventStart < slotEnd;
    }

    return false;
  });
}

export const InstructorSchedulePage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const [selectedSlot, setSelectedSlot] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentDate, setCurrentDate] = useState(new Date());

  const [hoveredDay, setHoveredDay] = useState(null);
  const [hoveredHour, setHoveredHour] = useState(null);

  // Confirmation modal for deleting a tentative slot.
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Drag-to-create state. Cells in this view are 1-hour-tall, so a drag is a
  // contiguous range of hours within a single day. We mirror state into refs
  // so the window-level mouse-up listener (registered once on mount) catches
  // even fast clicks where React hasn't re-rendered between mousedown/up.
  const [dragStart, setDragStart] = useState<{
    date: Date;
    hour: string;
  } | null>(null);
  const [dragEnd, setDragEnd] = useState<{
    date: Date;
    hour: string;
  } | null>(null);
  const dragStartRef = useRef<{ date: Date; hour: string } | null>(null);
  const dragEndRef = useRef<{ date: Date; hour: string } | null>(null);
  // After a drag finalises we set this so the trailing onClick (which fires
  // after mouseup) doesn't overwrite our prefilled add-form state.
  const dragJustEndedRef = useRef(false);
  useEffect(() => {
    dragStartRef.current = dragStart;
  }, [dragStart]);
  useEffect(() => {
    dragEndRef.current = dragEnd;
  }, [dragEnd]);

  const isInDragRange = (date: Date, hour: string) => {
    if (!dragStart || !dragEnd) return false;
    if (dragStart.date.getTime() !== date.getTime()) return false;
    const lo = Math.min(parseInt(dragStart.hour), parseInt(dragEnd.hour));
    const hi = Math.max(parseInt(dragStart.hour), parseInt(dragEnd.hour));
    const h = parseInt(hour);
    return h >= lo && h <= hi;
  };

  const PALETTE = {
    SUCCESS: "#00CE84",
    PURPLE_LIGHT: "#B28FFF",
    PURPLE_DARK: "#6257FF",
    MINT: "#00FF91",
    ORANGE: "#FFC229",
    CYAN: "#6BECFF",
    BLOCK: "#030508",
  };

  // Tentative > status > default. Status compared lowercase since it's a
  // freeform string column. "Completed" splits OTP-verified (started_at +
  // ended_at present) from manually-marked, matching the convention used in
  // the instructor's own day view.
  const getScheduleColors = (schedule: any) => {
    if (schedule.isTentative) {
      return {
        block: "border-amber-600 bg-amber-400 text-amber-950",
        card: "border-amber-200 bg-amber-50/30",
      };
    }
    const status = schedule.status?.toLowerCase();
    if (status === "paused") {
      if (schedule.pause_reason?.toLowerCase() === "payment") {
        return {
          block: "border-red-700 bg-red-500 text-white",
          card: "border-red-200 bg-red-50",
        };
      }

      return {
        block: "border-slate-700 bg-slate-500 text-white",
        card: "border-slate-200 bg-slate-50",
      };
    }
    if (status === "ongoing") {
      return {
        block: "border-blue-700 bg-blue-500 text-white",
        card: "border-blue-200 bg-blue-50/30",
      };
    }
    if (status === "completed") {
      if (schedule.started_at && schedule.ended_at) {
        return {
          block: "border-emerald-700 bg-emerald-500 text-white",
          card: "border-emerald-200 bg-emerald-50/30",
        };
      }
      return {
        block: "border-orange-600 bg-orange-400 text-orange-950",
        card: "border-orange-200 bg-orange-50/30",
      };
    }
    return {
      block: "border-indigo-700 bg-indigo-500 text-white",
      card: "border-indigo-200 bg-indigo-50/30",
    };
  };

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const handlePrevWeek = () => setCurrentDate((prev) => subDays(prev, 7));
  const handleNextWeek = () => setCurrentDate((prev) => addDays(prev, 7));
  const handlePrevDay = () => setCurrentDate((prev) => subDays(prev, 1));
  const handleNextDay = () => setCurrentDate((prev) => addDays(prev, 1));
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(currentDate, i)),
    [currentDate],
  );

  const [isAddingschedule, setIsAddingschedule] = useState(false);

  // Direction logic: Top half (until noon) slides from bottom, Bottom half slides from top
  const isTopHalf = selectedSlot ? parseInt(selectedSlot.hour) < 12 : true;

  const timeSlots = useMemo(() => {
    const slots = [];
    for (let i = SlotConfig.startHourOfDay; i < SlotConfig.endHourOfDay; i++) {
      const date = parse(i.toString(), "H", new Date());
      slots.push({
        hour24: i.toString().padStart(2, "0"),
        display: format(date, "h a"),
      });
    }
    return slots;
  }, []);

  const { data: instructor, isLoading } = useQuery({
    queryKey: ["instructor-full", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Instructor")
        .select(
          `
          *,
          schedules:Schedule (
            *,
            learner:learner_id (
              name, phone, pick_up_location, address_lat, address_lng
            ),
            lesson:lesson_id (number)
          )
        `,
        )
        .eq("id_instructor", id)
        .single();
      if (error) throw error;

      return data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (scheduleId) => {
      await supabase.from("Schedule").delete().eq("id", scheduleId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["instructor-full"]);
      if (selectedSlot) setSelectedSlot(null);
    },
  });

  // Mount-once window mouse-up listener. Reads the latest drag from refs
  // (state hasn't necessarily propagated when a fast click ends), then
  // opens the side panel pre-filled with the dragged time range.
  useEffect(() => {
    const handleUp = () => {
      const start = dragStartRef.current;
      const end = dragEndRef.current;
      dragStartRef.current = null;
      dragEndRef.current = null;
      setDragStart(null);
      setDragEnd(null);
      if (!start || !end) return;
      if (start.date.getTime() !== end.date.getTime()) return;
      const startH = Math.min(parseInt(start.hour), parseInt(end.hour));
      const endH = Math.max(parseInt(start.hour), parseInt(end.hour)) + 1; // bottom of last cell
      setSelectedSlot({
        date: start.date,
        hour: startH.toString().padStart(2, "0"),
        endHour: endH.toString().padStart(2, "0"),
        schedules: [],
      } as any);
      setIsAddingschedule(true);
      dragJustEndedRef.current = true;
    };
    window.addEventListener("mouseup", handleUp);
    return () => window.removeEventListener("mouseup", handleUp);
  }, []);

  const updatePaidInfoMutation = useMutation({
    mutationFn: async ({ scheduleId, paidInfo }) => {
      const { error } = await supabase
        .from("Schedule")
        .update({ paid_info: paidInfo }) // Ensure this column exists in your DB
        .eq("id", scheduleId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["instructor-full"]);
    },
  });

  // Calendar import functionality
  const {
    calendarEvents: importedCalendarEvents,
    importedEventsCount,
    importEvents,
    hasImportedCalendar,
  } = useAdminImportedCalendar({ instructorId: id });

  const [showCalendarImport, setShowCalendarImport] = useState(false);

  const [editingschedule, setEditingschedule] = useState<any | null>(null);

  const filteredSchedules = useMemo(() => {
    if (!instructor?.schedules) return [];
    const q = searchQuery.toLowerCase();
    return instructor.schedules.filter((s) => {
      const name =
        (s.isTentative ? s.tentative_details?.name : s.learner?.name) || "";
      const phone =
        (s.isTentative ? s.tentative_details?.phone : s.learner?.phone) || "";
      return (
        !searchQuery.trim() ||
        name.toLowerCase().includes(q) ||
        phone.includes(q)
      );
    });
  }, [instructor, searchQuery]);

  // Use the canonical Lesson.number for each schedule. This reflects the
  // lesson's position in the FULL course (across every instructor), not the
  // local position within this instructor's slice. Without this, range-based
  // instructor reassignments (e.g. lessons 6-10 to a new instructor) would
  // show as "Class 1..5" on the new instructor's view since the old code
  // renumbered within instructor.schedules only. Topup/demo schedules with
  // lesson_id=null intentionally have no class number — they're standalone
  // classes, not part of a numbered course.
  const scheduleToLessonNumber = useMemo(() => {
    if (!instructor?.schedules) return {};
    const mapping: Record<string, number> = {};
    instructor.schedules.forEach((schedule) => {
      if (schedule.isTentative || !schedule.learner_id) return;
      const lessonNumber = schedule.lesson?.number;
      if (typeof lessonNumber === "number" && lessonNumber > 0) {
        mapping[schedule.id] = lessonNumber;
      }
    });
    return mapping;
  }, [instructor?.schedules]);

  // Reset edit state when closing the sidebar or switching slots
  const handleCloseSidebar = () => {
    setSelectedSlot(null);
    setEditingschedule(null);
  };

  const formatTimeStr = (time) => (time ? time.slice(0, 5) : "");

  if (isLoading)
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="animate-spin text-slate-400" />
      </div>
    );

  return (
    <div className="flex h-screen max-h-screen flex-col overflow-hidden bg-white font-sans">
      <header className="z-[100] flex shrink-0 items-center justify-between border-b bg-white px-4 py-2 shadow-sm">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              navigate({
                pathname: "/admin/instructors",
                search: location.search,
              })
            }
            className="rounded-full"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>

          {/* Instructor identity + three-way status setter (Active / On
              Break / Inactive) — prominent per PRD, not buried in a sub-tab */}
          <div className="flex items-center gap-2">
            <span className="max-w-[180px] truncate text-sm font-bold text-slate-800">
              {instructor?.name}
            </span>
            {instructor && (
              <InstructorStatusControl
                instructorId={instructor.id_instructor}
                status={resolveInstructorStatus(instructor)}
                size="compact"
              />
            )}
          </div>

          <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-1">
            {/* Week Back */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:bg-white"
              onClick={handlePrevWeek}
            >
              <ChevronsLeft className="h-4 w-4 text-slate-600" />
            </Button>
            {/* Day Back */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:bg-white"
              onClick={handlePrevDay}
            >
              <ChevronLeft className="h-4 w-4 text-slate-600" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="px-3 text-[10px] font-bold uppercase tracking-tight"
              onClick={() => setCurrentDate(new Date())}
            >
              Today
            </Button>

            {/* Day Forward */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:bg-white"
              onClick={handleNextDay}
            >
              <ChevronRight className="h-4 w-4 text-slate-600" />
            </Button>
            {/* Week Forward */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:bg-white"
              onClick={handleNextWeek}
            >
              <ChevronsRight className="h-4 w-4 text-slate-600" />
            </Button>
          </div>

          <h1 className="ml-2 text-xs font-bold uppercase tracking-tight text-slate-500">
            {format(weekDates[0], "MMM d")} -{" "}
            {format(weekDates[6], "MMM d, yyyy")}
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 xl:flex">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-indigo-500" />
              Booked
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-amber-400" />
              Tentative
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-blue-500" />
              Ongoing
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-emerald-500" />
              Done (OTP)
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-orange-400" />
              Done (manual)
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-slate-500" />
              Paused
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-red-500" />
              Payment Due
            </span>
          </div>

          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              placeholder="Search name or phone..."
              className="h-8 w-full rounded-md border-none bg-slate-50 pl-9 text-xs outline-none focus:ring-1 focus:ring-slate-200"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Import Calendar Button */}
          <Button
            variant="outline"
            size="sm"
            className="flex items-center gap-2 text-xs"
            onClick={() => setShowCalendarImport(true)}
          >
            <Calendar className="h-4 w-4" />
            {hasImportedCalendar
              ? `${importedEventsCount} Events`
              : "Import Calendar"}
          </Button>
        </div>
      </header>

      {/* Calendar Import Dialog */}
      <Dialog open={showCalendarImport} onOpenChange={setShowCalendarImport}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Import Instructor Calendar
            </DialogTitle>
            <DialogDescription>
              Import events from the instructor's personal calendar to block
              those time slots from scheduling.
            </DialogDescription>
          </DialogHeader>
          <CalendarImport
            onImport={(events) => {
              importEvents(events);
              setShowCalendarImport(false);
            }}
            existingEventsCount={importedEventsCount}
          />
        </DialogContent>
      </Dialog>

      <div className="relative flex flex-1 overflow-hidden">
        {/* LEFT SIDEBAR (1/3 Width) */}
        <aside className="relative z-40 flex w-1/3 flex-col overflow-hidden border-r bg-slate-50/50 shadow-xl">
          <div className="relative flex flex-1 flex-col overflow-hidden">
            <AnimatePresence mode="wait">
              {!selectedSlot ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-1 flex-col items-center justify-center p-8 text-center"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                    <Calendar className="h-6 w-6 text-slate-300" />
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Select a slot to view schedules
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key="content"
                  initial={{ y: isTopHalf ? "100%" : "-100%", opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: isTopHalf ? "100%" : "-100%", opacity: 0 }}
                  className="flex flex-1 flex-col overflow-hidden bg-white"
                >
                  <div className="flex shrink-0 items-center justify-between border-b bg-slate-50/80 px-6 py-5">
                    <div>
                      <h2 className="text-sm font-bold text-black">
                        {format(selectedSlot.date, "EEEE, MMM d")}
                      </h2>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        Hour: {selectedSlot.hour}:00
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSelectedSlot(null)}
                      className="h-8 w-8 rounded-full"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
                    <Button
                      variant="outline"
                      className="mb-2 h-10 w-full border-2 border-dashed border-slate-200 text-[10px] font-bold uppercase text-slate-400 hover:border-black hover:text-black"
                      onClick={() => setIsAddingschedule(true)}
                    >
                      <Plus className="mr-2 h-3 w-3" /> Add schedule
                    </Button>

                    {selectedSlot.schedules?.map((schedule) => {
                      const details = schedule.tentative_details || {};
                      const isTentative = schedule.isTentative;

                      // Helper to ensure N/A is shown
                      const display = (val) =>
                        val && String(val).trim() !== "" ? val : "N/A";

                      // Format to 12-hour format
                      const format12Hour = (timeStr) => {
                        if (!timeStr) return "--:--";
                        try {
                          const [hours, minutes] = timeStr.split(":");
                          let h = parseInt(hours);
                          const ampm = h >= 12 ? "PM" : "AM";
                          h = h % 12 || 12;
                          return `${String(h).padStart(2, "0")}:${minutes} ${ampm}`;
                        } catch (e) {
                          return timeStr;
                        }
                      };

                      const paidInfoValue = isTentative
                        ? details.paid_info
                        : schedule.paid_status || schedule.payment_status;
                      const pickupLocation = isTentative
                        ? display(details.pickup_location)
                        : display(schedule.learner?.pick_up_location);

                      const lat = isTentative
                        ? details.lat
                        : schedule.learner?.address_lat;
                      const lng = isTentative
                        ? details.lng
                        : schedule.learner?.address_lng;

                      // 2. Check if valid coordinates exist
                      const hasCoords = lat && lng;

                      // 3. Create the URL (Fixed the template literal syntax as well)
                      const mapUrl = hasCoords
                        ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
                        : null;

                      const cardColors = getScheduleColors(schedule);

                      return (
                        <div
                          key={schedule.id}
                          className={cn(
                            "relative flex flex-col gap-3 rounded-xl border p-4 shadow-sm transition-all",
                            cardColors.card,
                          )}
                        >
                          {/* 1. TITLE & ICONS */}
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex-1 truncate text-base font-bold text-slate-900">
                              {isTentative ? (
                                display(details.name)
                              ) : (
                                <>
                                  {display(schedule.learner?.name)}
                                  {scheduleToLessonNumber[schedule.id] && (
                                    <span className="ml-1.5 font-medium text-slate-500">
                                      (Class{" "}
                                      {scheduleToLessonNumber[schedule.id]})
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              {isTentative && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-slate-400 hover:bg-white hover:text-indigo-600"
                                  onClick={() =>
                                    schedule && setEditingschedule(schedule)
                                  }
                                >
                                  <Wrench className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-slate-400 hover:bg-white hover:text-destructive"
                                onClick={() => setDeleteConfirmId(schedule.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          {/* 2. START-END TIME */}
                          <div className="flex items-center gap-2 text-slate-700">
                            <Clock className="h-3.5 w-3.5 text-slate-400" />
                            <span className="text-xs font-black uppercase tracking-tight">
                              {format12Hour(schedule.start_time)} —{" "}
                              {format12Hour(schedule.end_time)}
                            </span>
                          </div>

                          {/* 3. PHONE */}
                          <div className="flex items-center gap-2">
                            <Phone className="h-3.5 w-3.5 text-slate-400" />
                            <span className="text-[11px] font-semibold text-slate-600">
                              {isTentative
                                ? display(details.phone)
                                : display(schedule.learner?.phone)}
                            </span>
                          </div>

                          {/* 4. LOCATION (Conditional Link) */}
                          {mapUrl && pickupLocation !== "N/A" ? (
                            <a
                              href={mapUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group/map flex items-start gap-2 rounded-lg border border-slate-100 bg-white/80 p-2.5 text-[11px] text-slate-700 transition-all hover:border-indigo-300 hover:text-indigo-600"
                            >
                              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 group-hover/map:text-indigo-500" />
                              <span className="flex-1 font-medium leading-normal">
                                {pickupLocation}
                              </span>
                              <ExternalLink className="h-3 w-3 opacity-40" />
                            </a>
                          ) : (
                            <div className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/50 p-2.5 text-[11px] text-slate-400">
                              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" />
                              <span className="flex-1 font-medium leading-normal">
                                {pickupLocation}
                              </span>
                            </div>
                          )}

                          {/* 5. DESCRIPTION */}
                          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-100/40 p-2.5 text-[11px] text-slate-600">
                            <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                              Description
                            </p>
                            <span className="block italic leading-relaxed">
                              {isTentative
                                ? display(details.description)
                                : "N/A"}
                            </span>
                          </div>

                          {schedule.status?.toLowerCase() === "paused" && (
                            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-100/40 p-2.5 text-[11px] text-slate-600">
                              <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                                Pause Notes
                              </p>

                              <span className="block italic leading-relaxed">
                                {schedule.pause_reason?.toLowerCase() ===
                                "payment"
                                  ? "Due to payment"
                                  : schedule.pause_notes || "N/A"}
                              </span>
                            </div>
                          )}
                          {/* 6. LEAD NAME */}
                          <div className="flex items-center gap-2 pt-1">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                              Lead:
                            </span>
                            <span className="text-[11px] font-semibold text-slate-600">
                              {isTentative ? display(details.leadName) : "N/A"}
                            </span>
                          </div>

                          {/* 7. PAID INFO */}
                          <div className="mt-1 flex items-center gap-2 border-t border-slate-100 pt-3">
                            <CreditCard className="h-3.5 w-3.5 text-slate-400" />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                              Payment:
                            </span>
                            <span
                              className={cn(
                                "rounded-sm px-1.5 py-0.5 text-[9px] font-black uppercase text-white transition-colors",
                                // Exception: Use Tailwind class for unpaid red
                                paidInfoValue?.toLowerCase() === "unpaid"
                                  ? "bg-red-500"
                                  : "",
                              )}
                              style={{
                                // Use PALETTE for the rest, only if it's NOT unpaid
                                backgroundColor: (() => {
                                  const status = paidInfoValue?.toLowerCase();
                                  if (status === "unpaid") return undefined; // Let Tailwind class handle it
                                  if (status === "full paid")
                                    return PALETTE.SUCCESS;
                                  if (status === "half paid")
                                    return PALETTE.ORANGE;
                                  return PALETTE.BLOCK;
                                })(),
                              }}
                            >
                              {display(paidInfoValue)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* FIXED OVERLAY BLOCK (Keep this exactly as before) */}
          <AnimatePresence>
            {(isAddingschedule || editingschedule) && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[9998] bg-black/10"
                  onClick={() => {
                    setIsAddingschedule(false);
                    setEditingschedule(null);
                  }}
                />
                <motion.div
                  initial={{ x: "-100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "-100%" }}
                  className="fixed bottom-0 left-0 top-[64px] z-[9999] flex w-1/3 flex-col border-r bg-white shadow-2xl"
                >
                  <div
                    className={cn(
                      "flex h-14 shrink-0 items-center justify-between border-b px-6 text-white",
                      isAddingschedule ? "bg-black" : "bg-indigo-600",
                    )}
                  >
                    <span className="text-xs font-bold uppercase">
                      {isAddingschedule ? "Add schedule" : "Edit Tentative"}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setIsAddingschedule(false);
                        setEditingschedule(null);
                      }}
                      className="text-white hover:bg-white/20"
                    >
                      <X className="h-5 w-5" />
                    </Button>
                  </div>
                  <div className="flex-1 overflow-y-auto bg-slate-50 p-8">
                    {isAddingschedule ? (
                      <AddTentativeSchedule
                        instructorId={id}
                        instructorName={instructor?.name}
                        date={format(selectedSlot.date, "yyyy-MM-dd")}
                        startTime={`${selectedSlot.hour}:00`}
                        endTime={
                          (selectedSlot as any).endHour
                            ? `${(selectedSlot as any).endHour}:00`
                            : undefined
                        }
                      />
                    ) : (
                      <EditTentativeSchedule
                        key={editingschedule?.id}
                        schedule={editingschedule}
                        instructorName={instructor?.name}
                        onSuccess={() => setEditingschedule(null)}
                      />
                    )}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </aside>

        {/* CALENDAR (2/3 Width) */}
        <div className="flex flex-1 flex-row overflow-hidden bg-white">
          {/* TIME AXIS */}
          <div className="z-20 flex w-14 shrink-0 flex-col border-r bg-slate-50">
            <div className="h-10 border-b bg-white" />
            <div
              className="grid flex-1"
              style={{ gridTemplateRows: `repeat(${timeSlots.length}, 1fr)` }}
            >
              {timeSlots.map((slot, idx) => {
                const isRowHovered = hoveredHour === idx;

                return (
                  <div
                    key={slot.hour24}
                    className={cn(
                      "flex items-start justify-end border-b border-slate-100 pr-2 pt-1 transition-colors",
                      // Theme Update: White on Dark Grey
                      isRowHovered ? "bg-slate-500" : "bg-white",
                    )}
                  >
                    <span
                      className={cn(
                        "text-[9px] font-bold uppercase transition-colors",
                        // Toggle text color based on hover
                        isRowHovered ? "text-white" : "text-slate-400",
                      )}
                    >
                      {slot.display}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
            {/* GRID HEADERS */}
            <div className="sticky top-0 z-30 grid shrink-0 grid-cols-7 border-b bg-white">
              {weekDates.map((date, idx) => {
                const isHovered = hoveredDay === idx;
                const isToday =
                  format(date, "yyyy-MM-dd") ===
                  format(new Date(), "yyyy-MM-dd");

                return (
                  <div
                    key={date.toString()}
                    className="flex h-10 flex-col items-center justify-center border-r transition-colors last:border-0"
                    style={{
                      // Use BLOCK for hover state, otherwise keep it white
                      backgroundColor: isHovered ? PALETTE.BLOCK : "#FFFFFF",
                    }}
                  >
                    {/* Day Name (EEE) */}
                    <span
                      className="mb-0.5 text-[8px] font-bold uppercase transition-colors"
                      style={{
                        // Light text on dark hover, otherwise slate-400
                        color: isHovered ? "#F1F5F9" : "#94A3B8",
                      }}
                    >
                      {format(date, "EEE")}
                    </span>

                    {/* Day Number (d) - The Circle Container */}
                    <div
                      className={cn(
                        "flex items-center justify-center rounded-full text-[10px] font-black transition-all",
                        // Fixed size ensures it stays a perfect circle
                        "h-6 w-6",
                      )}
                      style={{
                        // CIRCLE BACKGROUND: Purple if today (and not hovered)
                        backgroundColor:
                          isToday && !isHovered
                            ? PALETTE.PURPLE_DARK
                            : "transparent",
                        // TEXT COLOR: White if in bubble or hovered, otherwise dark slate
                        color:
                          isHovered || (isToday && !isHovered)
                            ? "#FFFFFF"
                            : "#334155",
                      }}
                    >
                      {format(date, "d")}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* GRID CELLS */}
            <div
              className="relative grid min-h-0 flex-1 grid-cols-7"
              style={{ gridTemplateRows: `repeat(${timeSlots.length}, 1fr)` }}
            >
              {timeSlots.map((slot, rowIdx) => (
                <Fragment key={slot.hour24}>
                  {weekDates.map((date, colIdx) => {
                    const dateStr = format(date, "yyyy-MM-dd");
                    const slotSchedules = filteredSchedules.filter(
                      (s) =>
                        s.date === dateStr &&
                        s.start_time.split(":")[0] === slot.hour24,
                    );
                    const slotImportedEvents = getImportedEventsForSlot(
                      importedCalendarEvents,
                      date,
                      parseInt(slot.hour24),
                    );
                    const isTopUnavailable =
                      isTimeUnavailable(
                        instructor?.unavailability,
                        date,
                        parseInt(slot.hour24),
                        0,
                      ) ||
                      isBlockedByImportedEvent(
                        importedCalendarEvents,
                        date,
                        parseInt(slot.hour24),
                        0,
                      );
                    const isBottomUnavailable =
                      isTimeUnavailable(
                        instructor?.unavailability,
                        date,
                        parseInt(slot.hour24),
                        30,
                      ) ||
                      isBlockedByImportedEvent(
                        importedCalendarEvents,
                        date,
                        parseInt(slot.hour24),
                        30,
                      );

                    const inDrag = isInDragRange(date, slot.hour24);
                    const isCellEmpty = slotSchedules.length === 0;
                    return (
                      <div
                        key={`${dateStr}-${slot.hour24}`}
                        className={cn(
                          "group relative cursor-pointer select-none border-b border-r border-slate-50 transition-colors",
                          "hover:bg-slate-200",
                          inDrag
                            ? "bg-indigo-200 ring-1 ring-inset ring-indigo-400"
                            : selectedSlot?.date === date &&
                                selectedSlot?.hour === slot.hour24
                              ? "bg-indigo-50"
                              : "bg-white",
                        )}
                        onMouseEnter={() => {
                          setHoveredDay(colIdx);
                          setHoveredHour(rowIdx);
                          // Extend an in-progress drag if we're still on
                          // the same day column. Read from the ref so a
                          // drag started in the same tick is visible.
                          const cur = dragStartRef.current;
                          if (cur && cur.date.getTime() === date.getTime()) {
                            const newEnd = { date, hour: slot.hour24 };
                            dragEndRef.current = newEnd;
                            setDragEnd(newEnd);
                          }
                        }}
                        onMouseLeave={() => {
                          setHoveredDay(null);
                          setHoveredHour(null);
                        }}
                        onMouseDown={(e) => {
                          // Only left-click on empty cells starts a drag.
                          if (e.button !== 0) return;
                          if (!isCellEmpty) return;
                          e.preventDefault();
                          const start = { date, hour: slot.hour24 };
                          dragStartRef.current = start;
                          dragEndRef.current = start;
                          setDragStart(start);
                          setDragEnd(start);
                        }}
                        onClick={() => {
                          // The trailing click after a drag is a no-op —
                          // the drag finalizer already opened the panel.
                          if (dragJustEndedRef.current) {
                            dragJustEndedRef.current = false;
                            return;
                          }
                          setSelectedSlot({
                            date,
                            hour: slot.hour24,
                            schedules: slotSchedules,
                          });
                          setIsAddingschedule(false);
                        }}
                      >
                        {isTopUnavailable && (
                          <div
                            className="absolute left-0 top-0 z-0 h-1/2 w-full opacity-25"
                            style={{ backgroundColor: PALETTE.BLOCK }}
                          />
                        )}
                        {isBottomUnavailable && (
                          <div
                            className="absolute bottom-0 left-0 z-0 h-1/2 w-full opacity-25"
                            style={{ backgroundColor: PALETTE.BLOCK }}
                          />
                        )}
                        <div className="pointer-events-none absolute left-0 top-1/2 z-0 w-full border-t border-dashed border-slate-100" />

                        <div className="pointer-events-none absolute inset-0 z-20 overflow-visible p-0.5">
                          {slotSchedules.map((schedule, idx) => {
                            const startMin = parseInt(
                              schedule.start_time.split(":")[1],
                            );
                            const duration =
                              differenceInMinutes(
                                parse(
                                  schedule.end_time,
                                  "HH:mm:ss",
                                  new Date(),
                                ),
                                parse(
                                  schedule.start_time,
                                  "HH:mm:ss",
                                  new Date(),
                                ),
                              ) || 60;
                            const blockColors = getScheduleColors(schedule);

                            return (
                              <div
                                key={schedule.id}
                                className={cn(
                                  "group/grid pointer-events-auto absolute flex flex-col rounded-sm border-l-2 p-1 shadow-md transition-all",
                                  blockColors.block,
                                )}
                                style={{
                                  left: `${idx * 10}%`,
                                  width: "90%",
                                  top: `${(startMin / 60) * 100}%`,
                                  height: `${(duration / 60) * 100}%`,
                                  zIndex: 50 + idx,
                                  minHeight: "24px",
                                }}
                              >
                                {/* GRID DELETE BUTTON */}
                                {schedule.isTentative && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDeleteConfirmId(schedule.id);
                                    }}
                                    className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-sm bg-black/10 transition-colors hover:bg-black/20"
                                    title="Delete tentative schedule"
                                  >
                                    <Trash2 className="h-2.5 w-2.5 text-amber-950" />
                                  </button>
                                )}

                                <div className="mb-0.5 flex items-center gap-1 truncate pr-4 text-[8px] font-bold leading-none">
                                  <span>
                                    {schedule.isTentative
                                      ? schedule.tentative_details?.name
                                      : schedule.learner?.name}
                                  </span>

                                  {/* Show chronological Lesson Number for confirmed schedules only */}
                                  {!schedule.isTentative &&
                                    scheduleToLessonNumber[schedule.id] && (
                                      <span className="shrink-0 rounded-[2px] bg-black/10 px-1 py-0.5 font-black opacity-80">
                                        ({scheduleToLessonNumber[schedule.id]})
                                      </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-0.5 text-[7px] font-medium opacity-90">
                                  <Clock className="h-1.5 w-1.5" />
                                  {format(
                                    parse(
                                      schedule.start_time,
                                      "HH:mm:ss",
                                      new Date(),
                                    ),
                                    "h:mm a",
                                  )}{" "}
                                  -{" "}
                                  {format(
                                    parse(
                                      schedule.end_time,
                                      "HH:mm:ss",
                                      new Date(),
                                    ),
                                    "h:mm a",
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          {/* Imported Calendar Events */}
                          {slotImportedEvents.map((event, idx) => {
                            const isAllDay =
                              event.start?.date && !event.start?.dateTime;
                            let startMin = 0;
                            let duration = 60;

                            if (!isAllDay && event.start?.dateTime) {
                              const eventStart = new Date(event.start.dateTime);
                              startMin = eventStart.getMinutes();

                              if (event.end?.dateTime) {
                                const eventEnd = new Date(event.end.dateTime);
                                duration = Math.max(
                                  30,
                                  differenceInMinutes(eventEnd, eventStart),
                                );
                              }
                            }

                            return (
                              <div
                                key={event.id || `imported-${idx}`}
                                className="group/grid pointer-events-auto absolute flex flex-col rounded-sm border-l-2 border-slate-600 bg-slate-400 p-1 text-slate-900 shadow-md transition-all"
                                style={{
                                  left: `${(slotSchedules.length + idx) * 10}%`,
                                  width: "90%",
                                  top: isAllDay
                                    ? "0%"
                                    : `${(startMin / 60) * 100}%`,
                                  height: isAllDay
                                    ? "100%"
                                    : `${Math.min((duration / 60) * 100, 100)}%`,
                                  zIndex: 40 + idx,
                                  minHeight: "24px",
                                }}
                                title={event.summary || "Imported Event"}
                              >
                                <div className="mb-0.5 truncate text-[8px] font-bold leading-none">
                                  {event.summary || "Imported Event"}
                                </div>
                                {!isAllDay && event.start?.dateTime && (
                                  <div className="flex items-center gap-0.5 text-[7px] font-medium opacity-90">
                                    <Clock className="h-1.5 w-1.5" />
                                    {format(
                                      new Date(event.start.dateTime),
                                      "h:mm a",
                                    )}
                                    {event.end?.dateTime && (
                                      <>
                                        {" - "}
                                        {format(
                                          new Date(event.end.dateTime),
                                          "h:mm a",
                                        )}
                                      </>
                                    )}
                                  </div>
                                )}
                                {isAllDay && (
                                  <div className="text-[7px] font-medium opacity-90">
                                    All day
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Delete Tentative Slot Confirmation Modal */}
      <Dialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) {
            setDeleteConfirmId(null);
          }
        }}
      >
        <DialogContent className="max-w-sm overflow-hidden p-0 sm:max-w-md">
          <div className="flex flex-col items-center gap-4 px-6 pb-2 pt-7 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 ring-8 ring-red-50/50">
              <AlertTriangle className="h-7 w-7 text-red-600" strokeWidth={2} />
            </div>
            <div className="space-y-1.5">
              <DialogTitle className="text-lg font-semibold text-gray-900">
                Delete this slot?
              </DialogTitle>
              <DialogDescription className="text-sm text-gray-500">
                This tentative slot will be permanently removed from the
                calendar and the time will be freed for new bookings.
              </DialogDescription>
            </div>
          </div>
          <div className="flex gap-2 border-t border-gray-100 bg-gray-50 px-6 py-4">
            <Button
              variant="outline"
              className="flex-1 bg-white"
              onClick={() => setDeleteConfirmId(null)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1 gap-2"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (!deleteConfirmId) return;
                deleteMutation.mutate(deleteConfirmId, {
                  onSettled: () => setDeleteConfirmId(null),
                });
              }}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
