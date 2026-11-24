"use client";

import { useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { surveyQueryKeys } from "@/src/features/surveys/hooks/survey-history-query";
import { subscribeToAuthStore, useAuthStore } from "../auth-store";

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);

  useEffect(() => subscribeToAuthStore(), []);
  useEffect(() => {
    if (!token) queryClient.removeQueries({ queryKey: surveyQueryKeys.all });
  }, [queryClient, token]);

  return children;
}
