import { GoogleOAuthProvider } from "@react-oauth/google";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { APIProvider } from "@vis.gl/react-google-maps";
import React, { Suspense } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";

import EarningsComparison from "@/app/instructor/earnings/EarningsComparison";
import EarningsHome from "@/app/instructor/earnings/EarningsHome";
import MoreWaysToEarn from "@/app/instructor/earnings/MoreWaysToEarn";
import Instructor from "@/app/instructor/Instructor";
import InstructorProfile from "@/app/instructor/InstructorProfile";
import LeaveHome from "@/app/instructor/leave/LeaveHome";
import ReportNoShow from "@/app/instructor/no-show/ReportNoShow";
import OTP from "@/app/instructor/OTP";
import SafetyHome from "@/app/instructor/safety/SafetyHome";
import SupportHome from "@/app/instructor/support/SupportHome";
import LessonReview from "@/app/LessonReview";
import LL_test_booking_1 from "@/app/LL_test_booking_1";
import LL_test_booking_2 from "@/app/LL_test_booking_2";
import LL_test_booking_3 from "@/app/LL_test_booking_3";
import MainLayout from "@/components/layout/main-layout";
import Plan from "@/components/lesson/plan";
import RescheduleView from "@/components/lesson/RescheduleView";
import Lesson10 from "@/components/lesson/signature";
import PaymentCallback from "@/components/payment/PaymentCallback";
import PaymentPage from "@/components/payment/PaymentPage";
import PaymentStatus from "@/components/payment/PaymentStatus";
import ReschedulePaymentCallback from "@/components/payment/ReschedulePaymentCallback";
import {
  AuthProvider,
  ProtectedAdminRoute,
  ProtectedInstructorRoute,
  ProtectedLearnerRoute,
} from "@/context/auth-context";
import { PhoneVisibilityProvider } from "@/context/phone-visibility-context";
import AdminHome from "@/routes/admin/AdminHome";
import AdminManagement from "@/routes/admin/AdminManagement";
import ComplianceForms from "@/routes/admin/ComplianceForms";
import DLTestDates from "@/routes/admin/DLTestDates";
import DLTestSlots from "@/routes/admin/DLTestSlots";
import GameAnalytics from "@/routes/admin/GameAnalytics";
import InstructorOnboardingPage from "@/routes/admin/instructor-onboarding";
import InstructorEarnings from "@/routes/admin/InstructorEarnings";
import InstructorMatrix from "@/routes/admin/InstructorMatrix";
import InstructorsManagement, {
  InstructorSchedulePage,
} from "@/routes/admin/instructors";
import { AddTentativeSchedule } from "@/routes/admin/instructors";
import KAMManagement from "@/routes/admin/KAMManagement";
import LearnerDetails from "@/routes/admin/LearnerDetails";
import LearnerIssueFixer from "@/routes/admin/LearnerIssueFixer";
import LearnerLLDetails from "@/routes/admin/LearnerLLDetails";
import LearnerManagement from "@/routes/admin/LearnerManagement";
import LearnerMigration from "@/routes/admin/LearnerMigration";
import LessonsDashboard from "@/routes/admin/LessonsDashboard";
import LLCustomerMigration from "@/routes/admin/LLCustomerMigration";
import LLPipeline from "@/routes/admin/LLPipeline";
import SalesDashboard from "@/routes/admin/SalesDashboard";
import AdminSchedules from "@/routes/admin/schedules";
import AdminSettings from "@/routes/admin/Settings";
import UserManagement from "@/routes/admin/UserManagement";
import AdminLogin from "@/routes/admin-login";
import ScheduleDetails from "@/routes/createSchedule/details";
import UploadLL from "@/routes/createSchedule/uploadLL";
import Fees from "@/routes/fees";
import Home from "@/routes/home";
import InstructorAuth from "@/routes/InstructorAuth";
import LoadingAndRedirect from "@/routes/LoadingandRedirect";
import Login from "@/routes/login";
import Aadhar from "@/routes/onboard/aadhar";
import Birthday from "@/routes/onboard/birthday";
import DLQuestion from "@/routes/onboard/DL";
import OnboardingSignature from "@/routes/onboard/signature";
import Preferences from "@/routes/preferences";
import Profile2 from "@/routes/profile2";
import Start from "@/routes/start";
import StartLesson from "@/routes/startLesson";

import BugReportsManagement from "./routes/admin/BugReportsManagement";
import CarCommerceLeads from "./routes/admin/CarCommerceLeads";
import ControlTower from "./routes/admin/ControlTower";
import FeedbackManagement from "./routes/admin/FeedbackManagement";
import InstructorLessonLog from "./routes/admin/InstructorLessonLog";
import InstructorPerformance from "./routes/admin/InstructorPerformance";
import LeaveManagement from "./routes/admin/LeaveManagement";
import NoShowManagement from "./routes/admin/NoShowManagement";
import NotificationManagement from "./routes/admin/NotificationManagement";
import PaymentTracker from "./routes/admin/PaymentTracker";
import SafetyMonitoring from "./routes/admin/SafetyMonitoring";
import SupportTickets from "./routes/admin/SupportTickets";
import TentativeSchedules2 from "./routes/admin/TentativeManagement";
import OnboardingQuestions from "./routes/createSchedule/onboardingQuestions";
import HelpSupport from "./routes/help";
import ReportIssue from "./routes/report-issue";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

