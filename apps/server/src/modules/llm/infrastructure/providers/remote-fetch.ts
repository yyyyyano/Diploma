// Запросы к удалённому провайдеру (Groq, Z.ai, llama-server): адрес и ключ читаются в момент вызова, а не при старте
// процесса, — ключ из админки (секрет, NFR-16) и адрес из настройки действуют сразу, без перезапуска. Пакеты AI SDK
// принимают baseURL и apiKey только строкой при создании, поэтому им отдаётся условный адрес, а настоящий подставляет
// эта обёртка fetch. Значение ключа живёт только в заголовке запроса: в ошибки, логи и ответы оно не попадает.
import { z } from "zod";
import { AppError } from "../../../../platform/errors/app-error.ts";

/** Условный адрес для createGroq/createOpenAICompatible: обёртка меняет его на настоящий. */
export const PLACEHOLDER_BASE_URL = "https://provider.invalid/v1";

export interface RemoteSource {
  /** Адрес API без завершающего «/» (например, https://api.groq.com/openai/v1). */
  baseUrl(): Promise<string>;
  /** Ключ API; нет — провайдер не настроен (локальной модели ключ не нужен: функции нет). */
  key?(): Promise<string | undefined>;
}

/** Срок запроса списка моделей («Проверить связь»). */
const LIST_TIMEOUT_MS = 10_000;

export function remoteFetch(source: RemoteSource, send: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const target = url.replace(PLACEHOLDER_BASE_URL, (await source.baseUrl()).replace(/\/+$/, ""));
    const headers = new Headers(init?.headers);
    if (source.key !== undefined) {
      const key = await source.key();
      // Ключа нет — до сети не доходим: цепочка идёт дальше (isConfigured обычно отсекает такого провайдера раньше).
      if (key === undefined) throw new AppError("UNAVAILABLE");
      headers.set("authorization", `Bearer ${key}`);
    }
    return send(target, { ...init, headers });
  };
}

const ModelsPage = z.object({ data: z.array(z.object({ id: z.string() })) });

/** Модели, которые провайдер отдаёт сейчас (OpenAI-совместимый `GET /models`); ошибка — статус без тела ответа. */
export async function fetchModelIds(
  source: RemoteSource,
  send: typeof fetch = fetch,
): Promise<readonly string[]> {
  const response = await remoteFetch(source, send)(`${PLACEHOLDER_BASE_URL}/models`, {
    signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
  });
  if (!response.ok) throw new RemoteStatusError(response.status);
  return ModelsPage.parse(await response.json()).data.map((model) => model.id);
}

/** Провайдер ответил не 2xx; тело не сохраняется: в нём бывают подробности запроса. */
export class RemoteStatusError extends Error {
  override readonly name = "RemoteStatusError";
  readonly status: number;
  constructor(status: number) {
    super(`Провайдер ответил ${String(status)}.`);
    this.status = status;
  }
}
