"use client";

import type { ReactNode } from "react";

interface SitesWorkspacePanelProps {
  isMobilePanelOpen: boolean;
  hasSelectedSite: boolean;
  matchedCount: number;
  onToggleMobilePanel: () => void;
  children: ReactNode;
}

export function SitesWorkspacePanel({
  isMobilePanelOpen,
  hasSelectedSite,
  matchedCount,
  onToggleMobilePanel,
  children,
}: SitesWorkspacePanelProps) {
  return (
    <aside
      aria-label="Synchronized site list and details"
      className={`z-10 flex w-full max-w-full flex-col overflow-hidden border-t border-[#CFDDE0] bg-[#FAFCFC] lg:h-full lg:w-[420px] lg:shrink-0 lg:border-t-0 lg:border-l xl:w-[450px] ${
        isMobilePanelOpen
          ? hasSelectedSite
            ? "h-[58%]"
            : "h-[48%]"
          : "h-auto"
      }`}
    >
      {/* Mobile collapsible header bar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#CFDDE0] bg-[#F4F8F9] px-3 py-2 lg:hidden">
        <span className="text-xs font-semibold text-[#0F292E] tabular-nums">
          Sites in view ({matchedCount})
        </span>
        <button
          type="button"
          aria-expanded={isMobilePanelOpen}
          onClick={onToggleMobilePanel}
          className="rounded-md border border-[#CFDDE0] bg-white px-2.5 py-1 text-xs font-medium text-[#0D6E6E] transition-colors hover:bg-[#E7F1F2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D6E6E]"
        >
          {isMobilePanelOpen ? "Hide list" : "Show list"}
        </button>
      </div>

      <div
        className={`${
          isMobilePanelOpen ? "flex" : "hidden lg:flex"
        } min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden`}
      >
        {children}
      </div>
    </aside>
  );
}
