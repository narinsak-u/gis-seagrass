import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { apiClient } from "@/src/lib/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { surveyHistoryQueryOptions } from "../hooks/survey-history-query";
import { mergeSurveyHistoryItems, type SurveyListItem } from "../types";
afterEach(() => vi.restoreAllMocks());

const survey = (id: string, surveyed_on: string): SurveyListItem => ({
  id, lon: 99, lat: 7, surveyed_on, cover_percent: 50,
  species: [], note: null, created_by: null,
});

describe("Survey history query", () => {
  it("keeps session epoch, Site code, and page size in keys without including token", async () => {
    const firstKey = surveyHistoryQueryOptions(
      "TRG-001", "first-token", 2, 10,
    ).queryKey;
    expect(firstKey).toEqual(["surveys", "history", 2, "TRG-001", 10]);
    expect(surveyHistoryQueryOptions(
      "TRG-001", "second-token", 2, 10,
    ).queryKey).toEqual(firstKey);
    expect(surveyHistoryQueryOptions(
      "TRG-001", "first-token", 3, 10,
    ).queryKey).not.toEqual(firstKey);
    expect(surveyHistoryQueryOptions(
      "TRG-001", "first-token", 2, 20,
    ).queryKey).not.toEqual(firstKey);
  });

  it("loads response pages in order and follows response pagination metadata", async () => {
    const requestedPages: number[] = [];
    const request = vi.spyOn(apiClient, "request").mockImplementation(async (config) => {
      const page = Number((config.params as { page: number }).page);
      requestedPages.push(page);
      return {
        status: 200,
        data: {
          items: [survey(String(page), "2025-03-08")],
          total: 23,
          page,
          pageSize: 10,
        },
      } as never;
    });
    const client = new QueryClient();
    const observer = new InfiniteQueryObserver(client, surveyHistoryQueryOptions(
      "TRG-001", "viewer-token", 1, 10,
    ));

    await observer.refetch();
    await observer.fetchNextPage();
    const result = observer.getCurrentResult();

    expect(result.data?.pages.map(({ page }) => page)).toEqual([1, 2]);
    expect(result.hasNextPage).toBe(true);
    expect(requestedPages).toEqual([1, 2]);
    observer.destroy();
    client.clear();
    request.mockRestore();
  });

  it("guards a late 401 with the request token and session epoch", async () => {
    let unauthorized: unknown[] = [];
    const request = vi.spyOn(apiClient, "request").mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 401,
        data: { error: { code: "UNAUTHORIZED", message: "expired" } },
      },
    });
    const client = new QueryClient();
    const observer = new InfiniteQueryObserver(client, surveyHistoryQueryOptions(
      "TRG-001",
      "old-token",
      4,
      10,
      (...args) => { unauthorized = args; },
    ));

    await observer.refetch();

    expect(unauthorized).toEqual(["expired", "old-token", 4]);
    observer.destroy();
    client.clear();
    request.mockRestore();
  });

  it("deduplicates overlapping pages in newest-first order for counts and points", () => {
    const merged = mergeSurveyHistoryItems([
      [survey("new", "2025-04-01"), survey("duplicate", "2025-03-01")],
      [survey("duplicate", "2025-03-01"), survey("old", "2025-02-01")],
    ]);
    expect(merged.map(({ id }) => id)).toEqual(["new", "duplicate", "old"]);
    expect(merged).toHaveLength(3);
  });
});
