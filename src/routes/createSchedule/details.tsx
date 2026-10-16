import { Map, MapEvent, useMapsLibrary } from "@vis.gl/react-google-maps";
import { ArrowLeft, MapPin } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { hasLearnerPickupLocation } from "@/lib/learner-schedule-onboarding";
import { useLearner, useLearnerUpdate } from "@/queries/learner";

const mapContainerStyle = {
  width: "100%",
  height: "300px",
  borderRadius: "0.5rem",
  position: "relative",
} as const;

const markerStyle = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -100%)",
  zIndex: 1,
  pointerEvents: "none",
} as const;

export default function ScheduleDetails() {
  const { data: learner } = useLearner();
  const { mutate: updateLearner, isPending } = useLearnerUpdate();
  const seededRef = useRef(false);
  const [address, setAddress] = useState<string>("");
  const [addressLat, setAddressLat] = useState<number>();
  const [addressLng, setAddressLng] = useState<number>();
  const { toast } = useToast();

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isDemoFlow = searchParams.get("type") === "demo";
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const places = useMapsLibrary("places");

  useEffect(() => {
    if (!learner || seededRef.current) return;
    seededRef.current = true;
    if (hasLearnerPickupLocation(learner)) {
      setAddress(learner.pick_up_location ?? "");
      setAddressLat(learner.address_lat!);
      setAddressLng(learner.address_lng!);
    }
  }, [learner]);

  // Initialize Autocomplete when the component mounts
  useEffect(() => {
    if (!inputRef.current || !places || autocompleteRef.current) return;
    autocompleteRef.current = new places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: "IN" },
      fields: ["address_components", "formatted_address", "geometry"],
    });

    autocompleteRef.current.addListener("place_changed", () => {
      const place = autocompleteRef.current?.getPlace();
      if (!place?.formatted_address || !place.geometry?.location) return;

      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      setAddressLat(lat);
      setAddressLng(lng);
      setAddress(place.formatted_address);
    });

    return () => {
      if (autocompleteRef.current) {
        google.maps.event.clearInstanceListeners(autocompleteRef.current);
        autocompleteRef.current = null;
      }
    };
  }, [places]);

  const onCameraChanged = useCallback((ev: MapEvent) => {
    const center = ev.map.getCenter();
    if (!center) return;
    const lat = center.lat();
    const lng = center.lng();
    setAddressLat(lat);
    setAddressLng(lng);

    // Reverse geocode to keep the address text in sync with the pin.
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      if (status === "OK" && results?.[0]) {
        setAddress(results[0].formatted_address);
      }
    });
  }, []);

  const onContinue = useCallback(async () => {
    // The user might type a random string instead of selecting an address.
    if (isPending) return;
    if (
      !address ||
      !hasLearnerPickupLocation({
        address_lat: addressLat,
        address_lng: addressLng,
      })
    ) {
      toast({
        title: "Pickup location required",
        description:
          "Please select a valid address or the nearest landmark from the search bar",
        variant: "destructive",
      });
      return;
    }

    updateLearner(
      {
        pick_up_location: address,
        address_lat: addressLat,
        address_lng: addressLng,
      },
      {
        onSuccess: () => {
          // Demos skip licence/start-date questions, but still select timings.
          navigate(
            isDemoFlow
              ? "/createSchedule/preferences?type=new"
              : "/createSchedule/onboardingQuestions",
          );
        },
        onError: (error) => {
          toast({
            title: "Error updating profile",
            description:
              error instanceof Error ? error.message : "An error occurred",
            variant: "destructive",
          });
        },
      },
    );
  }, [
    address,
    navigate,
    updateLearner,
    addressLat,
    addressLng,
    toast,
    isDemoFlow,
    isPending,
  ]);

  return (
    <div className="flex h-full w-full flex-col rounded-md">
      <div className="flex flex-col rounded-b-[40px] bg-primary">
        <div className="flex items-center justify-between p-4">
          <Button
            type="button"
            aria-label="Back to learner home"
            disabled={!learner?.id}
            variant="ghost"
            size="icon"
            className="text-primary-foreground"
            onClick={() =>
              navigate("/home", {
                replace: true,
                state: { scheduleSetupReturnFor: learner?.id },
              })
            }
          >
            <ArrowLeft className="h-6 w-6" />
          </Button>
          <span className="text-lg font-semibold text-primary-foreground">
            1/4
          </span>
        </div>
        <div className="relative z-10 rounded-b-[40px] bg-primary p-6 text-primary-foreground">
          <h1 className="mb-1 text-xl font-semibold">Pick-up location</h1>
          <p className="">Our instructor&apos;s will meet you here</p>
        </div>
      </div>

      <div className="scrollbar-hide flex-1 overflow-y-auto bg-white p-6">
        <div className="mt-4 w-full space-y-4">
          <div className="flex w-full flex-col gap-1">
            <Label htmlFor="input1">Address</Label>
            <Input
              id="input1"
              type="text"
              placeholder="Start typing your address..."
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setAddressLat(undefined);
                setAddressLng(undefined);
              }}
              ref={inputRef}
            />
          </div>
          {addressLat !== undefined && addressLng !== undefined && (
            <div className="relative w-full overflow-hidden rounded-lg border border-gray-200">
              <Map
                defaultZoom={17}
                defaultCenter={{ lat: addressLat, lng: addressLng }}
                center={{ lat: addressLat, lng: addressLng }}
                gestureHandling="greedy"
                disableDefaultUI={false}
                style={mapContainerStyle}
                onCameraChanged={(e) => {
                  setAddressLat(e.detail.center.lat);
                  setAddressLng(e.detail.center.lng);
                }}
                onDragend={onCameraChanged}
              />
              <div style={markerStyle}>
                <MapPin
                  className="h-8 w-8 text-black"
                  strokeWidth={1}
                  fill="hsl(var(--primary))"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 border-t bg-white p-4">
        <Button
          className="w-full"
          onClick={() => onContinue()}
          disabled={
            isPending ||
            !address ||
            !hasLearnerPickupLocation({
              address_lat: addressLat,
              address_lng: addressLng,
            })
          }
        >
          {isPending ? "Saving..." : "Continue"}
        </Button>
      </div>
    </div>
  );
}
