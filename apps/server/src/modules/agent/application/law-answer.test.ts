// LEGAL-04, LAW-15: «в моей базе нет» — тема вопроса определяется малой моделью и уходит в журнал спроса вместе с актами;
// ответ с цитатами тему не определяет.
import { testScope } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { lawAnswer } from "./law-answer.ts";

const scope = testScope();

const cited = {
  outcome: "cited",
  parts: [{ type: "text", text: "Вычет — по закону." }],
  citations: [],
  notices: [{ kind: "disclaimer", text: "Не является юридической консультацией." }],
  versionIds: [],
} as const;
const noBase = { ...cited, outcome: "no-base" } as const;

function setup(first: typeof cited | typeof noBase, topic: string | Error = "taxes") {
  const finalized: unknown[] = [];
  const classified: unknown[] = [];
  const memory = memoryLogger();
  return {
    finalized,
    classified,
    memory,
    deps: {
      log: memory.log,
      legalConsult: {
        finalizeAnswer: async (input: { topic: string | null }) => {
          finalized.push(input);
          return first;
        },
      },
      llm: {
        classify: async (_caller: unknown, request: unknown) => {
          classified.push(request);
          if (topic instanceof Error) throw topic;
          return topic;
        },
      },
    } as never,
  };
}

const input = { draft: "черновик", question: "Как вернуть налог?", candidateActIds: ["HK9800166"] };

describe("lawAnswer", () => {
  it("ответ с цитатами — один вызов finalizeAnswer без темы, модель темы не зовётся", async () => {
    const t = setup(cited);
    expect((await lawAnswer(t.deps, scope, input)).outcome).toBe("cited");
    expect(t.finalized).toEqual([
      { draft: "черновик", candidateActIds: ["HK9800166"], topic: null },
    ]);
    expect(t.classified).toEqual([]);
  });

  it("«в моей базе нет» — тема от модели и повтор finalizeAnswer с темой для журнала спроса", async () => {
    const t = setup(noBase, "taxes");
    expect((await lawAnswer(t.deps, scope, input)).outcome).toBe("no-base");
    expect(t.finalized).toHaveLength(2);
    expect(t.finalized[1]).toMatchObject({ topic: "taxes", candidateActIds: ["HK9800166"] });
    expect(t.classified).toHaveLength(1);
  });

  it("тема none — повтора нет: вопрос не о деньгах граждан", async () => {
    const t = setup(noBase, "none");
    await lawAnswer(t.deps, scope, input);
    expect(t.finalized).toHaveLength(1);
  });

  it("сбой модели темы не мешает ответу и пишется без текста вопроса", async () => {
    const t = setup(noBase, new Error("сбой"));
    expect((await lawAnswer(t.deps, scope, input)).outcome).toBe("no-base");
    expect(t.finalized).toHaveLength(1);
    expect(t.memory.lines().map((line) => line["msg"])).toContain("agent.topic-unavailable");
    expect(JSON.stringify(t.memory.lines())).not.toContain("Как вернуть");
  });
});
