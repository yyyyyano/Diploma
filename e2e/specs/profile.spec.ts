// «Что ассистент знает обо мне» (PROF-05, AUTH-07, P5): свой пользователь → анкета пропущена и больше не показывается →
// пустая страница с «Не указано · Указать» → факт указан в окне формы → удалён сразу с «Отменить» → возвращён. axe 0
// нарушений WCAG 2.2 AA и нет горизонтальной прокрутки при 1440 и 390: пусто, окно формы, список фактов.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { holdUndoToast } from "./support/undo-toast.ts";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

/** Окна и списки Mantine появляются с переходом прозрачности: axe посреди перехода видит бледный текст. */
async function animationsSettled(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );
}

async function accessibleAtBothWidths(page: Page) {
  const problems: unknown[] = [];
  for (const size of VIEWPORTS) {
    await page.setViewportSize(size);
    await animationsSettled(page);
    const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    for (const v of result.violations) {
      problems.push({
        width: size.width,
        id: v.id,
        targets: v.nodes.map((n) => n.target.join(" ")),
      });
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    if (overflow > 0) problems.push({ width: size.width, overflow });
  }
  await page.setViewportSize(VIEWPORTS[0]);
  return problems;
}

test("«Что ассистент знает обо мне»: указать, удалить и вернуть факт; axe 0 при 1440 и 390", async ({
  page,
}) => {
  const email = `profile-${String(Date.now())}@example.test`;
  const password = "кошт2026профиль";
  await page.goto("/register");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByLabel("Повторите пароль").fill(password);
  await page.getByRole("checkbox", { name: /согласен/ }).check();
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  // AUTH-07: анкету можно пропустить целиком — второй раз она не показывается.
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: "Пропустить анкету" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/home$/);

  // PROF-05: пусто — что здесь будет; ключи PROF-01 — «Не указано · Указать».
  await page.goto("/memory");
  await expect(
    page.getByRole("heading", { level: 1, name: "Что ассистент знает обо мне" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Ассистент пока ничего о вас не знает" }),
  ).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // Указать факт — форма по ключу; axe с открытым окном.
  await page.getByRole("button", { name: "Указать: Многодетная семья" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await dialog.getByText("Нет", { exact: true }).click();
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Запомнил: Многодетная семья")).toBeVisible();
  const family = page.getByRole("region", { name: "Семья и дети" });
  await expect(family.getByText("указано вами")).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // PROF-05, P5: удалить — сразу; «Отменить» возвращает факт.
  await page.getByRole("button", { name: "Удалить: Многодетная семья" }).click();
  const undoRemove = await holdUndoToast(page, "Удалил: Многодетная семья");
  await expect(family.getByText("указано вами")).toHaveCount(0);
  await undoRemove.click();
  await expect(family.getByText("указано вами")).toBeVisible();
});
