import { expect, test } from "@playwright/test";

test("manifest is linked and installable-shaped", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", /^#/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /width=device-width/);

  const response = await request.get(href!);
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as {
    name: string;
    short_name: string;
    start_url: string;
    display: string;
    theme_color: string;
    background_color: string;
    icons: Array<{ src: string; sizes: string; purpose?: string }>;
  };
  expect(manifest.name).toContain("Garanti Kuluçka");
  expect(manifest.short_name.length).toBeLessThanOrEqual(12);
  expect(manifest.start_url).toBe("/");
  expect(manifest.display).toBe("standalone");
  expect(manifest.theme_color).toMatch(/^#/);
  expect(manifest.background_color).toMatch(/^#/);
  const sizes = manifest.icons.map((icon) => icon.sizes);
  expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  for (const icon of manifest.icons) {
    const iconResponse = await request.get(icon.src);
    expect(iconResponse.ok(), icon.src).toBe(true);
    expect(iconResponse.headers()["content-type"]).toContain("image/png");
  }
});

test("service worker registers, controls the page and serves the shell offline", async ({ page, context }) => {
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? null), { timeout: 20_000 })
    .toBe("activated");
  // clientsClaim: the open page becomes controlled without a reload.
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 20_000 }).toBe(true);

  const cacheNames = await page.evaluate(() => caches.keys());
  expect(cacheNames.some((name) => name.includes("precache"))).toBe(true);
  // Only static assets are precached; nothing from the backend.
  const cachedUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) urls.push(new URL(request.url).pathname);
    }
    return urls;
  });
  expect(cachedUrls).toEqual(expect.arrayContaining(["/index.html", "/manifest.webmanifest"]));
  expect(cachedUrls.filter((path) => /^\/(backend|api|auth|admin)\//.test(path))).toEqual([]);

  await context.setOffline(true);
  await page.goto("/siparisler");
  await expect(page.locator("#root")).not.toBeEmpty();
  await context.setOffline(false);
});
