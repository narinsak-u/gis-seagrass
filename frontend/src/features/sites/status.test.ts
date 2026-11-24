import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SITE_STATUS_VALUES,
  SITE_STATUS_LEGEND,
  buildSiteStatusFillExpression,
  buildSiteStatusStrokeExpression,
  getSiteStatusMeta,
} from "./status";

describe("siteStatus scale and legend metadata", () => {
  it("defines the exact five API siteStatus values in ordered legend sequence", () => {
    assert.deepEqual(SITE_STATUS_VALUES, [
      "very_good",
      "good",
      "fair",
      "poor",
      "no_data",
    ]);
    assert.deepEqual(
      SITE_STATUS_LEGEND.map((item) => item.value),
      ["very_good", "good", "fair", "poor", "no_data"],
    );
  });

  it("assigns distinct colors to every status and marks no_data as a distinct neutral style", () => {
    const fills = SITE_STATUS_LEGEND.map((item) => item.fillColor.toLowerCase());
    assert.equal(new Set(fills).size, 5);

    const noData = getSiteStatusMeta("no_data");
    const poor = getSiteStatusMeta("poor");
    assert.equal(noData.isNeutral, true);
    assert.equal(poor.isNeutral, false);
    assert.notEqual(noData.fillColor.toLowerCase(), poor.fillColor.toLowerCase());
    assert.notEqual(noData.strokeColor.toLowerCase(), poor.strokeColor.toLowerCase());
  });

  it("builds MapLibre match expressions covering all five API values with no_data fallback", () => {
    const fillExpr = buildSiteStatusFillExpression();
    assert.equal(fillExpr[0], "match");
    assert.deepEqual(fillExpr[1], ["get", "siteStatus"]);
    assert.equal(fillExpr[fillExpr.length - 1], getSiteStatusMeta("no_data").fillColor);

    const strokeExpr = buildSiteStatusStrokeExpression();
    assert.equal(strokeExpr[0], "match");
    assert.deepEqual(strokeExpr[1], ["get", "siteStatus"]);
    assert.equal(strokeExpr[strokeExpr.length - 1], getSiteStatusMeta("no_data").strokeColor);

    for (const status of SITE_STATUS_VALUES) {
      const fillIdx = fillExpr.indexOf(status);
      assert.ok(fillIdx >= 2, `Expected ${status} in fill expression`);
      assert.equal(fillExpr[fillIdx + 1], getSiteStatusMeta(status).fillColor);
    }
  });
});
