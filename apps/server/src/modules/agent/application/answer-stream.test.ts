// AGT-04 (P1), LEGAL-03, CHAT-04, LLM-10, AGT-01: поток ответа — по предложениям с проверкой чисел; правовой ответ целиком
// после finalizeAnswer; график — частью data-chart; пометки о пределе шагов и сбое; кто ответил — в finish.
import type { LawAnswerData } from "@kosht/contract";
import { createAgentT } from "@kosht/i18n";
import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { NumberLedger } from "../../llm/index.ts";
import { answerTransform, newRunState, type RunState } from "./answer-stream.ts";

const t = createAgentT();

const law: LawAnswerData = {
  outcome: "cited",
  parts: [{ type: "text", text: "Вычет — по закону." }],
  citations: [],
  notices: [{ kind: "disclaimer", text: "Не является юридической консультацией." }],
  versionIds: [],
};

function text(id: string, ...deltas: string[]): UIMessageChunk[] {
  return [
    { type: "text-start", id },
    ...deltas.map((delta): UIMessageChunk => ({ type: "text-delta", id, delta })),
    { type: "text-end", id },
  ];
}
const finish: UIMessageChunk = { type: "finish", finishReason: "stop" };

async function run(
  chunks: UIMessageChunk[],
  options: {
    ledger?: NumberLedger;
    legalMode?: boolean;
    state?: RunState;
    finalizeLaw?: (draft: string) => Promise<LawAnswerData>;
  } = {},
) {
  const memory = memoryLogger();
  const finalized: string[] = [];
  const transform = answerTransform({
    ledger: options.ledger ?? new NumberLedger(),
    state: options.state ?? newRunState(),
    t,
    log: memory.log,
    legalMode: options.legalMode ?? false,
    finalizeLaw:
      options.finalizeLaw ??
      (async (draft) => {
        finalized.push(draft);
        return law;
      }),
  });
  const out: UIMessageChunk[] = [];
  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();
  const done = (async () => {
    for (;;) {
      const next = await reader.read();
      if (next.done) return;
      out.push(next.value);
    }
  })();
  for (const chunk of chunks) await writer.write(chunk);
  await writer.close();
  await done;
  return { out, memory, finalized };
}

const shown = (out: UIMessageChunk[]) =>
  out
    .filter((chunk) => chunk.type === "text-delta")
    .map((chunk) => chunk.delta)
    .join("");

describe("AGT-04: числа ответа — по предложениям", () => {
  it("число из результата инструмента (копейки → рубли) проходит, ответ выводится как есть", async () => {
    const ledger = new NumberLedger();
    ledger.addJson({ total: 123_456 });
    const { out } = await run(
      [...text("t1", "Вы потратили 1 234,56 BYN. ", "Это за сентябрь."), finish],
      { ledger },
    );
    expect(shown(out)).toBe("Вы потратили 1 234,56 BYN. Это за сентябрь.");
    expect(out.at(-1)).toEqual(finish);
  });

  it("модель выдумала «1 234,56» — предложение не выводится, остальное идёт, в конце пометка, в логе agent.number-unverified", async () => {
    const { out, memory } = await run([
      ...text("t1", "Привет. Вы потратили 1 234,56 BYN. Хорошего дня."),
      finish,
    ]);
    expect(shown(out)).toContain("Привет. ");
    expect(shown(out)).toContain("Хорошего дня.");
    expect(shown(out)).not.toContain("1 234,56");
    expect(shown(out)).toContain(t("unverified"));
    const line = memory.lines().find((l) => l["msg"] === "agent.number-unverified");
    expect(line).toMatchObject({ count: 1 });
    expect(JSON.stringify(memory.lines())).not.toContain("234");
  });

  it("предложение идёт в поток целиком и только после точки: на полуслове ничего не выводится", async () => {
    const { out } = await run([...text("t1", "Записал", " трату", ". Готово"), finish]);
    const deltas = out.filter((chunk) => chunk.type === "text-delta").map((c) => c.delta);
    expect(deltas).toEqual(["Записал трату. ", "Готово"]);
  });

  it("текст, из которого убрано всё, не оставляет пустой части", async () => {
    const { out } = await run([...text("t1", "Итого 777 BYN."), finish]);
    expect(out.filter((chunk) => chunk.type === "text-start")).toHaveLength(1);
    expect(shown(out)).toBe(t("unverified"));
  });

  it("мысли модели на сайт не идут", async () => {
    const { out } = await run([
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", delta: "думаю" },
      { type: "reasoning-end", id: "r1" },
      ...text("t1", "Ответ."),
      finish,
    ]);
    expect(out.map((chunk) => chunk.type)).not.toContain("reasoning-delta");
  });
});

