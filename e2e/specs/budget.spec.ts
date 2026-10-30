// «Лимиты и цели» (BUD-01…06, P5, AGT-07, DES-16): свой пользователь → пусто → новый лимит (окно) с «Отменить» → новая
// цель с расчётом взноса → взнос в копилку с «Отменить» → удаление лимита только через «Да». axe 0 нарушений WCAG 2.2 AA
// и нет горизонтальной прокрутки при 1440 и 390: пусто, окна, список. Пороги и уведомления проверяют int-тесты.
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

test("«Лимиты и цели»: пусто, новый лимит и цель, взнос с «Отменить», удаление лимита через «Да»; axe 0 при 1440 и 390", async ({
  page,
}) => {
  const email = `budget-${String(Date.now())}@example.test`;
  const password = "кошт2026лимиты";
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

  // DES-16: пусто — что здесь будет и первый шаг для лимитов и для целей.
  await page.goto("/budget");
  const empty = page.getByRole("heading", { name: "Лимитов пока нет" });
  await expect(empty).toBeVisible();
  await expect(page.getByRole("heading", { name: "Целей пока нет" })).toBeVisible();
  await shownSettled(empty);
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // BUD-01: новый лимит — окно формы, категория из справочника.
  await page.getByRole("button", { name: "Новый лимит" }).first().click();
  const limitForm = page.getByRole("dialog", { name: "Новый лимит" });
  await expect(limitForm).toBeVisible();
  await shownSettled(limitForm);
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await limitForm.getByRole("combobox", { name: "Категория" }).click();
  await page.getByRole("option", { name: "Кафе, рестораны и доставка" }).click();
  await limitForm.getByRole("textbox", { name: "Лимит на месяц, BYN" }).fill("200");
  await limitForm.getByRole("button", { name: "Сохранить лимит" }).click();
  const undoLimit = await holdUndoToast(page, /Лимит на «Кафе, рестораны и доставка» сохранён/);
  const card = page.getByRole("article", { name: "Кафе, рестораны и доставка" });
  await expect(card).toContainText(/0% · осталось 200,00\sBYN/);
  await undoLimit.click();
  await expect(card).toHaveCount(0);

  // Снова поставить лимит — для проверки удаления.
  await page.getByRole("button", { name: "Новый лимит" }).first().click();
  const again = page.getByRole("dialog", { name: "Новый лимит" });
  await again.getByRole("combobox", { name: "Категория" }).click();
  await page.getByRole("option", { name: "Кафе, рестораны и доставка" }).click();
  await again.getByRole("textbox", { name: "Лимит на месяц, BYN" }).fill("200");
  await again.getByRole("button", { name: "Сохранить лимит" }).click();
  await expect(card).toBeVisible();

  // BUD-04, BUD-05: новая цель — взнос считает сервер.
  await page.getByRole("button", { name: "Новая цель" }).first().click();
  const goalForm = page.getByRole("dialog", { name: "Новая цель" });
  await expect(goalForm).toBeVisible();
  await shownSettled(goalForm);
  await goalForm.getByRole("textbox", { name: "Название" }).fill("Отпуск");
  await goalForm.getByRole("textbox", { name: "Сколько накопить, BYN" }).fill("3000");
  await goalForm.getByLabel("К какому сроку").fill("2099-06-01");
  await expect(goalForm.getByText(/Откладывайте по .*\sBYN\sв месяц/)).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await goalForm.getByRole("button", { name: "Создать цель" }).click();
  await holdUndoToast(page, "Цель «Отпуск» создана.");
  const goal = page.getByRole("article", { name: "Отпуск" });
  await expect(goal).toContainText("копилка");

  // BUD-04: взнос в копилку — сразу, с «Отменить».
  await goal.getByRole("button", { name: "Внести" }).click();
  const contribute = page.getByRole("dialog", { name: "Взнос в копилку «Отпуск»" });
  await contribute.getByRole("textbox", { name: "Сумма взноса, BYN" }).fill("200");
  await contribute.getByRole("button", { name: "Внести" }).click();
  const undoContribution = await holdUndoToast(page, "Отложено 200 BYN на «Отпуск».");
  await expect(goal).toContainText(/\+200,00\sBYN/);
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await undoContribution.click();
  await expect(goal).toContainText("Взносов пока нет");

  // AGT-07: удаление лимита — только вопрос «Да/Нет».
  await page.getByRole("button", { name: "Удалить лимит «Кафе, рестораны и доставка»" }).click();
  const question = page.getByRole("dialog");
  await expect(question.getByText(/Удалить этот лимит\?/)).toBeVisible();
  await shownSettled(question);
  await expect(card).toBeVisible();
  await question
    .getByRole("button", { name: "Да, удалить лимит «Кафе, рестораны и доставка»" })
    .click();
  await expect(card).toHaveCount(0);
});
