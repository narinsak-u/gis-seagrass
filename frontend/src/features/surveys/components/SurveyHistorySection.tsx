"use client";

import type { SiteDetailFeature } from "@/src/features/sites/types";
import type { SurveyHistoryState } from "../types";

export interface SurveyHistorySectionProps {
  site: SiteDetailFeature;
  historyState: SurveyHistoryState;
  onRequestSignIn: () => void;
  onLoadMore: () => void;
  onRetry: () => void;
}

const COVER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

function formatCreator(createdBy: string | null): string {
  if (!createdBy) return "Imported";
  if (createdBy.length <= 13) return createdBy;
  return `${createdBy.slice(0, 8)}…${createdBy.slice(-4)}`;
}

export function SurveyHistorySection({
  site,
  historyState,
  onRequestSignIn,
  onLoadMore,
  onRetry,
}: SurveyHistorySectionProps) {
  const { status, items, total, hasMore, isPartialCoverage, error } = historyState;
  const remainingCount = Math.max(0, total - items.length);

  return (
    <section
      aria-label="Survey history"
      data-testid="survey-history-section"
      className="space-y-2.5 text-xs text-[#0F292E]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-white bg-[#7E22CE] ring-1 ring-[#3B0764]/60"
          />
          <h3 className="text-xs font-semibold text-[#0F292E]">
            Survey history
          </h3>
        </div>

        {items.length > 0 && (
          <span
            data-testid="survey-history-count"
            className="rounded-full bg-[#F3E8FF] px-2 py-0.5 text-[11px] font-medium text-[#581C87] tabular-nums"
          >
            {items.length} of {total} loaded
          </span>
        )}
      </div>

      {status === "unauthenticated" && (
        <div
          data-testid="survey-history-signin-prompt"
          className="rounded-lg border border-[#CFDDE0] bg-[#FAFCFC] p-3"
        >
          <p className="font-medium text-[#0F292E]">
            Protected survey records
          </p>
          <p className="mt-1 leading-relaxed text-[#436066]">
            Sign in with a viewer, editor, or admin account to view survey
            history and plot observation locations for {site.properties.code}.
          </p>
          <button
            type="button"
            onClick={onRequestSignIn}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-[#0D6E6E] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#095252] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D6E6E]"
          >
            Sign in to view Survey history
          </button>
        </div>
      )}

      {(status === "forbidden" || status === "unauthorized_role") && (
        <div
          role="alert"
          data-testid="survey-history-forbidden"
          className="rounded-lg border border-[#E5B8AF] bg-[#FFF8F6] p-3 text-[#5E1E11]"
        >
          <p className="font-semibold">Survey history access restricted</p>
          <p className="mt-0.5 text-[#7A2D1D]">
            {error?.message ??
              "Your account role does not have permission to view survey history."}
          </p>
        </div>
      )}

      {status === "loading" && (
        <div
          role="status"
          aria-live="polite"
          data-testid="survey-history-loading"
          className="space-y-2"
        >
          <div className="flex items-center gap-2 rounded-lg border border-[#E2ECEE] bg-[#FAFCFC] px-3 py-2 text-[#436066]">
            <span
              aria-hidden="true"
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#7E22CE]/25 border-t-[#7E22CE]"
            />
            <span>Loading survey history…</span>
          </div>
          <div
            aria-hidden="true"
            className="space-y-2 rounded-lg border border-[#E2ECEE] bg-[#FAFCFC] p-2.5"
          >
            <div className="h-3 w-2/5 animate-pulse rounded bg-[#DCE7EA]" />
            <div className="h-2.5 w-4/5 animate-pulse rounded bg-[#E7F0F2]" />
          </div>
        </div>
      )}

      {status === "empty" && (
        <div
          role="status"
          aria-live="polite"
          data-testid="survey-history-empty"
          className="rounded-lg border border-[#E2ECEE] bg-[#FAFCFC] p-3 text-[#436066]"
        >
          <p className="font-medium text-[#0F292E]">
            No surveys recorded for this site yet
          </p>
          <p className="mt-0.5">
            No protected survey observations or map points exist for{" "}
            {site.properties.code}.
          </p>
        </div>
      )}

      {status === "error" && items.length === 0 && error && (
        <div
          role="alert"
          data-testid="survey-history-error"
          className="rounded-lg border border-[#E5B8AF] bg-[#FFF8F6] p-3 text-[#5E1E11]"
        >
          <p className="font-semibold">Unable to load survey history</p>
          <p className="mt-0.5 text-[#7A2D1D]">{error.message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded-lg bg-[#8F2F1B] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#702313] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8F2F1B]"
          >
            Retry
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-2.5">
          {isPartialCoverage ? (
            <div
              role="status"
              aria-live="polite"
              data-testid="survey-history-partial-coverage"
              className="rounded-lg border border-[#E5D4F7] bg-[#FAF5FF] px-2.5 py-2 text-[11px] leading-relaxed text-[#581C87]"
            >
              Showing {items.length} of {total} surveys on map — load more pages
              to plot remaining points.
            </div>
          ) : (
            <p
              data-testid="survey-history-complete-coverage"
              className="text-[11px] text-[#436066]"
            >
              All {items.length}{" "}
              {items.length === 1 ? "survey point" : "survey points"} plotted on
              the map for {site.properties.code}.
            </p>
          )}

          <ol
            aria-label={`Survey history for ${site.properties.code}`}
            data-testid="survey-history-list"
            className="space-y-2"
          >
            {items.map((item) => (
              <li
                key={item.id}
                data-survey-id={item.id}
                className="rounded-lg border border-[#E2ECEE] bg-[#FAFCFC] p-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="font-semibold text-[#0F292E] tabular-nums">
                      {item.surveyed_on}
                    </span>
                    <span className="truncate text-[11px] text-[#5C777D]">
                      {item.survey_ref ?? `#${item.id}`}
                    </span>
                  </div>
                  <span className="shrink-0 rounded-full bg-[#E8F4F4] px-2 py-0.5 text-[11px] font-medium text-[#0B5555] tabular-nums">
                    {COVER_FORMATTER.format(item.cover_percent)}% cover
                  </span>
                </div>

                <dl className="mt-2 grid grid-cols-1 gap-y-1.5 text-[11px] sm:grid-cols-2 sm:gap-x-3">
                  <div className="min-w-0">
                    <dt className="text-[#5C777D]">Coordinates (lon, lat)</dt>
                    <dd className="mt-0.5 truncate font-medium text-[#0F292E] tabular-nums">
                      {item.lon.toFixed(4)}, {item.lat.toFixed(4)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[#5C777D]">Recorded by</dt>
                    <dd
                      title={item.created_by ?? "Imported seed survey"}
                      className="mt-0.5 truncate font-medium text-[#0F292E]"
                    >
                      {formatCreator(item.created_by)}
                    </dd>
                  </div>
                </dl>

                <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
                  <span className="text-[#5C777D]">Species:</span>
                  {item.species.length > 0 ? (
                    item.species.map((code) => (
                      <span
                        key={code}
                        className="rounded border border-[#CFDDE0] bg-white px-1.5 py-0.5 text-[10px] font-medium text-[#0F292E]"
                      >
                        {code}
                      </span>
                    ))
                  ) : (
                    <span className="text-[#436066]">Not recorded</span>
                  )}
                </div>

                {item.note && (
                  <p className="mt-1.5 break-words text-[11px] leading-relaxed text-[#436066]">
                    {item.note}
                  </p>
                )}
              </li>
            ))}
          </ol>

          {status === "error" && error && (
            <div
              role="alert"
              data-testid="survey-history-load-more-error"
              className="rounded-lg border border-[#E5B8AF] bg-[#FFF8F6] p-2.5 text-[#5E1E11]"
            >
              <p className="font-semibold">Unable to load more surveys</p>
              <p className="mt-0.5 text-[#7A2D1D]">{error.message}</p>
              <button
                type="button"
                onClick={onRetry}
                className="mt-2 rounded-lg bg-[#8F2F1B] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#702313] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8F2F1B]"
              >
                Retry
              </button>
            </div>
          )}

          {(hasMore || status === "loading_more") && (
            <button
              type="button"
              disabled={status === "loading_more"}
              onClick={onLoadMore}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#CFDDE0] bg-white px-3 py-1.5 text-xs font-medium text-[#0F292E] transition-colors hover:bg-[#E7F1F2] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D6E6E]"
            >
              {status === "loading_more" ? (
                <>
                  <span
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#7E22CE]/25 border-t-[#7E22CE]"
                  />
                  <span>Loading more surveys…</span>
                </>
              ) : (
                <span>
                  Load more surveys ({remainingCount} remaining)
                </span>
              )}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
