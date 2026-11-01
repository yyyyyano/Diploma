// «Календарь» (CAL-01, CAL-06, CAL-07, P5, AGT-07, DES-16): свой пользователь → пустой месяц → новое событие (окно) с «Отменить» → оно в
// сетке и в списке «Ближайшие» → карточка с «Откуда это событие» и напоминаниями → удаление только через «Да» и «Отменить» после него.
// axe 0 нарушений WCAG 2.2 AA и нет горизонтальной прокрутки при 1440 и 390: месяц, окно, карточка, список. Тик напоминаний и
// гарантии проверяют int-тесты.
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

/** День через `days` дней от сегодняшнего (у браузера и сервера один компьютер и пояс Минска). */
function inDays(days: number): string {
  const day = new Date(Date.now() + days * 86_400_000);
  return day.toISOString().slice(0, 10);
}

test("«Календарь»: пустой месяц, новое событие с «Отменить», карточка, список, удаление через «Да»; axe 0 при 1440 и 390", async ({
  page,
}) => {
  const email = `calendar-${String(Date.now())}@example.test`;
  const password = "кошт2026календарь";
  await page.goto("/register");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByLabel("Повторите пароль").fill(password);
  await page.getByRole("checkbox", { name: /согласен/ }).check();
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: "Пропустить анкету" }).click();
  await expect(page).toHaveURL(/\/home$/);

  // DES-16: пустой месяц — сетка и легенда на месте.
  await page.goto("/calendar");
  await expect(page.getByRole("heading", { level: 1, name: "Календарь" })).toBeVisible();
  const legend = page.getByRole("list", { name: "Типы событий" });
  await expect(legend).toBeVisible();
  await shownSettled(legend);
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // CAL-06: новое событие — окно формы.
  const title = "Оплатить кружок";
  const day = inDays(3);
  await page.getByRole("button", { name: "Добавить событие" }).first().click();
  const form = page.getByRole("dialog", { name: "Новое событие" });
  await expect(form).toBeVisible();
  await shownSettled(form);
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await form.getByRole("textbox", { name: "Название" }).fill(title);
  await form.getByLabel("Дата").fill(day);
  await form.getByRole("button", { name: "Добавить" }).click();
  const undo = await holdUndoToast(page, new RegExp(`Событие «${title}»`));
  const pill = page.getByRole("button", { name: new RegExp(`^${title},`) });
  await expect(pill).toBeVisible();

  // P5: «Отменить» — события нет; ставим заново.
  await undo.click();
  await expect(pill).toHaveCount(0);
  await page.getByRole("button", { name: "Добавить событие" }).first().click();
  const again = page.getByRole("dialog", { name: "Новое событие" });
  await again.getByRole("textbox", { name: "Название" }).fill(title);
  await again.getByLabel("Дата").fill(day);
  await again.getByRole("button", { name: "Добавить" }).click();
  await expect(pill).toBeVisible();

  // CAL-01: карточка события — «Откуда это событие» и напоминания за 7 и 1 день.
  await pill.click();
  const sheet = page.getByRole("dialog", { name: "Своё событие" });
  await expect(sheet.getByRole("heading", { name: title })).toBeVisible();
  await expect(sheet.getByText("Добавлено вами.")).toBeVisible();
  await expect(sheet.getByRole("checkbox", { name: "За 7 дней" })).toBeChecked();
  await expect(sheet.getByRole("checkbox", { name: "За 1 день" })).toBeChecked();
  await shownSettled(sheet);
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // CAL-01: список «Ближайшие».
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Список" }).click();
  await expect(page).toHaveURL(/view=list/);
  const row = page.getByRole("button", { name: new RegExp(`^${title},`) });
  await expect(row).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // AGT-07: удаление — только вопрос «Да/Нет», после «Да» — «Отменить».
  await row.click();
  const card = page.getByRole("dialog", { name: "Своё событие" });
  await card.getByRole("button", { name: "Удалить событие" }).click();
  const question = page.getByRole("dialog").filter({ hasText: `Удалить событие «${title}»?` });
  await expect(question).toBeVisible();
  await shownSettled(question);
  await question.getByRole("button", { name: "Удалить событие" }).click();
  const undoDelete = await holdUndoToast(page, `Событие «${title}» удалено`);
  await expect(row).toHaveCount(0);
  await undoDelete.click();
  await expect(row).toHaveCount(1);
});
