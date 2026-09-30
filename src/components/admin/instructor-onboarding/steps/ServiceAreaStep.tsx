import ZoneDrawingEditor from "@/components/instructor-zones/ZoneDrawingEditor";
import { Label } from "@/components/ui/label";

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
      </div>
    </div>
  );
}
