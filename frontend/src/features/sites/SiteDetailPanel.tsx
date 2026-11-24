"use client";

import type { ReactNode } from "react";
import { getSiteStatusMeta } from "./status";
import { formatProvinceLabel, type ProvinceNameLookup } from "./filtering";
import type { SiteDetailState } from "./detail";
import type { SiteDetailFeature, SiteFeature } from "./types";

export interface SiteDetailPanelProps {
  selectedFeature: SiteFeature | null;
  detailState: SiteDetailState;
  provinceNames?: ProvinceNameLookup;
  onClose: () => void;
  onRetry: () => void;
  /** Extension slot for Ticket 05 protected Survey history. */
  renderSurveyHistory?: (site: SiteDetailFeature) => ReactNode;
}

const AREA_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const COVER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

export function SiteDetailPanel({
  selectedFeature,
  detailState,
  provinceNames,
  onClose,
  onRetry,
  renderSurveyHistory,
}: SiteDetailPanelProps) {
  if (!detailState.selectedCode) {
    return null;
  }

  const detail = detailState.data;
  const displayProps = detail?.properties ?? selectedFeature?.properties ?? null;
  const statusMeta = displayProps
    ? getSiteStatusMeta(displayProps.siteStatus)
    : null;

  return (
    <section
      aria-label="Site detail"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
        }
      }}
      className="order-first shrink-0 border-b border-[#CFDDE0] bg-white px-3.5 py-3 text-xs text-[#0F292E] sm:px-4 lg:order-last lg:max-h-[48%] lg:overflow-y-auto lg:border-t-2 lg:border-b-0 lg:border-t-[#0D6E6E]/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-[#0F292E]">
              {displayProps?.name ?? detailState.selectedCode}
            </h2>
            {statusMeta && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{
                  backgroundColor: statusMeta.badgeBg,
                  color: statusMeta.badgeText,
                }}
              >
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full ${
                    statusMeta.isNeutral ? "border border-dashed" : ""
                  }`}
                  style={{
                    backgroundColor: statusMeta.fillColor,
                    borderColor: statusMeta.strokeColor,
                  }}
                />
                {statusMeta.label}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-[#436066]">
            Code: <span className="font-medium text-[#0F292E]">{detailState.selectedCode}</span>
          </p>
        </div>

        <button
          type="button"
          aria-label="Close site detail"
          onClick={onClose}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#CFDDE0] bg-[#FAFCFC] px-2.5 py-1 text-xs font-medium text-[#0F292E] transition-colors hover:bg-[#E7F1F2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D6E6E]"
        >
          <span>Close</span>
        </button>
      </div>

      {detailState.status === "loading" && (
        <div
          role="status"
          aria-live="polite"
          className="mt-3 flex items-center gap-2 rounded-lg border border-[#E2ECEE] bg-[#FAFCFC] px-3 py-2.5 text-[#436066]"
        >
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#0D6E6E]/25 border-t-[#0D6E6E]"
          />
          <span>Loading site details…</span>
        </div>
      )}

      {detailState.status === "error" && detailState.error && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-[#E5B8AF] bg-[#FFF8F6] p-3 text-[#5E1E11]"
        >
          <p className="font-semibold">Unable to load site detail</p>
          <p className="mt-0.5 text-[#7A2D1D]">{detailState.error.message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded-lg bg-[#8F2F1B] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#702313] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8F2F1B]"
          >
            Retry
          </button>
        </div>
      )}

      {detailState.status === "ready" && detail && (
        <div className="mt-3 space-y-3">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-[#E2ECEE] bg-[#FAFCFC] p-2.5">
            <div>
              <dt className="text-[11px] text-[#436066]">Province</dt>
              <dd className="mt-0.5 font-medium text-[#0F292E]">
                {formatProvinceLabel(detail.properties.province_code, provinceNames)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-[#436066]">Area</dt>
              <dd className="mt-0.5 font-medium text-[#0F292E] tabular-nums">
                {AREA_FORMATTER.format(detail.properties.area_rai)} rai
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-[#436066]">Record version</dt>
              <dd className="mt-0.5 font-medium text-[#0F292E] tabular-nums">
                v{detail.properties.version}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-[#436066]">Assessment</dt>
              <dd className="mt-0.5 font-medium text-[#0F292E]">
                {getSiteStatusMeta(detail.properties.siteStatus).description}
              </dd>
            </div>
          </dl>

          <div className="rounded-lg border border-[#E2ECEE] bg-[#FAFCFC] p-2.5">
            <h3 className="text-xs font-semibold text-[#0F292E]">
              Latest survey
            </h3>

            {detail.properties.latest_survey ? (
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                <div>
                  <dt className="text-[11px] text-[#436066]">Surveyed on</dt>
                  <dd className="mt-0.5 font-medium text-[#0F292E] tabular-nums">
                    {detail.properties.latest_survey.surveyed_on}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-[#436066]">Seagrass cover</dt>
                  <dd className="mt-0.5 font-medium text-[#0F292E] tabular-nums">
                    {COVER_FORMATTER.format(detail.properties.latest_survey.cover_percent)}%
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[11px] text-[#436066]">Survey reference</dt>
                  <dd className="mt-0.5 font-medium text-[#0F292E]">
                    {detail.properties.latest_survey.survey_ref ?? "Not recorded"}
                  </dd>
                </div>
              </dl>
            ) : (
              <p
                data-testid="no-survey-data"
                className="mt-1.5 text-[#436066]"
              >
                No survey data recorded for this site yet.
              </p>
            )}
          </div>

          {renderSurveyHistory && (
            <div className="border-t border-[#E2ECEE] pt-3">
              {renderSurveyHistory(detail)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
