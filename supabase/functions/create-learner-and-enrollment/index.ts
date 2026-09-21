import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

export async function createLearnerAndEnrollment(data: {
  name: string;
  email: string;
  phone: string;
  courseId: string;
  amount: number;
  installmentType: string;
  installment1Amount: number;
  installment2Amount: number;
  unlockedLessons: number[];
  courseTypeSelection?: string;
  totalLessons?: number;
  selectedModules?: string[];
  modulePrices?: Record<string, number>;
  has_a_DL?: boolean;
  has_two_wheeler_license?: boolean;
  address_change_required?: boolean;
  LL_received?: boolean;
}) {
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
    courseTypeSelection === "demo"
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
    const errorMessage = error.message || "An error occurred";

    // Return 400 for "Learner already registered" error (validation error)
    // Return 500 for other errors (server errors)
    const statusCode =
      errorMessage === "Learner already registered" ? 400 : 500;

    return new Response(JSON.stringify({ error: errorMessage }), {
      status: statusCode,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