const Schedule = React.lazy(() => import("@/routes/schedule"));
const Prep = React.lazy(() => import("@/routes/prep"));

export default function App() {
  return (
    // basename resolves to "/" everywhere except the GitHub Pages test
    // deploy (built with VITE_BASE_PATH set), where it matches the
    // sub-path the app is actually served from — see vite.config.ts.
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <PhoneVisibilityProvider>
            <Routes>
              <Route path="/start" element={<Start />} />
              <Route path="/login" element={<Login />} />
              <Route path="/report-issue" element={<ReportIssue />} />
              <Route path="/admin-byser-secu7" element={<AdminLogin />} />
              <Route path="/instructor-login" element={<InstructorAuth />} />
              <Route
                path="/onboard"
                element={
                  <ProtectedLearnerRoute>
                    <Outlet />
                  </ProtectedLearnerRoute>
                }
              >
                <Route path="birthday" element={<Birthday />} />
                <Route path="aadhar" element={<Aadhar />} />
                <Route path="signature" element={<OnboardingSignature />} />
                <Route path="dl" element={<DLQuestion />} />
              </Route>
              <Route
                path="/"
                element={
                  <ProtectedLearnerRoute>
                    <MainLayout />
                  </ProtectedLearnerRoute>
                }
              >
                <Route index element={<Navigate to="/home" replace />} />
                <Route path="home" element={<Home />} />
                <Route
                  path="prep"
                  element={
                    <Suspense fallback={<div>Loading prep...</div>}>
                      <Prep />
                    </Suspense>
                  }
                />
                <Route
                  path="schedule"
                  element={
                    <Suspense fallback={<div>Loading schedule...</div>}>
                      <Schedule />
                    </Suspense>
                  }
                />
                <Route path="help" element={<HelpSupport />} />
                <Route path="fees" element={<Fees />} />
                <Route path="profile" element={<Profile2 />} />
              </Route>
              <Route path="/signature" element={<Lesson10 />} />
              <Route
                path="createSchedule"
                element={
                  <ProtectedLearnerRoute>
                    <Outlet />
                  </ProtectedLearnerRoute>
                }
              >
                <Route
                  path="details"
                  element={
                    <APIProvider
                      apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
                    >
                      <ScheduleDetails />
                    </APIProvider>
                  }
                />
                <Route path="preferences" element={<Preferences />} />
                <Route path="uploadLL" element={<UploadLL />} />
                <Route
                  path="onboardingQuestions"
                  element={<OnboardingQuestions />}
                />
              </Route>
              <Route
                path="/"
                element={
                  <ProtectedLearnerRoute>
                    <Outlet />
                  </ProtectedLearnerRoute>
                }
              >
                <Route path="birthday" element={<Birthday />} />
                <Route path="aadhar" element={<Aadhar />} />
                <Route path="bookLL-1" element={<LL_test_booking_1 />} />
                <Route path="bookLL-2/:navId" element={<LL_test_booking_2 />} />
                <Route path="bookLL-3" element={<LL_test_booking_3 />} />
                <Route
                  path="/startLesson/:lessonNumber"
                  element={<StartLesson />}
                />
                <Route path="/lesson-review" element={<LessonReview />} />
              </Route>
              <Route
                path="/lesson/:lessonId"
                element={
                  <ProtectedLearnerRoute>
                    <Plan />
                  </ProtectedLearnerRoute>
                }
              />
              <Route
                path="/instructor"
                element={
                  <GoogleOAuthProvider
                    clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}
                  >
                    <ProtectedInstructorRoute>
                      <Instructor />
                    </ProtectedInstructorRoute>
                  </GoogleOAuthProvider>
                }
              />
              <Route
                path="/instructor-profile"
                element={
                  <ProtectedInstructorRoute>
                    <InstructorProfile />
                  </ProtectedInstructorRoute>
                }
              />
              <Route
                path="/instructor/earnings"
                element={
                  <ProtectedInstructorRoute>
                    <EarningsHome />
                  </ProtectedInstructorRoute>
                }
              />
              <Route
                path="/instructor/earnings/more"
                element={
                  <ProtectedInstructorRoute>
                    <MoreWaysToEarn />
                  </ProtectedInstructorRoute>
                }
              />
              <Route
                path="/instructor/earnings/compare"
                element={
                  <ProtectedInstructorRoute>
                    <EarningsComparison />
                  </ProtectedInstructorRoute>
                }
              />
              <Route
                path="/instructor/leave"
                element={
                  <ProtectedInstructorRoute>
                    <LeaveHome />
                  </ProtectedInstructorRoute>
                }
              />
              <Route
                path="/instructor/report-no-show"
                element={
                  <ProtectedInstructorRoute>
                    <ReportNoShow />
                  </ProtectedInstructorRoute>
                }
              />
              <Route
                path="/instructor/support"
                element={
                  <ProtectedInstructorRoute>
                    <SupportHome />
                  </ProtectedInstructorRoute>
                }
              />
              <Route
                path="/instructor/safety"
                element={
                  <ProtectedInstructorRoute>
                    <SafetyHome />
                  </ProtectedInstructorRoute>
                }
              />
              <Route
                path="/otp/start/:learnerId/:scheduleId"
                element={
                  <ProtectedInstructorRoute>
                    <OTP isVerifyStartLesson={true} />
                  </ProtectedInstructorRoute>
                }
              />
              <Route
                path="/otp/end/:learnerId/:scheduleId"
                element={
                  <ProtectedInstructorRoute>
                    <OTP isVerifyStartLesson={false} />
                  </ProtectedInstructorRoute>
                }
              />
              <Route
                path="/reschedule/:lessonId"
                element={
                  <ProtectedLearnerRoute>
                    <RescheduleView />
                  </ProtectedLearnerRoute>
                }
              />
              <Route path="/loading" element={<LoadingAndRedirect />} />
              <Route
                path="/admin"
                element={
                  <ProtectedAdminRoute>
                    <Outlet />
                  </ProtectedAdminRoute>
                }
              >
                <Route index element={<AdminHome />} />
                <Route path="game-analytics" element={<GameAnalytics />} />
                <Route path="compliance-forms" element={<ComplianceForms />} />
                <Route path="schedules" element={<AdminSchedules />} />
                <Route
                  path="instructor-matrix"
                  element={<InstructorMatrix />}
                />
                <Route path="sales-dashboard" element={<SalesDashboard />} />
                <Route
                  path="instructor-earnings"
                  element={<InstructorEarnings />}
                />
                <Route path="kam-management" element={<KAMManagement />} />
                <Route
                  path="lessons-dashboard"
                  element={<LessonsDashboard />}
                />
                <Route path="instructors" element={<InstructorsManagement />} />
                <Route
                  path="instructors/:id"
                  element={<InstructorSchedulePage />}
                />

                <Route
                  path="learner-ll-details"
                  element={<LearnerLLDetails />}
                />
                <Route path="ll-pipeline" element={<LLPipeline />} />
                <Route path="dl-test-slots" element={<DLTestSlots />} />
                <Route path="dl-test-dates" element={<DLTestDates />} />
                <Route path="learner-details" element={<LearnerDetails />} />
                <Route
                  path="learner-management"
                  element={<LearnerManagement />}
                />
                <Route
                  path="notification-management"
                  element={<NotificationManagement />}
                />
                <Route
                  path="tentative-schedules-info"
                  element={<TentativeSchedules2 />}
                />
                <Route
                  path="tentative-add/:instructorId/:date/:startTime"
                  element={<AddTentativeSchedule />}
                />
                <Route
                  path="learner-issue-fixer"
                  element={<LearnerIssueFixer />}
                />
                <Route
                  path="learner-migration"
                  element={<LearnerMigration />}
                />
                <Route
                  path="ll-customer-migration"
                  element={<LLCustomerMigration />}
                />
                <Route
                  path="instructor-onboarding"
                  element={<InstructorOnboardingPage />}
                />
                <Route path="settings" element={<AdminSettings />} />
                <Route path="admin-management" element={<AdminManagement />} />
                <Route path="user-management" element={<UserManagement />} />
                <Route path="bug-reports" element={<BugReportsManagement />} />
                <Route
                  path="instructor-lesson-log"
                  element={<InstructorLessonLog />}
                />
                <Route path="payment-tracker" element={<PaymentTracker />} />
                <Route path="feedback" element={<FeedbackManagement />} />
                <Route
                  path="car-commerce-leads"
                  element={<CarCommerceLeads />}
                />
                <Route path="leave-management" element={<LeaveManagement />} />
                <Route path="no-shows" element={<NoShowManagement />} />
                <Route path="support-tickets" element={<SupportTickets />} />
                <Route
                  path="safety-monitoring"
                  element={<SafetyMonitoring />}
                />
                <Route
                  path="instructor-performance"
                  element={<InstructorPerformance />}
                />
                <Route path="control-tower" element={<ControlTower />} />
              </Route>
              <Route path="/payment" element={<PaymentPage />} />
              <Route path="/payment/callback" element={<PaymentCallback />} />
              <Route path="/payment/success" element={<PaymentStatus />} />
              <Route path="/payment/failure" element={<PaymentStatus />} />
              <Route
                path="/reschedule/callback"
                element={<ReschedulePaymentCallback />}
              />
              <Route
                path="*"
                element={
                  <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
                    <h1 className="text-2xl font-bold">Page not found</h1>
                    <p>The page you requested does not exist.</p>
                    <Link className="text-blue-600 underline" to="/">
                      Return home
                    </Link>
                  </main>
                }
              />
            </Routes>
          </PhoneVisibilityProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}
