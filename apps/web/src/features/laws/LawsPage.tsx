// «База законов» (design/screens/Laws.dc.html, LEGAL-11, LAW-07, LEGAL-06): каталог актов по темам со статусом, поиск по
// названию и по статье («ст. 210 НК» → сразу в читалку), фильтры по теме и состоянию — в адресе. Открыта всем: гость видит
// страницу без меню. Четыре состояния (DES-16). Счётчики — подсчёт строк списка; денег страница не считает (P1).
import { LAW_GROUPS, type LawGroup, type LawListItem, type LawStatus } from "@kosht/contract";
import { formatDate } from "@kosht/i18n";
import { LocalDate } from "@kosht/kernel";
import { useDebouncedValue } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { BookOpen, ExternalLink, Scale, Search, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LawStatusBadge } from "../../entities/law/index.ts";
import { orpc } from "../../lib/api.ts";
import { EmptyState, PageHeader, SkeletonList } from "../../ui/index.ts";
import classes from "./LawsPage.module.css";
import type { LawsSearch } from "./model/search.ts";
import { useViewer } from "./model/viewer.ts";

const STATUSES: readonly LawStatus[] = ["active", "has-changes", "card-only"];
/** «ст. 210 НК», «п. 3 ст. 13 …»: такое обращение разбирает сервер, а не фильтр по названию. */
const REFERENCE = /^(?:(?:п|пп|пункт)\.?\s*[\d.]+\s+)?(?:ст|статья|статье|статью)\.?\s*\d/iu;

const fold = (text: string): string => text.toLowerCase().replaceAll("ё", "е");

function matches(act: LawListItem, query: string): boolean {
  const haystack = fold(`${act.title} ${act.shortName ?? ""}`);
  return fold(query)
    .split(/\s+/u)
    .filter((word) => word !== "")
    .every((word) => haystack.includes(word));
}

