import {
  CalendarPlus,
  Car,
  Check,
  ClipboardCheck,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Key,
  MapPin,
  Pencil,
  User,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

import { StepProps } from "../types";

// Generate a secure random password
function generateSecurePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(
    { length: 8 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
}

interface ReviewStepProps extends StepProps {
  onStepClick: (step: number) => void;
}

export function ReviewStep({ data, updateData, onStepClick }: ReviewStepProps) {
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  // Generate password if not already set
  const handleGeneratePassword = () => {
    const newPassword = generateSecurePassword();
    updateData({ initialPassword: newPassword });
  };

  // Copy credentials to clipboard
  const handleCopyCredentials = () => {
    const credentials = `Phone: +91${data.phone}\nPassword: ${data.initialPassword}`;
    navigator.clipboard.writeText(credentials);
    setCopied(true);
    toast({
      title: "Copied!",
      description: "Credentials copied to clipboard",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const sections = [
    {
      title: "Basic Information",
      icon: User,
      step: 1,
      items: [
        { label: "Name", value: data.name },
        { label: "Phone", value: data.phone ? `+91 ${data.phone}` : "-" },
        { label: "Email", value: data.email || "Not provided" },
      ],
    },
    {
      title: "Documents",
      icon: FileText,
      step: 2,
      items: [
        { label: "DL Number", value: data.DL_number || "Not provided" },
        {
          label: "ID Proof Type",
          value: data.id_proof_type
            ? data.id_proof_type.charAt(0).toUpperCase() +
              data.id_proof_type.slice(1)
            : "Not provided",
        },
        {
          label: "ID Proof Number",
          value: data.id_proof_number || "Not provided",
        },
      ],
    },
    {
      title: "Vehicle Details",
      icon: Car,
      step: 3,
      items: [
        {
          label: "Fuel Type",
          value: data.car_fuel_type
            ? data.car_fuel_type.toUpperCase()
            : "Not set",
        },
        { label: "Transmission", value: data.car_make || "Not set" },
        { label: "Model", value: data.car_mode || "Not set" },
        { label: "Vehicle Number", value: data.car_number || "Not set" },
        {
          label: "Experience",
          value: data.experience
            ? `${data.experience} year(s)`
            : "Not provided",
        },
      ],
    },
    {
      title: "Service Area",
      icon: MapPin,
      step: 4,
      items: [
        {
          label: "Polygon",
          value: data.serviceZone
            ? `Drawn (${data.serviceZone.length} points)`
            : "Not drawn",
        },
      ],
    },
  ];

  return (
    <div className="space-y-4 overflow-hidden">
      <div className="mb-4 text-center">
        <h2 className="text-xl font-semibold">Review & Submit</h2>
        <p className="text-sm text-muted-foreground">
          Review all information before creating the instructor account
        </p>
      </div>

      {/* Information Sections */}
      <div className="grid gap-3 overflow-hidden">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Card key={section.title} className="overflow-hidden">
              <CardHeader className="px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-primary" />
                    <CardTitle className="text-sm">{section.title}</CardTitle>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onStepClick(section.step)}
                    className="h-7 shrink-0 px-2"
                  >
                    <Pencil className="mr-1 h-3 w-3" />
                    Edit
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="px-3 py-2">
                <div className="grid gap-1.5">
                  {section.items.map((item) => (
                    <div
                      key={item.label}
                      className="flex flex-col gap-0.5 text-xs sm:flex-row sm:justify-between"
                    >
                      <span className="shrink-0 text-muted-foreground">
                        {item.label}
                      </span>
                      <span className="break-words font-medium sm:max-w-[65%] sm:text-right">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* Unavailability */}
        <Card className="overflow-hidden">
          <CardHeader className="px-3 py-2">
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <ClipboardCheck className="h-4 w-4 shrink-0 text-primary" />
                <CardTitle className="text-sm">Availability</CardTitle>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onStepClick(5)}
                className="h-7 shrink-0 px-2"
              >
                <Pencil className="mr-1 h-3 w-3" />
                Edit
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-3 py-2">
            {data.unavailability.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {data.unavailability.map((item, index) => (
                  <Badge key={index} variant="secondary" className="text-xs">
                    {item.reason || `Block ${index + 1}`}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No unavailability periods set
              </p>
            )}
          </CardContent>
        </Card>

        {/* Calendar Import */}
        <Card className="overflow-hidden">
          <CardHeader className="px-3 py-2">
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <CalendarPlus className="h-4 w-4 shrink-0 text-primary" />
                <CardTitle className="text-sm">Calendar Import</CardTitle>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onStepClick(6)}
                className="h-7 shrink-0 px-2"
              >
                <Pencil className="mr-1 h-3 w-3" />
                Edit
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-3 py-2">
            {data.importedCalendarEvents.length > 0 ? (
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0 text-green-500" />
                <span className="text-xs font-medium text-green-600">
                  {data.importedCalendarEvents.length} event(s) imported
                </span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No calendar events imported (optional)
              </p>
            )}
          </CardContent>
        </Card>

        {/* Contract Status */}
        <Card className="overflow-hidden">
          <CardHeader className="px-3 py-2">
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-primary" />
                <CardTitle className="text-sm">Contract</CardTitle>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onStepClick(7)}
                className="h-7 shrink-0 px-2"
              >
                <Pencil className="mr-1 h-3 w-3" />
                Edit
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-3 py-2">
            <div className="flex items-center gap-2">
              {data.contractAccepted ? (
                <>
                  <Check className="h-4 w-4 shrink-0 text-green-500" />
                  <span className="text-xs font-medium text-green-600">
                    Terms accepted
                  </span>
                </>
              ) : (
                <span className="text-xs text-amber-600">
                  Terms not yet accepted
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Password Section */}
      <Card className="overflow-hidden border-primary/50">
        <CardHeader className="px-3 py-2">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 shrink-0 text-primary" />
            <CardTitle className="text-sm">Login Credentials</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Set the initial password for the instructor
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 px-3 pb-3">
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs">
              Initial Password <span className="text-red-500">*</span>
            </Label>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={data.initialPassword}
                  onChange={(e) =>
                    updateData({ initialPassword: e.target.value })
                  }
                  placeholder="Enter or generate"
                  className="h-9 pr-9 text-sm"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGeneratePassword}
                className="h-9 shrink-0"
              >
                Generate
              </Button>
            </div>
          </div>

          {data.initialPassword && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleCopyCredentials}
              className="h-8 w-full text-xs"
            >
              {copied ? (
                <>
                  <Check className="mr-1 h-3 w-3" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="mr-1 h-3 w-3" />
                  Copy Credentials
                </>
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      {!data.initialPassword && (
        <p className="text-center text-xs text-amber-600">
          Please set a password before creating the instructor account
        </p>
      )}
    </div>
  );
}
