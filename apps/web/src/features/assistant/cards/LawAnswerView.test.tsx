// CHAT-05, CHAT-06, DES-12, LEGAL-03, LEGAL-05, LEGAL-06, LEGAL-07: правовой ответ — текст целиком, ссылки на статьи чипами
// в строке, по клику — дословная цитата с «Редакцией на …» и ссылкой на pravo.by; акт без текста — только ссылка с пометкой;
// «Не является юридической консультацией» — отдельной строкой. Ничего, кроме подставленного программой, не показывается.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../../test/render.tsx";
import { LawAnswerView } from "./LawAnswerView.tsx";

const QUOTE =
  "Потребитель вправе обменять непродовольственный товар надлежащего качества в течение четырнадцати дней.";

const answer = {
  outcome: "cited",
  parts: [
    { type: "text", text: "Обменять товар можно в течение 14 дней " },
    { type: "cite", n: 1 },
    { type: "text", text: ". Перечень невозвратных товаров — в акте " },
    { type: "cite", n: 2 },
    { type: "text", text: "." },
  ],
  citations: [
    {
      n: 1,
      kind: "quote",
      versionId: "12",
      pravoId: "H10200090",
      actTitle: "Закон № 90-З «О защите прав потребителей»",
      label: "ст. 28, п. 1",
      path: "Закон › Статья 28 › п. 1",
      text: QUOTE,
      edition: "в редакции на 21.10.2026",
      editionOn: "2026-10-21",
      url: "https://pravo.by/document/?guid=3871&p0=H10200090",
      changedSince: false,
      notes: [],
    },
    {
      n: 2,
      kind: "link",
      reason: "no-text",
      pravoId: "C20100778",
      actTitle: "ПСМ № 778",
      label: null,
      url: "https://pravo.by/document/?guid=3961&p0=C20100778",
      note: "текста акта в базе нет — откройте по ссылке",
    },
  ],
  notices: [{ kind: "disclaimer", text: "Не является юридической консультацией." }],
  versionIds: ["12"],
};

describe("CHAT-05: чипы статей и дословные цитаты", () => {
  it("текст ответа целиком; чип статьи — кнопка со своей подписью для диктора; цитата закрыта, пока не нажали", () => {
    renderWithProviders(<LawAnswerView data={answer} />);
    expect(screen.getByText(/Обменять товар можно в течение 14 дней/)).toBeInTheDocument();
    const chip = screen.getByRole("button", { name: "Показать цитату: ст. 28, п. 1" });
    expect(chip).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(QUOTE)).toBeNull();
  });

  it("по клику раскрывается дословная цитата: шапка «акт, статья», «Редакция…», ссылка на pravo.by; повторный клик закрывает", async () => {
    renderWithProviders(<LawAnswerView data={answer} />);
    const chip = screen.getByRole("button", { name: "Показать цитату: ст. 28, п. 1" });
    await userEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(QUOTE)).toBeInTheDocument();
    expect(dialog).toHaveTextContent("в редакции на 21.10.2026");
    expect(dialog).toHaveTextContent("Закон № 90-З «О защите прав потребителей», ст. 28, п. 1");
    expect(within(dialog).getByRole("link", { name: /ст\. 28/ })).toHaveAttribute(
      "href",
      "https://pravo.by/document/?guid=3871&p0=H10200090",
    );
    await userEvent.click(chip);
    expect(screen.queryByText(QUOTE)).toBeNull();
  });

  it("Esc закрывает раскрытую цитату, даже когда фокус остался на чипе", async () => {
    renderWithProviders(<LawAnswerView data={answer} />);
    const chip = screen.getByRole("button", { name: "Показать цитату: ст. 28, п. 1" });
    await userEvent.click(chip);
    expect(await screen.findByText(QUOTE)).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByText(QUOTE)).toBeNull();
    expect(chip).toHaveAttribute("aria-expanded", "false");
  });

  it("акт без текста — ссылка на pravo.by с пометкой, цитаты нет (LEGAL-06)", () => {
    renderWithProviders(<LawAnswerView data={answer} />);
    const link = screen.getByRole("link", { name: "ПСМ № 778" });
    expect(link).toHaveAttribute("href", "https://pravo.by/document/?guid=3961&p0=C20100778");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText("текста акта в базе нет — откройте по ссылке")).toBeInTheDocument();
  });

  it("CHAT-06, LEGAL-07: «Не является юридической консультацией» — отдельной строкой под ответом", () => {
    renderWithProviders(<LawAnswerView data={answer} />);
    expect(screen.getByText("Не является юридической консультацией.")).toBeInTheDocument();
  });

  it("CHAT-10: у версии, заменённой новой редакцией, под цитатой — «показан прежний текст»", async () => {
    const stale = {
      ...answer,
      citations: [{ ...answer.citations[0], changedSince: true }, answer.citations[1]],
    };
    renderWithProviders(<LawAnswerView data={stale} />);
    await userEvent.click(screen.getByRole("button", { name: /Показать цитату/ }));
    expect(await screen.findByText(/показан прежний текст/)).toBeInTheDocument();
  });

  it("пометки о ставке и прошлой дате показываются строками; ответ «в базе нет» — без чипов", () => {
    renderWithProviders(
      <LawAnswerView
        data={{
          outcome: "no-base",
          parts: [{ type: "text", text: "В моей базе нет норм по этому вопросу." }],
          citations: [],
          notices: [
            { kind: "past-date", text: "Прежнюю редакцию процитировать не могу." },
            { kind: "disclaimer", text: "Не является юридической консультацией." },
          ],
          versionIds: [],
        }}
      />,
    );
    expect(screen.getByText("Прежнюю редакцию процитировать не могу.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("ответ не по схеме — запасной вид, текста модели из части нет", () => {
    renderWithProviders(<LawAnswerView data={{ parts: "не массив" }} />);
    expect(screen.getByText(/Карточка недоступна/)).toBeInTheDocument();
  });

  it("метка на несуществующую цитату ничего не рисует, а текст ответа остаётся", () => {
    renderWithProviders(
      <LawAnswerView
        data={{
          ...answer,
          parts: [
            { type: "text", text: "Срок такой " },
            { type: "cite", n: 9 },
            { type: "text", text: " и всё." },
          ],
        }}
      />,
    );
    expect(screen.getByText(/Срок такой/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Показать цитату/ })).toBeNull();
  });
});
