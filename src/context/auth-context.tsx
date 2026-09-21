import { createClient, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";

// ── Single shared Supabase client ─────────────────────────────────────────
// All modules (queries, hooks, auth) must use this SAME instance so that
// when we inject a Go-auth session into localStorage the token is immediately
// available to every supabase.storage / supabase.from() call in the app.
// A second createClient() call would create an isolated object that never
// sees the localStorage write done in the same browser tab.
import { supabase } from "@/lib/supabaseClient";
import { isFeatureEnabled } from "@/services/featureFlagService";
import { triggerShadowAuth } from "@/utils/shadowAuth";
export { supabase };

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY!;
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// In dev the Vite proxy rewrites /go-api/* → http://localhost:8080/v1/*
// In production set VITE_BACKEND_API to the real Go service base URL (e.g. https://api.inlane.in/v1)
const BACKEND_API = import.meta.env.VITE_BACKEND_API || "/go-api";

/** Shape of the login response from the Go service. */
interface GoLoginResponse {
  accessToken: string;
  refreshToken: string;
  supabaseAccessToken: string;
  supabaseUserId: string; // Supabase auth.users UUID (must match JWT sub claim)
  user: {
    id: string; // RDS/Go-service internal user UUID
    phone: string;
    role: string;
    status: string;
  };
}

type UserRole = "learner" | "instructor" | "admin" | "user";

interface AuthContextType {
  user: User | null;
  login: (phone: string, password: string, role: UserRole) => Promise<void>;
  signUp: (
    phone: string,
    password: string,
    role: UserRole,
    name?: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  requestPasswordReset: (
    phone: string,
    context?: "learner" | "instructor" | "admin",
  ) => Promise<void>;
  verifyOtpAndResetPassword: (
    phone: string,
    otp: string,
    newPassword: string | null,
  ) => Promise<void>;
  changePassword: (
    oldPassword: string,
    newPassword: string,
    confirmNewPassword: string,
  ) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  // Stores the short-lived JWT reset token returned by POST /auth/otp/verify (Go flow).
  // Held in a ref so it persists across renders without triggering re-renders.
  const goResetTokenRef = useRef<string | null>(null);

  useEffect(() => {
    // Check active sessions and sets the user
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
      // Trigger shadow auth for all users when Go auth is enabled
      if (session?.user) {
        triggerShadowAuth(session.user, session);
      }
    });

    // Listen for changes on auth state (logged in, signed out, etc.)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (
        _event === "SIGNED_OUT" &&
        !session &&
        localStorage.getItem("go_access_token")
      ) {
        console.log(
          "[AUTH] SIGNED_OUT suppressed — Go auth session in progress.",
        );
        setLoading(false);
        return;
      }

      setUser(session?.user ?? null);
      setLoading(false);
      // Trigger shadow auth for all users when signed in
      if (_event === "SIGNED_IN" && session?.user) {
        triggerShadowAuth(session.user, session);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (phone: string, password: string, role: UserRole) => {
    console.log("[AUTH] Login attempt with:", { phone, role });

    // Normalize phone to last 10 digits
    const inputDigits = phone.replace(/\D/g, "");
    console.log(
      "[AUTH] Extracted digits:",
      inputDigits,
      "Length:",
      inputDigits.length,
    );

    if (inputDigits.length < 10) {
      console.error(
        "[AUTH] Invalid phone format. Too few digits:",
        inputDigits.length,
      );
      throw new Error(
        "Invalid phone number format. Please enter a valid phone number.",
      );
    }

    const last10 = inputDigits.slice(-10);
    console.log("[AUTH] Last 10 digits:", last10);

    // ── Go-service login (feature-flagged for all users) ────────────
    const goAuthEnabled = await isFeatureEnabled("use_go_auth");

    if (goAuthEnabled) {
      console.log("[AUTH] Trying Go service login for user:", last10);

      let goResponse: GoLoginResponse | null = null;
      let goLoginFailed = false;

      try {
        const res = await fetch(`${BACKEND_API}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: last10, password }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          console.warn(
            "[AUTH] Go login failed (status:",
            res.status,
            "):",
            errBody.message || "Unknown error",
            "— will fall back to Supabase.",
          );
          goLoginFailed = true;
        } else {
          goResponse = await res.json();
        }
      } catch (err: any) {
        console.warn(
          "[AUTH] Go service unreachable:",
          err.message,
          "— will fall back to Supabase.",
        );
        goLoginFailed = true;
      }

      if (!goLoginFailed && goResponse) {
        console.log("[AUTH] ========== GO SERVICE LOGIN SUCCESS ==========");
        console.log("[AUTH] Go Service User ID:", goResponse.user?.id);
        console.log("[AUTH] Go Service Phone:", goResponse.user?.phone);
        console.log("[AUTH] Go Service Role:", goResponse.user?.role);
        console.log("[AUTH] Go Service Status:", goResponse.user?.status);
        console.log(
          "[AUTH] Supabase User ID (from Go):",
          goResponse.supabaseUserId,
        );
        console.log("[AUTH] ================================================");

        // Role check against Go user object
        const userRole = goResponse.user?.role;
        const isValidRole =
          userRole === role ||
          (role === "admin" &&
            (userRole === "admin" ||
              userRole === "user" ||
              userRole === "super_admin"));

        if (!isValidRole) {
          console.error(
            "[AUTH] ❌ ROLE MISMATCH - Expected:",
            role,
            "Got:",
            userRole,
          );
          throw new Error("Invalid role for this login");
        }

        console.log("[AUTH] ✅ Role validation passed:", userRole);

        // Persist Go tokens for backend API calls
        localStorage.setItem("go_access_token", goResponse.accessToken);
        localStorage.setItem("go_refresh_token", goResponse.refreshToken);
        console.log("[AUTH] Go tokens stored in localStorage");

        // ── Establish Supabase session ──────────────────────────────────────
        // Step 1: try refreshSession
        const { data: refreshData, error: refreshError } =
          await supabase.auth.refreshSession({
            refresh_token: goResponse.refreshToken,
          });

        if (!refreshError && refreshData?.session) {
          console.log(
            "[AUTH] ✅ Supabase session established via refreshSession",
          );
          console.log("[AUTH] Supabase Auth User ID:", refreshData.user?.id);
          console.log("[AUTH] Supabase Auth Phone:", refreshData.user?.phone);
          console.log(
            "[AUTH] Supabase Auth Role:",
            refreshData.user?.user_metadata?.user_role,
          );
          if (refreshData.user && refreshData.session) {
            triggerShadowAuth(refreshData.user, refreshData.session);
          }
          return;
        }

        console.warn(
          "[AUTH] refreshSession failed:",
          refreshError?.message,
          "— injecting Go tokens directly.",
        );

        // Step 2: inject directly
        const goUser = {
          id: goResponse.supabaseUserId,
          phone: goResponse.user.phone,
          aud: "authenticated",
          role: "authenticated",
          app_metadata: {
            provider: "go_auth",
            providers: ["go_auth"],
            user_role: goResponse.user.role,
          },
          user_metadata: {
            user_role: goResponse.user.role,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          email: "",
          email_confirmed_at: undefined as unknown as string,
          phone_confirmed_at: new Date().toISOString(),
          last_sign_in_at: new Date().toISOString(),
          identities: [],
          factors: [],
        } as unknown as User;

        // Only inject session if Go returned a real supabaseAccessToken.
        // An empty string would cause "Invalid Compact JWS" on every Supabase storage/DB call.
        if (goResponse.supabaseAccessToken) {
          localStorage.setItem(
            "supabase_access_token",
            goResponse.supabaseAccessToken,
          );
          try {
            const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
            const supabaseStorageKey = `sb-${projectRef}-auth-token`;
            const injectedSession = {
              access_token: goResponse.supabaseAccessToken,
              token_type: "bearer",
              expires_in: 3600,
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              refresh_token: goResponse.refreshToken,
              user: goUser,
            };
            localStorage.setItem(
              supabaseStorageKey,
              JSON.stringify(injectedSession),
            );
            console.log(
              "[AUTH] ✅ Supabase session injected with Go supabaseAccessToken.",
            );
          } catch (storageErr) {
            console.warn(
              "[AUTH] Could not inject Supabase session storage:",
              storageErr,
            );
          }
        } else {
          // No supabaseAccessToken = user exists in RDS but NOT in Supabase auth.users.
          // Auto-create their Supabase account using the same credentials so that:
          // 1. They get a proper Supabase JWT for storage/RLS operations.
          // 2. Future Go logins will include supabaseAccessToken (user now in auth.users).
          console.warn(
            "[AUTH] No supabaseAccessToken — user not in Supabase auth. Auto-registering...",
          );
          localStorage.removeItem("supabase_access_token");

          // Build phone in E.164 format for Supabase
          const e164Phone = `+91${last10}`;
          const { data: signUpData, error: signUpError } =
            await supabase.auth.signUp({
              phone: e164Phone,
              password,
              options: {
                data: {
                  user_role: goResponse.user.role,
                  name: goResponse.user.phone, // placeholder; real name is in RDS
                },
              },
            });

          if (!signUpError && signUpData?.session) {
            // Successfully created Supabase account and got a session
            console.log(
              "[AUTH] ✅ Supabase account auto-created for Go user. Session established.",
            );
            // No need to inject — Supabase client already has the session
          } else if (!signUpError && signUpData?.user && !signUpData?.session) {
            // Account created but no session (Supabase email/phone confirmation required)
            console.warn(
              "[AUTH] Supabase account created but awaiting confirmation. Storage may not work until confirmed.",
            );
            await supabase.auth.signOut({ scope: "local" });
          } else {
            console.warn(
              "[AUTH] Could not auto-create Supabase account:",
              signUpError?.message,
              "— clearing stale session.",
            );
            await supabase.auth.signOut({ scope: "local" });
          }
        }

        setUser(goUser);
        console.log("[AUTH] ✅ Go login successful!");
        return;
      }

      // Go failed → fall through to Supabase
      console.log("[AUTH] Go login failed — falling back to Supabase.");
    }

    // ── Supabase login (fallback when Go fails or go_auth_enabled = false) ────
    console.log("[AUTH] Using Supabase direct login");

    const phoneFormats = [`+91${last10}`, `91${last10}`, last10, phone];

    let loginData = null;
    let lastError: any = null;

    for (const phoneFormat of phoneFormats) {
      try {
        console.log("[AUTH] Trying phone format:", phoneFormat);
        const { data, error } = await supabase.auth.signInWithPassword({
          phone: phoneFormat,
          password,
        });

        if (!error && data) {
          console.log("[AUTH] ✓ Login successful with format:", phoneFormat);
          loginData = data;
          break;
        }

        if (error) {
          lastError = error;
          console.warn(
            "[AUTH] Format failed:",
            phoneFormat,
            "Error:",
            error.message,
          );
        }
      } catch (err) {
        lastError = err;
        console.warn("[AUTH] Format error:", phoneFormat, "Error:", err);
      }
    }

    if (!loginData) {
      console.error("[AUTH] All phone formats failed. Last error:", lastError);
      throw lastError || new Error("Invalid phone number or password");
    }

    const data = loginData;

    console.log("[AUTH] ========== SUPABASE LOGIN SUCCESS ==========");
    console.log("[AUTH] Supabase Auth User ID:", data.user?.id);
    console.log("[AUTH] Supabase Auth Phone:", data.user?.phone);
    console.log(
      "[AUTH] Supabase Auth Role:",
      data.user?.user_metadata?.user_role,
    );
    console.log("[AUTH] ===========================================");

    const userRole = data.user?.user_metadata.user_role;
    const isValidRole =
      userRole === role ||
      (role === "admin" && (userRole === "admin" || userRole === "user"));

    if (!isValidRole) {
      console.error(
        "[AUTH] ❌ ROLE MISMATCH - Expected:",
        role,
        "Got:",
        userRole,
      );
      await supabase.auth.signOut();
      throw new Error("Invalid role for this login");
    }

    console.log("[AUTH] ✅ Supabase login successful!");
    // Trigger shadow auth for all users (Supabase fallback path)
    triggerShadowAuth(data.user, data.session);
  };

  const signUp = async (
    phone: string,
    password: string,
    role: UserRole,
    name?: string,
  ) => {
    // Normalize phone number
    const inputDigits = phone.replace(/\D/g, "");
    const last10 = inputDigits.slice(-10);
    // Supabase and Go signup both use E.164 format: +91XXXXXXXXXX
    const formattedPhone = phone.startsWith("+") ? phone : `+91${last10}`;

    console.log("[AUTH] Signup attempt:", {
      phone: formattedPhone,
      role,
      name,
    });

    // ──────────────────────────────────────────────────────────────────────────
    // LEARNER SIGNUP: Call Supabase + Go service in parallel
    // Go service returns tokens immediately so learner is auto-logged in
    // ──────────────────────────────────────────────────────────────────────────
    if (role === "learner") {
      // ── Create Learner record FIRST ────────────────────────────────────────
      // The Supabase BEFORE INSERT trigger on auth.users (update_signed_up_flag)
      // requires the Learner record to ALREADY EXIST with the same phone.
      // We create it before signUp and rely on ON CONFLICT to handle duplicates.
      const { error: learnerError } = await (supabase as any)
        .from("Learner")
        .upsert(
          {
            phone: formattedPhone,
            name: name || null,
            onboarding_completed: false,
          },
          { onConflict: "phone", ignoreDuplicates: true },
        );
      if (learnerError) {
        console.warn(
          "[AUTH] Failed to pre-create Learner record (non-fatal):",
          learnerError.message,
        );
      } else {
        console.log(
          "[AUTH] ✅ Learner record pre-created with phone:",
          formattedPhone,
        );
      }

      const supabaseSignupPromise = supabase.auth.signUp({
        phone: formattedPhone,
        password,
        options: {
          data: {
            user_role: "learner",
            name: name || "",
          },
        },
      });

      // Go learner signup — POST /auth/signup
      // Contract: { phone: "XXXXXXXXXX" (10 digits, no +91), password, name }
      // Role is hardcoded as "learner" server-side
      const goSignupPromise = (async () => {
        try {
          console.log("[AUTH] Attempting Go signup for learner:", last10);
          const res = await fetch(`${BACKEND_API}/auth/signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              phone: last10, // 10-digit number only, no +91 prefix
              password,
              name: name || "",
            }),
          });

          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            if (
              res.status === 409 &&
              errBody.code === "phone_already_registered"
            ) {
              console.warn(
                "[AUTH] Go: Learner phone already registered in RDS",
              );
              return {
                success: false,
                error: "phone_already_registered",
                data: null,
              };
            }
            if (res.status === 400 && errBody.code === "weak_password") {
              console.warn("[AUTH] Go: Weak password");
              return { success: false, error: "weak_password", data: null };
            }
            console.warn(
              "[AUTH] Go learner signup failed:",
              errBody.message || "Unknown error",
            );
            return {
              success: false,
              error: errBody.message || "Unknown error",
              data: null,
            };
          }

          const goResponse = await res.json();
          console.log(
            "[AUTH] ✅ Go learner signup successful:",
            goResponse.user?.id,
          );
          return { success: true, error: null, data: goResponse };
        } catch (err: any) {
          console.warn(
            "[AUTH] Go signup error (non-fatal, continuing with Supabase):",
            err.message,
          );
          return { success: false, error: err.message, data: null };
        }
      })();

      // Run both in parallel
      const [supabaseResult, goResult] = await Promise.all([
        supabaseSignupPromise,
        goSignupPromise,
      ]);

      // Supabase must succeed
      const { data, error } = supabaseResult;
      if (error) {
        console.error("[AUTH] Supabase learner signup failed:", error.message);
        throw error;
      }
      console.log(
        "[AUTH] ✅ Supabase learner signup successful:",
        data.user?.id,
      );

      // Store Go tokens → learner is auto-logged in (no separate login needed)
      if (goResult.success && goResult.data) {
        localStorage.setItem("go_access_token", goResult.data.accessToken);
        localStorage.setItem("go_refresh_token", goResult.data.refreshToken);
        console.log(
          "[AUTH] ✅ Go tokens stored — learner auto-logged in via Go.",
        );
      } else {
        console.warn(
          "[AUTH] Go signup failed (non-fatal). Learner will use Supabase session.",
          goResult.error,
        );
      }

      // Learner record is created by the update_signed_up_flag() trigger in Supabase
      // when the auth user is created. No manual insertion needed.
      console.log(
        "[AUTH] ✅ Learner profile will be created by database trigger",
      );
      console.log(
        "[AUTH] ✅ Learner signup complete (Supabase:",
        !!data.user,
        ", Go:",
        goResult.success,
        ")",
      );
      return;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // INSTRUCTOR SIGNUP: Supabase (primary) + Go service in parallel
    // Go service endpoint: POST /auth/signup { phone, password, name, role: "instructor" }
    // After Supabase signup, triggerShadowAuth also syncs the instructor to Go/RDS.
    // ──────────────────────────────────────────────────────────────────────────
    if (role === "instructor") {
      // ── Create Instructor record FIRST ─────────────────────────────────────
      // Same reason as learner: BEFORE INSERT trigger on auth.users requires
      // the Instructor record to already exist with the same phone.
      const { error: instructorError } = await supabase
        .from("Instructor")
        .upsert({ phone: formattedPhone, name: name || null } as any, {
          onConflict: "phone",
          ignoreDuplicates: true,
        });
      if (instructorError) {
        console.warn(
          "[AUTH] Failed to pre-create Instructor record (non-fatal):",
          instructorError.message,
        );
      } else {
        console.log(
          "[AUTH] ✅ Instructor record pre-created with phone:",
          formattedPhone,
        );
      }

      const supabaseSignupPromise = supabase.auth.signUp({
        phone: formattedPhone,
        password,
        options: {
          data: {
            user_role: "instructor",
            name: name || "",
          },
        },
      });

      // Go instructor signup — POST /auth/signup
      // Contract: { phone: "XXXXXXXXXX" (10 digits, no +91), password, name, role: "instructor" }
      const goSignupPromise = (async () => {
        try {
          console.log("[AUTH] Attempting Go signup for instructor:", last10);
          const res = await fetch(`${BACKEND_API}/auth/signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              phone: last10, // 10-digit number only, no +91 prefix
              password,
              name: name || "",
              role: "instructor",
            }),
          });

          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            console.warn(
              "[AUTH] Go instructor signup failed:",
              errBody.message || "Unknown error",
            );
            return {
              success: false,
              error: errBody.message || "Unknown error",
              data: null,
            };
          }

          const goResponse = await res.json();
          console.log(
            "[AUTH] ✅ Go instructor signup successful:",
            goResponse.user?.id,
          );
          return { success: true, error: null, data: goResponse };
        } catch (err: any) {
          console.warn(
            "[AUTH] Go instructor signup error (non-fatal, continuing with Supabase):",
            err.message,
          );
          return { success: false, error: err.message, data: null };
        }
      })();

      // Run both in parallel
      const [supabaseResult, goResult] = await Promise.all([
        supabaseSignupPromise,
        goSignupPromise,
      ]);

      // Supabase must succeed (primary)
      const { data, error } = supabaseResult;
      if (error) {
        console.error(
          "[AUTH] Supabase instructor signup failed:",
          error.message,
        );
        throw error;
      }
      console.log(
        "[AUTH] ✅ Supabase instructor signup successful:",
        data.user?.id,
      );

      if (!goResult.success) {
        console.warn(
          "[AUTH] Go instructor signup failed (non-fatal). Instructor will use Supabase session.",
          goResult.error,
        );
      }

      // Instructor record is created by the update_signed_up_flag() trigger in Supabase
      // when the auth user is created. No manual insertion needed.
      console.log(
        "[AUTH] ✅ Instructor profile will be created by database trigger",
      );

      // Trigger shadow auth to sync instructor to Go/RDS in the background
      if (data.user && data.session) {
        console.log(
          "[AUTH] Triggering shadow auth to sync instructor to RDS:",
          data.user.id,
        );
        triggerShadowAuth(data.user, data.session);
      }

      console.log(
        "[AUTH] ✅ Instructor signup complete (Supabase:",
        !!data.user,
        ", Go:",
        goResult.success,
        ")",
      );
      return;
    }

    throw new Error(`Unsupported signup role: ${role}`);
  };

  const logout = async () => {
    // Clear all stored tokens (Go + Supabase fallback)
    localStorage.removeItem("go_access_token");
    localStorage.removeItem("go_refresh_token");
    localStorage.removeItem("supabase_access_token");

    const { error } = await supabase.auth.signOut();

    // AuthSessionMissingError (403) is expected when:
    //   - The session was already invalidated server-side (e.g. after a password
    //     change via the Go service / Supabase admin API).
    // In that case the user is effectively already logged out — do NOT throw,
    // just let the caller continue with its navigation / cleanup.
    if (error && error.name !== "AuthSessionMissingError") {
      throw error;
    }

    if (error) {
      console.warn(
        "[AUTH] signOut returned AuthSessionMissingError — session was already invalidated (e.g. after password change). Treating as successful logout.",
      );
    }
  };

  const requestPasswordResetAlternative = async (
    phone: string,
    context?: "learner" | "instructor" | "admin",
  ) => {
    // Normalize to last 10 digits — Go service expects 10-digit phone
    const last10 = phone.replace(/\D/g, "").slice(-10);
    console.log(
      `[AUTH] Password reset OTP requested for phone: ${last10}, context: ${context || "auto-detect"}`,
    );

    const res = await fetch(`${BACKEND_API}/auth/otp/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: last10 }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(
        errBody.message || "Failed to send OTP. Please try again.",
      );
    }

    console.log("[AUTH] ✅ OTP request accepted by Go service.");
  };

  const verifyOtpAndResetPassword = async (
    phone: string,
    otp: string,
    newPassword: string | null,
  ) => {
    const last10 = phone.replace(/\D/g, "").slice(-10);

    if (!newPassword) {
      // ── Step 1: Verify OTP → receive short-lived resetToken ──────────────
      console.log("[AUTH] Verifying OTP via Go service for phone:", last10);

      const res = await fetch(`${BACKEND_API}/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: last10, otp }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        if (res.status === 404) {
          throw new Error("No user found with the provided phone number.");
        }
        throw new Error(
          errBody.message || "The OTP is invalid, expired, or already used.",
        );
      }

      const data = await res.json();
      goResetTokenRef.current = data.resetToken;
      console.log("[AUTH] ✅ OTP verified. Reset token stored.");
      return;
    }

    // ── Step 2: Reset password using the stored resetToken ───────────────────
    console.log("[AUTH] Resetting password via Go service for phone:", last10);

    if (!goResetTokenRef.current) {
      throw new Error("Reset token missing. Please verify your OTP again.");
    }

    const res = await fetch(`${BACKEND_API}/auth/reset-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${goResetTokenRef.current}`,
      },
      body: JSON.stringify({ newPassword }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      if (res.status === 400) {
        throw new Error(
          errBody.message || "Password must be at least 6 characters.",
        );
      }
      throw new Error(
        errBody.message || "Failed to reset password. Please try again.",
      );
    }

    goResetTokenRef.current = null;
    console.log("[AUTH] ✅ Password reset successfully via Go service.");
  };

  const changePassword = async (
    oldPassword: string,
    newPassword: string,
    confirmNewPassword: string,
  ) => {
    // Client-side validation
    if (!oldPassword) {
      throw new Error("Please enter your current password");
    }

    if (!newPassword || newPassword.length < 6) {
      throw new Error("New password must be at least 6 characters long");
    }

    if (newPassword !== confirmNewPassword) {
      throw new Error("New password and confirmation password must match.");
    }

    if (oldPassword === newPassword) {
      throw new Error("New password must be different from old password");
    }

    if (!user?.phone) {
      throw new Error("User not found. Please log in again.");
    }

    // Normalize phone to last 10 digits
    const last10 = user.phone.replace(/\D/g, "").slice(-10);

    // ── Go-service change password (feature-flagged for all users) ───────
    const goAuthEnabled = await isFeatureEnabled("use_go_auth");

    if (goAuthEnabled) {
      console.log("[AUTH] Changing password via Go service for user:", last10);

      const goAccessToken = localStorage.getItem("go_access_token");
      if (!goAccessToken) {
        throw new Error("Authentication required. Please log in again.");
      }

      const res = await fetch(`${BACKEND_API}/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${goAccessToken}`,
        },
        body: JSON.stringify({
          oldPassword,
          newPassword,
          confirmNewPassword,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));

        // Handle specific error codes from Go service
        if (errBody.code === "password_do_not_match") {
          throw new Error("New password and confirmation password must match.");
        }
        if (errBody.code === "weak_password") {
          throw new Error("Password must be at least 6 characters.");
        }
        if (errBody.code === "invalid_credentials") {
          throw new Error("Current password is incorrect.");
        }
        if (errBody.code === "unauthorized" || res.status === 401) {
          throw new Error("Authentication required. Please log in again.");
        }

        throw new Error(
          errBody.message || "Failed to change password. Please try again.",
        );
      }

      console.log("[AUTH] ✅ Password changed successfully via Go service.");
      return;
    }

    // ── Fallback: Supabase-based password change ───────────────────────────────
    console.log("[AUTH] Changing password via Supabase for user:", last10);

    if (!user?.id) {
      throw new Error("User not found. Please log in again.");
    }

    // First, verify the old password by attempting to sign in
    const phoneFormats = [`+91${last10}`, last10, user.phone];

    let isPasswordValid = false;

    for (const phoneFormat of phoneFormats) {
      const { error } = await supabase.auth.signInWithPassword({
        phone: phoneFormat,
        password: oldPassword,
      });

      if (!error) {
        isPasswordValid = true;
        break;
      }
    }

    if (!isPasswordValid) {
      throw new Error("Current password is incorrect.");
    }

    // If password is verified, update to new password
    const { error: updateError } =
      await supabaseAdmin.auth.admin.updateUserById(user.id, {
        password: newPassword,
      });

    if (updateError) {
      throw new Error("Failed to update password: " + updateError.message);
    }

    console.log("[AUTH] ✅ Password changed successfully via Supabase.");
    return;
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        signUp,
        logout,
        requestPasswordReset: requestPasswordResetAlternative, // Use the alternative implementation
        verifyOtpAndResetPassword,
        changePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function useUser() {
  const { user } = useAuth();
  return {
    phone: user?.phone,
    role: user?.user_metadata.user_role as UserRole,
  };
}

export function ProtectedLearnerRoute({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" />;
  }

  if (user.user_metadata.user_role !== "learner") {
    return <Navigate to="/login" />;
  }

  return (
    <div className="flex h-screen items-center justify-center font-glancyr">
      <div className="mx-auto flex aspect-[9/16] h-full max-h-[1000px] overflow-hidden rounded-lg bg-white shadow-lg">
        {children}
      </div>
    </div>
  );
}

export function ProtectedInstructorRoute({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/instructor-login" />;
  }

  if (user.user_metadata.user_role !== "instructor") {
    return <Navigate to="/instructor-login" />;
  }

  return (
    <div className="flex h-screen items-center justify-center font-glancyr">
      <div className="mx-auto flex aspect-[9/16] h-full max-h-[1000px] overflow-hidden rounded-lg bg-white shadow-lg">
        {children}
      </div>
    </div>
  );
}

export function ProtectedAdminRoute({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" />;
  }

  // Allow "admin", "super_admin", and "user" (team members created by admin) roles
  const userRole = user.user_metadata.user_role;
  if (
    userRole !== "admin" &&
    userRole !== "user" &&
    userRole !== "super_admin"
  ) {
    return <Navigate to="/login" />;
  }

  return <>{children}</>;
}
