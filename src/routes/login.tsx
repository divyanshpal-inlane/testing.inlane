import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom"; // Fixed import

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/auth-context";

export default function Login() {
  const {
    login,
    signUp,
    user,
    requestPasswordReset,
    verifyOtpAndResetPassword,
  } = useAuth();

  const [searchParams, setSearchParams] = useSearchParams();
  const active = searchParams.get("active") || "login";
  const [phone, setPhone] = useState<string>(searchParams.get("phone") || "");
  const [name, setName] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [newPassword, setNewPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [otp, setOtp] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [showNewPassword, setShowNewPassword] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [resetRequested, setResetRequested] = useState<boolean>(false);
  const [otpVerified, setOtpVerified] = useState<boolean>(false);
  const [timer, setTimer] = useState<number>(0); // Timer for resend OTP
  const [isRequestingOtp, setIsRequestingOtp] = useState<boolean>(false); // Prevent multiple OTP requests
  const [agreedTnc, setAgreedTnc] = useState<boolean>(false);

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

  const handleSendOtp = async () => {
    if (isRequestingOtp) return; // Prevent multiple clicks

    try {
      setIsRequestingOtp(true);
      setErrorMessage(""); // Clear previous errors
      await requestPasswordReset(phone, "learner");
      setResetRequested(true);
      setSuccessMessage(
        "OTP sent to your WhatsApp. Please check and enter below.",
      );
      setTimer(30);
    } catch (error: any) {
      setErrorMessage(
        error?.message || "Failed to send OTP. Please try again.",
      );
    } finally {
      setIsRequestingOtp(false);
    }
  };

  const handleVerifyOtp = async () => {
    try {
      setErrorMessage(""); // Clear previous errors
      await verifyOtpAndResetPassword(phone, otp, null);
      setOtpVerified(true);
      setSuccessMessage("OTP verified successfully. Set your new password.");
    } catch (error: any) {
      setErrorMessage(error?.message || "Invalid OTP. Please try again.");
    }
  };

  const onSubmitHandler = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(""); // Clear any previous errors
    try {
      if (active === "login") {
        await login(phone, password, "learner");
      } else if (active === "signup") {
        if (!name || name.trim().length < 2) {
          throw new Error("Please enter your full name");
        }
        await signUp(phone, password, "learner", name.trim());
        // Show success message and redirect to login
        setSuccessMessage(
          "User registered successfully! You can now login with your phone number.",
        );
        setTimeout(() => {
          setSearchParams({ active: "login" });
          setPhone("");
          setName("");
          setPassword("");
          setSuccessMessage("");
          setErrorMessage("");
        }, 2500);
      } else if (active === "forgot-password") {
        if (!resetRequested) {
          // Step 1: Request password reset OTP
          if (!phone || phone.trim().length < 10) {
            throw new Error("Please enter a valid phone number");
          }
          await requestPasswordReset(phone, "learner");
          setSuccessMessage(
            "OTP sent to your WhatsApp. Please check and enter below.",
          );
          setResetRequested(true);
        } else if (!otpVerified) {
          // Step 2: Verify OTP
          if (!otp || otp.trim().length < 4) {
            throw new Error("Please enter the OTP sent to your WhatsApp");
          }
          await verifyOtpAndResetPassword(phone, otp, null);
          setSuccessMessage(
            "OTP verified successfully. Set your new password.",
          );
          setOtpVerified(true);
        } else {
          // Step 3: Reset password
          if (!newPassword || newPassword.length < 6) {
            throw new Error("Password must be at least 6 characters long");
          }
          if (newPassword !== confirmPassword) {
            throw new Error("Passwords do not match");
          }
          await verifyOtpAndResetPassword(phone, otp, newPassword);
          setSuccessMessage(
            "Password reset successfully! You can now login with your new password.",
          );

          // Reset states and redirect to login
          setTimeout(() => {
            setSearchParams({ active: "login" });
            setResetRequested(false);
            setOtpVerified(false);
            setSuccessMessage("");
          }, 3000);
        }
      }
    } catch (error: any) {
      setSuccessMessage("");
      setErrorMessage(error?.message || "An error occurred. Please try again.");
    }
  };

  const resetPasswordFlow = () => {
    setSearchParams({ active: "forgot-password" });
    setResetRequested(false);
    setOtpVerified(false);
    setOtp("");
    setNewPassword("");
    setConfirmPassword("");
    setErrorMessage("");
    setSuccessMessage("");
  };

  if (user && user.user_metadata.user_role === "learner") {
    // Always redirect to /home - it will check onboarding_completed
    // and redirect to onboarding if needed. This allows migrated learners
    // (who already have onboarding_completed=true) to skip onboarding.
    return <Navigate to="/home" />;
  } else if (user && user.user_metadata.user_role === "instructor") {
    return <Navigate to="/instructor" />;
  }

  const handleTncAgree = (event: React.ChangeEvent<HTMLInputElement>) => {
    setAgreedTnc(event.target.checked);
  };

  return (
    <div className="flex h-screen items-center justify-center font-glancyr">
      <div className="mx-auto flex aspect-[9/16] h-full max-h-[1000px] overflow-hidden rounded-lg bg-white shadow-lg">
        <div className="flex h-full w-full flex-col">
          <header className="relative h-[400px]">
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
              <img
                src="/assets/login-hero.png"
                alt="Person with car"
                className="h-full w-full object-fill"
              />
            </div>
          </header>

          <div className="flex h-full flex-col gap-6 p-6">
            <div className="flex flex-col items-center">
              {active === "forgot-password" ? (
                <h2 className="text-2xl">Reset Your Password</h2>
              ) : (
                <>
                  <h2 className="text-2xl">Ready to take the wheel?</h2>
                  <p className="text-lg">Let&apos;s get you driving!</p>
                </>
              )}
            </div>

            <form onSubmit={onSubmitHandler}>
              <div className="space-y-4">
                {/* Phone input - shown in all flows */}
                <div className="flex h-fit rounded-md shadow-md">
                  <span className="flex items-center rounded-l-md border border-r-0 bg-gray-100 px-3 text-gray-500">
                    +91
                  </span>
                  <Input
                    type="tel"
                    className="rounded-l-none shadow-none"
                    placeholder="Enter Mobile Number"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={active === "forgot-password" && resetRequested}
                  />
                </div>

                {/* Name input - shown only in signup */}
                {active === "signup" && (
                  <Input
                    type="text"
                    placeholder="Full Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    minLength={2}
                  />
                )}

                {/* Password input - shown only in login/signup */}
                {active !== "forgot-password" && (
                  <div className="space-y-1">
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        placeholder={
                          active === "login"
                            ? "Enter Password"
                            : "Create Password"
                        }
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        minLength={6}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                      >
                        {showPassword ? (
                          <EyeOff size={20} />
                        ) : (
                          <Eye size={20} />
                        )}
                      </button>
                      <p className="text-sm text-muted-foreground">
                        Password should be minimum 6 characters
                      </p>
                    </div>
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
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                          aria-label={
                            showNewPassword ? "Hide password" : "Show password"
                          }
                        >
                          {showNewPassword ? (
                            <EyeOff size={20} />
                          ) : (
                            <Eye size={20} />
                          )}
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
                {errorMessage && (
                  <p className="text-sm text-destructive" role="alert">
                    {errorMessage}
                  </p>
                )}
                {successMessage && (
                  <p className="text-sm text-green-500" role="alert">
                    {successMessage}
                  </p>
                )}

                {/* Action buttons */}
                <div className="flex flex-col items-center gap-1">
                  {active === "login" ? (
                    <>
                      <Button className="w-full" type="submit">
                        Login
                      </Button>
                      <div className="flex w-full justify-between">
                        <Button
                          type="button"
                          variant={"link"}
                          onClick={() => {
                            setSearchParams({ active: "signup" });
                            setErrorMessage("");
                          }}
                        >
                          Signup
                        </Button>
                        <Button
                          type="button"
                          variant={"link"}
                          onClick={resetPasswordFlow}
                        >
                          Forgot Password?
                        </Button>
                      </div>
                    </>
                  ) : active === "signup" ? (
                    <>
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="agree_to_tnc"
                          name="agree_to_tnc"
                          checked={agreedTnc}
                          onChange={handleTncAgree}
                        />
                        <Label htmlFor="agree_to_tnc">
                          I have and agree to the&nbsp;
                          <a
                            target="_blank"
                            href="https://inlane.in/terms-and-conditions"
                            className="text-muted-foreground hover:text-blue-500 hover:underline"
                            rel="noreferrer"
                          >
                            Terms of Service
                          </a>
                          &nbsp; and&nbsp;
                          <a
                            target="_blank"
                            href="https://inlane.in/privacy-policy"
                            className="text-muted-foreground hover:text-blue-500 hover:underline"
                            rel="noreferrer"
                          >
                            Privacy Policy
                          </a>
                        </Label>
                      </div>
                      <Button
                        className="w-full"
                        type="submit"
                        disabled={!agreedTnc}
                      >
                        Signup
                      </Button>
                      <p className="text-sm text-muted-foreground">
                        Already signed up?
                        <Button
                          type="button"
                          variant={"link"}
                          onClick={() => {
                            setSearchParams({ active: "login" });
                            setErrorMessage("");
                          }}
                        >
                          Login
                        </Button>
                      </p>
                    </>
                  ) : (
                    <>
                      {!resetRequested ? (
                        <></>
                      ) : !otpVerified ? (
                        <Button className="w-full" type="submit">
                          Verify OTP
                        </Button>
                      ) : (
                        <Button className="w-full" type="submit">
                          Reset Password
                        </Button>
                      )}
                      {!resetRequested ? (
                        <Button
                          className="w-full"
                          onClick={handleSendOtp}
                          disabled={isRequestingOtp || phone.trim().length < 10}
                        >
                          Send OTP
                        </Button>
                      ) : (
                        <>
                          {!otpVerified && (
                            <Button
                              className="w-full"
                              onClick={handleSendOtp}
                              disabled={timer > 0 || isRequestingOtp}
                            >
                              Resend OTP {timer > 0 && `(${timer}s)`}
                            </Button>
                          )}
                        </>
                      )}
                      <p className="text-sm text-muted-foreground">
                        Remember your password?
                        <Button
                          type="button"
                          variant={"link"}
                          onClick={() => {
                            setSearchParams({ active: "login" });
                            setErrorMessage("");
                          }}
                        >
                          Login
                        </Button>
                      </p>
                    </>
                  )}
                </div>
              </div>
            </form>

            {active != "signup" && (
              <footer className="mt-auto flex flex-col text-center text-sm">
                <div className="flex items-center justify-center gap-2 py-4">
                  <span>Made in</span>
                  <img
                    src="/assets/india-flag-xs.png"
                    alt="Indian Flag"
                    className="h-4 w-6"
                  />
                </div>
                By continuing, you agree to our
                <nav className="flex flex-row justify-center gap-4">
                  <a
                    target="_blank"
                    href="https://inlane.in/terms-and-conditions"
                    className="text-muted-foreground hover:text-blue-500 hover:underline"
                    rel="noreferrer"
                  >
                    Terms of Service
                  </a>
                  <a
                    target="_blank"
                    href="https://inlane.in/privacy-policy"
                    className="text-muted-foreground hover:text-blue-500 hover:underline"
                    rel="noreferrer"
                  >
                    Privacy Policies
                  </a>
                </nav>
              </footer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
