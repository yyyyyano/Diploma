// Витрина дизайн-системы: axe 0 нарушений WCAG 2.2 AA при 1440 и 390 px, нет горизонтальной прокрутки, шрифты
// и стили — только со своего адреса (DES-09), панели и окна тоже проходят axe открытыми (CONSTRAINTS «Доступность»).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const VIEWPORTS = [
  { name: "компьютер 1440", width: 1440, height: 900 },
  { name: "телефон 390", width: 390, height: 844 },
] as const;

async function axeViolations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return result.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    targets: v.nodes.map((node) => node.target.join(" ")),
  }));
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/** Открывает витрину; собирает запросы на чужие адреса и пути загруженных шрифтов. */
async function openGallery(page: Page): Promise<{ foreign: string[]; fonts: string[] }> {
  const own = new URL(test.info().project.use.baseURL ?? "").origin;
  const foreign: string[] = [];
  const fonts: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "data:") return;
    if (url.origin !== own) foreign.push(request.url());
    else if (request.resourceType() === "font") fonts.push(url.pathname);
  });
  await page.goto("/dev/gallery");
  await expect(
    page.getByRole("heading", { level: 1, name: "Витрина дизайн-системы" }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return { foreign, fonts };
}

for (const viewport of VIEWPORTS) {
  test.describe(`витрина /dev/gallery — ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("axe: 0 нарушений, нет горизонтальной прокрутки", async ({ page }) => {
      await openGallery(page);
      expect(await axeViolations(page)).toEqual([]);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });

    test("DES-09: шрифт Onest — со своего адреса, ни одного запроса на чужие адреса", async ({
      page,
    }) => {
      const { foreign, fonts } = await openGallery(page);
      expect(foreign).toEqual([]);
      // Literata грузится только там, где есть текст закона (LawQuote, T-038): здесь — один Onest.
      expect(fonts.some((path) => /\/assets\/onest-.*\.woff2$/.test(path))).toBe(true);
      const onest = await page.evaluate(() => ({
        loaded: [...document.fonts].some(
          (f) => f.family.includes("Onest") && f.status === "loaded",
        ),
        body: getComputedStyle(document.body).fontFamily,
      }));
      expect(onest.loaded).toBe(true);
      expect(onest.body).toMatch(/^"?Onest Variable/);
    });

    test("открытая панель — axe 0, Esc закрывает и возвращает фокус", async ({ page }) => {
      await openGallery(page);
      const opener = page.getByRole("button", { name: "Открыть панель" });
      await opener.click();
      await expect(page.getByRole("dialog", { name: "Откуда эта цифра?" })).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(opener).toBeFocused();
    });

    test("подтверждение удаления — axe 0, кнопка-глагол", async ({ page }) => {
      await openGallery(page);
      await page.getByRole("button", { name: "Подтверждение удаления" }).click();
      const dialog = page.getByRole("dialog", { name: "Удалить 3 операции?" });
      await expect(dialog).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
      await dialog.getByRole("button", { name: "Да, удалить 3" }).click();
      await expect(page.getByText("Последнее действие: Удалено 3")).toBeVisible();
    });

    test("уведомление с отменой — axe 0, «Отменить» работает", async ({ page }) => {
      await openGallery(page);
      await page.getByRole("button", { name: "Уведомление с отменой" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Записал" })).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
      await page.getByRole("button", { name: "Отменить" }).click();
      await expect(page.getByText("Последнее действие: Отменено")).toBeVisible();
    });
  });
}

test.describe("витрина /dev/gallery — телефон 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("«Ещё» нижней панели открывает шторку разделов — axe 0", async ({ page }) => {
    await openGallery(page);
    await page.getByRole("button", { name: "Ещё разделы" }).click();
    await expect(page.getByRole("dialog", { name: "Все разделы" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});
