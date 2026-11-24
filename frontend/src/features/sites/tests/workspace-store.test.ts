import { describe, expect, it } from "vitest";
import { useSitesWorkspaceStore } from "../state/workspace-store";

const initialFilters = {
  province: "",
  siteStatus: "",
  search: "",
};

describe("sites workspace state", () => {
  it("updates shared filters and resets the viewport page", () => {
    useSitesWorkspaceStore.getState().setCurrentPage(3);
    useSitesWorkspaceStore.getState().setFilters({
      province: "92",
      siteStatus: "poor",
      search: "trg",
    });

    expect(useSitesWorkspaceStore.getState().filters).toEqual({
      province: "92",
      siteStatus: "poor",
      search: "trg",
    });
    expect(useSitesWorkspaceStore.getState().currentPage).toBe(1);
  });

  it("clears selected Site and resets filters on workspace reset", () => {
    useSitesWorkspaceStore.getState().setFilters({
      province: "92",
      siteStatus: "poor",
      search: "trg",
    });
    useSitesWorkspaceStore.getState().selectSite("TRG-001");
    useSitesWorkspaceStore.getState().setCurrentPage(2);
    useSitesWorkspaceStore.getState().reset();

    expect(useSitesWorkspaceStore.getState()).toMatchObject({
      filters: initialFilters,
      currentPage: 1,
      selectedSiteCode: null,
    });
  });
});
