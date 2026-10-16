import { Loader2, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useMaskedCall } from "@/hooks/useMaskedCall";

type MaskedCallButtonProps = {
  callerPhone: string | null | undefined;
  calleePhone: string | null | undefined;
  label?: string;
  loadingLabel?: string;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "default" | "outline" | "secondary" | "ghost" | "link";
  className?: string;
};

export function MaskedCallButton({
  callerPhone,
  calleePhone,
  label = "Call Now",
  loadingLabel = "Connecting...",
  size = "sm",
  variant = "outline",
  className,
}: MaskedCallButtonProps) {
  const { initiateCall, isCallLoading } = useMaskedCall();

  return (
    <Button
      size={size}
      variant={variant}
      disabled={isCallLoading || !callerPhone || !calleePhone}
      onClick={() => initiateCall(callerPhone ?? "", calleePhone ?? "")}
      className={className}
    >
      {isCallLoading ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <Phone size={14} />
      )}
      <span className="ml-1.5">{isCallLoading ? loadingLabel : label}</span>
    </Button>
  );
}
