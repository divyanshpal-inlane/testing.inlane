import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEMO_COURSE, SKILL_MODULES } from "@/constants/courses";
import { supabase } from "@/lib/supabaseClient";
import { usePaymentGatewayMode } from "@/queries/appSettings";
import { useCourses } from "@/queries/payment";

import {
  GatewaySelectionDialog,
  PaymentGateway,
} from "./GatewaySelectionDialog";
import { RazorpayCheckout } from "./RazorpayCheckout";

type CourseSelectionType = "predefined" | "custom" | "demo" | "test" | "topup";

interface PaymentDetails {
  amount: number;
  email: string;
  phone: string;
  paymentType: "course" | "reschedule" | "demo" | "custom" | "topup";
  courseId?: string;
  requestId?: string;
  name: string;
  learnerId?: string;
  installmentType?: "full" | "first_half" | "second_half";
  totalAmount?: number;
  parentPaymentId?: string;
  enrollmentId?: string;
  installment1Amount?: number;
  installment2Amount?: number;
  selectedModules?: string[];
  totalHours?: number;
  isDemoUpgrade?: boolean;
  demoPaymentId?: string;
}

function PaymentPage() {
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPrefilled, setIsPrefilled] = useState(false);
  const { data: courses, isLoading: coursesLoading } = useCourses();
  const { data: gatewayMode, isLoading: gatewayModeLoading } =
    usePaymentGatewayMode();
  const [paymentOption, setPaymentOption] = useState<"full" | "installment">(
    "full",
  );

  // New state for course type selection
  const [courseSelectionType, setCourseSelectionType] =
    useState<CourseSelectionType>("predefined");
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  // Admin-set per-module prices for a prefilled custom course (module id -> ₹).
  const [modulePriceMap, setModulePriceMap] = useState<Record<string, number>>(
    {},
  );
  const [hasCompletedDemo, setHasCompletedDemo] = useState(false);
  const [completedDemoCount, setCompletedDemoCount] = useState(0);
  const [demoPaymentId, setDemoPaymentId] = useState<string | null>(null);
  // Actual amount paid across completed demos — credited toward an upgrade.
  // Demo price is variable (₹1/₹200/₹300/…), so use the real paid total, not
  // count × the current DEMO_COURSE.price.
  const [demoCreditTotal, setDemoCreditTotal] = useState(0);

  // Gateway selection state
  const [showGatewayDialog, setShowGatewayDialog] = useState(false);
  const [selectedGateway, setSelectedGateway] = useState<PaymentGateway | null>(
    null,
  );
  const [showRazorpayCheckout, setShowRazorpayCheckout] = useState(false);

  const [paymentDetails, setPaymentDetails] = useState<PaymentDetails>({
    amount: 0,
    email: "",
    phone: "",
    paymentType: "course",
    courseId: "",
    requestId: "",
    name: "",
    learnerId: "",
    installmentType: "full",
    totalAmount: 0,
    selectedModules: [],
    totalHours: 0,
  });

  // Helper function to round prices to nearest integer
  const roundPrice = (price: number): number => {
    return Math.round(price);
  };

  useEffect(() => {
    const fetchLearnerDetails = async () => {
      const phone = searchParams.get("phone");
      const urlType = searchParams.get("type");
      if (phone && phone !== "undefined" && phone !== "null") {
        try {
          const { data: learner, error } = await supabase
            .from("Learner")
            .select("email, phone, name, id")
            .eq("phone", phone)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (error || !learner)
            throw new Error("Failed to fetch learner details");

          // Fetch the learner's latest enrollment up front so the demo / topup /
          // course prefills can all read its admin-set amount.
          const { data: enrollments, error: enrollmentError } = await supabase
            .from("enrollment")
            .select(
              "id, course_id, amount, payment_status, status, unlocked_lessons, installment_mode, installment1_amount, installment2_amount, progress",
            )
            .eq("learner_id", learner.id)
            .order("created_at", { ascending: false })
            .limit(1);

          if (enrollmentError)
            throw new Error("Failed to fetch enrollment details");

          const enrollment =
            enrollments && enrollments.length > 0 ? enrollments[0] : null;
          const courseId = enrollment?.course_id || "";
          const enrollmentId = enrollment?.id || "";
          const installmentMode = enrollment?.installment_mode || "full";

          // If URL has type=demo, prefill the demo lesson. The amount comes from
          // the enrollment (admin can set any demo price), falling back to the
          // default demo price for links without a saved enrollment.
          if (urlType === "demo") {
            const demoAmount = enrollment?.amount || DEMO_COURSE.price;
            setPaymentDetails((prev) => ({
              ...prev,
              email: learner.email || "",
              phone: learner.phone || "",
              name: learner.name || "",
              learnerId: learner.id,
              enrollmentId,
              paymentType: "demo",
              courseId: "",
              amount: demoAmount,
              totalAmount: demoAmount,
              totalHours: DEMO_COURSE.hours,
              selectedModules: [],
            }));
            setCourseSelectionType("demo");
            setIsPrefilled(true);
            return;
          }

          // If URL has type=topup, prefill topup with either explicit amount
          // (admin-set) or N hours × DEMO_COURSE.price (fallback)
          if (urlType === "topup") {
            const rawHours = parseInt(searchParams.get("hours") || "1", 10);
            const topupHours =
              Number.isFinite(rawHours) && rawHours > 0 ? rawHours : 1;
            // Use explicit amount from URL if provided (admin-set per-lesson cost),
            // otherwise fall back to hours × default price
            const rawAmount = parseInt(searchParams.get("amount") || "0", 10);
            const topupAmount =
              Number.isFinite(rawAmount) && rawAmount > 0
                ? rawAmount
                : topupHours * DEMO_COURSE.price;
            setPaymentDetails((prev) => ({
              ...prev,
              email: learner.email || "",
              phone: learner.phone || "",
              name: learner.name || "",
              learnerId: learner.id,
              paymentType: "topup",
              courseId: "",
              amount: topupAmount,
              totalAmount: topupAmount,
              totalHours: topupHours,
              selectedModules: [],
            }));
            setCourseSelectionType("topup");
            setIsPrefilled(true);
            return;
          }

          // Auto-detect demo/topup from the latest enrollment when the URL
          // didn't specify a type. This makes the bare /payment?phone=... link
          // work without requiring the caller to know about &type=demo.
          const enrollmentType = enrollment?.progress?.type;
          // Custom bundles (built by admin) have no course_id — identify them by
          // progress.type. An existing custom enrollment is FINAL: prefill & lock
          // it like a predefined course so the learner just pays the admin's
          // amount instead of being shown the module picker again.
          const isCustom = !courseId && enrollmentType === "custom";
          const customProgress = enrollment?.progress as {
            total_hours?: number;
            selected_modules?: string[];
            module_prices?: Record<string, number>;
          } | null;
          const customHours = customProgress?.total_hours;
          // The skill modules the admin picked, persisted on the enrollment, so
          // the learner sees the actual course they were sold (not just "Custom").
          const customModules = customProgress?.selected_modules ?? [];
          // Admin-set (possibly discounted) per-module prices, for the itemised
          // breakdown; falls back to the module's list price when absent.
          const customModulePrices = customProgress?.module_prices ?? {};
          if (
            !enrollment?.payment_status?.includes("paid") &&
            enrollmentType === "demo"
          ) {
            const demoAmount = enrollment?.amount || DEMO_COURSE.price;
            setPaymentDetails((prev) => ({
              ...prev,
              email: learner.email || "",
              phone: learner.phone || "",
              name: learner.name || "",
              learnerId: learner.id,
              enrollmentId,
              paymentType: "demo",
              courseId: "",
              amount: demoAmount,
              totalAmount: demoAmount,
              totalHours: DEMO_COURSE.hours,
              selectedModules: [],
            }));
            setCourseSelectionType("demo");
            setIsPrefilled(true);
            return;
          }
          if (
            !enrollment?.payment_status?.includes("paid") &&
            enrollmentType === "topup"
          ) {
            const topupHours = Math.max(
              1,
              enrollment?.progress?.total_hours || 1,
            );
            // Use enrollment amount if set (admin-configured), otherwise fall back to hours × default price
            const topupAmount =
              enrollment?.amount && enrollment.amount > 0
                ? enrollment.amount
                : topupHours * DEMO_COURSE.price;
            setPaymentDetails((prev) => ({
              ...prev,
              email: learner.email || "",
              phone: learner.phone || "",
              name: learner.name || "",
              learnerId: learner.id,
              paymentType: "topup",
              courseId: "",
              amount: topupAmount,
              totalAmount: topupAmount,
              totalHours: topupHours,
              selectedModules: [],
            }));
            setCourseSelectionType("topup");
            setIsPrefilled(true);
            return;
          }

          // Get course details (only if courseId exists)
          let course = null;
          if (courseId) {
            const { data: courseData, error: courseError } = await supabase
              .from("Courses")
              .select("price, id")
              .eq("id", courseId)
              .single();

            if (courseError) throw new Error("Failed to fetch course details");
            course = courseData;
          }

          // Check if this is a second installment payment by looking for a completed first installment payment
          let isSecondInstallment = false;
          let parentPaymentId = null;

          if (enrollment?.payment_status === "half_paid") {
            // Check if there's a completed first installment payment
            const { data: firstPayments, error: paymentsError } = await supabase
              .from("payment")
              .select("id, status")
              .eq("learner_id", learner.id)
              .eq("installment_type", "first_half")
              .eq("status", "completed")
              .order("created_at", { ascending: false })
              .limit(1);

            // console.log("First installment payments:", firstPayments, paymentsError);
            if (!paymentsError && firstPayments && firstPayments.length > 0) {
              // If there's a completed first installment payment, this is a second installment
              isSecondInstallment = true;
              parentPaymentId = firstPayments[0].id;
            }
          }

          // Get the installment amounts (either from enrollment or calculate)
          const coursePrice = roundPrice(course?.price || 0);
          const totalAmount = roundPrice(enrollment?.amount || coursePrice);

          // console.log("course price and totalAmount:", coursePrice, totalAmount);
          // Use custom installment amounts if available, otherwise calculate
          let installment1Amount = roundPrice(totalAmount / 2);
          let installment2Amount = totalAmount - installment1Amount;

          // Check if custom installment amounts are set in the enrollment
          if (
            enrollment?.installment1_amount &&
            enrollment?.installment1_amount > 0
          ) {
            installment1Amount = roundPrice(enrollment.installment1_amount);
          }

          if (
            enrollment?.installment2_amount &&
            enrollment?.installment2_amount > 0
          ) {
            installment2Amount = roundPrice(enrollment.installment2_amount);
          }

          // Set the correct amount based on installment type
          // console.log("isSecondInstallment and option:", isSecondInstallment, paymentOption, installment1Amount, installmentMode);
          const paymentAmount = isSecondInstallment
            ? installment2Amount
            : paymentOption === "full"
              ? totalAmount
              : installment1Amount;

          console.log("Installment amounts:", {
            installment1Amount,
            installment2Amount,
            totalAmount,
            paymentAmount,
            isSecondInstallment,
            paymentStatus: enrollment?.payment_status,
          });

          setPaymentDetails((prev) => ({
            ...prev,
            email: learner.email || "",
            phone: learner.phone || "",
            name: learner.name || "",
            learnerId: learner.id,
            // Set course/payment fields for a real enrollment — predefined
            // (course_id) or a custom bundle. This prevents overwriting amounts
            // set by demo/test selection.
            ...(courseId || isCustom
              ? {
                  courseId: courseId,
                  enrollmentId: enrollmentId,
                  paymentType: isCustom ? "custom" : "course",
                  amount: paymentAmount,
                  installmentType: isSecondInstallment
                    ? "second_half"
                    : paymentOption === "full"
                      ? "full"
                      : "first_half",
                  totalAmount: totalAmount,
                  totalHours: isCustom
                    ? (customHours ?? prev.totalHours)
                    : prev.totalHours,
                  parentPaymentId: parentPaymentId,
                  installment1Amount: installment1Amount,
                  installment2Amount: installment2Amount,
                }
              : {}),
          }));

          // If it's a second installment, force the payment option
          if (isSecondInstallment) {
            setPaymentOption("installment");
          } else if (
            // possible values "full" | "installment" | "second_half" | "first_half"
            installmentMode != "full"
          ) {
            // If enrollment was created with installment mode, default to that
            setPaymentOption("installment");
          }

          // Mark prefilled for a real enrollment — predefined (course_id) or a
          // custom bundle — so the course/module picker stays hidden and the
          // admin's selection is final. Custom shows the read-only summary below.
          if (isCustom) {
            setCourseSelectionType("custom");
            if (customModules.length > 0) setSelectedModules(customModules);
            setModulePriceMap(customModulePrices);
          }
          setIsPrefilled(!!courseId || isCustom);

          // Count completed demo payments for upgrade credit pricing.
          // "upgraded" counts too: the demo payment flips completed ->
          // upgraded the moment an upgrade order is created, BEFORE it is
          // paid. Counting only "completed" meant an abandoned upgrade lost
          // the credit on the next visit — and the scheduling side deducts
          // the demo hour off either status, so the learner would have paid
          // full price for one hour less.
          const { data: demoPayments, error: demoError } = await supabase
            .from("payment")
            .select("id, status, amount")
            .eq("learner_id", learner.id)
            .eq("payment_type", "demo")
            .in("status", ["completed", "upgraded"])
            .order("created_at", { ascending: false });

          if (!demoError && demoPayments && demoPayments.length > 0) {
            setHasCompletedDemo(true);
            setCompletedDemoCount(demoPayments.length);
            setDemoPaymentId(demoPayments[0].id);
            setDemoCreditTotal(
              demoPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
            );
          } else if (demoError) {
            console.log("Demo payment check skipped:", demoError.message);
          }
        } catch (err: unknown) {
          const errorMessage =
            err instanceof Error ? err.message : "An error occurred";
          setError(errorMessage);
        }
      }
    };

    fetchLearnerDetails();
  }, [searchParams, paymentOption]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPaymentDetails((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  // Update payment amount when payment option changes
  useEffect(() => {
    // Skip for demo, test, and topup - fixed price set by admin/URL
    if (
      courseSelectionType === "demo" ||
      courseSelectionType === "test" ||
      courseSelectionType === "topup"
    )
      return;

    // Use functional update to get the latest state values
    setPaymentDetails((prev) => {
      // Skip if second installment
      if (prev.installmentType === "second_half") return prev;

      const totalAmount = prev.totalAmount;
      if (!totalAmount || totalAmount <= 0) return prev;

      const installment1Amount =
        prev.installment1Amount || roundPrice(totalAmount / 2);

      const newAmount =
        paymentOption === "full" ? totalAmount : installment1Amount;

      // Only update if amount actually changed to prevent loops
      if (
        prev.amount === newAmount &&
        prev.installmentType ===
          (paymentOption === "full" ? "full" : "first_half")
      ) {
        return prev;
      }

      return {
        ...prev,
        amount: newAmount,
        installmentType: paymentOption === "full" ? "full" : "first_half",
      };
    });
  }, [paymentOption, courseSelectionType]);

  const handleCourseChange = (courseId: string) => {
    const selectedCourse = courses?.find((course) => course.id === courseId);
    const coursePrice = roundPrice(selectedCourse?.price || 0);

    // Apply demo discount: credit the actual amount paid across completed
    // demos (demo price is variable, so never assume a fixed per-demo value).
    const finalPrice = hasCompletedDemo
      ? Math.max(0, coursePrice - demoCreditTotal)
      : coursePrice;

    const installment1Amount = roundPrice(finalPrice / 2);
    const installment2Amount = finalPrice - installment1Amount;

    setPaymentDetails((prev) => ({
      ...prev,
      courseId,
      amount: paymentOption === "full" ? finalPrice : installment1Amount,
      totalAmount: finalPrice,
      installmentType: paymentOption === "full" ? "full" : "first_half",
      installment1Amount: installment1Amount,
      installment2Amount: installment2Amount,
      isDemoUpgrade: hasCompletedDemo,
      demoPaymentId: hasCompletedDemo ? demoPaymentId : undefined,
    }));
  };

  // Handle course type selection change
  const handleCourseTypeChange = (type: CourseSelectionType) => {
    setCourseSelectionType(type);
    setSelectedModules([]);

    if (type === "demo") {
      // Set demo pricing
      setPaymentDetails((prev) => ({
        ...prev,
        paymentType: "demo",
        courseId: "",
        amount: DEMO_COURSE.price,
        totalAmount: DEMO_COURSE.price,
        totalHours: DEMO_COURSE.hours,
        selectedModules: [],
      }));
    } else if (type === "test") {
      // Set test pricing (₹10 for testing)
      setPaymentDetails((prev) => ({
        ...prev,
        paymentType: "demo", // Use demo type for backend processing
        courseId: "",
        amount: 10,
        totalAmount: 10,
        totalHours: 1,
        selectedModules: [],
      }));
    } else if (type === "custom") {
      // Reset for custom selection
      setPaymentDetails((prev) => ({
        ...prev,
        paymentType: "custom",
        courseId: "",
        amount: 0,
        totalAmount: 0,
        totalHours: 0,
        selectedModules: [],
      }));
    } else {
      // Reset for predefined courses
      setPaymentDetails((prev) => ({
        ...prev,
        paymentType: "course",
        courseId: "",
        amount: 0,
        totalAmount: 0,
        selectedModules: [],
      }));
    }
  };

  // Handle module selection for custom courses
  const handleModuleToggle = (moduleId: string) => {
    const newSelectedModules = selectedModules.includes(moduleId)
      ? selectedModules.filter((m) => m !== moduleId)
      : [...selectedModules, moduleId];

    setSelectedModules(newSelectedModules);

    // Calculate total hours and price based on selected modules
    const totalHours = newSelectedModules.reduce((sum, modId) => {
      const module = SKILL_MODULES.find((m) => m.id === modId);
      return sum + (module?.hours || 0);
    }, 0);

    // Calculate price by summing up individual module course prices
    let totalPrice = 0;
    newSelectedModules.forEach((modId) => {
      const module = SKILL_MODULES.find((m) => m.id === modId);
      if (module && courses) {
        const moduleCourse = courses.find((c) => c.id === module.courseId);
        totalPrice += moduleCourse?.price || 0;
      }
    });

    // Apply demo discount: credit the actual amount paid across completed
    // demos (demo price is variable, so never assume a fixed per-demo value).
    const finalPrice = hasCompletedDemo
      ? Math.max(0, totalPrice - demoCreditTotal)
      : totalPrice;

    const installment1Amount = roundPrice(finalPrice / 2);
    const installment2Amount = finalPrice - installment1Amount;

    setPaymentDetails((prev) => ({
      ...prev,
      paymentType: "custom",
      amount: paymentOption === "full" ? finalPrice : installment1Amount,
      totalAmount: finalPrice,
      totalHours: totalHours,
      selectedModules: newSelectedModules,
      installment1Amount: installment1Amount,
      installment2Amount: installment2Amount,
      isDemoUpgrade: hasCompletedDemo,
      demoPaymentId: hasCompletedDemo ? demoPaymentId : undefined,
    }));
  };

  // Get prepared payment data for both gateways
  const getPreparedPaymentData = () => {
    const totalAmount = paymentDetails.totalAmount || paymentDetails.amount;
    const installment1Amount =
      paymentDetails.installment1Amount || roundPrice(totalAmount / 2);
    const installment2Amount =
      paymentDetails.installment2Amount || totalAmount - installment1Amount;

    let finalAmount = paymentDetails.amount;
    let finalInstallmentType = paymentDetails.installmentType;

    if (courseSelectionType === "demo") {
      // Admin can set any demo price; fall back to the default only when unset.
      finalAmount = paymentDetails.amount || DEMO_COURSE.price;
      finalInstallmentType = "full";
    } else if (courseSelectionType === "topup") {
      // Use the pre-set amount (from URL's admin-set per-lesson cost) if available,
      // otherwise fall back to hours × default price
      const topupHours = Math.max(1, paymentDetails.totalHours || 1);
      finalAmount =
        paymentDetails.amount && paymentDetails.amount > 0
          ? paymentDetails.amount
          : topupHours * DEMO_COURSE.price;
      finalInstallmentType = "full";
    } else if (courseSelectionType === "test") {
      finalAmount = 10;
      finalInstallmentType = "full";
    } else if (paymentDetails.installmentType !== "second_half") {
      finalAmount = paymentOption === "full" ? totalAmount : installment1Amount;
      finalInstallmentType = paymentOption === "full" ? "full" : "first_half";
    }

    return {
      ...paymentDetails,
      amount: finalAmount,
      installmentType: finalInstallmentType,
      ...(paymentDetails.enrollmentId
        ? { enrollmentId: paymentDetails.enrollmentId }
        : {}),
      installment1Amount: installment1Amount,
      installment2Amount: installment2Amount,
      selectedModules:
        courseSelectionType === "custom" ? selectedModules : undefined,
      totalHours:
        courseSelectionType === "custom" || courseSelectionType === "topup"
          ? paymentDetails.totalHours
          : undefined,
      isDemoUpgrade: hasCompletedDemo && courseSelectionType !== "demo",
      demoPaymentId:
        hasCompletedDemo && courseSelectionType !== "demo"
          ? demoPaymentId
          : undefined,
      courseSelectionType: courseSelectionType,
    };
  };

  // Handle form submission - check gateway mode and proceed accordingly
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Check gateway mode setting
    if (gatewayMode === "icici") {
      // ICICI only - go directly to ICICI
      await processICICIPayment();
    } else if (gatewayMode === "razorpay") {
      // Razorpay only - go directly to Razorpay
      setSelectedGateway("razorpay");
      setShowRazorpayCheckout(true);
    } else {
      // Both gateways - show selection dialog
      setShowGatewayDialog(true);
    }
  };

  // Handle gateway selection
  const handleGatewaySelect = async (gateway: PaymentGateway) => {
    setShowGatewayDialog(false);
    setSelectedGateway(gateway);

    if (gateway === "razorpay") {
      // Show Razorpay checkout component
      setShowRazorpayCheckout(true);
    } else {
      // Process ICICI payment (existing flow - unchanged)
      await processICICIPayment();
    }
  };

  // ICICI payment flow (existing code - unchanged)
  const processICICIPayment = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const paymentData = getPreparedPaymentData();

      console.log("Sending payment data to ICICI:", paymentData);

      const { data, error } = await supabase.functions.invoke(
        "process-payment",
        {
          body: paymentData,
        },
      );

      if (error) {
        console.error("Payment error:", error);

        if (error.message && error.message.includes("column")) {
          setError(
            `Database error: ${error.message}. Please run the SQL migration to add the required columns.`,
          );
        } else {
          setError(`Payment processing failed: ${error.message}`);
        }

        throw error;
      }

      // Orange PG returns a redirect URL directly
      if (data.redirectUrl) {
        console.log("Redirecting to Orange PG:", data.redirectUrl);
        window.location.href = data.redirectUrl;
        return;
      }

      // Fallback for legacy response format (form submission)
      if (data.gatewayURL && data.formData) {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = data.gatewayURL;

        console.log("Submitting to payment gateway:", {
          gatewayURL: data.gatewayURL,
          formData: data.formData,
        });

        Object.entries(data.formData).forEach(([key, value]) => {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = key;
          input.value = String(value);
          form.appendChild(input);
        });

        form.setAttribute("target", "_self");
        form.style.display = "none";
        document.body.appendChild(form);

        setTimeout(() => {
          form.submit();
          setTimeout(() => {
            if (document.body.contains(form)) {
              document.body.removeChild(form);
            }
          }, 2000);
        }, 100);
        return;
      }

      throw new Error("Invalid payment gateway response");
    } catch (err: unknown) {
      console.error("Payment initiation failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Payment initiation failed. Please try again.",
      );
      setIsLoading(false);
    }
  };

  // Handle Razorpay checkout cancel
  const handleRazorpayCancel = () => {
    setShowRazorpayCheckout(false);
    setSelectedGateway(null);
  };

  const type =
    searchParams.get("type") === "reschedule" ? "reschedule" : "course";

  const isSecondInstallment = paymentDetails.installmentType === "second_half";
  const displayAmount = paymentDetails.totalAmount || paymentDetails.amount;
  const firstInstallmentAmount =
    paymentDetails.installment1Amount || roundPrice(displayAmount / 2);
  const secondInstallmentAmount =
    paymentDetails.installment2Amount || displayAmount - firstInstallmentAmount;

  if (coursesLoading || gatewayModeLoading) {
    return (
      <div className="container mx-auto max-w-md py-8">
        <Card>
          <CardHeader>
            <CardTitle>Loading...</CardTitle>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-md py-8">
      <Card>
        <CardHeader>
          <CardTitle>Payment Details</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            {type === "course" && !isPrefilled && (
              <>
                {/* Course Type Selection */}
                <div className="space-y-3">
                  <label className="text-sm font-medium">
                    Choose Course Type
                  </label>
                  <div className="space-y-2">
                    <div
                      className={`flex cursor-pointer items-center space-x-3 rounded-lg border p-3 ${
                        courseSelectionType === "predefined"
                          ? "border-primary bg-primary/5"
                          : "border-gray-200"
                      }`}
                      onClick={() => handleCourseTypeChange("predefined")}
                    >
                      <input
                        type="radio"
                        name="courseType"
                        checked={courseSelectionType === "predefined"}
                        onChange={() => handleCourseTypeChange("predefined")}
                        className="h-4 w-4"
                      />
                      <div>
                        <p className="font-medium">Select a Course</p>
                        <p className="text-xs text-gray-500">
                          Choose from our predefined course packages
                        </p>
                      </div>
                    </div>

                    <div
                      className={`flex cursor-pointer items-center space-x-3 rounded-lg border p-3 ${
                        courseSelectionType === "custom"
                          ? "border-primary bg-primary/5"
                          : "border-gray-200"
                      }`}
                      onClick={() => handleCourseTypeChange("custom")}
                    >
                      <input
                        type="radio"
                        name="courseType"
                        checked={courseSelectionType === "custom"}
                        onChange={() => handleCourseTypeChange("custom")}
                        className="h-4 w-4"
                      />
                      <div>
                        <p className="font-medium">Build Your Own Course</p>
                        <p className="text-xs text-gray-500">
                          Select individual skill modules you want to learn
                        </p>
                      </div>
                    </div>

                    <div
                      className={`flex cursor-pointer items-center space-x-3 rounded-lg border p-3 ${
                        courseSelectionType === "demo"
                          ? "border-primary bg-primary/5"
                          : "border-gray-200"
                      }`}
                      onClick={() => handleCourseTypeChange("demo")}
                    >
                      <input
                        type="radio"
                        name="courseType"
                        checked={courseSelectionType === "demo"}
                        onChange={() => handleCourseTypeChange("demo")}
                        className="h-4 w-4"
                      />
                      <div>
                        <p className="font-medium">
                          Demo Lesson - ₹{DEMO_COURSE.price}
                        </p>
                        <p className="text-xs text-gray-500">
                          {DEMO_COURSE.description}
                        </p>
                      </div>
                    </div>

                    <div
                      className={`flex cursor-pointer items-center space-x-3 rounded-lg border p-3 ${
                        courseSelectionType === "test"
                          ? "border-primary bg-primary/5"
                          : "border-gray-200"
                      }`}
                      onClick={() => handleCourseTypeChange("test")}
                    >
                      <input
                        type="radio"
                        name="courseType"
                        checked={courseSelectionType === "test"}
                        onChange={() => handleCourseTypeChange("test")}
                        className="h-4 w-4"
                      />
                      <div>
                        <p className="font-medium">Test Payment - ₹10</p>
                        <p className="text-xs text-gray-500">
                          For testing purposes only
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Predefined Course Dropdown */}
                {courseSelectionType === "predefined" && (
                  <div>
                    <label
                      htmlFor="courseId"
                      className="mb-1 block text-sm font-medium"
                    >
                      Select Course
                    </label>
                    <Select
                      value={paymentDetails.courseId}
                      onValueChange={handleCourseChange}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a course" />
                      </SelectTrigger>
                      <SelectContent>
                        {courses?.map((course) => (
                          <SelectItem key={course.id} value={course.id}>
                            {course.name} - {course.total_lessons} Lessons
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {hasCompletedDemo && (
                      <p className="mt-1 text-xs text-green-600">
                        ₹{demoCreditTotal} credit from your {completedDemoCount}{" "}
                        demo
                        {completedDemoCount === 1 ? "" : "s"} will be deducted
                        from the course price
                      </p>
                    )}
                  </div>
                )}

                {/* Custom Course Module Selection */}
                {courseSelectionType === "custom" && (
                  <div className="space-y-3">
                    <label className="text-sm font-medium">
                      Select Skill Modules
                    </label>
                    <div className="space-y-2">
                      {SKILL_MODULES.map((module) => {
                        const moduleCourse = courses?.find(
                          (c) => c.id === module.courseId,
                        );
                        const modulePrice = moduleCourse?.price || 0;
                        const isSelected = selectedModules.includes(module.id);

                        return (
                          <div
                            key={module.id}
                            className={`flex cursor-pointer items-start space-x-3 rounded-lg border p-3 ${
                              isSelected
                                ? "border-primary bg-primary/5"
                                : "border-gray-200"
                            }`}
                            onClick={() => handleModuleToggle(module.id)}
                          >
                            <div
                              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${
                                isSelected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-gray-300"
                              }`}
                            >
                              {isSelected && (
                                <svg
                                  className="h-3 w-3"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={3}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M5 13l4 4L19 7"
                                  />
                                </svg>
                              )}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <span className="cursor-pointer font-medium">
                                  {module.label}
                                </span>
                                <span className="text-sm font-semibold">
                                  ₹{modulePrice}
                                </span>
                              </div>
                              <p className="text-xs text-gray-500">
                                {module.hours} hours - {module.description}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {selectedModules.length > 0 && (
                      <div className="rounded-lg bg-gray-50 p-3">
                        <div className="flex justify-between text-sm">
                          <span>Total Hours:</span>
                          <span className="font-medium">
                            {paymentDetails.totalHours} hours
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span>Price:</span>
                          <span className="font-medium">
                            ₹{paymentDetails.totalAmount}
                          </span>
                        </div>
                        {hasCompletedDemo && (
                          <p className="mt-1 text-xs text-green-600">
                            Demo discount of ₹{demoCreditTotal} applied (
                            {completedDemoCount} demo
                            {completedDemoCount === 1 ? "" : "s"})
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Demo Course Info */}
                {courseSelectionType === "demo" && (
                  <Alert className="border-blue-200 bg-blue-50">
                    <AlertDescription>
                      <strong>Demo Lesson</strong> - Try a {DEMO_COURSE.hours}
                      -hour introductory lesson for just ₹{DEMO_COURSE.price}.
                      If you decide to purchase a full course later, this amount
                      will be deducted from your course price!
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}

            {/* Show demo info when opened via topup payment link */}
            {isPrefilled && courseSelectionType === "demo" && (
              <Alert>
                <AlertDescription>
                  <strong>Demo Lesson</strong> - {DEMO_COURSE.hours}-hour
                  introductory lesson for ₹{paymentDetails.amount}
                </AlertDescription>
              </Alert>
            )}

            {/* Topup summary — number of hours is set by admin / enrollment and is not editable here */}
            {isPrefilled && courseSelectionType === "topup" && (
              <div className="space-y-3">
                <Alert className="border-blue-200 bg-blue-50">
                  <AlertDescription>
                    <strong>Topup Class</strong> -{" "}
                    {paymentDetails.totalHours ?? 1} hour(s)
                  </AlertDescription>
                </Alert>
                <div>
                  <label
                    htmlFor="topupHours"
                    className="mb-1 block text-sm font-medium"
                  >
                    Number of hours
                  </label>
                  <div
                    id="topupHours"
                    aria-readonly="true"
                    className="rounded-md border bg-muted px-3 py-2 text-sm"
                  >
                    {paymentDetails.totalHours ?? 1}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Total: ₹
                    {paymentDetails.amount ?? paymentDetails.totalAmount}
                  </p>
                </div>
              </div>
            )}

            {/* Show custom course details when prefilled (read-only) */}
            {type === "course" &&
              isPrefilled &&
              courseSelectionType === "custom" && (
                <div className="space-y-3">
                  <div>
                    <label
                      htmlFor="courseName"
                      className="mb-1 block text-sm font-medium"
                    >
                      Course
                    </label>
                    <div
                      id="courseName"
                      className="rounded-md border bg-muted px-3 py-2 text-sm font-medium"
                    >
                      {selectedModules.length > 0
                        ? selectedModules
                            .map(
                              (id) =>
                                SKILL_MODULES.find((m) => m.id === id)?.label,
                            )
                            .filter(Boolean)
                            .join(" + ")
                        : "Custom Course"}
                    </div>
                  </div>

                  {selectedModules.length > 0 && (
                    <div>
                      <label className="mb-2 block text-sm font-medium">
                        Selected Modules
                      </label>
                      <div className="space-y-2">
                        {selectedModules.map((moduleId) => {
                          const module = SKILL_MODULES.find(
                            (m) => m.id === moduleId,
                          );
                          const moduleCourse = courses?.find(
                            (c) => c.id === module?.courseId,
                          );
                          // Prefer the admin-set (discounted) price; fall back to
                          // the module's list price for older enrollments.
                          const modulePrice =
                            modulePriceMap[moduleId] ??
                            moduleCourse?.price ??
                            0;

                          return (
                            <div
                              key={moduleId}
                              className="flex items-start space-x-3 rounded-lg border border-gray-200 bg-gray-50 p-3"
                            >
                              <div className="flex-1">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">
                                    {module?.label}
                                  </span>
                                  <span className="text-sm font-semibold">
                                    ₹{modulePrice}
                                  </span>
                                </div>
                                <p className="text-xs text-gray-600">
                                  {module?.hours} hours - {module?.description}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-3 rounded-lg bg-blue-50 p-3">
                        <div className="flex justify-between text-sm">
                          <span>Total Hours:</span>
                          <span className="font-medium">
                            {paymentDetails.totalHours} hours
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

            {/* Show selected course details when prefilled (read-only) */}
            {type === "course" &&
              isPrefilled &&
              courseSelectionType !== "demo" &&
              courseSelectionType !== "custom" && (
                <div>
                  <label
                    htmlFor="courseId"
                    className="mb-1 block text-sm font-medium"
                  >
                    Selected Course
                  </label>
                  <Select
                    value={paymentDetails.courseId}
                    onValueChange={handleCourseChange}
                    disabled={isPrefilled}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a course" />
                    </SelectTrigger>
                    <SelectContent>
                      {courses?.map((course) => (
                        <SelectItem key={course.id} value={course.id}>
                          {course.name} - {course.total_lessons} Lessons
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            <div>
              <label
                htmlFor="amount"
                className="mb-1 block text-sm font-medium"
              >
                Amount
              </label>
              <Input
                id="amount"
                name="amount"
                type="number"
                value={paymentDetails.amount}
                onChange={handleInputChange}
                disabled
                className="w-full"
              />
            </div>
            {type === "course" && (
              <>
                <div>
                  <label
                    htmlFor="name"
                    className="mb-1 block text-sm font-medium"
                  >
                    Name
                  </label>
                  <Input
                    id="name"
                    name="name"
                    type="text"
                    value={paymentDetails.name}
                    onChange={handleInputChange}
                    required
                    className="w-full"
                    disabled={isPrefilled}
                  />
                </div>
                <div>
                  <label
                    htmlFor="email"
                    className="mb-1 block text-sm font-medium"
                  >
                    Email
                  </label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    value={paymentDetails.email}
                    onChange={handleInputChange}
                    required
                    className="w-full"
                    disabled={isPrefilled}
                  />
                </div>
                <div>
                  <label
                    htmlFor="phone"
                    className="mb-1 block text-sm font-medium"
                  >
                    Phone Number
                  </label>
                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    value={paymentDetails.phone}
                    onChange={handleInputChange}
                    required
                    className="w-full"
                    pattern="[0-9]{10}"
                    title="Please enter a valid 10-digit phone number"
                    disabled={isPrefilled}
                  />
                </div>
              </>
            )}
            {!isSecondInstallment &&
              displayAmount > 0 &&
              courseSelectionType !== "demo" &&
              courseSelectionType !== "test" && (
                <div className="space-y-2">
                  <label
                    htmlFor="paymentOption"
                    className="text-sm font-medium"
                  >
                    Payment Option
                  </label>
                  <Select
                    value={paymentOption}
                    defaultValue={
                      paymentDetails.installmentType === "full"
                        ? "full"
                        : "installment"
                    }
                    onValueChange={(value: "full" | "installment") =>
                      setPaymentOption(value)
                    }
                    disabled={isPrefilled || isSecondInstallment}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select payment option" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full">
                        Pay full amount (₹{displayAmount})
                      </SelectItem>
                      <SelectItem value="installment">
                        Pay in installments (₹{firstInstallmentAmount} now + ₹
                        {secondInstallmentAmount} later)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {paymentOption === "installment" && (
                    <p className="text-xs text-gray-500">
                      Note: Only 1 lesson will be unlocked. You&apos;ll need to
                      pay the remaining amount to unlock all lessons.
                    </p>
                  )}
                </div>
              )}
            {isSecondInstallment && (
              <Alert className="border-blue-200 bg-blue-50">
                <AlertDescription>
                  This is your second installment payment of ₹
                  {secondInstallmentAmount}. Completing this payment will unlock
                  all remaining lessons.
                </AlertDescription>
              </Alert>
            )}
            <div className="sticky bottom-0 z-10 -mx-6 border-t bg-white px-6 py-4">
              <Button
                type="submit"
                className="w-full"
                disabled={
                  isLoading ||
                  // A prefilled course is locked by the admin — its course /
                  // modules / amount are already set, so never gate the button
                  // on picking them (the picker isn't even shown).
                  (type === "course" &&
                    !isPrefilled &&
                    courseSelectionType === "predefined" &&
                    !paymentDetails.courseId) ||
                  (type === "course" &&
                    !isPrefilled &&
                    courseSelectionType === "custom" &&
                    selectedModules.length === 0) ||
                  (!paymentDetails.requestId && type === "reschedule")
                }
              >
                {isLoading
                  ? "Processing..."
                  : type === "course" &&
                      !isPrefilled &&
                      courseSelectionType === "predefined" &&
                      !paymentDetails.courseId
                    ? "Select a Course to Continue"
                    : type === "course" &&
                        !isPrefilled &&
                        courseSelectionType === "custom" &&
                        selectedModules.length === 0
                      ? "Select Modules to Continue"
                      : `Pay ₹${paymentDetails.amount}`}
              </Button>
            </div>
          </form>
          <div className="mt-6 text-center text-sm">
            <span className="text-black">By continuing, you agree to our</span>
            <div className="mt-1 flex justify-center gap-3">
              <a
                href="https://inlane.in/terms-and-conditions"
                className="text-gray-500 hover:text-blue-500 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Terms of Service
              </a>
              <a
                href="https://inlane.in/privacy-policy"
                className="text-gray-500 hover:text-blue-500 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Privacy Policies
              </a>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Gateway Selection Dialog */}
      <GatewaySelectionDialog
        open={showGatewayDialog}
        onOpenChange={setShowGatewayDialog}
        onSelectGateway={handleGatewaySelect}
        amount={paymentDetails.amount}
      />

      {/* Razorpay Checkout */}
      {showRazorpayCheckout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Processing Payment</CardTitle>
            </CardHeader>
            <CardContent>
              <RazorpayCheckout
                paymentData={{
                  ...getPreparedPaymentData(),
                  paymentType:
                    courseSelectionType === "demo" ||
                    courseSelectionType === "test"
                      ? "demo"
                      : courseSelectionType === "custom"
                        ? "custom"
                        : courseSelectionType === "topup"
                          ? "topup"
                          : "course",
                }}
                onCancel={handleRazorpayCancel}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default PaymentPage;
