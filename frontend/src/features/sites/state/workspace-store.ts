import { create } from "zustand";
import { EMPTY_SITE_FILTERS, type SiteFilterCriteria } from "../filtering";

interface SitesWorkspaceState {
  filters: SiteFilterCriteria;
  currentPage: number;
  selectedSiteCode: string | null;
  setFilters: (filters: SiteFilterCriteria) => void;
  setCurrentPage: (page: number) => void;
  selectSite: (code: string | null) => void;
  reset: () => void;
}

export const useSitesWorkspaceStore = create<SitesWorkspaceState>((set) => ({
  filters: EMPTY_SITE_FILTERS,
  currentPage: 1,
  selectedSiteCode: null,
  setFilters: (filters) => set({ filters, currentPage: 1 }),
  setCurrentPage: (currentPage) => set({ currentPage }),
  selectSite: (selectedSiteCode) => set({ selectedSiteCode }),
  reset: () =>
    set({
      filters: EMPTY_SITE_FILTERS,
      currentPage: 1,
      selectedSiteCode: null,
    }),
}));
