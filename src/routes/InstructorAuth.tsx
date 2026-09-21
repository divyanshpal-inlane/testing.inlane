import { Eye, EyeOff } from "lucide-react";
import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/auth-context";

export default function InstructorAuth() {
  const {
    login,
    signUp,
    requestPasswordReset,
    verifyOtpAndResetPassword,
    user,
  } = useAuth();
  const [active, setActive] = useState<"login" | "signup" | "forgot-password">(
    "login",
  );
  const [phone, setPhone] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [newPassword, setNewPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [otp, setOtp] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [showNewPassword, setShowNewPassword] = useState<boolean>(false);
  const [resetRequested, setResetRequested] = useState<boolean>(false);
  const [otpVerified, setOtpVerified] = useState<boolean>(false);
  const [timer, setTimer] = useState<number>(0); // Timer for resend OTP
  const [isRequestingOtp, setIsRequestingOtp] = useState<boolean>(false); // Prevent multiple OTP requests
  const [errorMessage, setErrorMessage] = useState<string>("");
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

  const handleSendOtp = async () => {
    if (isRequestingOtp) return;

    try {
      setIsRequestingOtp(true);
      await requestPasswordReset(phone, "instructor");
      setResetRequested(true);
      setTimer(30);
      setSuccessMessage(
        "OTP sent to your WhatsApp. Please check and enter below.",
      );
    } catch (error) {
      setErrorMessage("Failed to send OTP. Please try again.");
    } finally {
      setIsRequestingOtp(false);
    }
  };

  const handleVerifyOtp = async () => {
    try {
      await verifyOtpAndResetPassword(phone, otp, null);
      setOtpVerified(true);
      setSuccessMessage("OTP verified successfully. Set your new password.");
    } catch (error) {
      setErrorMessage("Invalid OTP. Please try again.");
    }
  };

  const onSubmitHandler = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");
    try {
      // Format phone with +91 prefix to match how instructor accounts are created
      const formattedPhone = `+91${phone.replace(/\D/g, "")}`;
      if (active === "login") {
        await login(formattedPhone, password, "instructor");
      } else if (active === "signup") {
        if (!name || name.trim().length < 2) {
          throw new Error("Please enter your full name");
        }
        await signUp(formattedPhone, password, "instructor", name.trim());
        // Show success message and redirect to login
        setSuccessMessage(
          "User registered successfully! You can now login with your phone number.",
        );
        setTimeout(() => {
          setActive("login");
          setPhone("");
          setName("");
          setPassword("");
          setSuccessMessage("");
          setErrorMessage("");
        }, 2500);
      } else if (active === "forgot-password") {
        if (!resetRequested) {
          if (!phone || phone.trim().length < 10) {
            throw new Error("Please enter a valid phone number");
          }
          await handleSendOtp();
        } else if (!otpVerified) {
          if (!otp || otp.trim().length < 4) {
            throw new Error("Please enter the OTP sent to your WhatsApp");
          }
          await handleVerifyOtp();
        } else {
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

          setTimeout(() => {
            setActive("login");
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

  if (user && user.user_metadata.user_role === "instructor") {
    return <Navigate to="/instructor" />;
  }

  return (
    <div className="flex h-screen items-center justify-center font-glancyr">
      <div className="mx-auto flex aspect-[9/16] h-full max-h-[1000px] overflow-hidden rounded-lg bg-white shadow-lg">
        <div className="flex h-full w-full flex-col">
          <div className="flex h-full flex-col gap-6 p-6">
            <div className="flex flex-col items-center">
              {active === "forgot-password" ? (
                <h2 className="text-2xl">Reset Your Password</h2>
              ) : (
                <>
                  <h2 className="text-2xl">Welcome, Instructor!</h2>
                  <p className="text-lg">Ready to guide new drivers?</p>
                </>
              )}
            </div>

            <form onSubmit={onSubmitHandler}>
              <div className="space-y-4">
                <div className="flex h-fit rounded-md shadow-md">
                  <span className="flex items-center rounded-l-md border border-r-0 bg-gray-100 px-3 text-gray-500">
                    +91
                  </span>
                  <Input
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

                {active !== "forgot-password" && (
                  <div className="relative w-full">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder={
                        active === "signup"
                          ? "Create Password"
                          : "Enter Password"
                      }
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pr-10"
                    />
                    <Button
                      className="absolute right-2 top-1/2 -translate-y-1/2 transform p-1"
                      type="button"
                      variant="ghost"
                      onClick={() => setShowPassword((prev) => !prev)}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                )}

                {active === "forgot-password" && resetRequested && (
                  <div className="space-y-1">
                    <Input
                      type="text"
                      placeholder="Enter OTP"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      disabled={otpVerified}
                      maxLength={6}
                    />
                  </div>
                )}

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
                        <Button
                          className="absolute right-2 top-1/2 -translate-y-1/2 transform p-1"
                          type="button"
                          variant="ghost"
                          onClick={() => setShowNewPassword((prev) => !prev)}
                        >
                          {showNewPassword ? <EyeOff /> : <Eye />}
                        </Button>
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

                <div className="flex flex-col items-center gap-1">
                  {active === "login" ? (
                    <>
                      <Button className="w-full" type="submit">
                        Login as Instructor
                      </Button>
                      <p className="text-sm text-muted-foreground">
                        Not registered?
                        <Button
                          type="button"
                          variant="link"
                          onClick={() => setActive("signup")}
                        >
                          Sign up
                        </Button>
                      </p>
                      <Button
                        type="button"
                        variant="link"
                        onClick={() => setActive("forgot-password")}
                      >
                        Forgot Password?
                      </Button>
                    </>
                  ) : active === "signup" ? (
                    <>
                      <Button className="w-full" type="submit">
                        Sign up as Instructor
                      </Button>
                      <p className="text-sm text-muted-foreground">
                        Already registered?
                        <Button
                          type="button"
                          variant="link"
                          onClick={() => setActive("login")}
                        >
                          Login
                        </Button>
                      </p>
                    </>
                  ) : (
                    <>
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
                          <Button
                            className="w-full"
                            onClick={handleVerifyOtp}
                            disabled={otp.trim().length < 4 || otpVerified}
                          >
                            Verify OTP
                          </Button>
                        </>
                      )}
                      {otpVerified && (
                        <Button className="w-full" type="submit">
                          Reset Password
                        </Button>
                      )}
                      <p className="text-sm text-muted-foreground">
                        Remember your password?
                        <Button
                          type="button"
                          variant="link"
                          onClick={() => setActive("login")}
                        >
                          Login
                        </Button>
                      </p>
                    </>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
