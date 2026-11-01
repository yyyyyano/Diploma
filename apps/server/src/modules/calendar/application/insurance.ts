// ОСАГО и КАСКО (CAL-05): в операциях найден платёж страховщику — спрашиваем «Похоже, вы оплатили ОСАГО 12.03.2026 — напомнить 05.03.2027?».
// Страховщик — по словарю названий в настройке (операции не хранят MCC). Вопрос — ожидающее решение «Да/Нет» в `actions` и уведомление
// с ним (ключ — операция: тот же платёж второй раз не спрашивается, «Нет» помнится). «Да» создаёт событие «Продлить …» на ту же дату
// следующего года с напоминанием за 7 дней. Спрашивается последний платёж каждого вида, продление которого ещё впереди.
import { LocalDate } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { addMonths, remindDate } from "../domain/dates.ts";
import { insertEvent } from "../infrastructure/db/calendar.repo.ts";
import { EVIDENCE_DAYS, EVIDENCE_WORDS } from "../settings.ts";
import type { Deps } from "./deps.ts";
import { UNDO_CREATE_HANDLER } from "./events.ts";
import type { Reminders } from "./reminders.ts";

export const RENEW_HANDLER = "calendar.insurance-renew";

export type InsuranceKind = "osago" | "kasko" | "other";

/** Вид страховки по тексту операции: ОСАГО и КАСКО названы прямо, остальное — «страховка». */
export function insuranceKindOf(text: string): InsuranceKind {
  const lower = text.toLowerCase();
  if (/осаго/u.test(lower)) return "osago";
  if (/каско/u.test(lower)) return "kasko";
  return "other";
}

/** Правило события: ключ названия в словаре сайта (`osago`, `kasko`, `insurance`). */
export const insuranceRule = (kind: InsuranceKind) => (kind === "other" ? "insurance" : kind);

/** Тот же день и месяц следующего года (12.03.2026 → 12.03.2027); 29 февраля — 28 февраля. */
export const renewalOn = (paidOn: LocalDate): LocalDate => addMonths(paidOn, 12);

const isoOf = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;

/** Рассылка отката: уведомление с таким ключом уже было — вопрос не создаётся. */
class AlreadyAsked extends Error {}

export function makeInsurance(d: Deps, reminders: Reminders) {
  const { clock, settings, realtime, log } = d.platform;

  /** Последние платежи страховщикам по видам, чьё продление ещё впереди. */
  async function candidates(s: ScopedDb) {
    const today = clock.today();
    const from = LocalDate.addDays(today, -(await settings.get(EVIDENCE_DAYS)));
    const words = (await settings.get(EVIDENCE_WORDS)).insurer;
    const latest = new Map<InsuranceKind, { id: string; paidOn: LocalDate }>();
    for (const word of words) {
      const found = await d.transactions.list(s, {
        query: word,
        type: "expense",
        from,
        to: today,
        page: 1,
        pageSize: 100,
      });
      for (const op of found.items) {
        if (op.pending) continue;
        const text = `${op.merchantName ?? ""} ${op.description} ${op.note ?? ""}`;
        // Запрос мог совпасть по категории: слово страховщика должно быть в самом платеже.
        if (!words.some((w) => text.toLowerCase().includes(w.toLowerCase()))) continue;
        const kind = insuranceKindOf(text);
        const known = latest.get(kind);
        if (known === undefined || op.occurredOn > known.paidOn) {
          latest.set(kind, { id: op.id, paidOn: op.occurredOn });
        }
      }
    }
    return [...latest.entries()]
      .map(([kind, op]) => ({ kind, ...op, renewOn: renewalOn(op.paidOn) }))
      .filter((c) => c.renewOn > today);
  }

  /** Спросить про каждый найденный платёж один раз; возвращает, сколько вопросов задано. */
  async function scan(s: ScopedDb): Promise<number> {
    let asked = 0;
    for (const c of await candidates(s)) {
      const remindDays = await reminders.defaults("insurance");
      const first = remindDays.reduce((a, b) => Math.max(a, b), 0);
      try {
        await s.transaction(async (tx) => {
          const decisionId = await d.actions.propose(tx, {
            handler: RENEW_HANDLER,
            payload: { transactionId: c.id, paidOn: c.paidOn, kind: c.kind },
            summary: {
              key: `decisions.insuranceRenew.${c.kind}`,
              params: { paidOn: isoOf(c.paidOn), remindOn: isoOf(remindDate(c.renewOn, first)) },
            },
          });
          const noticeId = await d.notifications.notify(tx, {
            kind: "insurance-renewal",
            key: `insurance:${c.id}`,
            objectRef: { entity: "transaction", id: c.id },
            decisionId,
            params: {
              kind: c.kind,
              paidOn: isoOf(c.paidOn),
              remindOn: isoOf(remindDate(c.renewOn, first)),
            },
          });
          // Уведомление по ключу уже было — вопрос уже задавали (в том числе с ответом «Нет»): решение откатывается вместе с транзакцией.
          if (noticeId === undefined) throw new AlreadyAsked();
        });
        asked += 1;
      } catch (error) {
        if (!(error instanceof AlreadyAsked)) throw error;
      }
    }
    if (asked > 0) log.info({ count: asked }, "calendar.insurance-asked");
    return asked;
  }

  /** «Да» (реестр confirm): событие «Продлить …» на ту же дату следующего года; в нагрузке — платёж, его день и вид, без сумм и текстов. */
  async function confirm(tx: ScopedDb, payload: unknown): Promise<string | undefined> {
    const body = payload as { transactionId?: unknown; paidOn?: unknown; kind?: unknown } | null;
    const { transactionId, paidOn, kind } = body ?? {};
    if (
      typeof transactionId !== "string" ||
      typeof paidOn !== "string" ||
      (kind !== "osago" && kind !== "kasko" && kind !== "other")
    ) {
      throw new Error("calendar.insurance-renew: нет transactionId, paidOn или kind в решении.");
    }
    const day = renewalOn(LocalDate.parse(paidOn));
    const remindDays = await reminders.defaults("insurance");
    const eventId = await insertEvent(tx, {
      type: "insurance",
      title: null,
      rule: insuranceRule(kind),
      day,
      origin: "insurance",
      params: { paidOn, kind },
      refEntity: "transaction",
      refId: transactionId,
      key: `insurance:${transactionId}`,
      remindDays,
    });
    if (eventId === undefined) return undefined;
    await reminders.replan(tx, eventId, { day, remindDays, dayChanged: true });
    const undoToken = await d.actions.record(tx, {
      handler: UNDO_CREATE_HANDLER,
      payload: { eventId },
      subject: `calendar-event:${eventId}`,
      channel: "web",
    });
    await realtime.changed(tx, { entity: "calendar-event", ids: [eventId] });
    return undoToken;
  }

  return { scan, confirm };
}

export type Insurance = ReturnType<typeof makeInsurance>;
