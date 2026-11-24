"use client";

import { useId } from "react";
import { SITE_STATUS_LEGEND, type SiteStatus } from "./status";
import {
  hasActiveSiteFilters,
  type ProvinceOption,
  type SiteFilterCriteria,
} from "./filtering";

export interface SiteFiltersProps {
  filters: SiteFilterCriteria;
  provinceOptions: readonly ProvinceOption[];
  matchedCount: number;
  totalInView: number;
  isLoading: boolean;
  onChange: (next: SiteFilterCriteria) => void;
  onClear: () => void;
}

export function SiteFilters({
  filters,
  provinceOptions,
  matchedCount,
  totalInView,
  isLoading,
  onChange,
  onClear,
}: SiteFiltersProps) {
  const searchId = useId();
  const provinceId = useId();
  const statusId = useId();
  const filtersActive = hasActiveSiteFilters(filters);

  return (
    <section
      aria-label="Filter sites in map view"
      className="shrink-0 border-b border-[#CFDDE0] bg-[#FAFCFC] px-3 py-2.5 sm:px-4"
    >
      <div className="space-y-2">
        <div>
          <label
            htmlFor={searchId}
            className="mb-1 block text-xs font-medium text-[#0F292E]"
          >
            Search sites
          </label>
          <div className="relative">
            <input
              id={searchId}
              type="search"
              value={filters.search}
              onChange={(event) =>
                onChange({ ...filters, search: event.target.value })
              }
              placeholder="Site code or name"
              autoComplete="off"
              className="w-full rounded-lg border border-[#CFDDE0] bg-white px-2.5 py-1.5 text-xs text-[#0F292E] placeholder:text-[#6B858B] focus-visible:border-[#0D6E6E] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#0D6E6E]"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="min-w-0">
            <label
              htmlFor={provinceId}
              className="mb-1 block text-xs font-medium text-[#0F292E]"
            >
              Province
            </label>
            <select
              id={provinceId}
              value={filters.province}
              onChange={(event) =>
                onChange({ ...filters, province: event.target.value })
              }
              className="w-full min-w-0 rounded-lg border border-[#CFDDE0] bg-white px-2 py-1.5 text-xs text-[#0F292E] focus-visible:border-[#0D6E6E] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#0D6E6E]"
            >
              <option value="">All provinces</option>
              {provinceOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label
              htmlFor={statusId}
              className="mb-1 block text-xs font-medium text-[#0F292E]"
            >
              Site status
            </label>
            <select
              id={statusId}
              value={filters.siteStatus}
              onChange={(event) =>
                onChange({
                  ...filters,
                  siteStatus: event.target.value as SiteStatus | "",
                })
              }
              className="w-full min-w-0 rounded-lg border border-[#CFDDE0] bg-white px-2 py-1.5 text-xs text-[#0F292E] focus-visible:border-[#0D6E6E] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#0D6E6E]"
            >
              <option value="">All statuses</option>
              {SITE_STATUS_LEGEND.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-xs">
          <p className="text-[#436066] tabular-nums" aria-live="polite">
            {isLoading && totalInView === 0
              ? "Loading viewport sites…"
              : filtersActive
                ? `${matchedCount} of ${totalInView} in view`
                : `${totalInView} ${totalInView === 1 ? "site" : "sites"} in view`}
          </p>

          {filtersActive && (
            <button
              type="button"
              onClick={onClear}
              className="rounded-md px-2 py-0.5 text-xs font-medium text-[#0D6E6E] transition-colors hover:bg-[#E7F1F2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D6E6E]"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
