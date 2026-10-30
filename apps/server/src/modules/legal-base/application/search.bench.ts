// Бюджеты поиска по законам (CONSTRAINTS.md, LAW-21, NFR-05) — `make bench`: точное обращение «ст. 210 НК» ≤ 10 мс p95;
// гибридный поиск (SQL: FTS `russian` + halfvec HNSW + RRF) на ~25 тыс. фрагментов ≤ 200 мс p95; `search_law` целиком
// (с эмбеддингом запроса) ≤ 600 мс p95 — это значение [калибр.], здесь с ПОДДЕЛЬНЫМ эмбеддером: настоящий замер bge-m3 —
// пользователь после `make up WITH_MODELS=1`. Синтетический набор и HNSW строятся один раз на запуск; векторы — только у
// текущих версий активной модели (частичный индекс). p95 печатается.
import { performance } from "node:perf_hooks";
import { hashEmbedder } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { hybridIds } from "../infrastructure/db/search.repo.ts";
import { buildTsQuery } from "../domain/ts-query.ts";
import { makeLawSearch } from "./search.ts";

const FRAGMENTS = 25_000;
const ACTS = 200;
const RUNS = 60;
let db: TestDb;
const fake = hashEmbedder(1024);

beforeAll(async () => {
  db = await createTestDb();
  const words = Array.from({ length: 600 }, (_, i) => `слово${String(i)}`).concat([
    "обмен",
    "товар",
    "качество",
    "потребитель",
    "налог",
    "вычет",
    "договор",
    "возврат",
    "пособие",
    "вклад",
  ]);
  let seed = 7;
  const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
  const text = () =>
    Array.from({ length: 30 }, () => words[Math.floor(rand() * words.length)]).join(" ");
  await db.owner.query(
    `insert into legal_acts (pravo_id, title, kind, has_text, source, load_state)
     select 'B' || lpad(g::text, 8, '0'), 'Акт ' || g, 'law', true, 'admin', 'loaded' from generate_series(1, ${String(ACTS)}) g`,
  );
  await db.owner.query(
    `insert into legal_acts (pravo_id, title, kind, has_text, source, load_state) values ('Hk0900071', 'НК', 'code', true, 'start-catalog', 'loaded')`,
  );
  await db.owner.query(
    `insert into legal_act_snapshots (act_id, text_hash, raw_gz, raw_bytes, status, fetched_at)
     select id, md5(id::text), '\\x00'::bytea, 1, 'applied', now() from legal_acts`,
  );
  await db.owner.query(
    `insert into legal_act_aliases (act_id, alias) select id, 'нк' from legal_acts where pravo_id = 'Hk0900071'`,
  );
  const acts = (
    await db.owner.query<{ id: string; sid: string }>(
      `select a.id, s.id as sid from legal_acts a join legal_act_snapshots s on s.act_id = a.id`,
    )
  ).rows;
  const nk = acts.at(-1);
  const BATCH = 500;
  for (let from = 0; from < FRAGMENTS; from += BATCH) {
    const rows = Array.from({ length: BATCH }, (_, i) => {
      const n = from + i;
      const act = n < 3 ? nk : acts[n % ACTS];
      return {
        act,
        key: n < 3 ? `a${String(209 + n)}` : `a${String(n)}`,
        no: n < 3 ? String(209 + n) : String(n),
        body: text(),
      };
    });
    const f = await db.owner.query<{ id: string }>(
      `insert into legal_fragments (act_id, path_key, article_no, position)
       select * from unnest($1::uuid[], $2::text[], $3::text[], $4::int[]) returning id`,
      [
        rows.map((r) => r.act?.id),
        rows.map((r) => r.key),
        rows.map((r) => r.no),
        rows.map((_, i) => from + i),
      ],
    );
    const v = await db.owner.query<{ id: string }>(
      `insert into legal_fragment_versions (fragment_id, kind, search_path, body, text_hash, first_snapshot_id, last_snapshot_id)
       select * from unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::uuid[], $7::uuid[]) returning id`,
      [
        f.rows.map((r) => r.id),
        rows.map(() => "norm"),
        rows.map((r) => `Акт › Статья ${r.no}`),
        rows.map((r) => r.body),
        rows.map((r) => r.key + String(from)),
        rows.map((r) => r.act?.sid),
        rows.map((r) => r.act?.sid),
      ],
    );
    const vectors = await fake.embed(rows.map((r) => r.body));
    await db.owner.query(
      `insert into legal_fragment_embeddings (version_id, model_id, embedding, embedded_at)
       select u.id, '019e0000-0000-7000-8000-000000000001', u.v::halfvec(1024), now()
       from unnest($1::uuid[], $2::text[]) as u(id, v)`,
      [v.rows.map((r) => r.id), vectors.map((x) => `[${x.join(",")}]`)],
    );
  }
  await db.owner.query("analyze legal_fragment_versions");
  await db.owner.query("analyze legal_fragment_embeddings");
});
afterAll(async () => {
  await db.drop();
});

function p95(samples: readonly number[]): number {
  const sorted = [...samples].toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

async function measure(run: () => Promise<unknown>): Promise<number> {
  await run();
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const t = performance.now();
    await run();
    samples.push(performance.now() - t);
  }
  return p95(samples);
}

describe("бюджеты поиска по законам (~25 тыс. фрагментов, поддельные векторы)", () => {
  const search = () =>
    makeLawSearch({
      system: createSystemDb(db.pool),
      embedQuery: async (text) => (await fake.embed([text]))[0] ?? null,
      log: memoryLogger().log,
    });

  it("точное обращение «ст. 210 НК» — p95 не больше 10 мс", async () => {
    const s = search();
    const out = await s.search("ст. 210 НК");
    expect(out.mode).toBe("exact");
    const value = await measure(() => s.search("ст. 210 НК"));
    process.stdout.write(`точное обращение p95 = ${value.toFixed(1)} мс (бюджет 10)\n`);
    expect(value).toBeLessThanOrEqual(10);
  });

  it("гибрид (SQL: FTS + HNSW + RRF) — p95 не больше 200 мс", async () => {
    const vector = (await fake.embed(["обмен товар качество потребитель возврат"]))[0] ?? null;
    const ts = buildTsQuery("обмен товар качество потребитель возврат", "or");
    const value = await measure(() =>
      hybridIds(createSystemDb(db.pool), { tsQuery: ts, vector, limit: 10 }),
    );
    process.stdout.write(`гибридный SQL p95 = ${value.toFixed(1)} мс (бюджет 200)\n`);
    expect(value).toBeLessThanOrEqual(200);
  });

  it("search_law целиком с поддельным эмбеддером — p95 не больше 600 мс [калибр.]", async () => {
    const s = search();
    const value = await measure(() =>
      s.search("можно ли обменять товар надлежащего качества потребитель"),
    );
    process.stdout.write(
      `search_law целиком p95 = ${value.toFixed(1)} мс (бюджет 600 [калибр.], поддельный эмбеддер)\n`,
    );
    expect(value).toBeLessThanOrEqual(600);
  });
});
