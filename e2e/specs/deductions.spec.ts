// «Налоговые вычеты» (TAX-01, TAX-04, TAX-06, LEGAL-12, DES-16): свой пользователь → пустой калькулятор → расчёт вычета на обучение
// 2 000 BYN (до 260,00 BYN по ставке 13 %, формула, чек-лист) → вопрос о зарплате → вкладки «Жильё» и «Дети». axe 0 нарушений
// WCAG 2.2 AA и нет горизонтальной прокрутки при 1440 и 390: пусто, результат, вкладка «Жильё». Числа примеров TAX-07 проверяют
// int-тесты `main/tax.int.test.ts`; здесь — что человек видит.
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

test("«Налоговые вычеты»: расчёт вычета на обучение, вкладки Жильё и Дети; axe 0 при 1440 и 390", async ({
  page,
}) => {
  const email = `deductions-${String(Date.now())}@example.test`;
  const password = "кошт2026вычеты";
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

  // DES-16: пусто — что здесь будет; тип занятости не указан — считаем как наёмного работника.
  await page.goto("/deductions");
  await expect(page.getByRole("heading", { level: 1, name: "Налоговые вычеты" })).toBeVisible();
  await expect(page.getByText(/здесь появится расчёт/)).toBeVisible();
  await expect(page.getByText(/Тип занятости в профиле не указан/)).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // TAX-07, пример 1: обучение 2 000 BYN → до 260,00 BYN по ставке 13 %, с формулой и нормой.
  await page
    .getByRole("textbox", { name: "Сколько заплатили за обучение в году, BYN" })
    .fill("2000");
  await page.getByRole("button", { name: "Посчитать" }).click();
  const result = page.getByRole("heading", { name: "Расчёт вычета" });
  await expect(result).toBeVisible();
  await expect(page.getByText("13 %")).toBeVisible();
  await expect(page.getByText(/260,00/).first()).toBeVisible();
  await expect(page.getByText(/Сумма «до»/)).toBeVisible();
  // TAX-04: зарплаты нет — один вопрос с ответом в факт.
  await expect(
    page.getByText("Какая у вас зарплата до вычета налогов — есть в расчётном листке?"),
  ).toBeVisible();
  // «Откуда эта цифра?» — сохранённый расчёт: ставка и оплата в формуле.
  await page.getByRole("button", { name: /Откуда эта цифра: экономия/ }).click();
  const why = page.getByRole("dialog", { name: "Откуда эта цифра?" });
  await expect(why).toBeVisible();
  await expect(why.getByText("Ставка подоходного налога")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(why).toBeHidden();
  // LEGAL-12: чек-лист документов — рядом с расчётом (цитаты норм из базы законов проверяет int-тест: каталог в стенде e2e грузит первый администратор).
  await expect(page.getByRole("heading", { name: "Вычет на обучение" })).toBeVisible();
  await animationsSettled(page);
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // TAX-04, PROF-04: ответ сохраняется фактом и расчёт пересчитывается — «до» исчезает, остаток не переносится.
  await page.getByRole("textbox", { name: "Зарплата до вычета налогов в месяц, BYN" }).fill("2500");
  await page.getByRole("button", { name: "Запомнить и пересчитать" }).click();
  await expect(page.getByText(/Сумма «до»/)).toBeHidden();
  await expect(page.getByText("Какая у вас зарплата до вычета налогов")).toBeHidden();

  // Вкладка «Жильё»: свои поля; дети — по профилю, без ввода.
  await page.getByText("Жильё", { exact: true }).click();
  await expect(page).toHaveURL(/kind=housing/);
  await expect(page.getByRole("textbox", { name: /Расходы на жильё, BYN/ })).toBeVisible();
  await page.getByRole("textbox", { name: /Расходы на жильё, BYN/ }).fill("120000");
  await page.getByRole("button", { name: "Посчитать" }).click();
  await expect(page.getByText(/15\s?600,00/).first()).toBeVisible();
  await expect(page.getByText("48 мес.")).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  await page.getByText("Дети", { exact: true }).click();
  await expect(page.getByText(/Вычет на детей считается по профилю/)).toBeVisible();
  await page.getByRole("button", { name: "Посчитать" }).click();
  await expect(page.getByText(/нет детей до 18 лет/)).toBeVisible();
});
