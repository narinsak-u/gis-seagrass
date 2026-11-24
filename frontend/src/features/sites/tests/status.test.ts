import { describe, expect, it } from "vitest";
import {
  SITE_STATUS_VALUES,
  SITE_STATUS_LEGEND,
  buildSiteStatusFillExpression,
  buildSiteStatusStrokeExpression,
  getSiteStatusMeta,
} from "../status";

describe("siteStatus scale and legend metadata", () => {
  it("defines the exact five API siteStatus values in ordered legend sequence", () => {
    expect(SITE_STATUS_VALUES).toEqual([
      "very_good",
      "good",
      "fair",
      "poor",
      "no_data",
    ]);
    expect(SITE_STATUS_LEGEND.map((item) => item.value)).toEqual(["very_good", "good", "fair", "poor", "no_data"]);
  });

  it("assigns distinct colors to every status and marks no_data as a distinct neutral style", () => {
    const fills = SITE_STATUS_LEGEND.map((item) => item.fillColor.toLowerCase());
    expect(new Set(fills).size).toBe(5);

    const noData = getSiteStatusMeta("no_data");
    const poor = getSiteStatusMeta("poor");
    expect(noData.isNeutral).toBe(true);
    expect(poor.isNeutral).toBe(false);
    expect(noData.fillColor.toLowerCase()).not.toBe(poor.fillColor.toLowerCase());
    expect(noData.strokeColor.toLowerCase()).not.toBe(poor.strokeColor.toLowerCase());
  });

  it("builds MapLibre match expressions covering all five API values with no_data fallback", () => {
    const fillExpr = buildSiteStatusFillExpression();
    expect(fillExpr[0]).toBe("match");
    expect(fillExpr[1]).toEqual(["get", "siteStatus"]);
    expect(fillExpr[fillExpr.length - 1]).toBe(getSiteStatusMeta("no_data").fillColor);

    const strokeExpr = buildSiteStatusStrokeExpression();
    expect(strokeExpr[0]).toBe("match");
    expect(strokeExpr[1]).toEqual(["get", "siteStatus"]);
    expect(strokeExpr[strokeExpr.length - 1]).toBe(getSiteStatusMeta("no_data").strokeColor);

    for (const status of SITE_STATUS_VALUES) {
      const fillIdx = (fillExpr as unknown as unknown[]).indexOf(status);
      expect(fillIdx, `Expected ${status} in fill expression`).toBeGreaterThanOrEqual(2);
      expect(fillExpr[fillIdx + 1]).toBe(getSiteStatusMeta(status).fillColor);
    }
  });
});
