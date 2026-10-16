import React, { createContext, useContext } from "react";

import { useCurrentAdmin } from "@/queries/adminPermissions";

interface PhoneVisibilityContextType {
  canViewUnmaskedPhoneNumbers: boolean;
  canViewUnmaskedCarNumbers: boolean;
  isLoading: boolean;
}

const PhoneVisibilityContext = createContext<
  PhoneVisibilityContextType | undefined
>(undefined);

export function PhoneVisibilityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: currentAdmin, isLoading } = useCurrentAdmin();

  const canViewUnmaskedPhoneNumbers =
    currentAdmin?.is_super_admin ||
    currentAdmin?.permissions?.includes("view_unmasked_phone_numbers") ||
    false;

  const canViewUnmaskedCarNumbers =
    currentAdmin?.is_super_admin ||
    currentAdmin?.permissions?.includes("view_unmasked_car_numbers") ||
    false;

  const value: PhoneVisibilityContextType = {
    canViewUnmaskedPhoneNumbers,
    canViewUnmaskedCarNumbers,
    isLoading,
  };

  return (
    <PhoneVisibilityContext.Provider value={value}>
      {children}
    </PhoneVisibilityContext.Provider>
  );
}

export function usePhoneVisibility() {
  const context = useContext(PhoneVisibilityContext);
  if (context === undefined) {
    throw new Error(
      "usePhoneVisibility must be used within a PhoneVisibilityProvider",
    );
  }
  return context;
}
