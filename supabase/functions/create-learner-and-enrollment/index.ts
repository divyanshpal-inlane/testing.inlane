import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { validateCreateLearnerRequest, ValidationError } from "./validation.ts";

// Load environment variables
const supabaseUrl = Deno.env.get("MY_SUPABASE_URL");
const supabaseKey = Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Max-Age": "86400",
};

export async function createLearnerAndEnrollment(input: unknown) {
  // Validate and normalize the complete request before either insert. In
  // particular, hidden course/RTO fields are rejected instead of silently
  // being persisted through a stale or tampered client payload.
  const data = validateCreateLearnerRequest(input);
  const {
    name,
    email,
    phone,
    courseId,
    amount,
    installmentType,
    installment1Amount,
    installment2Amount,
    unlockedLessons,
    courseTypeSelection,
    totalLessons,
    selectedModules,
    modulePrices,
    has_a_DL,
    has_two_wheeler_license,
    address_change_required,
    LL_received,
    caseType,
    twoWheelerRequirement,
    fourWheelerRequirement,
    rtoFee,
    rtoAddressChangeRequired,
  } = data;

  // Check if learner with this phone already exists
  const { data: existingLearner, error: checkError } = await supabase
    .from("Learner")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  if (checkError) {
    console.error("Supabase phone check error:", checkError);
    throw new Error(checkError.message || "Failed to check learner existence");
  }

  if (existingLearner) {
    throw new Error("Learner already registered");
  }

  // Create learner entry (license flags come from the admin form)
  const { data: learners, error: learnerError } = await supabase
    .from("Learner")
    .insert([
      {
        name,
        email,
        phone,
        has_a_DL: has_a_DL ?? false,
        has_two_wheeler_license: has_two_wheeler_license ?? false,
        address_change_required: address_change_required ?? false,
        LL_received: LL_received ?? false,
      },
    ])
    .select()
    .maybeSingle();

  if (learnerError || !learners) {
    console.error("Supabase learner insert error:", learnerError);
    throw new Error(learnerError?.message || "Failed to create learner");
  }

  // Build progress based on course type
  const progress =
    caseType === "rto_only"
      ? {}
      : courseTypeSelection === "demo"
        ? { type: "demo", total_hours: 1 }
        : courseTypeSelection === "custom"
          ? {
              type: "custom",
              total_hours: totalLessons || 0,
              // Persist the picked skill modules so the learner's payment link can
              // show the actual course name the admin sold them.
              selected_modules: selectedModules || [],
              // Per-module (possibly discounted) prices set by the admin, so the
              // payment page shows the real itemised breakdown.
              module_prices: modulePrices || {},
            }
          : { type: "course", total_hours: totalLessons || 0 };

  // Create enrollment entry (course_id is NULL for demo/custom courses).
  // payment_status is set to "pending" (not left NULL) so the reuse lookups in
  // process-payment / create-razorpay-order — which filter on
  // `payment_status != 'full_paid'` — actually match this row and update it in
  // place instead of inserting a duplicate. (In SQL, NULL <> 'full_paid' is
  // NULL, so a NULL row would be silently excluded.)
  const { data: enrollments, error: enrollmentError } = await supabase
    .from("enrollment")
    .insert([
      {
        learner_id: learners.id,
        course_id: courseId || null,
        amount,
        payment_status: "pending",
        installment_mode: installmentType,
        installment1_amount: installment1Amount,
        installment2_amount: installment2Amount,
        unlocked_lessons: unlockedLessons,
        progress,
        case_type: caseType,
        two_wheeler_requirement: twoWheelerRequirement,
        four_wheeler_requirement: fourWheelerRequirement,
        rto_fee: rtoFee,
        rto_address_change_required: rtoAddressChangeRequired,
      },
    ])
    .select()
    .maybeSingle();

  if (enrollmentError || !enrollments)
    throw new Error(enrollmentError?.message || "Failed to create enrollment");

  return { learner: learners, enrollment: enrollments };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let body;
  try {
    body = await req.json();
  } catch (error) {
    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const result = await createLearnerAndEnrollment(body);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error creating learner and enrollment:", error);
    const errorMessage =
      error instanceof Error ? error.message : "An error occurred";

    // Invalid requests and duplicate learners are client errors. Database and
    // infrastructure failures remain server errors.
    const statusCode =
      error instanceof ValidationError ||
      errorMessage === "Learner already registered"
        ? 400
        : 500;

    return new Response(JSON.stringify({ error: errorMessage }), {
      status: statusCode,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
