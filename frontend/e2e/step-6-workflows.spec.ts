import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const accounts = {
  viewer: { email: process.env.E2E_VIEWER_EMAIL!, password: process.env.E2E_VIEWER_PASSWORD! },
  editor: { email: process.env.E2E_EDITOR_EMAIL!, password: process.env.E2E_EDITOR_PASSWORD! },
  admin: { email: process.env.E2E_ADMIN_EMAIL!, password: process.env.E2E_ADMIN_PASSWORD! },
} as const;

const siteCode = "TRG-001";
const statusLabels = {
  very_good: "Very good",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  no_data: "No data",
} as const;

const surveyLocation = {
  lon: 99.538168,
  lat: 7.330521,
  surveyed_on: "2026-11-23",
  species: ["TH"],
};

async function openWorkspace(page: Page) {
  await page.route("https://tiles.openfreemap.org/styles/liberty", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
    }),
  );
  const sitesResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/api/sites.geojson"),
  );
  await page.goto("/");
  const response = await sitesResponse;
  expect(response.ok()).toBeTruthy();
  const collection = await response.json();
  expect(collection.features.length).toBeGreaterThan(0);
  await expect(page.getByRole("region", { name: "Seagrass sites interactive map" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Active sites in map view" })).toBeVisible();
  return { collection, bbox: new URL(response.url()).searchParams.get("bbox") };
}

async function fillCredentials(dialog: Locator, role: keyof typeof accounts) {
  await dialog.getByLabel("Email").fill(accounts[role].email);
  await dialog.getByLabel("Password").fill(accounts[role].password);
}

async function signIn(page: Page, role: keyof typeof accounts) {
  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await fillCredentials(dialog, role);
  const identityResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/api/auth/me"),
  );
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await identityResponse).ok()).toBeTruthy();
  await expect(page.getByTestId("auth-identity")).toBeVisible();
  await expect(page.getByTestId("auth-role")).toHaveText(role);
}

async function apiToken(request: APIRequestContext, role: keyof typeof accounts) {
  const response = await request.post("/api/auth/login", { data: accounts[role] });
  expect(response.status()).toBe(200);
  return (await response.json()).access_token as string;
}

function polygonCenter(feature: {
  geometry: { coordinates: number[][][][] };
}): [number, number] {
  const ring = feature.geometry.coordinates[0][0];
  const points = ring.slice(0, -1);
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
}

async function siteCanvasPoint(page: Page, feature: Parameters<typeof polygonCenter>[0]) {
  const [lon, lat] = polygonCenter(feature);
  const canvas = page.getByRole("region", { name: "Seagrass sites interactive map" }).locator("canvas");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const worldPixels = 512 * 2 ** 7.4;
  const centerLat = (8.05 * Math.PI) / 180;
  const siteLat = (lat * Math.PI) / 180;
  const mercatorY = (value: number) => Math.log(Math.tan(Math.PI / 4 + value / 2));
  return {
    canvas,
    x: bounds!.x + bounds!.width / 2 + ((lon - 98.85) * worldPixels) / 360,
    y: bounds!.y + bounds!.height / 2 -
      ((mercatorY(siteLat) - mercatorY(centerLat)) * worldPixels) / (2 * Math.PI),
  };
}

async function sitePolygonIsInteractive(page: Page, feature: Parameters<typeof polygonCenter>[0]) {
  const point = await siteCanvasPoint(page, feature);
  await page.mouse.move(point.x, point.y);
  return point.canvas.evaluate((element) => (element as HTMLCanvasElement).style.cursor === "pointer");
}

async function clickSitePolygon(page: Page, feature: Parameters<typeof polygonCenter>[0]) {
  const point = await siteCanvasPoint(page, feature);
  await expect.poll(async () => {
    await page.mouse.move(point.x, point.y);
    return point.canvas.evaluate((element) => (element as HTMLCanvasElement).style.cursor);
  }, { timeout: 15_000 }).toBe("pointer");
  await page.mouse.click(point.x, point.y);
}

