"use client";

import { useEffect, useId, useState } from "react";
import { SITE_STATUS_LEGEND } from "@/src/features/sites/status";

export interface StatusLegendProps {
  className?: string;
  surveyPointCount?: number;
}

export function StatusLegend({
  className = "",
  surveyPointCount = 0,
}: StatusLegendProps) {
  const panelId = useId();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 640px)");
    setIsOpen(media.matches);
  }, []);

  return (
    <aside
      aria-label="Site status legend"
      className={`pointer-events-auto max-w-[calc(100vw-1.5rem)] rounded-xl border border-[#CFDDE0] bg-[#FAFCFC]/95 text-[#0F292E] shadow-md backdrop-blur-sm ${className}`}
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <span className="text-xs font-semibold tracking-tight text-[#0F292E]">
          Site status
        </span>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setIsOpen((prev) => !prev)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-[#0D6E6E] transition-colors hover:bg-[#E7F1F2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D6E6E]"
        >
          <span>{isOpen ? "Hide" : "Legend"}</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
          >
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {isOpen && (
        <div id={panelId} className="border-t border-[#E2ECEE] px-3 py-2.5 text-xs">
          <ul className="space-y-1.5">
            {SITE_STATUS_LEGEND.map((item) => (
              <li
                key={item.value}
                data-status={item.value}
                className="flex items-center gap-2.5"
              >
                <span
                  aria-hidden="true"
                  className={`h-3.5 w-4 shrink-0 rounded-[3px] ${
                    item.isNeutral ? "no-data-swatch border-[1.5px] border-dashed" : "border"
                  }`}
                  style={{
                    backgroundColor: item.fillColor,
                    borderColor: item.strokeColor,
                  }}
                />
                <span className="font-medium text-[#0F292E]">{item.label}</span>
                <span className="ml-auto pl-2 text-[11px] text-[#436066] tabular-nums">
                  {item.value === "very_good" && "≥75%"}
                  {item.value === "good" && "50–74%"}
                  {item.value === "fair" && "25–49%"}
                  {item.value === "poor" && "<25%"}
                  {item.value === "no_data" && "Unassessed"}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-2.5 border-t border-[#E2ECEE] pt-2">
            <p className="mb-1.5 text-[11px] font-semibold text-[#436066]">
              Map layers
            </p>
            <ul className="space-y-1.5">
              <li
                data-layer="province-boundary"
                className="flex items-center gap-2.5"
              >
                <span
                  aria-hidden="true"
                  className="inline-block w-4 shrink-0 border-t-2 border-dashed border-[#2B4C8C]"
                />
                <span className="font-medium text-[#0F292E]">
                  Province boundary
                </span>
              </li>
              <li
                data-layer="survey-point"
                className="flex items-center gap-2.5"
              >
                <span
                  aria-hidden="true"
                  className="ml-0.5 inline-block h-3 w-3 shrink-0 rounded-full border-2 border-white bg-[#7E22CE] ring-1 ring-[#3B0764]/70"
                />
                <span className="font-medium text-[#0F292E]">Survey point</span>
                <span className="ml-auto pl-2 text-[11px] text-[#436066] tabular-nums">
                  {surveyPointCount > 0
                    ? `${surveyPointCount} plotted`
                    : "Selected site"}
                </span>
              </li>
            </ul>
          </div>
        </div>
      )}
    </aside>
  );
}
