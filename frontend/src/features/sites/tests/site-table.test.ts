import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SiteTable } from "../components/SiteTable";

it("offers recovery instead of indefinite loading for an invalid map viewport", () => {
  const html = renderToStaticMarkup(createElement(SiteTable, {
    features: [],
    page: 1,
    pageSize: 10,
    selectedSiteCode: null,
    viewportStatus: "invalid",
    viewportError: null,
    hasActiveFilters: false,
    onSelectRow: () => {},
    onPageChange: () => {},
    onClearFilters: () => {},
    onRetry: () => {},
    onResetView: () => {},
  }));

  expect(html).toContain('role="alert"');
  expect(html).toContain("Invalid map viewport");
  expect(html).toContain("Return to coast");
  expect(html).not.toContain("Loading active sites in map view");
});
