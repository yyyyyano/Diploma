// Маскировщик (PRIV-03, ADR-0009): правила (IBAN, карты, телефоны, email, паспорт, адреса) + склонённый словарь имён
// пользователя + NER → метки `[ИМЯ_1]`; ответ модели демаскируется локально. Суммы, даты и магазины не трогаются.
// Метки сквозные в пределах сессии (один вызов модели): одно значение — одна метка, номер — по первому появлению.
import type { Scope } from "@kosht/kernel";
import { label, LABEL_PATTERN, type MaskKind } from "../../domain/masking/labels.ts";
import { nameMatcher } from "../../domain/masking/names.ts";
import { detectByRules, resolveOverlaps, type Span } from "../../domain/masking/rules.ts";
import type { KnownNames, MaskSession, Masked, Masker, NameRecognizer } from "./ports.ts";
import type { Redactions } from "./redactions.ts";

export interface MaskerDeps {
  readonly names: KnownNames;
  /** NER; нет — режим деградации: правила и словарь. */
  readonly recognizer?: NameRecognizer;
  /** Замены для трасс Langfuse (OBS-03). */
  readonly redactions?: Redactions;
}

/** Ключ «то же значение»: у номеров пробелы и дефисы не важны, у слов — регистр. */
function identity(kind: MaskKind, original: string): string {
  const compact = original
    .toLowerCase()
    .replace(/[\s-]+/g, " ")
    .trim();
  return kind === "name" || kind === "address" ? compact : compact.replace(/ /g, "");
}

export function createMasker(d: MaskerDeps): Masker {
  function session(scope: Scope): MaskSession {
    const replacements = new Map<string, string>();
    const labelOf = new Map<string, string>();
    const counters = new Map<MaskKind, number>();
    let matcher: Promise<((text: string) => Span[]) | undefined> | undefined;

    const dictionary = () => (matcher ??= d.names.names(scope).then((names) => nameMatcher(names)));

    function labelFor(kind: MaskKind, original: string): string {
      const key = `${kind}:${identity(kind, original)}`;
      const known = labelOf.get(key);
      if (known !== undefined) return known;
      const next = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, next);
      const created = label(kind, next);
      labelOf.set(key, created);
      replacements.set(created, original);
      d.redactions?.remember(original, created);
      return created;
    }

    return {
      replacements,
      async mask(text) {
        if (text === "") return text;
        const fromDictionary = (await dictionary())?.(text) ?? [];
        const fromNer = (await d.recognizer?.recognize(text)) ?? [];
        const spans = resolveOverlaps([...detectByRules(text), ...fromDictionary, ...fromNer]);
        let result = "";
        let cursor = 0;
        for (const span of spans) {
          result +=
            text.slice(cursor, span.start) + labelFor(span.kind, text.slice(span.start, span.end));
          cursor = span.end;
        }
        return result + text.slice(cursor);
      },
    };
  }

  function unmask(text: string, replacements: ReadonlyMap<string, string>): string {
    return text.replace(LABEL_PATTERN, (found) => replacements.get(found) ?? found);
  }

  return {
    session,
    unmask,
    async mask(scope, text): Promise<Masked> {
      const one = session(scope);
      const masked = await one.mask(text);
      return { text: masked, replacements: one.replacements };
    },
  };
}
