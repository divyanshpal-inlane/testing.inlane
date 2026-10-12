import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";

type LookupBy = "leadId" | "email";

export type CrmLearnerFill = {
  name?: string;
  email?: string;
  phone?: string;
};

type LookupLearnerResponse = {
  configured?: boolean;
  found?: boolean;
  code?: string;
  learner?: CrmLearnerFill | null;
};

// Calls the same edge function as Instructor Management's lookup (it holds the
// Cratio credentials and only serves logged-in staff), using the
// learner-specific action that also returns the e-mail and phone this form needs.
async function lookupLearner(
  leadId: string,
  by: LookupBy,
): Promise<LookupLearnerResponse> {
  const { data, error } = await supabase.functions.invoke(
    "instructor-slot-booking",
    { body: { action: "lookupLearner", leadId, by } },
  );
  if (error) throw error;
  return (data ?? {}) as LookupLearnerResponse;
}

// Lead ID / e-mail lookup that pre-fills the Create New Learner form. It only
// calls `onFill`; every filled field stays editable in the form.
export function CrmLeadAutofill({
  onFill,
}: {
  onFill: (fill: CrmLearnerFill) => void;
}) {
  const { toast } = useToast();
  const [by, setBy] = useState<LookupBy>("leadId");
  const [value, setValue] = useState("");
  const [isLooking, setIsLooking] = useState(false);

  const handleLookup = async () => {
    const id = value.trim();
    if (!id) {
      toast({
        title: by === "leadId" ? "Lead ID required" : "E-mail required",
        description:
          by === "leadId"
            ? "Enter a CRM Lead ID to look up."
            : "Enter the customer's e-mail to look up.",
        variant: "destructive",
      });
      return;
    }
    setIsLooking(true);
    try {
      const result = await lookupLearner(id, by);
      if (result.configured === false) {
        toast({
          title: "CRM not configured",
          description:
            "The CRM lookup is not set up yet. Enter the details manually.",
          variant: "destructive",
        });
        return;
      }
      if (result.code === "CRM_LOOKUP_USE_EMAIL") {
        toast({
          title: "Enter a valid e-mail",
          description: "That doesn't look like an e-mail address.",
          variant: "destructive",
        });
        return;
      }
      if (result.code || !result.found || !result.learner) {
        toast({
          title: "Lead not found",
          description:
            by === "email"
              ? `No Cratio lead has the e-mail ${id}.`
              : `No CRM lead matched ${id}.`,
          variant: "destructive",
        });
        return;
      }
      const { name, email, phone } = result.learner;
      onFill({ name, email, phone });
      const missing = [
        !name && "name",
        !email && "e-mail",
        !phone && "phone",
      ].filter(Boolean);
      toast({
        title: "Lead loaded",
        description:
          missing.length > 0
            ? `Filled from CRM. The lead has no ${missing.join(", ")} — enter it manually.`
            : "Name, e-mail and phone filled from CRM. You can still edit them.",
      });
    } catch (err) {
      console.error("CRM learner lookup failed:", err);
      toast({
        title: "Lookup failed",
        description:
          "Could not reach the CRM. Enter the details manually and try again.",
        variant: "destructive",
      });
    } finally {
      setIsLooking(false);
    }
  };

  return (
    <div className="grid grid-cols-4 items-start gap-4">
      <Label className="pt-2 text-right">Autofill</Label>
      <div className="col-span-3 space-y-2">
        <div className="flex gap-1">
          {(["leadId", "email"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setBy(mode);
                setValue("");
              }}
              className={cn(
                "rounded-md border px-3 py-1 text-xs font-medium",
                by === mode
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground",
              )}
            >
              {mode === "leadId" ? "Lead ID" : "E-mail"}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={
              by === "leadId" ? "Enter CRM Lead ID" : "Enter customer e-mail"
            }
            onKeyDown={(e) => {
              // Enter must not submit/close the surrounding dialog.
              if (e.key === "Enter") {
                e.preventDefault();
                void handleLookup();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            onClick={handleLookup}
            disabled={isLooking}
          >
            {isLooking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Look up"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
