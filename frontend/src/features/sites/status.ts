import type { ExpressionSpecification } from "maplibre-gl";

export const SITE_STATUS_VALUES = [
  "very_good",
  "good",
  "fair",
  "poor",
  "no_data",
] as const;

export type SiteStatus = (typeof SITE_STATUS_VALUES)[number];

export interface SiteStatusMeta {
  readonly value: SiteStatus;
  readonly label: string;
  readonly description: string;
  readonly fillColor: string;
  readonly strokeColor: string;
  readonly badgeBg: string;
  readonly badgeText: string;
  readonly isNeutral: boolean;
}

export const SITE_STATUS_META: Record<SiteStatus, SiteStatusMeta> = {
  very_good: {
    value: "very_good",
    label: "Very good",
    description: "Dense cover (75% or above)",
    fillColor: "#0B6E4F",
    strokeColor: "#064E38",
    badgeBg: "#E3F4EE",
    badgeText: "#064E38",
    isNeutral: false,
  },
  good: {
    value: "good",
    label: "Good",
    description: "Healthy cover (50% to 74%)",
    fillColor: "#3B9A63",
    strokeColor: "#226D43",
    badgeBg: "#E8F6EE",
    badgeText: "#1E603B",
    isNeutral: false,
  },
  fair: {
    value: "fair",
    label: "Fair",
    description: "Moderate cover (25% to 49%)",
    fillColor: "#D99B26",
    strokeColor: "#9A6B0E",
    badgeBg: "#FDF4E1",
    badgeText: "#7C5407",
    isNeutral: false,
  },
  poor: {
    value: "poor",
    label: "Poor",
    description: "Sparse cover (under 25%)",
    fillColor: "#C84B31",
    strokeColor: "#8F2F1B",
    badgeBg: "#FCECE8",
    badgeText: "#8F2F1B",
    isNeutral: false,
  },
  no_data: {
    value: "no_data",
    label: "No data",
    description: "No surveys recorded yet",
    fillColor: "#7A8A94",
    strokeColor: "#47555E",
    badgeBg: "#EDF1F3",
    badgeText: "#3C4B54",
    isNeutral: true,
  },
};

export const SITE_STATUS_LEGEND: readonly SiteStatusMeta[] = SITE_STATUS_VALUES.map(
  (status) => SITE_STATUS_META[status],
);

export function isSiteStatus(value: unknown): value is SiteStatus {
  return typeof value === "string" && value in SITE_STATUS_META;
}

export function getSiteStatusMeta(status: unknown): SiteStatusMeta {
  return isSiteStatus(status) ? SITE_STATUS_META[status] : SITE_STATUS_META.no_data;
}

export function buildSiteStatusFillExpression(): ExpressionSpecification {
  return [
    "match",
    ["get", "siteStatus"],
    "very_good",
    SITE_STATUS_META.very_good.fillColor,
    "good",
    SITE_STATUS_META.good.fillColor,
    "fair",
    SITE_STATUS_META.fair.fillColor,
    "poor",
    SITE_STATUS_META.poor.fillColor,
    "no_data",
    SITE_STATUS_META.no_data.fillColor,
    SITE_STATUS_META.no_data.fillColor,
  ];
}

export function buildSiteStatusStrokeExpression(): ExpressionSpecification {
  return [
    "match",
    ["get", "siteStatus"],
    "very_good",
    SITE_STATUS_META.very_good.strokeColor,
    "good",
    SITE_STATUS_META.good.strokeColor,
    "fair",
    SITE_STATUS_META.fair.strokeColor,
    "poor",
    SITE_STATUS_META.poor.strokeColor,
    "no_data",
    SITE_STATUS_META.no_data.strokeColor,
    SITE_STATUS_META.no_data.strokeColor,
  ];
}
