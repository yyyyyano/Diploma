// Карточка акта Национального реестра (`guid=3961`, LAW-30, LAW-32, LAW-34): дата вступления в силу, «Дата ограничения
// действия» (утрата силы) и перечень изменяющих актов. Карточка есть у любого акта; разбор — по подписям `<b>…</b><div>…</div>`
// и по фразам «Закон … от 16 марта 2026 г. № 134-З», а не по классам вёрстки. Те же фразы стоят в перечне «Изменения и дополнения»
// на странице текста — по ключу «номер|дата» видно, какие изменения в текст ещё не вошли.
import * as cheerio from "cheerio";
import { collapseSpaces } from "./read-page.ts";

export interface CardChange {
  /** «134-з|2026-03-16»: номер в нижнем регистре и дата ISO. */
  readonly key: string;
  /** «Закон Республики Беларусь от 16 марта 2026 г. № 134-З». */
  readonly description: string;
}

export interface ParsedCard {
  readonly title: string;
  /** «Закон Республики Беларусь от 8 июля 2008 г. № 369-З» — вид, орган принятия, дата и номер (LAW-13: орган, вид акта). */
  readonly kindLine: string;
  readonly inForceOn: string | null;
  /** День утраты силы («Дата ограничения действия»); null — акт действует. */
  readonly repealedOn: string | null;
  readonly changes: readonly CardChange[];
}

const MONTHS: Readonly<Record<string, string>> = {
  января: "01",
  февраля: "02",
  марта: "03",
  апреля: "04",
  мая: "05",
  июня: "06",
  июля: "07",
  августа: "08",
  сентября: "09",
  октября: "10",
  ноября: "11",
  декабря: "12",
};

/** «Закон Республики Беларусь от 16 марта 2026 г. № 134-З» — вид акта, дата и номер. */
const CHANGE =
  /((?:Закон|Указ|Декрет|Постановление|Приказ)[^№<>]{0,160}?\sот\s+(\d{1,2})\s+([а-яё]+)\s+(\d{4})\s*г\.\s*№\s*([0-9A-Za-zА-Яа-я/-]+))/giu;

/** ISO-дата из «16.03.2026»; не по форме — null. */
function isoOfDotted(text: string): string | null {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/u.exec(text);
  return m === null ? null : `${m[3] ?? ""}-${m[2] ?? ""}-${m[1] ?? ""}`;
}

/** Изменения из текста: фразы «вид … от <дата> № <номер>» по порядку, без повторов. */
export function changesIn(text: string): CardChange[] {
  const seen = new Map<string, CardChange>();
  for (const m of text.matchAll(CHANGE)) {
    const month = MONTHS[(m[3] ?? "").toLowerCase()];
    if (month === undefined) continue;
    const day = (m[2] ?? "").padStart(2, "0");
    const key = `${(m[5] ?? "").toLowerCase()}|${m[4] ?? ""}-${month}-${day}`;
    if (!seen.has(key)) seen.set(key, { key, description: collapseSpaces(m[1] ?? "") });
  }
  return [...seen.values()];
}

/** Ключи изменений, уже вошедших в текст: перечень «Изменения и дополнения» (`p.changeadd`) на странице акта. */
export function changeKeysOfPage(html: string): ReadonlySet<string> {
  const $ = cheerio.load(html);
  const lines = $("p.changeadd")
    .map((_, el) => collapseSpaces($(el).text()))
    .get();
  return new Set(changesIn(lines.join("\n")).map((c) => c.key));
}

export function parseCard(html: string): ParsedCard {
  const $ = cheerio.load(html);
  $("script, style").remove();
  const fields = new Map<string, string>();
  $("b").each((_, el) => {
    const next = $(el).nextAll("div").first();
    if (next.length > 0) fields.set(collapseSpaces($(el).text()), collapseSpaces(next.text()));
  });
  const full = collapseSpaces($("body").text());
  const marker = full.indexOf("Акты, изменяющие");
  const tail = marker < 0 ? "" : full.slice(marker);
  return {
    title: fields.get("Название акта") ?? "",
    kindLine: fields.get("Вид акта, орган принятия, дата и номер принятия (издания)") ?? "",
    inForceOn: isoOfDotted(fields.get("Дата вступления в силу") ?? ""),
    repealedOn: isoOfDotted(fields.get("Дата ограничения действия") ?? ""),
    changes: changesIn(tail),
  };
}
