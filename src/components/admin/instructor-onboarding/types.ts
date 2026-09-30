// Types for Instructor Onboarding Wizard

import type { ZoneCoordinate } from "@/components/instructor-zones/types";
import { ParsedCalendarEvent } from "@/utils/icsParser";

export type IdProofType = "aadhar" | "pan" | "voter_id" | "passport";
export type CarFuelType = "petrol" | "diesel" | "ev" | "cng" | "lpg";
export type CarMakeType = "Manual" | "Automatic";

export interface Unavailability {
  // Single day block
  booked_date?: string;
  booked_start_time?: string;
  booked_end_time?: string;
  all_day?: boolean;

  // Weekly recurring (supports multiple days)
  day_of_week?: string; // Legacy: single day
  days_of_week?: string[]; // New: multiple days like ["monday", "wednesday", "friday"]

  // Date range
  start_date?: string;
  end_date?: string;
  range_all_day?: boolean;
  range_start_time?: string;
  range_end_time?: string;

  // Metadata
  reason?: string; // Label for the block (e.g., "Personal", "Holiday", "Other job")
  type?: "single" | "recurring" | "range"; // Explicit type for easier handling
}

export interface InstructorOnboardingData {
  // Step 1: Basic Info
  name: string;
  phone: string;
  email: string;

  // Step 2: Documents
  DL_number: string;
  id_proof_type: IdProofType | null;
  id_proof_number: string;

  // Step 3: Vehicle Details
  car_make: CarMakeType | "";
  car_mode: string;
  car_number: string;
  car_fuel_type: CarFuelType | null;
  experience: number;

  // Step 4: Drawn service area polygon (saved to instructor_service_zones after
  // the Instructor row exists, since zones reference instructor_id). One polygon
  // per instructor, so this is a single ring rather than a list.
  // address/latitude/longitude/radius/areas were removed from this step: the
  // polygon is now the only service-area source of truth.
  serviceZone: ZoneCoordinate[] | null;

  // Step 5: Unavailability
  unavailability: Unavailability[];

  // Step 6: Calendar Import (optional)
  importedCalendarEvents: ParsedCalendarEvent[];

  // Step 7: Contract
  contractAccepted: boolean;

  // Auth
  initialPassword: string;
}

export const initialOnboardingData: InstructorOnboardingData = {
  // Step 1
  name: "",
  phone: "",
  email: "",

  // Step 2
  DL_number: "",
  id_proof_type: null,
  id_proof_number: "",

  // Step 3
  car_make: "",
  car_mode: "",
  car_number: "",
  car_fuel_type: null,
  experience: 0,

  // Step 4
  serviceZone: null,

  // Step 5
  unavailability: [],

  // Step 6
  importedCalendarEvents: [],

  // Step 7
  contractAccepted: false,

  // Auth
  initialPassword: "",
};

export interface ServiceableArea {
  id: string;
  name: string;
  postal_code?: string;
}

export interface StepProps {
  data: InstructorOnboardingData;
  updateData: (updates: Partial<InstructorOnboardingData>) => void;
}

export interface StepInfo {
  id: number;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
}
