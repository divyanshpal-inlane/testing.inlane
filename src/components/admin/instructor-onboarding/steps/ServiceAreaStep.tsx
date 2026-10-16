import { AlertTriangle } from "lucide-react";

import ZoneDrawingEditor from "@/components/instructor-zones/ZoneDrawingEditor";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import type { StepProps } from "../types";

export function ServiceAreaStep({ data, updateData }: StepProps) {
  return (
    <div className="space-y-6">
      <div className="mb-6 text-center">
        <h2 className="text-xl font-semibold">Service Area</h2>
        <p className="text-muted-foreground">
          Draw the area this instructor can cover
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Service Area Map</Label>
          <ZoneDrawingEditor
            coordinates={data.serviceZone}
            onChange={(serviceZone) => updateData({ serviceZone })}
            height="420px"
            emptyHint="No service area drawn yet. Pan/zoom the map to the instructor's area, then draw the boundary."
          />
        </div>

        {/* Defaults ON: an onboarding boundary is an admin's approximation
            drawn from a map, not one Operations has verified against real
            driving routes. Storing it as rough is what keeps it out of live
            customer matching while it waits for review. */}
        <div className="flex items-start justify-between gap-3 rounded-md border border-dashed p-3">
          <div className="min-w-0 space-y-0.5">
            <Label
              htmlFor="onboarding-rough-polygon"
              className="flex items-center gap-1.5 text-sm font-medium"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              Rough Polygon
            </Label>
            <p className="text-xs text-muted-foreground">
              {data.serviceZoneIsRough
                ? "Saved as a provisional area for Operations to refine. It is hidden by default on the Service Zone screen and is never used to match customers to this instructor."
                : "Saved as a verified service area and used to match customers to this instructor. Only choose this if the boundary has already been confirmed."}
            </p>
          </div>
          <Switch
            id="onboarding-rough-polygon"
            aria-label="Rough Polygon"
            checked={data.serviceZoneIsRough}
            onCheckedChange={(serviceZoneIsRough) =>
              updateData({ serviceZoneIsRough })
            }
          />
        </div>
      </div>
    </div>
  );
}
