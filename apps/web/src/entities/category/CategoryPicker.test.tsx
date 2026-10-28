// CAT-01, CAT-02: выбор категории — встроенные нужного типа и свои без скрытых, значок у варианта; «Новая категория»
// создаёт и сразу выбирает; ключи значков и цветов сайта совпадают с контрактом.
import { CATEGORY_COLOR_KEYS, CATEGORY_ICON_KEYS, type CategoryRef } from "@kosht/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw.ts";
import { renderWithProviders } from "../../test/render.tsx";
import { CATEGORY_ICONS } from "../../ui/index.ts";
import { CATEGORY_COLORS } from "../../ui/theme/index.ts";
import { CategoryPicker } from "./CategoryPicker.tsx";

const CUSTOM = "0199f0a0-0000-7000-8000-0000000000cc";

const items = [
  {
    ref: { type: "system", code: "groceries" },
    kind: "expense",
    name: null,
    icon: "shopping-cart",
    color: "groceries",
    hidden: false,
  },
  {
    ref: { type: "system", code: "taxi" },
    kind: "expense",
    name: null,
    icon: "car-taxi-front",
    color: "taxi",
    hidden: false,
  },
  {
    ref: { type: "system", code: "alcohol" },
    kind: "expense",
    name: null,
    icon: "wine",
    color: "subscriptions",
    hidden: true,
  },
  {
    ref: { type: "system", code: "salary" },
    kind: "income",
    name: null,
    icon: "briefcase",
    color: "salary",
    hidden: false,
  },
  {
    ref: { type: "custom", id: CUSTOM },
    kind: "expense",
    name: "Кружки",
    icon: "ticket",
    color: "kids",
    hidden: false,
  },
];

function renderPicker(value: CategoryRef | null = null) {
  const picked: CategoryRef[] = [];
  server.use(http.get("*/api/categories", () => HttpResponse.json({ items })));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <CategoryPicker kind="expense" value={value} onChange={(ref) => picked.push(ref)} />
    </QueryClientProvider>,
  );
  return picked;
}

describe("CAT-01, CAT-02: выбор категории", () => {
  it("расходные встроенные и свои, без скрытых и доходных; выбор — ссылка на категорию", async () => {
    const picked = renderPicker();
    await userEvent.click(screen.getByRole("combobox", { name: "Категория" }));
    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual(["Продукты", "Такси", "Кружки"]);
    await userEvent.click(screen.getByRole("option", { name: "Такси" }));
    expect(picked).toEqual([{ type: "system", code: "taxi" }]);
  });

  it("скрытая, но уже выбранная категория остаётся в списке", async () => {
    renderPicker({ type: "system", code: "alcohol" });
    expect(await screen.findByDisplayValue("Алкоголь и табак")).toBeInTheDocument();
  });

  it("«Новая категория» — окно с названием, создаёт и сразу выбирает новую", async () => {
    const created: unknown[] = [];
    const picked = renderPicker();
    server.use(
      http.post("*/api/categories", async ({ request }) => {
        created.push(await request.json());
        return HttpResponse.json({
          item: {
            ref: { type: "custom", id: CUSTOM },
            kind: "expense",
            name: "Секции",
            icon: "circle-ellipsis",
            color: "other",
            hidden: false,
          },
        });
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Новая категория" }));
    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "Добавить категорию" });
    expect(save).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Название" }), "Секции");
    await userEvent.click(save);
    await screen.findByRole("button", { name: "Новая категория" });
    expect(created).toEqual([
      { name: "Секции", kind: "expense", color: "other", icon: "circle-ellipsis" },
    ]);
    expect(picked).toEqual([{ type: "custom", id: CUSTOM }]);
  });
});

describe("DES-14: ключи значков и цветов", () => {
  it("значки CategoryIcon и цвета темы — те же, что в контракте", () => {
    expect(Object.keys(CATEGORY_ICONS).toSorted()).toEqual([...CATEGORY_ICON_KEYS].toSorted());
    expect(Object.keys(CATEGORY_COLORS).toSorted()).toEqual([...CATEGORY_COLOR_KEYS].toSorted());
  });
});
