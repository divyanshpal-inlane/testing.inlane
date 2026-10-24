import {
  BookOpenCheck,
  Bug,
  Calendar,
  CalendarOff,
  Car,
  Check,
  ClipboardList,
  CreditCard,
  Eye,
  EyeOff,
  Gauge,
  Handshake,
  LayoutGrid,
  LifeBuoy,
  ListChecks,
  Loader2,
  Lock,
  LogOut,
  Map,
  MessageSquare,
  PhoneCall,
  Radar,
  Search,
  Settings,
  ShieldCheck,
  Siren,
  Upload,
  UserPlus,
  Users,
  UserX,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/auth-context";
import {
  ADMIN_PERMISSIONS,
  PermissionKey,
  useCurrentAdmin,
} from "@/queries/adminPermissions";
import { useCurrentUser } from "@/queries/userManagement";

// Map permission keys to feature configs
const featureConfig: Record<
  PermissionKey,
  {
    title: string;
    description: string;
    icon: typeof UserPlus;
    link: string;
    color: string;
  }
> = {
  game_analytics: {
    title: "Game Analytics",
    description: "See which learners launch games and how often",
    icon: Gauge,
    link: "/admin/game-analytics",
    color: "text-violet-500",
  },
  learner_management: {
    title: "Learner Management",
    description: "Create and manage learner enrollments",
    icon: UserPlus,
    link: "/admin/learner-management",
    color: "text-teal-500",
  },
  customer_migration: {
    title: "Customer Migration",
    description: "Migrate existing customers from paper records",
    icon: Upload,
    link: "/admin/learner-migration",
    color: "text-purple-500",
  },
  schedule_management: {
    title: "Schedule Management",
    description: "Manage and organize training schedules for learners",
    icon: Calendar,
    link: "/admin/schedules",
    color: "text-blue-500",
  },
  ll_applications: {
    title: "LL Applications",
    description: "Process and update learner's license applications",
    icon: ClipboardList,
    link: "/admin/learner-ll-details",
    color: "text-green-500",
  },
  ll_pipeline: {
    title: "LL → DL Pipeline",
    description:
      "Track every RTO application end-to-end: docs, call, scrutiny, tests, delivery",
    icon: ClipboardList,
    link: "/admin/ll-pipeline",
    color: "text-cyan-600",
  },
  post_ll_applications: {
    title: "Post-LL Applications",
    description: "Process and update driver's license applications",
    icon: ClipboardList,
    link: "/admin/learner-details",
    color: "text-green-500",
  },
  instructor_management: {
    title: "Instructor Management",
    description: "Add, edit, and manage driving instructors",
    icon: Users,
    link: "/admin/instructors",
    color: "text-orange-500",
  },
  instructor_matrix: {
    title: "Instructor Availability Matrix",
    description: "Color-coded weekly view of instructor capacity and bookings",
    icon: LayoutGrid,
    link: "/admin/instructor-matrix",
    color: "text-emerald-500",
  },
  kam_management: {
    title: "KAM Management",
    description: "Create KAMs and assign instructors to them",
    icon: Handshake,
    link: "/admin/kam-management",
    color: "text-amber-500",
  },
  instructor_earnings: {
    title: "Instructor Earnings",
    description: "Rates, targets, payouts, adjustments, and earning programs",
    icon: Wallet,
    link: "/admin/instructor-earnings",
    color: "text-green-600",
  },
  lessons_dashboard: {
    title: "Lessons Dashboard",
    description: "Consolidated view of all scheduled lessons with filters",
    icon: ListChecks,
    link: "/admin/lessons-dashboard",
    color: "text-sky-500",
  },
  notification_management: {
    title: "Daily Notification Management",
    description: "Set reminders and send daily notifications to learners",
    icon: PhoneCall,
    link: "/admin/notification-management",
    color: "text-teal-500",
  },
  tentative_schedules: {
    title: "Tentative Schedules Info",
    description: "Search tentative schedules",
    icon: Calendar,
    link: "/admin/tentative-schedules-info",
    color: "text-orange-500",
  },
  learner_issue_fixer: {
    title: "Learner Issue Fixer",
    description: "Diagnose and fix learner app, payment, and scheduling issues",
    icon: Wrench,
    link: "/admin/learner-issue-fixer",
    color: "text-red-500",
  },
  settings: {
    title: "Settings",
    description: "Configure payment gateways and app settings",
    icon: Settings,
    link: "/admin/settings",
    color: "text-gray-600",
  },
  team_feedback: {
    title: "Team Feedback",
    description: "View bugs, feature requests, and suggestions from team",
    icon: Bug,
    link: "/admin/bug-reports",
    color: "text-indigo-500",
  },
  instructor_lesson_log: {
    title: "Instructor Lesson Log",
    description: "View lesson completions with OTP and timing details",
    icon: BookOpenCheck,
    link: "/admin/instructor-lesson-log",
    color: "text-emerald-500",
  },
  payment_tracker: {
    title: "Payment Tracker",
    description: "Track payments, lesson progress, and follow-up urgency",
    icon: CreditCard,
    link: "/admin/payment-tracker",
    color: "text-blue-500",
  },
  course_feedback: {
    title: "Course Feedback",
    description: "Learner feedback at midway and course completion",
    icon: MessageSquare,
    link: "/admin/feedback",
    color: "text-pink-500",
  },
  view_unmasked_phone_numbers: {
    title: "View Unmasked Phone Numbers",
    description:
      "View and edit unmasked phone numbers for instructors and learners",
    icon: Users,
    link: "",
    color: "text-gray-500",
  },
  view_unmasked_customer_phone_numbers: {
    title: "View Unmasked Customer Phone Numbers",
    description:
      "View unmasked customer / lead phone numbers in Learner Management, Instructor Management (tentative bookings) and the Sales Dashboard",
    icon: Users,
    link: "",
    color: "text-gray-500",
  },
  view_unmasked_car_numbers: {
    title: "View Unmasked Car Numbers",
    description: "View unmasked vehicle registration numbers for instructors",
    icon: Car,
    link: "",
    color: "text-gray-500",
  },
  admin_management: {
    title: "User Management",
    description: "Create and manage admin team members and their permissions",
    icon: Users,
    link: "/admin/user-management",
    color: "text-indigo-500",
  },
  leave_management: {
    title: "Leave Management",
    description: "Approve instructor leave and arrange replacement instructors",
    icon: CalendarOff,
    link: "/admin/leave-management",
    color: "text-rose-500",
  },
  no_show_management: {
    title: "No-show Management",
    description: "Manage learner and instructor no-show cases",
    icon: UserX,
    link: "/admin/no-shows",
    color: "text-orange-500",
  },
  support_tickets: {
    title: "Support Tickets",
    description: "View and resolve instructor support requests",
    icon: LifeBuoy,
    link: "/admin/support-tickets",
    color: "text-sky-500",
  },
  car_commerce_leads: {
    title: "Car Commerce Leads",
    description: "Learners who want to buy a car — with CSV export",
    icon: Car,
    link: "/admin/car-commerce-leads",
    color: "text-rose-500",
  },
  ll_customer_migration: {
    title: "LL Customer Migration",
    description: "Bulk-import existing Learner's License customers from CSV",
    icon: Upload,
    link: "/admin/ll-customer-migration",
    color: "text-violet-500",
  },
  safety_monitoring: {
    title: "Safety Monitoring",
    description: "Accidents, breakdowns, misconduct reports and SOS alerts",
    icon: Siren,
    link: "/admin/safety-monitoring",
    color: "text-red-500",
  },
  instructor_performance: {
    title: "Instructor Performance",
    description:
      "Attendance, punctuality, ratings, complaints and completion rates",
    icon: Gauge,
    link: "/admin/instructor-performance",
    color: "text-emerald-600",
  },
  ops_control_tower: {
    title: "Operations Control Tower",
    description:
      "Live KPIs, today's operations and exception dashboard in one place",
    icon: Radar,
    link: "/admin/control-tower",
    color: "text-blue-600",
  },
  compliance_forms: {
    title: "Compliance Forms",
    description: "Generate RTO Form 14, Form 15 & Certificate for any customer",
    icon: ClipboardList,
    link: "/admin/compliance-forms",
    color: "text-indigo-500",
  },
  sales_dashboard: {
    title: "Sales Availability Dashboard",
    description:
      "Search instructors by name or location and see live 30-min free-slot availability",
    icon: Search,
    link: "/admin/sales-dashboard",
    color: "text-cyan-500",
  },
  instructor_zone_map: {
    title: "Instructor Zone Map",
    description: "View and edit instructor service-area polygons on a map",
    icon: Map,
    link: "/admin/instructor-zone-map",
    color: "text-indigo-500",
  },
  sales_issue_tickets: {
    title: "Escalate Issue Tracker",
    description:
      "View, search and update escalated issue tickets, with analytics",
    icon: LifeBuoy,
    link: "/admin/sales-issue-tickets",
    color: "text-amber-500",
  },
} as const;

// Note: view_unmasked_phone_numbers controls visibility of sensitive data but doesn't have a dashboard feature card
// Note: admin_management is only assignable to super admins, not available in regular admin permission selection

export default function AdminHome() {
  const { data: currentAdmin, isLoading: adminLoading } = useCurrentAdmin();
  const { data: currentUser, isLoading: userLoading } = useCurrentUser();
  const { logout, user, changePassword } = useAuth();
  const navigate = useNavigate();
  const [openPasswordDialog, setOpenPasswordDialog] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [moduleQuery, setModuleQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Ctrl/Cmd+K jumps to the module search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsChangingPassword(true);

    try {
      await changePassword(
        passwordForm.oldPassword,
        passwordForm.newPassword,
        passwordForm.confirmPassword,
      );

      setSuccessMessage("Password changed successfully!");
      setPasswordForm({
        oldPassword: "",
        newPassword: "",
        confirmPassword: "",
      });

      setTimeout(() => {
        setSuccessMessage(null);
        setOpenPasswordDialog(false);
      }, 2000);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to change password. Please try again.",
      );
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate("/admin-byser-secu7");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const isLoading = adminLoading || userLoading;

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Determine if user is admin or team member
  // Priority: Check if user exists in User table (team member) > Check if user is admin
  const userRole = user?.user_metadata?.user_role;
  const isTeamMember = !!currentUser; // User table exists = team member (created by admin)
  const isAdmin =
    !isTeamMember &&
    currentAdmin &&
    (currentAdmin.is_admin || currentAdmin.is_super_admin);

  console.log("[AdminHome] User type determination:", {
    userRole: userRole,
    currentUserExists: !!currentUser,
    currentUser: currentUser,
    currentAdminExists: !!currentAdmin,
    currentAdmin: currentAdmin,
    adminIsAdmin: currentAdmin?.is_admin,
    adminIsSuperAdmin: currentAdmin?.is_super_admin,
    resolvedIsTeamMember: isTeamMember,
    resolvedIsAdmin: isAdmin,
    userPhone: user?.phone,
    currentUserPhone: currentUser?.phone,
  });

  // Debug logging
  console.log("[AdminHome] Debug Info:", {
    userRole,
    currentAdminExists: !!currentAdmin,
    currentUserExists: !!currentUser,
    isAdmin,
    isTeamMember,
    currentAdminPermissions: currentAdmin?.permissions,
    currentUserPermissions: currentUser?.permissions,
  });

  // Get permissions based on user type
  let userPermissions: PermissionKey[] = [];
  let isUserSuperAdmin = false;
  let isUserAdmin = false;
  let displayName = "";

  if (isTeamMember) {
    // Team member takes precedence - use their specific permissions
    userPermissions = (currentUser?.permissions || []).filter((perm) => {
      // Validate that permission exists in featureConfig
      const isValid = !!featureConfig[perm];
      if (!isValid) {
        console.warn(`[AdminHome] Invalid permission ignored: "${perm}"`);
      }
      return isValid;
    });
    displayName = currentUser?.name || "Team Member";
    console.log(
      "[AdminHome] Using Team Member permissions (filtered):",
      userPermissions,
    );
    console.log(
      "[AdminHome] Raw permissions from DB:",
      currentUser?.permissions,
    );
  } else if (isAdmin) {
    userPermissions = currentAdmin?.permissions || [];
    isUserSuperAdmin = currentAdmin?.is_super_admin || false;
    isUserAdmin = currentAdmin?.is_admin || false;
    displayName = currentAdmin?.name || "Admin";
    console.log("[AdminHome] Using Admin permissions:", userPermissions);
  }

  // Filter features based on user's permissions
  console.log(
    "[AdminHome] All featureConfig keys:",
    Object.keys(featureConfig),
  );
  console.log("[AdminHome] User permissions to check:", userPermissions);

  const allowedFeatures = userPermissions
    .filter(
      (perm) =>
        perm !== "admin_management" &&
        perm !== "view_unmasked_phone_numbers" &&
        perm !== "view_unmasked_customer_phone_numbers" &&
        perm !== "view_unmasked_car_numbers",
    ) // Filter out admin_management, view_unmasked_phone_numbers and view_unmasked_car_numbers
    .map((perm) => {
      const feature = featureConfig[perm];
      console.log(
        `[AdminHome] Permission "${perm}": feature found=${!!feature}`,
      );
      return feature;
    })
    .filter((feature) => feature !== undefined);

  // Module search: matches title or description, case-insensitive.
  const normalizedQuery = moduleQuery.trim().toLowerCase();
  const matchesQuery = (...texts: string[]) =>
    !normalizedQuery ||
    texts.some((t) => t.toLowerCase().includes(normalizedQuery));
  const visibleFeatures = allowedFeatures.filter((f) =>
    matchesQuery(f.title, f.description),
  );
  const showAdminMgmt = matchesQuery(
    "Admin Management",
    "Create and manage admin accounts and permissions",
  );
  const showUserMgmt = matchesQuery(
    "User Management",
    "Create and manage users with specific permissions",
  );
  // "Escalate an Issue" is for every logged-in user, no permission needed.
  const showReportIssue = matchesQuery(
    "Escalate an Issue",
    "Raise an issue ticket for the Support team",
  );
  const showChangePassword = matchesQuery(
    "Change Password",
    "Update your account password for enhanced security",
  );
  const noModuleMatches =
    !!normalizedQuery &&
    visibleFeatures.length === 0 &&
    !(currentAdmin?.is_super_admin && showAdminMgmt) &&
    !(currentAdmin?.is_admin && showUserMgmt) &&
    !showReportIssue &&
    !showChangePassword;

  console.log(
    "[AdminHome] Final allowedFeatures count:",
    allowedFeatures.length,
  );
  console.log(
    "[AdminHome] Final allowedFeatures:",
    allowedFeatures.map((f) => f?.title || "unknown"),
  );

  return (
    <div
      className="min-h-screen bg-white p-8"
      style={{
        backgroundImage: 'url("/assets/bg_pattern.svg")',
        backgroundRepeat: "repeat",
        backgroundSize: "cover",
      }}
    >
      <div className="mx-auto max-w-3xl">
        {/* Header with Logout Button */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">
              {isTeamMember ? "User Dashboard" : "Admin Dashboard"}
            </h1>
            <p className="mt-2 text-lg text-muted-foreground">
              Manage schedules and learner licenses
            </p>
            {currentAdmin?.is_super_admin && (
              <p className="mt-1 text-sm text-purple-600">
                Logged in as Super Admin
              </p>
            )}
            {isTeamMember && (
              <p className="mt-1 text-sm text-blue-600">
                Logged in as {displayName}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            className="flex items-center gap-2"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>

        {/* Module search */}
        <form
          role="search"
          className="relative mb-6"
          onSubmit={(e) => {
            e.preventDefault();
            // Enter opens the first matching module.
            if (normalizedQuery && visibleFeatures[0]) {
              navigate(visibleFeatures[0].link);
            }
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            type="search"
            value={moduleQuery}
            onChange={(e) => setModuleQuery(e.target.value)}
            placeholder="Search modules…  (Ctrl+K)"
            aria-label="Search modules"
            className="bg-white pl-9 pr-20"
          />
          {moduleQuery && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setModuleQuery("");
                searchRef.current?.focus();
              }}
              className="absolute right-12 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            aria-label="Search"
            className="absolute right-1 top-1/2 h-7 -translate-y-1/2 px-2"
          >
            <Search className="h-4 w-4" />
          </Button>
        </form>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
          {noModuleMatches && (
            <Card className="col-span-2">
              <CardHeader>
                <CardTitle>No modules found</CardTitle>
                <CardDescription>
                  Nothing matches &ldquo;{moduleQuery.trim()}&rdquo;. Try a
                  different word.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
          {/* Super Admin Management - only for super admins */}
          {currentAdmin?.is_super_admin && showAdminMgmt && (
            <Card className="border-purple-200 transition-all hover:shadow-lg">
              <Link to="/admin/admin-management">
                <CardHeader>
                  <div className="flex items-center gap-4">
                    <div className="rounded-lg bg-purple-100 p-2 text-purple-600">
                      <ShieldCheck size={24} />
                    </div>
                    <div>
                      <CardTitle className="text-xl">
                        Admin Management
                      </CardTitle>
                      <CardDescription className="mt-1">
                        Create and manage admin accounts and permissions
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button className="w-full" variant="ghost">
                    Access Admin Management
                  </Button>
                </CardContent>
              </Link>
            </Card>
          )}

          {/* User Management - for admins and super admins */}
          {currentAdmin?.is_admin && showUserMgmt && (
            <Card className="border-blue-200 transition-all hover:shadow-lg">
              <Link to="/admin/user-management">
                <CardHeader>
                  <div className="flex items-center gap-4">
                    <div className="rounded-lg bg-blue-100 p-2 text-blue-600">
                      <Users size={24} />
                    </div>
                    <div>
                      <CardTitle className="text-xl">User Management</CardTitle>
                      <CardDescription className="mt-1">
                        Create and manage users with specific permissions
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button className="w-full" variant="ghost">
                    Access User Management
                  </Button>
                </CardContent>
              </Link>
            </Card>
          )}

          {/* Feature cards based on permissions */}
          {visibleFeatures.map((feature) => (
            <Card
              key={feature.title}
              className="transition-all hover:shadow-lg"
            >
              <Link to={feature.link}>
                <CardHeader>
                  <div className="flex items-center gap-4">
                    <div
                      className={`rounded-lg bg-gray-100 p-2 ${feature.color}`}
                    >
                      <feature.icon size={24} />
                    </div>
                    <div>
                      <CardTitle className="text-xl">{feature.title}</CardTitle>
                      <CardDescription className="mt-1">
                        {feature.description}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button className="w-full" variant="ghost">
                    Access {feature.title}
                  </Button>
                </CardContent>
              </Link>
            </Card>
          ))}

          {allowedFeatures.length === 0 &&
            !currentAdmin?.is_super_admin &&
            !isTeamMember && (
              <Card className="col-span-2">
                <CardHeader>
                  <CardTitle>No Access</CardTitle>
                  <CardDescription>
                    You don't have permission to access any features. Please
                    contact the Super Admin to get access.
                  </CardDescription>
                </CardHeader>
              </Card>
            )}

          {allowedFeatures.length === 0 && isTeamMember && (
            <Card className="col-span-2">
              <CardHeader>
                <CardTitle>No Permissions Assigned</CardTitle>
                <CardDescription>
                  You haven't been assigned any permissions yet. Please contact
                  your admin to get access to features.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {/* Escalate an Issue - visible to every logged-in user */}
          {showReportIssue && (
            <Card className="border-rose-200 transition-all hover:shadow-lg">
              <Link to="/admin/report-sales-issue">
                <CardHeader>
                  <div className="flex items-center gap-4">
                    <div className="rounded-lg bg-rose-100 p-2 text-rose-600">
                      <Bug size={24} />
                    </div>
                    <div>
                      <CardTitle className="text-xl">
                        Escalate an Issue
                      </CardTitle>
                      <CardDescription className="mt-1">
                        Raise an issue ticket for the Support team
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button className="w-full" variant="ghost">
                    Escalate an Issue
                  </Button>
                </CardContent>
              </Link>
            </Card>
          )}

          {/* Change Password - visible to everyone (at the end) */}
          <Dialog
            open={openPasswordDialog}
            onOpenChange={setOpenPasswordDialog}
          >
            {showChangePassword && (
              <Card
                className="cursor-pointer border-blue-200 transition-all hover:shadow-lg"
                onClick={() => setOpenPasswordDialog(true)}
              >
                <CardHeader>
                  <div className="flex items-center gap-4">
                    <div className="rounded-lg bg-blue-100 p-2 text-blue-600">
                      <Lock size={24} />
                    </div>
                    <div>
                      <CardTitle className="text-xl">Change Password</CardTitle>
                      <CardDescription className="mt-1">
                        Update your account password for enhanced security
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button className="w-full" variant="ghost">
                    Change Password
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Change Password Dialog */}
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Lock className="h-5 w-5" />
                  Change Password
                </DialogTitle>
                <DialogDescription>
                  Update your account password. It must be at least 6 characters
                  long.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handlePasswordChange} className="space-y-4">
                {/* Current Password */}
                <div className="space-y-2">
                  <Label htmlFor="oldPassword" className="text-sm font-medium">
                    Current Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="oldPassword"
                      type={showOldPassword ? "text" : "password"}
                      placeholder="Enter your current password"
                      value={passwordForm.oldPassword}
                      onChange={(e) =>
                        setPasswordForm({
                          ...passwordForm,
                          oldPassword: e.target.value,
                        })
                      }
                      disabled={isChangingPassword}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowOldPassword(!showOldPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    >
                      {showOldPassword ? (
                        <EyeOff size={18} />
                      ) : (
                        <Eye size={18} />
                      )}
                    </button>
                  </div>
                </div>

                {/* New Password */}
                <div className="space-y-2">
                  <Label htmlFor="newPassword" className="text-sm font-medium">
                    New Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showNewPassword ? "text" : "password"}
                      placeholder="Enter your new password"
                      value={passwordForm.newPassword}
                      onChange={(e) =>
                        setPasswordForm({
                          ...passwordForm,
                          newPassword: e.target.value,
                        })
                      }
                      disabled={isChangingPassword}
                      minLength={6}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    >
                      {showNewPassword ? (
                        <EyeOff size={18} />
                      ) : (
                        <Eye size={18} />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Password should be minimum 6 characters
                  </p>
                </div>

                {/* Confirm Password */}
                <div className="space-y-2">
                  <Label
                    htmlFor="confirmPassword"
                    className="text-sm font-medium"
                  >
                    Confirm New Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Confirm your new password"
                      value={passwordForm.confirmPassword}
                      onChange={(e) =>
                        setPasswordForm({
                          ...passwordForm,
                          confirmPassword: e.target.value,
                        })
                      }
                      disabled={isChangingPassword}
                      minLength={6}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowConfirmPassword(!showConfirmPassword)
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    >
                      {showConfirmPassword ? (
                        <EyeOff size={18} />
                      ) : (
                        <Eye size={18} />
                      )}
                    </button>
                  </div>
                </div>

                {/* Error and Success Messages */}
                {errorMessage && (
                  <Alert variant="destructive">
                    <AlertDescription>{errorMessage}</AlertDescription>
                  </Alert>
                )}

                {successMessage && (
                  <Alert className="border-green-200 bg-green-50">
                    <Check className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-green-800">
                      {successMessage}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex gap-2 pt-4">
                  <Button
                    type="submit"
                    disabled={isChangingPassword}
                    className="flex-1"
                  >
                    {isChangingPassword ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Changing...
                      </>
                    ) : (
                      "Change Password"
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setOpenPasswordDialog(false)}
                    disabled={isChangingPassword}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
