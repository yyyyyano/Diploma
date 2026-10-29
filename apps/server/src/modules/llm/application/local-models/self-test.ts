// Самотест локальных моделей при старте (NFR-25, ARCHITECTURE §15): llama-server на Intel Arc через Vulkan иногда
// выдаёт мусор — без проверки пользователь получал бы «ответы» неизвестно чего. Проверяются: чат («сколько будет
// 2+2» → есть «4»), эмбеддинги (размер 1024, конечные ненулевые числа, «кошка» ближе к «кот», чем к «налог»). Эталонного
// вектора файлом нет — его не получить без запуска модели; сравнение «по смыслу» ловит ту же поломку (мусорные векторы
// не упорядочивают пары). Сервис не запущен — не «мусор», а LLAMA_DOWN.
export type SelfTestProblem = "LLAMA_DOWN" | "CHAT_GARBAGE" | "EMBED_GARBAGE";

export interface SelfTestResult {
  readonly ok: boolean;
  readonly problems: readonly SelfTestProblem[];
}

export interface SelfTestDeps {
  /** OpenAI-совместимый адрес (`http://127.0.0.1:8142/v1`). */
  readonly baseUrl: string;
  readonly chatModel: string;
  readonly embedModel: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export const EMBEDDING_DIMENSIONS = 1024;

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [index, x] of a.entries()) {
    const y = b[index] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

class Unreachable extends Error {}

export async function runSelfTest(d: SelfTestDeps): Promise<SelfTestResult> {
  const send = d.fetch ?? fetch;
  const post = async (path: string, body: unknown): Promise<unknown> => {
    let response: Response;
    try {
      response = await send(`${d.baseUrl.replace(/\/+$/, "")}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(d.timeoutMs ?? 120_000),
      });
    } catch {
      throw new Unreachable();
    }
    if (!response.ok) throw new Unreachable();
    return response.json();
  };
  const problems: SelfTestProblem[] = [];
  try {
    const chat = (await post("/chat/completions", {
      model: d.chatModel,
      messages: [{ role: "user", content: "Сколько будет 2+2? Ответь одной цифрой." }],
      max_tokens: 16,
      temperature: 0,
    })) as { choices?: { message?: { content?: string } }[] };
    if (!/(?<!\d)4(?!\d)/.test(chat.choices?.[0]?.message?.content ?? "")) {
      problems.push("CHAT_GARBAGE");
    }
    const embeddings = (await post("/embeddings", {
      model: d.embedModel,
      input: ["кошка", "кот", "налог на доходы физических лиц"],
    })) as { data?: { embedding?: number[] }[] };
    const [cat, kitten, tax] = (embeddings.data ?? []).map((item) => item.embedding ?? []);
    const sane =
      cat !== undefined &&
      kitten !== undefined &&
      tax !== undefined &&
      [cat, kitten, tax].every(
        (vector) =>
          vector.length === EMBEDDING_DIMENSIONS &&
          vector.every(Number.isFinite) &&
          vector.some((value) => value !== 0),
      ) &&
      cosine(cat, kitten) > cosine(cat, tax) + 0.05;
    if (!sane) problems.push("EMBED_GARBAGE");
  } catch (error) {
    if (error instanceof Unreachable) return { ok: false, problems: ["LLAMA_DOWN"] };
    throw error;
  }
  return { ok: problems.length === 0, problems };
}
