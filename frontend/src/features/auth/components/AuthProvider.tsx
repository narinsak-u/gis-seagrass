"use client";

import { useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { surveyQueryKeys } from "@/src/features/surveys/hooks/survey-history-query";
import { registerSurveyCacheCleanup } from "../auth-store";

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  useEffect(
    () => registerSurveyCacheCleanup(() => {
      void queryClient.cancelQueries({ queryKey: surveyQueryKeys.all });
      queryClient.removeQueries({ queryKey: surveyQueryKeys.all });
    }),
    [queryClient],
  );

  return children;
}
