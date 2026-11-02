import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures";
import { publishStringsViaApi } from "../helpers/api";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

test("real CLI push → batch translation → temporary review → atomic publication", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const created = await page.request.post("/api/projects", {
    data: {
      name: `CLI workspace ${Date.now()}`,
      base_language: "vi",
      target_languages: ["en", "ja"],
      layout: "flat",
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const project = await created.json();
  const root = `/api/projects/${project.slug}`;
  const existing = [];
  for (const key of ["login.title", "login.submit"]) {
    const response = await page.request.post(`${root}/strings`, {
      data: {
        key,
        source_text: "Đăng nhập",
        translations: { en: "Log in", ja: "ログイン" },
      },
    });
    expect(response.ok()).toBeTruthy();
    existing.push(await response.json());
  }
  await publishStringsViaApi(
    page,
    project.slug,
    existing.map((item) => item.id),
  );
  const keyResponse = await page.request.post(`${root}/api-keys`, {
    data: { name: "Browser CLI test" },
  });
  expect(keyResponse.ok()).toBeTruthy();
  const apiKey = (await keyResponse.json()).key;
  const directory = mkdtempSync(path.join(os.tmpdir(), "xlocale-workspace-"));
  try {
    mkdirSync(path.join(directory, ".x-locale"));
    mkdirSync(path.join(directory, "locales"));
    writeFileSync(
      path.join(directory, ".x-locale/config.yaml"),
      JSON.stringify({
        api_url: `http://127.0.0.1:${process.env.E2E_BACKEND_PORT ?? 8001}`,
        api_key: apiKey,
        project_slug: project.slug,
        output_dir: "locales",
        layout: "flat",
        base_language: "vi",
        stage: "draft",
      }),
      { mode: 0o600 },
    );
    writeFileSync(
      path.join(directory, "locales/vi.json"),
      JSON.stringify({
        "login.title": "Đăng nhập bằng email",
        "login.submit": "Tiếp tục",
        "login.email": "Địa chỉ email",
      }),
    );
    execFileSync(
      path.join(repo, "cli/.venv/bin/python"),
      ["-m", "x_locale_cli", "push"],
      {
        cwd: directory,
        env: { ...process.env, PYTHONPATH: path.join(repo, "cli") },
        stdio: "pipe",
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  await page.goto(`/projects/${project.slug}/activity`);
  const review = page.getByRole("link", { name: "Review this batch" }).first();
  await expect(review).toBeVisible();
  await review.click();
  await expect(page).toHaveURL(/\/batches\//);
  await expect(
    page.getByRole("heading", { name: "CLI push batch" }),
  ).toBeVisible();
  await expect(
    page.getByText("1 new · 2 updated", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Translate all", exact: true })
    .click();
  await expect(
    page.getByText("Translations are ready for review.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator('[aria-current="step"]')).toContainText("Review");
  const before = await page.request.get(
    `${root}/export?stage=public&locale=en`,
  );
  expect((await before.json()).en["login.title"]).toBe("Log in");
  const english = page.getByRole("textbox", {
    name: "EN translation for login.title",
    exact: true,
  });
  const savedBefore = await page.request.get(
    `${root}/strings/${existing[0].id}`,
  );
  expect(
    (await savedBefore.json()).translations.find(
      (t: { locale: string }) => t.locale === "en",
    ).value,
  ).toBe("Log in");
  // Abandon generation through reload: nothing is saved or resumed.
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(english).toHaveValue("Log in");
  await page
    .getByRole("button", { name: "Translate all", exact: true })
    .click();
  await expect(
    page.getByText("Translations are ready for review.", { exact: false }),
  ).toBeVisible();
  // Leaving uses the app dialog; cancelling keeps the temporary content.
  const generated = await english.inputValue();
  await page
    .getByRole("link", { name: "Activity", exact: true })
    .first()
    .click();
  const leaveDialog = page.getByRole("alertdialog", {
    name: "Leave this workflow?",
  });
  await expect(leaveDialog).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("batch-leave-dialog.png"),
  });
  await expect(
    leaveDialog.getByRole("button", { name: "Keep reviewing" }),
  ).toBeFocused();
  await leaveDialog.getByRole("button", { name: "Keep reviewing" }).click();
  await expect(english).toHaveValue(generated);
  await page
    .getByRole("link", { name: "Activity", exact: true })
    .first()
    .click();
  await leaveDialog.getByRole("button", { name: "Discard and leave" }).click();
  await expect(
    page.getByRole("heading", { name: "Activity", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Review this batch" }).first().click();
  await expect(english).toHaveValue("Log in");
  await page
    .getByRole("button", { name: "Translate all", exact: true })
    .click();
  await expect(
    page.getByText("Translations are ready for review.", { exact: false }),
  ).toBeVisible();
  await english.fill("Log in with email");
  await page.keyboard.press("Tab");
  const stillSaved = await page.request.get(
    `${root}/strings/${existing[0].id}`,
  );
  expect(
    (await stillSaved.json()).translations.find(
      (t: { locale: string }) => t.locale === "en",
    ).value,
  ).toBe("Log in");
  await page
    .getByRole("heading", { name: "CLI push batch", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("batch-review-light.png"),
    fullPage: true,
  });
  const publish = page.getByRole("button", { name: /Publish batch/ });
  await publish.click();
  await expect(
    page.getByText("Batch saved and published.", { exact: false }),
  ).toBeVisible();
  expect(await page.getByRole("dialog").count()).toBe(0);
  await expect(page.locator('[aria-current="step"]')).toHaveCount(0);
  await expect(
    page.getByText("Batch published", { exact: true }),
  ).toBeVisible();
  const after = await page.request.get(`${root}/export?stage=public&locale=en`);
  expect((await after.json()).en["login.title"]).toBe("Log in with email");

  // A later competing edit cannot be published using the already-rendered fingerprint.
  const row = existing.find((item) => item.key === "login.title");
  await page.request.patch(`${root}/strings/${row.id}`, {
    data: { translations: { en: "Competing edit" } },
  });
  await page.reload();
  await expect(publish).toBeEnabled();
  await page.request.patch(`${root}/strings/${row.id}`, {
    data: { translations: { en: "Newest edit" } },
  });
  await publish.click();
  await expect(
    page.getByText("The batch changed. Nothing was saved.", { exact: false }),
  ).toBeVisible();
  const unchanged = await page.request.get(
    `${root}/export?stage=public&locale=en`,
  );
  expect((await unchanged.json()).en["login.title"]).toBe("Log in with email");
  await expect(publish).toBeDisabled();
  await page.getByRole("button", { name: "Restart workflow" }).click();
  await page
    .getByRole("alertdialog", { name: "Restart this workflow?" })
    .getByRole("button", { name: "Discard and restart" })
    .click();
  await expect(english).toHaveValue("Newest edit");
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(
    page.getByText("Batch saved and published.", { exact: false }),
  ).toBeVisible();
  const republished = await page.request.get(
    `${root}/export?stage=public&locale=en`,
  );
  expect((await republished.json()).en["login.title"]).toBe("Newest edit");
  // Both appearances and a narrow screen retain usable fields and no horizontal overflow.
  await page
    .getByRole("heading", { name: "CLI push batch", exact: true })
    .scrollIntoViewIfNeeded();
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({
    path: testInfo.outputPath("batch-review-dark.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(english).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await english.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("batch-review-mobile-fields.png"),
  });
  await page
    .getByRole("heading", { name: "CLI push batch", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("batch-review-mobile.png"),
    fullPage: true,
  });
});
