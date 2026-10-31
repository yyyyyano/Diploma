// Чек-листы документов (LEGAL-12, CHAT-04): шаблоны — `domain/checklists.ts`, тексты — словарь `legal`, состояние галочек — таблица
// домохозяйства. Модель текст чек-листа не пишет: она только выбирает шаблон по id (инструмент `get_checklist`).
import type {
  ChecklistId,
  ChecklistItem as ItemView,
  ChecklistSubject,
  ChecklistSummary,
  ChecklistView,
} from "@kosht/contract";
import type { LegalT } from "@kosht/i18n";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { CHECKLISTS, checklistById, type ChecklistTemplate } from "../domain/checklists.ts";
import { checkedItems, setChecked } from "../infrastructure/db/progress.repo.ts";

const norm = (pravoId: string) => `https://pravo.by/document/?guid=3871&p0=${pravoId}`;
const card = (pravoId: string) => `https://pravo.by/document/?guid=3961&p0=${pravoId}`;

/** Ключ состояния: к чему относится чек-лист. */
export function subjectKey(subject: ChecklistSubject): string {
  return subject.kind === "general" ? "general" : `${subject.kind}:${subject.id}`;
}

export function makeChecklists(d: { readonly t: LegalT }) {
  const { t } = d;

  function view(template: ChecklistTemplate, checked: ReadonlySet<string>): ChecklistView {
    const base = `checklists.${template.id}` as const;
    const items: ItemView[] = template.items.map((item) => {
      // Ключи словаря собираются по шаблону: полноту проверяет тест (каждый пункт шаблона имеет текст).
      const text = t(`${base}.items.${item.id}` as never) as string;
      const deadline =
        item.deadline === true ? (t(`${base}.deadlines.${item.id}` as never) as string) : null;
      return {
        id: item.id,
        kind: item.kind,
        text,
        instance:
          item.instance === undefined
            ? null
            : { id: item.instance, label: t(`instance.${item.instance}`) },
        deadline,
        norm:
          item.norm === undefined
            ? null
            : {
                ref: item.norm.ref,
                url: norm(item.norm.pravoId),
                unsaved: item.norm.unsaved === true,
              },
        act: item.act === undefined ? null : { url: card(item.act) },
        checked: item.kind === "note" ? null : checked.has(item.id),
      };
    });
    const checkable = items.filter((i) => i.checked !== null);
    return {
      id: template.id,
      title: t(`${base}.title` as never) as string,
      summary: t(`${base}.summary` as never) as string,
      items,
      done: checkable.filter((i) => i.checked === true).length,
      total: checkable.length,
    };
  }

  const template = (id: string): ChecklistTemplate => {
    const found = checklistById(id);
    if (found === undefined) throw new AppError("VALIDATION");
    return found;
  };

  return {
    /** Набор чек-листов: название и описание. */
    list(): ChecklistSummary[] {
      return CHECKLISTS.map((c) => ({
        id: c.id,
        title: t(`checklists.${c.id}.title` as never) as string,
        summary: t(`checklists.${c.id}.summary` as never) as string,
      }));
    },
    /** Шаблон без состояния (агент, предпросмотр): галочек нет. */
    template(id: ChecklistId): ChecklistView {
      return view(template(id), new Set());
    },
    /** Чек-лист с галочками домохозяйства для этого `subject`. */
    async get(s: ScopedDb, input: { id: ChecklistId; subject: ChecklistSubject }) {
      const tpl = template(input.id);
      return view(tpl, new Set(await checkedItems(s, tpl.id, subjectKey(input.subject))));
    },
    /** Отметить или снять пункт: только пункт этого шаблона и только тот, у которого есть галочка (заметка — нет). */
    async setChecked(
      s: ScopedDb,
      input: { id: ChecklistId; subject: ChecklistSubject; item: string; done: boolean },
    ) {
      const tpl = template(input.id);
      const item = tpl.items.find((i) => i.id === input.item);
      if (item === undefined || item.kind === "note") throw new AppError("VALIDATION");
      const subject = subjectKey(input.subject);
      await setChecked(s, {
        checklistId: tpl.id,
        subject,
        itemId: item.id,
        done: input.done,
      });
      return view(tpl, new Set(await checkedItems(s, tpl.id, subject)));
    },
  };
}

export type Checklists = ReturnType<typeof makeChecklists>;
