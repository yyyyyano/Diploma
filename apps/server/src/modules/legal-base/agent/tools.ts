// Инструменты агента legal-base (AGT-03 «legal», ADR-0009): поиск по законам, фрагмент по id, карточка акта. Описания —
// по-английски и коротко (префикс набора «core + legal» ≤ 3 000 токенов), вход без владельца: правовая база общая.
// Агент пишет цитаты только по найденным фрагментам (метки `[[F…]]` подставляет legal-consult, P3).
import { z } from "zod";
import { defineTool } from "../../../platform/tools/define-tool.ts";
import { MAX_LIMIT, type LawSearch } from "../application/search.ts";
import type { Lookup } from "../application/lookup.ts";

const Fragment = z.object({
  id: z.uuid(),
  actId: z.string(),
  actTitle: z.string(),
  path: z.string(),
  text: z.string(),
  excluded: z.boolean(),
  url: z.string(),
});

export function legalBaseTools(deps: { search: LawSearch; lookup: Lookup }) {
  return {
    search: defineTool({
      name: "search_law",
      toolset: "legal",
      kind: "read",
      description:
        "Search Belarusian laws by a question or a reference like 'st. 210 NK' (article, act). Returns 6-10 current fragments with path, text and pravo.by link.",
      input: z.object({ query: z.string().trim().min(2).max(300) }),
      output: z.object({
        mode: z.enum(["exact", "hybrid"]),
        fragments: z.array(Fragment),
      }),
      execute: async (_ctx, input) => {
        const out = await deps.search.search(input.query, MAX_LIMIT);
        return {
          mode: out.mode,
          fragments: out.fragments.map((f) => ({
            id: f.versionId,
            actId: f.pravoId,
            actTitle: f.actTitle,
            path: f.path,
            text: f.text,
            excluded: f.excluded,
            url: f.url,
          })),
        };
      },
    }),
    fragment: defineTool({
      name: "get_law_fragment",
      toolset: "legal",
      kind: "read",
      description: "Get one law fragment by id (from search_law) with its exact text and link.",
      input: z.object({ id: z.uuid() }),
      output: z.object({ fragment: Fragment.nullable() }),
      execute: async (_ctx, input) => {
        const f = await deps.lookup.fragment(input.id);
        return {
          fragment:
            f === undefined
              ? null
              : {
                  id: f.versionId,
                  actId: f.pravoId,
                  actTitle: f.actTitle,
                  path: f.path,
                  text: f.text,
                  excluded: f.excluded,
                  url: `https://pravo.by/document/?guid=3871&p0=${f.pravoId}`,
                },
        };
      },
    }),
    actCard: defineTool({
      name: "law_act_card",
      toolset: "legal",
      kind: "read",
      description:
        "Get a law act card by pravo.by id: title, status, whether its text is in the base, link. Acts without text can only be named, not quoted.",
      input: z.object({ actId: z.string().regex(/^[A-Za-z][A-Za-z0-9]{5,11}$/u) }),
      output: z.object({
        act: z
          .object({
            actId: z.string(),
            title: z.string(),
            isNpa: z.boolean(),
            hasText: z.boolean(),
            status: z.enum(["active", "repealed"]),
            url: z.string(),
          })
          .nullable(),
      }),
      execute: async (_ctx, input) => {
        const row = await deps.lookup.actCard(input.actId);
        return {
          act:
            row === undefined
              ? null
              : {
                  actId: row.pravoId,
                  title: row.title,
                  isNpa: row.isNpa,
                  hasText: row.hasText,
                  status: row.status === "repealed" ? ("repealed" as const) : ("active" as const),
                  url: `https://pravo.by/document/?guid=${row.hasText ? "3871" : "3961"}&p0=${row.pravoId}`,
                },
        };
      },
    }),
  };
}
