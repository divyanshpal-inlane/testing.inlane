import { OnboardingWizard } from "@/components/admin/instructor-onboarding/OnboardingWizard";

// No APIProvider here: ServiceAreaStep renders ZoneDrawingEditor, which loads
// the Maps JS API through the shared googleMapsLoader. Wrapping this route in
// vis.gl's APIProvider as well injects the script twice.
export default function InstructorOnboardingPage() {
  return (
    <div className="container mx-auto px-4 py-6">
      <OnboardingWizard />
    </div>
  );
}