export function LawsPage({ search }: { readonly search: LawsSearch }) {
  const { t } = useTranslation("laws");
  const navigate = useNavigate();
  const { user } = useViewer();
  const catalog = useQuery(orpc.legalBase.catalog.queryOptions());
  const raw = search.q ?? "";
  const query = raw.trim();
  const isReference = REFERENCE.test(query);
  // Обращение разбирает сервер: не на каждую набранную букву, а когда человек перестал печатать.
  const [settled] = useDebouncedValue(query, 300);
  const target = useQuery(
    orpc.legalBase.resolve.queryOptions({
      input: { q: settled },
      enabled: isReference && REFERENCE.test(settled) && settled.length >= 4,
    }),
  );
  const setSearch = (patch: Partial<LawsSearch>) =>
    void navigate({ to: "/laws", search: (prev) => ({ ...prev, ...patch }), replace: true });

  const guest = user === undefined;
  const header = guest ? (
    <header className={classes.hero}>
      <h1 className={classes.heroTitle}>{t("guest.title")}</h1>
      <p className={classes.heroIntro}>{t("guest.intro")}</p>
    </header>
  ) : (
    <PageHeader title={t("title")} subtitle={t("subtitle")} />
  );

  if (catalog.isPending) {
    return (
      <>
        {header}
        <div className={classes.body}>
          <SkeletonList rows={6} />
        </div>
      </>
    );
  }
  if (catalog.isError) {
    return (
      <>
        {header}
        <div className={classes.body}>
          <EmptyState
            tone="error"
            icon={BookOpen}
            title={t("error.title")}
            description={t("error.text")}
            actions={
              <button
                type="button"
                className={classes.button}
                onClick={() => void catalog.refetch()}
              >
                {t("error.retry")}
              </button>
            }
          />
        </div>
      </>
    );
  }

  const { acts, counts, editionOn } = catalog.data;
  if (acts.length === 0) {
    return (
      <>
        {header}
        <div className={classes.body}>
          <EmptyState icon={Scale} title={t("empty.title")} description={t("empty.text")} />
        </div>
      </>
    );
  }

  const byGroup = (group: LawGroup | "other"): LawListItem[] =>
    acts.filter((act) => (act.group ?? "other") === group);
  const visible = acts.filter(
    (act) =>
      (search.group === undefined || (act.group ?? "other") === search.group) &&
      (search.status === undefined || act.status === search.status) &&
      (query === "" || isReference || matches(act, query)),
  );
  const groups = ([...LAW_GROUPS, "other"] as const).filter((group) =>
    visible.some((act) => (act.group ?? "other") === group),
  );
  const resolved = isReference ? (target.data?.target ?? null) : null;
  const resolvedAct =
    resolved === null ? undefined : acts.find((a) => a.pravoId === resolved.pravoId);

  return (
    <>
      {header}
      <div className={classes.body}>
        <search className={classes.search}>
          <Search size={18} strokeWidth={1.8} aria-hidden className={classes.searchIcon} />
          <input
            type="search"
            className={classes.input}
            aria-label={t("search.label")}
            placeholder={t("search.placeholder")}
            value={raw}
            onChange={(event) =>
              setSearch({ q: event.target.value === "" ? undefined : event.target.value })
            }
          />
        </search>

        <fieldset className={classes.chips} aria-label={t("filters.topics")}>
          <button
            type="button"
            className={classes.chip}
            aria-pressed={search.group === undefined}
            onClick={() => setSearch({ group: undefined })}
          >
            {t("filters.all")} <span className={classes.count}>{acts.length}</span>
          </button>
          {([...LAW_GROUPS, "other"] as const).map((group) => {
            const n = byGroup(group).length;
            return n === 0 ? null : (
              <button
                key={group}
                type="button"
                className={classes.chip}
                aria-pressed={search.group === group}
                onClick={() => setSearch({ group })}
              >
                {t(`groups.${group}`)} <span className={classes.count}>{n}</span>
              </button>
            );
          })}
        </fieldset>

        <fieldset className={classes.segments} aria-label={t("filters.statuses")}>
          <button
            type="button"
            className={classes.segment}
            aria-pressed={search.status === undefined}
            onClick={() => setSearch({ status: undefined })}
          >
            {t("filters.all")}
          </button>
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={classes.segment}
              aria-pressed={search.status === status}
              onClick={() => setSearch({ status })}
            >
              {t(`status.${status}`)}
            </button>
          ))}
        </fieldset>

        <p className={classes.summary}>
          <span>{t("summary.total", { count: counts.total })}</span>
          <span>{t("summary.withText", { count: counts.withText })}</span>
          <span>{t("summary.cardOnly", { count: counts.cardOnly })}</span>
          <span>{t("summary.withChanges", { count: counts.withChanges })}</span>
          {editionOn !== null && (
            <span>{t("summary.edition", { date: formatDate(LocalDate.parse(editionOn)) })}</span>
          )}
        </p>

        {resolved !== null && (
          <Link
            to="/laws/$pravoId"
            params={{ pravoId: resolved.pravoId }}
            search={{ article: resolved.key }}
            className={classes.jump}
          >
            <BookOpen size={18} strokeWidth={1.8} aria-hidden />
            {t("search.openArticle", {
              article: resolved.key.replace(".", "¹"),
              act: resolvedAct?.shortName ?? resolvedAct?.title ?? resolved.pravoId,
            })}
          </Link>
        )}

        {visible.length === 0 && resolved === null ? (
          <EmptyState
            icon={Search}
            title={t("search.nothing")}
            description={t("search.nothingHint")}
            actions={
              <button
                type="button"
                className={classes.button}
                onClick={() => setSearch({ q: undefined, group: undefined, status: undefined })}
              >
                {t("search.reset")}
              </button>
            }
          />
        ) : (
          <div className={classes.columns}>
            {groups.map((group) => {
              const rows = visible.filter((act) => (act.group ?? "other") === group);
              return (
                <section key={group} className={classes.group} aria-labelledby={`g-${group}`}>
                  <header className={classes.groupHead}>
                    <h2 id={`g-${group}`} className={classes.groupTitle}>
                      {t(`groups.${group}`)}
                    </h2>
                    <span className={classes.groupCount}>
                      {t("group.count", { count: rows.length })}
                    </span>
                  </header>
                  <ul className={classes.list}>
                    {rows.map((act) => (
                      <li key={act.pravoId} className={classes.row}>
                        <div className={classes.rowMain}>
                          <Link
                            to="/laws/$pravoId"
                            params={{ pravoId: act.pravoId }}
                            className={classes.title}
                          >
                            {act.title}
                          </Link>
                          <span className={classes.meta}>
                            {t(`kinds.${kindKey(act.kind)}`)}
                            {act.shortName !== null && ` · ${act.shortName}`}
                          </span>
                        </div>
                        <LawStatusBadge status={act.status} />
                        <a
                          className={classes.external}
                          href={`https://pravo.by/document/?guid=${act.hasText ? "3871" : "3961"}&p0=${act.pravoId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${t("openOnPravo")}: ${act.title}`}
                        >
                          <ExternalLink size={16} strokeWidth={1.8} aria-hidden />
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        <p className={classes.disclaimer}>
          <ShieldCheck size={16} strokeWidth={1.8} aria-hidden />
          {t("disclaimer")}
        </p>
      </div>
    </>
  );
}

/** Вид акта из каталога — ключ подписи; неизвестный вид читается как постановление. */
function kindKey(kind: string): "law" | "code" | "decree" | "resolution" | "plenum" {
  return kind === "law" || kind === "code" || kind === "decree" || kind === "plenum"
    ? kind
    : "resolution";
}