test("E2E-01 public map renders seeded Sites, polygons, and status legend", async ({ page }) => {
  const { collection } = await openWorkspace(page);
  expect(collection.features.some((feature: { geometry: unknown }) => feature.geometry)).toBeTruthy();
  await expect(page.getByRole("complementary", { name: "Site status legend" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
});

test("E2E-02 panning reaches Phang Nga and requests only bounded Site geometry", async ({ page }) => {
  const unboundedGeometryRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/api/sites.geojson") && !url.searchParams.has("bbox")) {
      unboundedGeometryRequests.push(request.url());
    }
  });
  const { bbox: initialBbox } = await openWorkspace(page);
  expect(initialBbox).toBeTruthy();
  const changedRequest = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/api/sites.geojson") && url.searchParams.get("bbox") !== initialBbox;
  });
  const canvas = page.getByRole("region", { name: "Seagrass sites interactive map" }).locator("canvas");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const startX = bounds!.x + bounds!.width / 2;
  const startY = bounds!.y + bounds!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 205, startY + 240, { steps: 5 });
  await page.mouse.up();
  const changed = await changedRequest;
  expect(changed.ok()).toBeTruthy();
  const changedUrl = new URL(changed.url());
  expect(changedUrl.searchParams.has("all")).toBeFalsy();
  const bbox = changedUrl.searchParams.get("bbox")!.split(",").map(Number);
  const collection = await changed.json();
  const target = collection.features.find((feature: { properties: { code: string } }) =>
    feature.properties.code === "PNA-004",
  );
  expect(target).toBeTruthy();
  const [lon, lat] = polygonCenter(target);
  expect(bbox).toHaveLength(4);
  expect(lon).toBeGreaterThanOrEqual(bbox[0]);
  expect(lon).toBeLessThanOrEqual(bbox[2]);
  expect(lat).toBeGreaterThanOrEqual(bbox[1]);
  expect(lat).toBeLessThanOrEqual(bbox[3]);
  expect(unboundedGeometryRequests).toEqual([]);
});

test("E2E-03 filtering synchronizes polygons and selecting a row zooms to the same Site", async ({ page }) => {
  test.setTimeout(60_000);
  const { collection, bbox: initialBbox } = await openWorkspace(page);
  const target = collection.features.find((feature: { properties: { code: string } }) =>
    feature.properties.code === siteCode,
  );
  const excluded = collection.features.find((feature: { properties: { code: string } }) =>
    feature.properties.code !== siteCode,
  );
  expect(target).toBeTruthy();
  expect(excluded).toBeTruthy();
  await expect.poll(() => sitePolygonIsInteractive(page, target), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => sitePolygonIsInteractive(page, excluded), { timeout: 15_000 }).toBe(true);
  const table = page.getByRole("table", { name: "Active sites in map view" });
  await page.getByRole("searchbox", { name: "Search sites" }).fill(siteCode);
  const row = table.getByRole("row").filter({ hasText: siteCode });
  await expect(row).toHaveCount(1);
  await expect.poll(() => sitePolygonIsInteractive(page, target), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => sitePolygonIsInteractive(page, excluded), { timeout: 15_000 }).toBe(false);
  const zoomedRequest = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/api/sites.geojson"),
  );
  await row.getByRole("button", { name: new RegExp(`Select site ${siteCode}`) }).click();
  const response = await zoomedRequest;
  expect(response.ok()).toBeTruthy();
  await expect(row).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("region", { name: "Site detail" })).toBeVisible();
  expect(initialBbox).not.toBe(new URL(response.url()).searchParams.get("bbox"));
});

test("E2E-09 375px workspace supports keyboard Site selection and detail", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openWorkspace(page);

  const table = page.getByRole("table", { name: "Active sites in map view" });
  await expect(table).toBeVisible();
  await page.getByRole("searchbox", { name: "Search sites" }).fill(siteCode);
  const siteButton = table.getByRole("button", { name: new RegExp(`Select site ${siteCode}`) });
  await expect(siteButton).toBeVisible();
  await siteButton.focus();
  await expect(siteButton).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(siteButton).toHaveAttribute("aria-pressed", "true");
  const detail = page.getByRole("region", { name: "Site detail" });
  await expect(detail).toBeVisible();
  await expect(detail.getByText(siteCode, { exact: true })).toBeVisible();
});