describe("LEGAL-03: правовой ответ — целиком после finalizeAnswer", () => {
  it("по ходу — только шаги; текст не идёт, после — data-law-answer", async () => {
    const state = newRunState();
    state.legalToolUsed = true;
    const { out, finalized } = await run(
      [
        { type: "tool-input-start", toolCallId: "c1", toolName: "search_law" },
        ...text("t1", "Вычет предоставляется «текст» [[F1]]."),
        finish,
      ],
      { legalMode: true, state },
    );
    expect(out.map((chunk) => chunk.type)).toEqual([
      "tool-input-start",
      "data-law-answer",
      "finish",
    ]);
    expect(finalized[0]).toContain("[[F1]]");
    expect(out[1]).toMatchObject({ type: "data-law-answer", data: law });
  });

  it("выдуманное число в черновике убирается до подстановки цитат", async () => {
    const state = newRunState();
    state.legalToolUsed = true;
    const { finalized } = await run(
      [...text("t1", "Ставка 77 процентов. Смотрите [[F1]]."), finish],
      { legalMode: true, state },
    );
    expect(finalized[0]).not.toContain("77");
    expect(finalized[0]).toContain("[[F1]]");
  });

  it("набор legal, но поиска по законам не было и меток нет — обычный ответ по предложениям", async () => {
    const { out, finalized } = await run([...text("t1", "Записал трату."), finish], {
      legalMode: true,
    });
    expect(finalized).toEqual([]);
    expect(shown(out)).toBe("Записал трату.");
  });

  it("finalizeAnswer упал — честная пометка вместо ответа, текст черновика не показывается", async () => {
    const state = newRunState();
    state.legalToolUsed = true;
    const { out } = await run([...text("t1", "Черновик [[F1]]."), finish], {
      legalMode: true,
      state,
      finalizeLaw: async () => {
        throw new Error("сбой");
      },
    });
    expect(shown(out)).toBe(t("modelUnavailable"));
    expect(shown(out)).not.toContain("Черновик");
  });
});

describe("CHAT-04: график", () => {
  const chart = {
    kind: "bar",
    title: "Траты",
    unit: "money",
    currency: "BYN",
    labels: ["Такси"],
    series: [{ name: "Сентябрь", values: [12_000] }],
  };
  const call = (output: unknown): UIMessageChunk[] => [
    { type: "tool-input-available", toolCallId: "c1", toolName: "make_chart", input: chart },
    { type: "tool-output-available", toolCallId: "c1", output },
    finish,
  ];

  it("вызов принят — после результата идёт часть data-chart", async () => {
    const { out } = await run(call({ ok: true }));
    expect(out.map((chunk) => chunk.type)).toEqual([
      "tool-input-available",
      "tool-output-available",
      "data-chart",
      "finish",
    ]);
    expect(out[2]).toMatchObject({ type: "data-chart", data: chart });
  });

  it("вызов отклонён проверкой — графика нет", async () => {
    const { out } = await run(call({ ok: false, code: "VALIDATION" }));
    expect(out.map((chunk) => chunk.type)).not.toContain("data-chart");
  });
});

describe("AGT-01, AGT-13, LLM-10: концовка ответа", () => {
  it("предел шагов — пометка «могла не успеть»", async () => {
    const state = newRunState();
    state.stepLimitHit = true;
    const { out } = await run([...text("t1", "Вот что нашёл."), finish], { state });
    expect(shown(out)).toContain(t("stepLimit"));
  });

  it("сбой потока модели — кусок error наружу не идёт, вместо него пометка", async () => {
    const { out, memory } = await run([
      { type: "error", errorText: "секрет ivan@mail.by" },
      finish,
    ]);
    expect(out.map((chunk) => chunk.type)).not.toContain("error");
    expect(shown(out)).toBe(t("modelUnavailable"));
    expect(JSON.stringify(memory.lines())).not.toContain("ivan");
  });

  it("сбой модели оборвал поток без finish — пометка и завершение сообщения всё равно есть", async () => {
    const { out } = await run([{ type: "error", errorText: "сбой" }]);
    expect(shown(out)).toBe(t("modelUnavailable"));
    expect(out.at(-1)).toMatchObject({ type: "finish" });
  });

  it("«Стоп»: кусок abort проходит, пометок и finish не дописывается", async () => {
    const { out } = await run([{ type: "abort" }]);
    expect(out).toEqual([{ type: "abort" }]);
  });

  it("кто ответил и кто недоступен — в метаданных куска finish", async () => {
    const state = newRunState();
    state.answeredBy = { model: "zai/glm", unavailable: ["groq/llama"] };
    const { out } = await run([...text("t1", "Ответ."), finish], { state });
    expect(out.at(-1)).toEqual({
      type: "finish",
      finishReason: "stop",
      messageMetadata: { answeredBy: { model: "zai/glm", unavailable: ["groq/llama"] } },
    });
  });
});
