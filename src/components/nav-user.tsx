import {
  BadgeCheck,
  Bell,
  Check,
  ChevronsUpDown,
  CreditCard,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogOut,
} from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/auth-context";

export function NavUser({
  user,
}: {
  user: {
    name: string;
    email: string;
    avatar: string;
  };
}) {
  const { user: authUser, changePassword } = useAuth();
  const [open, setOpen] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
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
        setOpen(false);
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DropdownMenu>
        <DropdownMenuTrigger className="w-full rounded-md outline-none ring-ring hover:bg-accent focus-visible:ring-2 data-[state=open]:bg-accent">
          <div className="flex items-center gap-2 px-2 py-1.5 text-left text-sm transition-all">
            <Avatar className="h-7 w-7 rounded-md border">
              <AvatarImage
                src={user.avatar}
                alt={user.name}
                className="animate-in fade-in-50 zoom-in-90"
              />
              <AvatarFallback className="rounded-md">CN</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 leading-none">
              <div className="font-medium">{user.name}</div>
              <div className="overflow-hidden text-xs text-muted-foreground">
                <div className="line-clamp-1">{user.email}</div>
              </div>
            </div>
            <ChevronsUpDown className="ml-auto mr-0.5 h-4 w-4 text-muted-foreground/50" />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-56"
          align="end"
          side="right"
          sideOffset={4}
        >
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm transition-all">
              <Avatar className="h-7 w-7 rounded-md">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback>CN</AvatarFallback>
              </Avatar>
              <div className="grid flex-1">
                <div className="font-medium">{user.name}</div>
                <div className="overflow-hidden text-xs text-muted-foreground">
                  <div className="line-clamp-1">{user.email}</div>
                </div>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem className="gap-2">
              <BadgeCheck className="h-4 w-4 text-muted-foreground" />
              Account
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              Billing
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              Notifications
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DialogTrigger asChild>
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              onSelect={(e) => e.preventDefault()}
            >
              <Lock className="h-4 w-4 text-muted-foreground" />
              Change Password
            </DropdownMenuItem>
          </DialogTrigger>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2">
            <LogOut className="h-4 w-4 text-muted-foreground" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Change Password Dialog */}
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Change Password
          </DialogTitle>
          <DialogDescription>
            Update your account password. It must be at least 6 characters long.
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
                {showOldPassword ? <EyeOff size={18} /> : <Eye size={18} />}
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
                {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Password should be minimum 6 characters
            </p>
          </div>

          {/* Confirm Password */}
          <div className="space-y-2">
            <Label htmlFor="confirmPassword" className="text-sm font-medium">
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
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
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
              onClick={() => setOpen(false)}
              disabled={isChangingPassword}
            >
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