test("E2E-04 polygon detail shows Site identity and protected Survey history after viewer sign-in", async ({ page }) => {
  test.setTimeout(60_000);
  const { collection } = await openWorkspace(page);
  const feature = collection.features.find((candidate: { properties: { code: string } }) =>
    candidate.properties.code === siteCode,
  );
  expect(feature).toBeTruthy();
  await clickSitePolygon(page, feature);
  const detail = page.getByRole("region", { name: "Site detail" });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("heading", { name: feature.properties.name })).toBeVisible();
  await expect(detail.getByText(`Code: ${siteCode}`)).toBeVisible();
  await expect(detail.getByText(statusLabels[feature.properties.siteStatus as keyof typeof statusLabels], { exact: true })).toBeVisible();
  const history = page.getByTestId("survey-history-section");
  await expect(history.getByTestId("survey-history-signin-prompt")).toBeVisible();
  await history.getByRole("button", { name: "Sign in to view Survey history" }).click();
  const dialog = page.getByRole("dialog");
  await fillCredentials(dialog, "viewer");
  const identityResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/api/auth/me"),
  );
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await identityResponse).ok()).toBeTruthy();
  await expect(page.getByTestId("auth-role")).toHaveText("viewer");
  const historyList = history.getByRole("list", { name: `Survey history for ${siteCode}` });
  const retry = history.getByRole("button", { name: "Retry" });
  await expect(historyList.or(retry)).toBeVisible({ timeout: 15_000 });
  if (await retry.isVisible()) await retry.click();
  await expect(historyList).toBeVisible({ timeout: 15_000 });
});

test("E2E-05 viewer identity is shown, no write controls appear, and sign-out clears session", async ({ page }) => {
  await openWorkspace(page);
  await signIn(page, "viewer");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Create|Edit|Delete)( Site| Survey)?$/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByTestId("auth-identity")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});

test("E2E-08 changing accounts hides prior Survey history before new results load", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("searchbox", { name: "Search sites" }).fill(siteCode);
  await page.getByRole("button", { name: new RegExp(`Select site ${siteCode}`) }).click();
  const history = page.getByTestId("survey-history-section");
  let requestCount = 0;
  const { promise: editorRequestStarted, resolve: notifyEditorRequest } =
    Promise.withResolvers<void>();
  const { promise: editorResponseGate, resolve: releaseEditorRequest } =
    Promise.withResolvers<void>();
  await page.route(`**/api/sites/${siteCode}/surveys*`, async (route) => {
    requestCount += 1;
    const note = requestCount === 1 ? "VIEWER-SESSION-SURVEY" : "EDITOR-SESSION-SURVEY";
    if (requestCount > 1) {
      notifyEditorRequest();
      await editorResponseGate;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [{
          id: note,
          lon: surveyLocation.lon,
          lat: surveyLocation.lat,
          surveyed_on: surveyLocation.surveyed_on,
          cover_percent: 50,
          species: surveyLocation.species,
          note,
          created_by: null,
          survey_ref: null,
        }],
        total: 1,
        page: 1,
      }),
    });
  });

  await signIn(page, "viewer");
  await expect(history.getByText("VIEWER-SESSION-SURVEY", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(history.getByText("VIEWER-SESSION-SURVEY", { exact: true })).toHaveCount(0);

  await signIn(page, "editor");
  await editorRequestStarted;
  await expect(history.getByText("VIEWER-SESSION-SURVEY", { exact: true })).toHaveCount(0);
  releaseEditorRequest();
  await expect(history.getByText("EDITOR-SESSION-SURVEY", { exact: true })).toBeVisible();
});

test("E2E-06 admin Survey API write is visible in Site history UI", async ({ page, request }) => {
  const token = await apiToken(request, "admin");
  const note = `Playwright E2E ${Date.now()}`;
  const write = await request.post(`/api/sites/${siteCode}/surveys`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      ...surveyLocation,
      cover_percent: 63.21,
      note,
    },
  });
  expect(write.status()).toBe(201);
  await openWorkspace(page);
  await signIn(page, "admin");
  await page.getByRole("searchbox", { name: "Search sites" }).fill(siteCode);
  await page.getByRole("button", { name: new RegExp(`Select site ${siteCode}`) }).click();
  await expect(
    page.getByRole("region", { name: "Site detail" }).getByText(statusLabels.good, { exact: true }),
  ).toBeVisible();
  const history = page.getByTestId("survey-history-section");
  await expect(history.getByText(note, { exact: true })).toBeVisible({ timeout: 15_000 });
});

test("E2E-07 editor role is visible and admin-only Survey API write returns 403", async ({ page, request }) => {
  const token = await apiToken(request, "editor");
  await openWorkspace(page);
  await signIn(page, "editor");
  await expect(page.getByTestId("auth-identity")).toHaveAttribute(
    "aria-label",
    `Signed in as ${accounts.editor.email} (editor)`,
  );
  await expect(page.getByRole("button", { name: /^(Create|Edit|Delete)( Site| Survey)?$/ })).toHaveCount(0);
  const response = await request.post(`/api/sites/${siteCode}/surveys`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      ...surveyLocation,
      cover_percent: 60,
      note: `Rejected editor write ${Date.now()}`,
    },
  });
  expect(response.status()).toBe(403);
});
