import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { apiClient } from "@/src/lib/api";
import type { BboxBounds } from "../types";
import { createViewportDebouncer, formatBbox, isValidBboxBounds, normalizeBboxBounds, siteViewportQueryOptions } from "../viewport";

describe("Site viewport bounds", () => {

  it("keys bounded requests by province and cancels the prior viewport Query", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const previousAdapter = apiClient.defaults.adapter;
    const signals: { aborted: boolean }[] = [];
    apiClient.defaults.adapter = async (config) => {
      if (config.signal) signals.push(config.signal);
      return new Promise<never>(() => {});
    };
    const observer = new QueryObserver(
      client,
      siteViewportQueryOptions("98,7,99,8", "92"),
    );
    const unsubscribe = observer.subscribe(() => {});
    try {
      expect(siteViewportQueryOptions("98,7,99,8", "92").queryKey).toEqual([
        "sites",
        "viewport",
        "98,7,99,8",
        "92",
        "active",
      ]);
      await vi.waitFor(() => expect(signals).toHaveLength(1));
      observer.setOptions(siteViewportQueryOptions("98.5,7.5,99,8", "92"));
      await vi.waitFor(() => expect(signals[0].aborted).toBe(true));
    } finally {
      unsubscribe();
      client.clear();
      apiClient.defaults.adapter = previousAdapter;
    }
  });

  it("settles only the latest bounds after the 250 ms debounce", () => {
    vi.useFakeTimers();
    const onSettle = vi.fn();
    const debouncer = createViewportDebouncer(onSettle);
    const first = { minLon: 98, minLat: 7, maxLon: 99, maxLat: 8 };
    const latest = { minLon: 98.5, minLat: 7.5, maxLon: 99.5, maxLat: 8.5 };
    try {
      debouncer.schedule(first);
      vi.advanceTimersByTime(200);
      debouncer.schedule(latest);
      vi.advanceTimersByTime(249);
      expect(onSettle).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onSettle).toHaveBeenCalledOnce();
      expect(onSettle).toHaveBeenCalledWith(latest);
    } finally {
      debouncer.cancel();
      vi.useRealTimers();
    }
  });
  it("formats valid bounds in deterministic minLon,minLat,maxLon,maxLat order", () => {
    expect(formatBbox({
      minLon: 98.1234567,
      minLat: 7.05,
      maxLon: 99.6,
      maxLat: 9.0342091,
    })).toBe("98.123457,7.05,99.6,9.034209");
  });

  it("normalizes finite coordinates to six decimals", () => {
    expect(normalizeBboxBounds({
      minLon: 98.1234567,
      minLat: 7.05,
      maxLon: 99.6,
      maxLat: 9.0342091,
    })).toEqual({
      minLon: 98.123457,
      minLat: 7.05,
      maxLon: 99.6,
      maxLat: 9.034209,
    });
  });

  it.each([
    { minLon: -180, minLat: -90, maxLon: 180, maxLat: 90 },
    { minLon: 99, minLat: 7, maxLon: 98, maxLat: 8 },
    { minLon: 98, minLat: 7, maxLon: 99, maxLat: 7 },
    { minLon: Number.NaN, minLat: 7, maxLon: 99, maxLat: 8 },
    { minLon: -181, minLat: 7, maxLon: 99, maxLat: 8 },
  ] satisfies BboxBounds[])("rejects invalid or unbounded bounds: %o", (bounds) => {
    expect(isValidBboxBounds(bounds)).toBe(false);
  });

  it("accepts a bounded WGS84 viewport", () => {
    expect(isValidBboxBounds({
      minLon: 98,
      minLat: 7,
      maxLon: 99,
      maxLat: 8,
    })).toBe(true);
  });
});
