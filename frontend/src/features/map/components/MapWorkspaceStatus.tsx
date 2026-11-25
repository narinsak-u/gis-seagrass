"use client";

import type { ViewportProvincesState } from "@/src/features/provinces/provinces-viewport";
import type { ViewportSitesState } from "@/src/features/sites/viewport";
import { StatusLegend } from "./StatusLegend";

interface MapWorkspaceStatusProps {
  siteState: ViewportSitesState;
  provinceState: ViewportProvincesState;
  siteCount: number;
  provinceCount: number;
  surveyPointCount: number;
  basemapNotice: string | null;
  onRetrySites: () => void;
  onResetView: () => void;
  onRetryProvinces: () => void;
}

export function MapWorkspaceStatus({
  siteState,
  provinceState,
  siteCount,
  provinceCount,
  surveyPointCount,
  basemapNotice,
  onRetrySites,
  onResetView,
  onRetryProvinces,
}: MapWorkspaceStatusProps) {
  return (
    <>
      {/* Top-left floating status & recovery overlays (leaves space for top-right map controls) */}
      <div className="pointer-events-none absolute top-3 left-3 z-10 flex max-w-[calc(100%-4.5rem)] flex-col gap-2 sm:max-w-sm">
        {siteState.status === "loading" && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-auto inline-flex w-fit items-center gap-2 rounded-xl border border-[#CFDDE0] bg-[#FAFCFC]/95 px-3 py-2 text-xs font-medium text-[#0F292E] shadow-sm backdrop-blur-sm"
          >
            <span
              aria-hidden="true"
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#0D6E6E]/25 border-t-[#0D6E6E]"
            />
            <span>Loading active sites in view…</span>
          </div>
        )}

        {siteState.status === "ready" && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-auto inline-flex w-fit items-center gap-2 rounded-xl border border-[#CFDDE0] bg-[#FAFCFC]/95 px-3 py-1.5 text-xs font-medium text-[#0F292E] shadow-sm backdrop-blur-sm tabular-nums"
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full bg-[#0B6E4F]"
            />
            <span>
              {siteCount} {siteCount === 1 ? "active site" : "active sites"} in view
            </span>
          </div>
        )}

        {siteState.status === "empty" && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-auto rounded-xl border border-[#CFDDE0] bg-[#FAFCFC]/96 px-3.5 py-2.5 text-xs text-[#0F292E] shadow-md backdrop-blur-sm"
          >
            <p className="font-semibold text-[#0F292E]">
              No active sites in this view
            </p>
            <p className="mt-0.5 text-[#436066]">
              Pan or zoom toward the coast to browse monitored seagrass beds.
            </p>
            <button
              type="button"
              onClick={onResetView}
              className="mt-2 rounded-lg bg-[#0D6E6E] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#095252] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D6E6E]"
            >
              Return to coastal view
            </button>
          </div>
        )}

        {siteState.status === "invalid" && (
          <div
            role="alert"
            className="pointer-events-auto rounded-xl border border-[#E5B8AF] bg-[#FFF8F6]/98 px-3.5 py-2.5 text-xs text-[#5E1E11] shadow-md backdrop-blur-sm"
          >
            <p className="font-semibold">Invalid map viewport</p>
            <button
              type="button"
              onClick={onResetView}
              className="mt-2 rounded-lg bg-[#8F2F1B] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#702313] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8F2F1B]"
            >
              Return to coast
            </button>
          </div>
        )}

        {siteState.status === "error" && siteState.error && (
          <div
            role="alert"
            className="pointer-events-auto rounded-xl border border-[#E5B8AF] bg-[#FFF8F6]/98 px-3.5 py-2.5 text-xs text-[#5E1E11] shadow-md backdrop-blur-sm"
          >
            <p className="font-semibold">Unable to load sites for this area</p>
            <p className="mt-0.5 text-[#7A2D1D]">{siteState.error.message}</p>
            <button
              type="button"
              onClick={onRetrySites}
              className="mt-2 rounded-lg bg-[#8F2F1B] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#702313] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8F2F1B]"
            >
              Retry request
            </button>
          </div>
        )}

        {provinceState.status === "loading" && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-auto inline-flex w-fit items-center gap-2 rounded-xl border border-[#CBD6EA] bg-[#FAFCFC]/95 px-3 py-1.5 text-xs font-medium text-[#1E3A6D] shadow-sm backdrop-blur-sm"
          >
            <span
              aria-hidden="true"
              className="h-3 w-3 animate-spin rounded-full border-2 border-[#2B4C8C]/25 border-t-[#2B4C8C]"
            />
            <span>Loading province boundaries…</span>
          </div>
        )}

        {provinceState.status === "ready" && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-auto inline-flex w-fit items-center gap-2 rounded-xl border border-[#CBD6EA] bg-[#FAFCFC]/95 px-3 py-1.5 text-xs font-medium text-[#1E3A6D] shadow-sm backdrop-blur-sm tabular-nums"
          >
            <span
              aria-hidden="true"
              className="inline-block w-4 border-t-2 border-dashed border-[#2B4C8C]"
            />
            <span>
              {provinceCount} {provinceCount === 1 ? "province" : "provinces"} in view
            </span>
          </div>
        )}

        {provinceState.status === "empty" && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-auto inline-flex w-fit items-center gap-2 rounded-xl border border-[#CFDDE0] bg-[#FAFCFC]/95 px-3 py-1.5 text-xs text-[#436066] shadow-sm backdrop-blur-sm"
          >
            <span
              aria-hidden="true"
              className="inline-block w-4 border-t-2 border-dashed border-[#8CA0AE]"
            />
            <span>No province boundaries in view</span>
          </div>
        )}

        {provinceState.status === "error" && provinceState.error && (
          <div
            role="alert"
            className="pointer-events-auto rounded-xl border border-[#D8CBE8] bg-[#FAF8FF]/98 px-3.5 py-2.5 text-xs text-[#312456] shadow-md backdrop-blur-sm"
          >
            <p className="font-semibold">Province boundaries unavailable</p>
            <p className="mt-0.5 text-[#4B3A7A]">{provinceState.error.message}</p>
            <button
              type="button"
              onClick={onRetryProvinces}
              className="mt-2 rounded-lg bg-[#2B4C8C] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#1E3A6D] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2B4C8C]"
            >
              Retry provinces
            </button>
          </div>
        )}

        {basemapNotice && (
          <div
            role="status"
            className="pointer-events-auto rounded-xl border border-[#E4D3A3] bg-[#FFFBF0]/95 px-3 py-2 text-xs text-[#6B4E08] shadow-sm"
          >
            {basemapNotice}
          </div>
        )}
      </div>

      {/* Bottom-left status legend — elevated slightly on narrow mobile screens so MapLibre attribution at bottom-right stays unobstructed */}
      <div className="pointer-events-none absolute bottom-10 left-3 z-10 sm:bottom-3 sm:left-3">
        <StatusLegend surveyPointCount={surveyPointCount} />
      </div>
    </>
  );
}
