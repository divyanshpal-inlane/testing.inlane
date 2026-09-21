import { memo, useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { loadMapsApi } from "@/lib/sales-dashboard/maps";

interface AddressAutocompleteProps {
  value: string;
  onChange: (address: string, lat: number | null, lng: number | null) => void;
  placeholder?: string;
  className?: string;
}

export const AddressAutocomplete = memo(
  ({
    value,
    onChange,
    placeholder = "Search address...",
    className = "",
  }: AddressAutocompleteProps) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(
      null,
    );
    const [internalValue, setInternalValue] = useState(value);
    const [maps, setMaps] = useState<typeof google.maps | null>(null);

    useEffect(() => {
      setInternalValue(value);
    }, [value]);

    useEffect(() => {
      let active = true;
      void loadMapsApi().then((m) => {
        if (active) setMaps(m);
      });
      return () => {
        active = false;
      };
    }, []);

    useEffect(() => {
      if (!inputRef.current || !maps) return;

      autocompleteRef.current = new maps.places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: "IN" },
        fields: ["formatted_address", "geometry"],
      });

      const listener = autocompleteRef.current.addListener(
        "place_changed",
        () => {
          const place = autocompleteRef.current?.getPlace();

          if (place?.geometry?.location) {
            const addr = place.formatted_address || "";
            const lat = place.geometry.location.lat();
            const lng = place.geometry.location.lng();

            setInternalValue(addr);
            onChange(addr, lat, lng);
          }
        },
      );

      return () => {
        if (listener) google.maps.event.removeListener(listener);
      };
    }, [maps, onChange]);

    const handleManualTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setInternalValue(val);
      onChange(val, null, null);
    };

    return (
      <Input
        ref={inputRef}
        value={internalValue}
        onChange={handleManualTyping}
        placeholder={placeholder}
        autoComplete="off"
        className={className}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
      />
    );
  },
);

AddressAutocomplete.displayName = "AddressAutocomplete";
