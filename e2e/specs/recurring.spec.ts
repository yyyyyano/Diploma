// «Регулярные платежи» (REC-02, P5, DES-16): свой пользователь → пусто → «Добавить вручную» (окно) → платёж в разделе
// «Обязательные платежи» с итогом → «Отменить» убирает его → снова добавить → исправить сумму → пункт меню «Это не
// регулярный» с «Отменить». axe 0 нарушений WCAG 2.2 AA и нет горизонтальной прокрутки при 1440 и 390: пусто, окно, список,
// окно исправления. Найденные поиском платежи проверяют int-тесты на синтетической истории (операции в e2e не заводятся).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { shownSettled } from "./support/settled.ts";
import { holdUndoToast } from "./support/undo-toast.ts";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

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

test("«Регулярные платежи»: пусто, добавить вручную, «Отменить», исправить и исключить; axe 0 при 1440 и 390", async ({
  page,
}) => {
  const email = `recurring-${String(Date.now())}@example.test`;
  const password = "кошт2026регулярные";
  await page.goto("/register");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByLabel("Повторите пароль").fill(password);
  await page.getByRole("checkbox", { name: /согласен/ }).check();
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: "Пропустить анкету" }).click();
  await expect(page).toHaveURL(/\/accounts$/);

  // DES-16: пусто — что здесь будет и первый шаг.
  await page.goto("/recurring");
  const empty = page.getByRole("heading", { name: "Регулярных платежей пока нет" });
  await expect(empty).toBeVisible();
  await shownSettled(empty);
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // REC-02: добавить вручную — окно формы.
  await page.getByRole("button", { name: "Добавить вручную" }).first().click();
  const form = page.getByRole("dialog", { name: "Добавить регулярный платёж" });
  await expect(form).toBeVisible();
  await shownSettled(form);
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await form.getByRole("textbox", { name: "Получатель или название" }).fill("Аренда гаража");
  await form.getByRole("textbox", { name: "Сумма, BYN" }).fill("120,00");
  await form.getByRole("textbox", { name: "День" }).fill("30");
  await form.getByRole("button", { name: "Добавить", exact: true }).click();
  const undoAdd = await holdUndoToast(page, "«Аренда гаража» добавлен");
  const mandatory = page.getByRole("region", { name: "Обязательные платежи" });
  await expect(mandatory).toContainText("Аренда гаража");
  await expect(mandatory).toContainText(/120,00\sBYN/);

  // P5: «Отменить» убирает добавленный платёж.
  await undoAdd.click();
  await expect(page.getByText("Аренда гаража")).toHaveCount(0);

  // Снова добавить и исправить сумму.
  await page.getByRole("button", { name: "Добавить вручную" }).first().click();
  const again = page.getByRole("dialog", { name: "Добавить регулярный платёж" });
  await again.getByRole("textbox", { name: "Получатель или название" }).fill("Аренда гаража");
  await again.getByRole("textbox", { name: "Сумма, BYN" }).fill("120,00");
  await again.getByRole("textbox", { name: "День" }).fill("30");
  await again.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(mandatory).toContainText("Аренда гаража");
  await page.getByRole("button", { name: "Действия с платежом «Аренда гаража»" }).click();
  await page.getByRole("menuitem", { name: "Исправить сумму и дату" }).click();
  const edit = page.getByRole("dialog", { name: "Исправить: Аренда гаража" });
  await expect(edit).toBeVisible();
  await shownSettled(edit);
  await page.mouse.move(0, 0);
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await edit.getByRole("textbox", { name: "Сумма, BYN" }).fill("135,00");
  await edit.getByRole("button", { name: "Сохранить" }).click();
  await holdUndoToast(page, "«Аренда гаража» исправлен");
  await expect(mandatory).toContainText(/135,00\sBYN/);
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // REC-02: «Это не регулярный» — платёж уходит из списка, «Отменить» возвращает.
  await page.getByRole("button", { name: "Действия с платежом «Аренда гаража»" }).click();
  await page.getByRole("menuitem", { name: "Это не регулярный" }).click();
  const undoExclude = await holdUndoToast(page, "«Аренда гаража» больше не считается регулярным");
  await expect(page.getByText("Аренда гаража", { exact: true })).toHaveCount(0);
  await undoExclude.click();
  await expect(mandatory).toContainText("Аренда гаража");
});
