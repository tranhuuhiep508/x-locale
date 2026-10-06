import { test, expect } from "@playwright/test";

test("overview coverage and pending edits open the matching catalog results", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
  const created = await page.request.post("/api/projects", {
    data: {
      name: `Overview ${Date.now()}`,
      base_language: "vi",
      target_languages: ["en", "ja"],
      layout: "flat",
    },
  });
  expect(created.status()).toBe(201);
  const { slug } = (await created.json()) as { slug: string };
  try {
    const first = await page.request.post(`/api/projects/${slug}/strings`, {
      data: {
        key: "hello",
        source_text: "Xin chào",
        status: "public",
        translations: { en: "Hello", ja: "こんにちは" },
      },
    });
    expect(first.status()).toBe(201);
    const { id } = (await first.json()) as { id: string };
    const second = await page.request.post(`/api/projects/${slug}/strings`, {
      data: {
        key: "goodbye",
        source_text: "Tạm biệt",
        translations: { ja: "さようなら" },
      },
    });
    expect(second.status()).toBe(201);
    const edited = await page.request.patch(
      `/api/projects/${slug}/strings/${id}`,
      { data: { source_text: "Xin chào bạn" } },
    );
    expect(edited.ok()).toBe(true);

    const overviewRequests: URL[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith(`/api/projects/${slug}/`))
        overviewRequests.push(url);
    });
    await page.goto(`/projects/${slug}`);
    await expect(
      page.getByRole("progressbar", { name: "English translation coverage" }),
    ).toHaveAttribute("aria-valuenow", "50");
    await expect(
      page.getByRole("progressbar", { name: "Japanese translation coverage" }),
    ).toHaveAttribute("aria-valuenow", "100");
    await expect(
      page.getByRole("link", { name: /Pending edits 1/ }),
    ).toBeVisible();

    expect(
      overviewRequests.filter((url) => url.pathname.endsWith("/coverage")),
    ).toHaveLength(1);
    expect(
      overviewRequests.some((url) => url.searchParams.has("missing_locale")),
    ).toBe(false);

    await page.getByRole("link", { name: "1 missing" }).click();
    await expect(page).toHaveURL(/missing_locale=en/);
    await expect(
      page.getByRole("row").filter({ hasText: "goodbye" }),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "hello" }),
    ).toHaveCount(0);

    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await page.getByRole("link", { name: /Pending edits 1/ }).click();
    await expect(page).toHaveURL(/has_unpublished_changes=true/);
    await expect(
      page.getByRole("row").filter({ hasText: "hello" }),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "goodbye" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Review publish changes" }),
    ).toBeVisible();
  } finally {
    await page.request.delete(`/api/projects/${slug}`);
  }
});
