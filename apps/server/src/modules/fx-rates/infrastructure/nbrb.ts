// Адаптер НБРБ (STMT-09, SPEC §9.8): `api.nbrb.by/exrates/rates/{ISO}?parammode=2&ondate=ГГГГ-ММ-ДД` — по ISO-коду
// (внутренний Cur_ID со временем меняется), бесплатно и без ключа. 404 и пустой ответ — курса на этот день нет (шаг
// назад делает сценарий); не 2xx, чужая валюта, ответ не по схеме — ошибка. Таймаут — AbortSignal.timeout.
import { fromNbrb, NbrbRate } from "../domain/fx-rate.ts";
import type { FxRatesSource } from "../application/ports.ts";

export const NBRB_BASE_URL = "https://api.nbrb.by/exrates/rates";

export interface NbrbOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
  readonly timeoutMs: () => Promise<number>;
}

export function createNbrbSource(options: NbrbOptions): FxRatesSource {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? NBRB_BASE_URL;
  return {
    async rateOn(currency, day) {
      const url = `${baseUrl}/${encodeURIComponent(currency)}?parammode=2&ondate=${day}`;
      const response = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(await options.timeoutMs()),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`НБРБ ответил ${String(response.status)}.`);
      const text = (await response.text()).trim();
      if (text === "" || text === "null") return null;
      const parsed = NbrbRate.safeParse(JSON.parse(text));
      if (!parsed.success) throw new Error("НБРБ: ответ не по формату.");
      if (parsed.data.Cur_Abbreviation !== currency) throw new Error("НБРБ: курс другой валюты.");
      const rate = fromNbrb(parsed.data);
      if (rate === null) throw new Error("НБРБ: курс не по формату.");
      return rate;
    },
  };
}
