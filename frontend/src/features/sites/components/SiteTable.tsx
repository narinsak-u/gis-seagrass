"use client";

import { useEffect, useRef } from "react";
import { getSiteStatusMeta } from "../status";
import {
  formatProvinceLabel,
  paginateItems,
  type ProvinceNameLookup,
} from "../filtering";
import type { SiteFeature } from "../types";
import type { ViewportErrorInfo, ViewportLoadStatus } from "../viewport";

export interface SiteTableProps {
  features: readonly SiteFeature[];
  page: number;
  pageSize: number;
  selectedSiteCode: string | null;
  viewportStatus: ViewportLoadStatus;
  viewportError: ViewportErrorInfo | null;
  hasActiveFilters: boolean;
  provinceNames?: ProvinceNameLookup;
  onSelectRow: (feature: SiteFeature) => void;
  onPageChange: (page: number) => void;
  onClearFilters: () => void;
  onResetView: () => void;
}

const AREA_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

export function SiteTable({
  features,
  page,
  pageSize,
  selectedSiteCode,
  viewportStatus,
  viewportError,
  hasActiveFilters,
  provinceNames,
  onSelectRow,
  onPageChange,
  onClearFilters,
  onRetry,
  onResetView,
}: SiteTableProps) {
  const selectedRowRef = useRef<HTMLTableRowElement | null>(null);
  const paginated = paginateItems(features, page, pageSize);

  useEffect(() => {
    if (selectedSiteCode && selectedRowRef.current) {
      selectedRowRef.current.scrollIntoView({
        block: "nearest",
      });
    }
  }, [selectedSiteCode, paginated.page]);


  if (viewportStatus === "invalid") {
    return (
      <div
        role="alert"
        className="m-3 rounded-xl border border-[#E5B8AF] bg-[#FFF8F6] p-3.5 text-xs text-[#5E1E11]"
      >
        <p className="font-semibold">Invalid map viewport</p>
        <p className="mt-1 text-[#7A2D1D]">Return to the coast to load sites.</p>
        <button
          type="button"
          onClick={onResetView}
          className="mt-2.5 rounded-lg bg-[#8F2F1B] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#702313] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8F2F1B]"
        >
          Return to coast
        </button>
      </div>
    );
  }
  if (viewportStatus === "error" && viewportError) {
    return (
      <div
        role="alert"
        className="m-3 rounded-xl border border-[#E5B8AF] bg-[#FFF8F6] p-3.5 text-xs text-[#5E1E11]"
      >
        <p className="font-semibold">Unable to load sites for this map view</p>
        <p className="mt-1 text-[#7A2D1D]">{viewportError.message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2.5 rounded-lg bg-[#8F2F1B] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#702313] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8F2F1B]"
        >
          Retry
        </button>
      </div>
    );
  }

  if (
    (viewportStatus === "idle" || viewportStatus === "loading") &&
    features.length === 0
  ) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-xs text-[#436066]"
      >
        <span
          aria-hidden="true"
          className="h-5 w-5 animate-spin rounded-full border-2 border-[#0D6E6E]/25 border-t-[#0D6E6E]"
        />
        <p className="font-medium text-[#0F292E]">
          Loading active sites in map view…
        </p>
      </div>
    );
  }

  if (features.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="px-4 py-7 text-center text-xs text-[#436066]"
      >
        {hasActiveFilters ? (
          <>
            <p className="font-semibold text-[#0F292E]">
              No sites match the current filters
            </p>
            <p className="mt-1">
              Change or clear your search, province, or status filter to browse
              sites in this viewport.
            </p>
            <button
              type="button"
              onClick={onClearFilters}
              className="mt-3 rounded-lg bg-[#0D6E6E] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#095252] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D6E6E]"
            >
              Clear filters
            </button>
          </>
        ) : (
          <>
            <p className="font-semibold text-[#0F292E]">
              No active sites in this map view
            </p>
            <p className="mt-1">
              Pan or zoom the map toward Thailand&apos;s coastline to see
              monitored seagrass sites.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:min-h-0 lg:flex-1">
      <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        <table
          aria-label="Active sites in map view"
          className="w-full table-fixed border-collapse text-left text-xs"
        >
          <thead className="sticky top-0 z-10 border-b border-[#CFDDE0] bg-[#EEF4F5] text-[11px] font-semibold text-[#436066]">
            <tr>
              <th scope="col" className="py-2 pl-3 pr-2 sm:pl-4">
                Site
              </th>
              <th scope="col" className="hidden w-24 px-2 py-2 sm:table-cell">
                Province
              </th>
              <th
                scope="col"
                className="hidden w-20 px-2 py-2 text-right sm:table-cell"
              >
                Area (rai)
              </th>
              <th scope="col" className="w-24 py-2 pl-2 pr-3 text-right sm:w-28 sm:pr-4">
                Status
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[#E2ECEE] bg-[#FAFCFC]">
            {paginated.items.map((feature) => {
              const props = feature.properties;
              const isSelected = selectedSiteCode === props.code;
              const statusMeta = getSiteStatusMeta(props.siteStatus);
              const provinceLabel = formatProvinceLabel(
                props.province_code,
                provinceNames,
              );

              return (
                <tr
                  key={props.code}
                  ref={isSelected ? selectedRowRef : null}
                  data-site-code={props.code}
                  data-selected={isSelected ? "true" : "false"}
                  aria-current={isSelected ? "true" : undefined}
                  onClick={() => onSelectRow(feature)}
                  className={`cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-[#E2F2F0] shadow-[inset_3px_0_0_0_#0D6E6E]"
                      : "hover:bg-[#F0F6F7]"
                  }`}
                >
                  <td className="py-2 pl-3 pr-2 align-middle sm:pl-4">
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      aria-label={`Select site ${props.code}, ${props.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectRow(feature);
                      }}
                      className="block w-full rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D6E6E]"
                    >
                      <span className="block truncate font-semibold text-[#0F292E]">
                        {props.code}
                      </span>
                      <span className="block truncate text-[11px] text-[#436066]">
                        {props.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-[#5C777D] sm:hidden">
                        {provinceLabel}, {AREA_FORMATTER.format(props.area_rai)} rai
                      </span>
                    </button>
                  </td>

                  <td
                    className="hidden truncate px-2 py-2 align-middle text-[#436066] sm:table-cell"
                    title={provinceLabel}
                  >
                    {provinceLabel}
                  </td>

                  <td className="hidden px-2 py-2 text-right align-middle text-[#436066] tabular-nums sm:table-cell">
                    {AREA_FORMATTER.format(props.area_rai)}
                  </td>

                  <td className="py-2 pl-2 pr-3 text-right align-middle sm:pr-4">
                    <span
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{
                        backgroundColor: statusMeta.badgeBg,
                        color: statusMeta.badgeText,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          statusMeta.isNeutral
                            ? "border border-dashed"
                            : ""
                        }`}
                        style={{
                          backgroundColor: statusMeta.fillColor,
                          borderColor: statusMeta.strokeColor,
                        }}
                      />
                      <span className="truncate">{statusMeta.label}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <nav
        aria-label="Site table pagination"
        className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[#CFDDE0] bg-[#F4F8F9] px-3 py-2 text-xs sm:px-4"
      >
        <div className="flex items-center gap-2 text-[#436066] tabular-nums">
          <span>
            {paginated.startIndex}–{paginated.endIndex} of {paginated.totalItems}
          </span>
          {viewportStatus === "loading" && (
            <span className="text-[11px] text-[#0D6E6E]" role="status">
              Updating…
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Previous page"
            disabled={paginated.page <= 1}
            onClick={() => onPageChange(paginated.page - 1)}
            className="rounded-md border border-[#CFDDE0] bg-white px-2.5 py-1 text-xs font-medium text-[#0F292E] transition-colors hover:bg-[#E7F1F2] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D6E6E]"
          >
            Previous
          </button>

          <span className="px-1 text-[11px] font-medium text-[#436066] tabular-nums">
            Page {paginated.page} of {paginated.totalPages}
          </span>

          <button
            type="button"
            aria-label="Next page"
            disabled={paginated.page >= paginated.totalPages}
            onClick={() => onPageChange(paginated.page + 1)}
            className="rounded-md border border-[#CFDDE0] bg-white px-2.5 py-1 text-xs font-medium text-[#0F292E] transition-colors hover:bg-[#E7F1F2] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D6E6E]"
          >
            Next
          </button>
        </div>
      </nav>
    </div>
  );
}
