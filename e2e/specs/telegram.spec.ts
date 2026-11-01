// «Telegram» в настройках (TG-02, PRIV-08): свой пользователь → вкладка «Telegram» — возможности бота и текст отдельного
// согласия; без токена бот «не настроен», «Подключить» неактивна (живую привязку проверяет int-тест `main/telegram.int.test.ts` и
// пользователь на телефоне). axe 0 нарушений WCAG 2.2 AA и нет горизонтальной прокрутки при 1440 и 390.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

/**
 * Конец конечных переходов (бесконечные — скелетоны — не ждём). Только после смены ширины: у только что появившегося окна
 * переход Mantine начинается кадром позже, и здесь он бы ещё не виден — для окон есть `shownSettled`.
 */
async function animationsSettled(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== "running" ||
          animation.effect?.getComputedTiming().iterations === Infinity,
      ),
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

test("вкладка «Telegram»: возможности, согласие, бот не настроен; axe 0 при 1440 и 390", async ({
  page,
}) => {
  const email = `telegram-${String(Date.now())}@example.test`;
  const password = "кошт2026телеграм";
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

  await page.goto("/settings?tab=telegram");
  await expect(page.getByRole("heading", { level: 2, name: "Telegram-бот «Кошт»" })).toBeVisible();
  await expect(page.getByText(/проходят через серверы Telegram за рубежом/)).toBeVisible();
  await expect(page.getByText(/Бот не настроен/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Подключить Telegram" })).toBeDisabled();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
});
