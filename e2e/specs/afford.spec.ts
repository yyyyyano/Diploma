// «Могу ли я позволить покупку?» (AFF-01, AFF-03, AFF-05, AFF-08, DES-16): свой пользователь → пустой экран → быстрая сумма 3 000 → три
// сценария и график (данных нет: «доход не найден» с вопросом, сценарий «сейчас» считается) → «Откуда эта цифра?» → безопасный платёж:
// предел ПДН ждёт «Подтвердить» — честное «нет предела». axe 0 нарушений WCAG 2.2 AA и нет горизонтальной прокрутки при 1440 и 390: пусто,
// результат. Числа примеров AFF проверяют int-тесты `afford.int.test.ts` и `safe-loan.int.test.ts`; здесь — что видит человек.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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

test("«Могу ли я позволить покупку?»: три сценария, график, безопасный платёж; axe 0 при 1440 и 390", async ({
  page,
}) => {
  const email = `afford-${String(Date.now())}@example.test`;
  const password = "кошт2026покупка";
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

  // Пункт меню «Крупная покупка» ведёт на экран.
  await page.goto("/afford");
  await expect(
    page.getByRole("heading", { level: 1, name: "Могу ли я позволить покупку?" }),
  ).toBeVisible();

  // DES-16: пусто — что делать; безопасный платёж виден сразу, предел ПДН ждёт подтверждения.
  await expect(
    page.getByText("Введите сумму или выберите быструю — покажу три сценария"),
  ).toBeVisible();
  await expect(page.getByText(/Предел долговой нагрузки ещё не подтверждён/)).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // AFF-01, AFF-03: быстрая сумма → пересчёт на сервере → три сценария и график.
  await page.getByLabel("Что покупаете").fill("Ноутбук");
  await page.getByRole("button", { name: /^3\s000$/ }).click();
  await expect(page.getByRole("heading", { name: /Ноутбук за 3\s000,00\sBYN/ })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(page.getByRole("figure", { name: /График остатка по дням/ })).toBeVisible();
  // Данных нет: остатков нет, поэтому «сейчас» уходит в минус; дохода нет — вопрос (AFF-08).
  await expect(page.getByText("Риск просадки").first()).toBeVisible();
  await expect(page.getByText("Регулярный доход не найден", { exact: true })).toBeVisible();

  // P2: «Откуда эта цифра?» у минимального остатка — сохранённый расчёт.
  await page
    .getByRole("button", { name: /Откуда эта цифра: минимальный остаток/ })
    .first()
    .click();
  const why = page.getByRole("dialog", { name: "Откуда эта цифра?" });
  await expect(why).toBeVisible();
  await expect(
    why.getByRole("term").filter({ hasText: "Наименьший остаток за период" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(why).toBeHidden();
  await animationsSettled(page);
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // AFF-08: названный доход и день поступления — сценарии пересчитываются, вопрос исчезает.
  const question = page.locator("form").filter({ hasText: "Регулярный доход не найден" });
  const inTenDays = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  await question.getByLabel("Доход в месяц, BYN").fill("2400");
  await question.getByLabel("День поступления").fill(inTenDays);
  await question.getByRole("button", { name: "Пересчитать" }).click();
  await expect(page.getByText("Регулярный доход не найден", { exact: true })).toBeHidden();
  await expect(page.getByText("Оценка по вашим данным").first()).toBeVisible();
  await animationsSettled(page);
  expect(await accessibleAtBothWidths(page)).toEqual([]);
});
