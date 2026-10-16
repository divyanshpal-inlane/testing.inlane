import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/auth-context";

export default function AdminLogin() {
  const { login, requestPasswordReset, verifyOtpAndResetPassword, user } =
    useAuth();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<"login" | "forgot-password">("login");
  const [formData, setFormData] = useState({
    phone: "",
    password: "",
  });
  const [newPassword, setNewPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [otp, setOtp] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [showNewPassword, setShowNewPassword] = useState<boolean>(false);
  const [resetRequested, setResetRequested] = useState<boolean>(false);
  const [otpVerified, setOtpVerified] = useState<boolean>(false);
  const [timer, setTimer] = useState<number>(0);
  const [isRequestingOtp, setIsRequestingOtp] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string>("");

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
    } else if (interval) {
      clearInterval(interval);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [timer]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSendOtp = async () => {
    if (isRequestingOtp) return;

    try {
      setIsRequestingOtp(true);
      await requestPasswordReset(formData.phone, "admin");
      setResetRequested(true);
      setTimer(30);
      setSuccessMessage(
        "OTP sent to your WhatsApp. Please check and enter below.",
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to send OTP. Please try again.",
      );
    } finally {
      setIsRequestingOtp(false);
    }
  };

  const handleVerifyOtp = async () => {
    try {
      setError(null);
      await verifyOtpAndResetPassword(formData.phone, otp, null);
      setOtpVerified(true);
      setSuccessMessage("OTP verified successfully. Set your new password.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Invalid OTP. Please try again.",
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage("");
    setIsLoading(true);

    try {
      if (active === "login") {
        console.log("[AdminLogin] Form submitted with phone:", formData.phone);

        // The login function in auth-context.tsx now handles phone normalization
        // Users can enter phone in any format: 9876543210, 919876543210, +919876543210, etc.
        console.log("[AdminLogin] Attempting login with:", formData.phone);

        await login(formData.phone, formData.password, "admin");

        console.log("[AdminLogin] ✓ Login successful");
        console.log("[AdminLogin] Navigating to /admin");
        navigate("/admin");
      } else if (active === "forgot-password") {
        if (!resetRequested) {
          // Step 1: Request password reset OTP
          if (!formData.phone || formData.phone.trim().length < 10) {
            throw new Error("Please enter a valid phone number");
          }
          await handleSendOtp();
        } else if (!otpVerified) {
          // Step 2: Verify OTP
          if (!otp || otp.trim().length < 4) {
            throw new Error("Please enter the OTP sent to your WhatsApp");
          }
          await handleVerifyOtp();
        } else {
          // Step 3: Reset password
          if (!newPassword || newPassword.length < 6) {
            throw new Error("Password must be at least 6 characters long");
          }
          if (newPassword !== confirmPassword) {
            throw new Error("Passwords do not match");
          }
          await verifyOtpAndResetPassword(formData.phone, otp, newPassword);
          setSuccessMessage(
            "Password reset successfully! You can now login with your new password.",
          );

          // Reset states and redirect to login
          setTimeout(() => {
            setActive("login");
            setResetRequested(false);
            setOtpVerified(false);
            setSuccessMessage("");
            setFormData({ phone: "", password: "" });
            setOtp("");
            setNewPassword("");
            setConfirmPassword("");
          }, 3000);
        }
      }
    } catch (err) {
      setSuccessMessage("");
      setError(
        err instanceof Error
          ? err.message
          : "An error occurred. Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const resetPasswordFlow = () => {
    setActive("forgot-password");
    setResetRequested(false);
    setOtpVerified(false);
    setOtp("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    setSuccessMessage("");
  };

  if (
    user &&
    (user.user_metadata.user_role === "admin" ||
      user.user_metadata.user_role === "user")
  ) {
    return <Navigate to="/admin" />;
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          {active === "forgot-password" ? (
            <h1 className="text-2xl font-bold">Reset Your Password</h1>
          ) : (
            <>
              <h1 className="text-2xl font-bold">Admin Login</h1>
              <p className="text-gray-500">
                Enter your credentials to continue
              </p>
            </>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Input
              name="phone"
              type="tel"
              placeholder="Phone number"
              value={formData.phone}
              onChange={handleChange}
              required
              minLength={10}
              disabled={active === "forgot-password" && resetRequested}
            />
          </div>

          {/* Password input - shown only in login */}
          {active !== "forgot-password" && (
            <div className="space-y-2">
              <div className="relative">
                <Input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={formData.password}
                  onChange={handleChange}
                  required
                  minLength={6}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              <p className="text-sm text-muted-foreground">
                Password should be minimum 6 characters
              </p>
            </div>
          )}

          {/* OTP input - shown only in forgot-password after requesting OTP */}
          {active === "forgot-password" && resetRequested && (
            <div className="space-y-1">
              <Input
                type="text"
                placeholder="Enter OTP from WhatsApp"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                disabled={otpVerified}
                maxLength={6}
              />
            </div>
          )}

          {/* New password input - shown only in forgot-password after OTP verification */}
          {active === "forgot-password" && otpVerified && (
            <>
              <div className="space-y-1">
                <div className="relative">
                  <Input
                    type={showNewPassword ? "text" : "password"}
                    placeholder="Enter New Password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    aria-label={
                      showNewPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showNewPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <Input
                  type={showNewPassword ? "text" : "password"}
                  placeholder="Confirm New Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </>
          )}

          {/* Error and success messages */}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {successMessage && (
            <p className="text-sm text-green-500" role="alert">
              {successMessage}
            </p>
          )}

          {/* Action buttons */}
          {active === "login" ? (
            <>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  "Login"
                )}
              </Button>
              <Button
                type="button"
                variant="link"
                className="w-full"
                onClick={resetPasswordFlow}
              >
                Forgot Password?
              </Button>
            </>
          ) : (
            <>
              {!resetRequested ? (
                <Button
                  className="w-full"
                  onClick={handleSendOtp}
                  disabled={
                    isRequestingOtp || formData.phone.trim().length < 10
                  }
                  type="button"
                >
                  Send OTP
                </Button>
              ) : !otpVerified ? (
                <Button className="w-full" type="submit" disabled={isLoading}>
                  {isLoading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    "Verify OTP"
                  )}
                </Button>
              ) : (
                <Button className="w-full" type="submit" disabled={isLoading}>
                  {isLoading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    "Reset Password"
                  )}
                </Button>
              )}
              {!resetRequested ? (
                <></>
              ) : (
                <>
                  {!otpVerified && (
                    <Button
                      className="w-full"
                      onClick={handleSendOtp}
                      disabled={timer > 0 || isRequestingOtp}
                      type="button"
                    >
                      Resend OTP {timer > 0 && `(${timer}s)`}
                    </Button>
                  )}
                </>
              )}
              <Button
                type="button"
                variant="link"
                className="w-full"
                onClick={() => {
                  setActive("login");
                  setError(null);
                  setSuccessMessage("");
                }}
              >
                Back to Login
              </Button>
            </>
          )}
        </form>

        {active === "login" && (
          <p className="text-center text-sm text-gray-500">
            Contact Super Admin to get access
          </p>
        )}
      </div>
    </div>
  );
}
