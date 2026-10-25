// Сообщение канала kosht_realtime (ADR-0008, ARCHITECTURE §5 «Живые сигналы»): из любого процесса в api, а оттуда —
// в events.stream (SSE) домохозяйства. В сообщении — домохозяйство, вид сигнала, сущность и id; данных нет (OBS-04):
// сайт по сигналу перезапрашивает нужное обычными процедурами. Полезная нагрузка NOTIFY в Postgres — меньше 8000
// байт, поэтому пачка id режется на куски не больше NOTIFY_MAX_BYTES.
import { EntityId, EntityKind } from "@kosht/contract";
import { z } from "zod";

/** Предел куска (Buffer.byteLength JSON): запас до 8000 байт полезной нагрузки NOTIFY. */
export const NOTIFY_MAX_BYTES = 7500;

/** Сообщение канала: проверяется схемой и на входе в api — пишет его любой процесс с доступом к базе. */
export const RealtimeMessage = z.strictObject({
  householdId: z.uuid(),
  type: z.enum(["changed", "progress"]),
  entity: EntityKind,
  ids: z.array(EntityId).min(1),
  percent: z.int().min(0).max(100).optional(),
});
export type RealtimeMessage = z.infer<typeof RealtimeMessage>;

/** Пачка id одного сигнала; householdId — из scope вызывающего, а не из его входа. */
export interface SignalBatch {
  readonly householdId: string;
  readonly type: RealtimeMessage["type"];
  readonly entity: string;
  readonly ids: readonly string[];
  readonly percent?: number;
}

/**
 * Сообщения NOTIFY для пачки: каждый кусок — JSON не длиннее NOTIFY_MAX_BYTES, все id по разу в исходном порядке.
 * Пачка не по схеме — RangeError без значений (её собирает код, а не пользователь).
 */
export function encodeSignal(batch: SignalBatch): string[] {
  if (batch.ids.length === 0) return [];
  const parsed = RealtimeMessage.safeParse({ ...batch, ids: [...batch.ids] });
  if (!parsed.success) {
    throw new RangeError(
      "Сигнал realtime не по схеме: ожидаются uuid домохозяйства и id, сущность kebab-case.",
    );
  }
  const { ids, ...head } = parsed.data;
  // Размер считается по ходу: JSON массива без пробелов — «[» id «,» id … «]», поэтому каждый следующий id
  // добавляет свою длину в JSON и одну запятую.
  const empty = Buffer.byteLength(JSON.stringify({ ...head, ids: [] }));
  const chunks: string[] = [];
  let current: string[] = [];
  let size = empty;
  for (const id of ids) {
    const idBytes = Buffer.byteLength(JSON.stringify(id));
    if (current.length > 0 && size + 1 + idBytes > NOTIFY_MAX_BYTES) {
      chunks.push(JSON.stringify({ ...head, ids: current }));
      current = [];
      size = empty;
    }
    size += (current.length > 0 ? 1 : 0) + idBytes;
    current.push(id);
  }
  chunks.push(JSON.stringify({ ...head, ids: current }));
  return chunks;
}

/** Входящее сообщение канала: не JSON или не по схеме — undefined (текст сообщения наружу не уходит). */
export function decodeSignal(payload: string): RealtimeMessage | undefined {
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return undefined;
  }
  const parsed = RealtimeMessage.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}
