import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { surveyHistoryQueryOptions } from "../hooks/survey-history-query";

describe("Survey history query", () => {
  it("loads subsequent Survey pages with the bearer token", async () => {
    const requestedPages: string[] = [];
    const authHeaders: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      requestedPages.push(new URL(url, "http://localhost").searchParams.get("page") ?? "");
      authHeaders.push(new Headers(init?.headers).get("authorization") ?? "");
      const page = Number(new URL(url, "http://localhost").searchParams.get("page"));
      return new Response(JSON.stringify({
        items: [{
          id: String(page),
          lon: 99 + page,
          lat: 7,
          surveyed_on: "2025-03-08",
          cover_percent: 50,
          species: [],
          note: null,
          created_by: null,
        }],
        total: 23,
        page,
        pageSize: 10,
      }), { headers: { "content-type": "application/json" } });
    };
    const client = new QueryClient();
    const observer = new InfiniteQueryObserver(client, surveyHistoryQueryOptions(
      "TRG-001",
      "viewer-token",
      10,
      fetchImpl,
    ));

    await observer.refetch();
    await observer.fetchNextPage();
    const result = observer.getCurrentResult();

    expect(result.data?.pages.map(({ page }) => page)).toEqual([1, 2]);
    expect(result.hasNextPage).toBe(true);
    expect(requestedPages).toEqual(["1", "2"]);
    expect(authHeaders).toEqual(["Bearer viewer-token", "Bearer viewer-token"]);
    observer.destroy();
    client.clear();
  });
});
