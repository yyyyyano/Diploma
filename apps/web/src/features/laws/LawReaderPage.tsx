// Читалка акта (design/screens/Laws.dc.html, состояние article-reader; LEGAL-05, LEGAL-06, LAW-32): оглавление по структуре
// акта, текст шрифтом законов по частям (статья или страница акта без статей — весь НК одним запросом не грузится),
// «редакция по состоянию на <дата снимка>», предупреждение о принятых изменениях, ссылки на pravo.by. Акт «только карточка» —
// без текста, со ссылкой. «Спросить ассистента об этой статье» — с чатом (T-043).
import type { LawActView, LawTocEntry } from "@kosht/contract";
import { formatDate } from "@kosht/i18n";
import { LocalDate } from "@kosht/kernel";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Info,
  Lock,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LawStatusBadge } from "../../entities/law/index.ts";
import { assistantBridge } from "../../lib/assistant-bridge.ts";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf } from "../../lib/errors.ts";
import { EmptyState, LawRefChip, PageHeader, SkeletonList, SkeletonText } from "../../ui/index.ts";
import classes from "./LawReaderPage.module.css";
import type { ReaderSearch } from "./model/search.ts";
import { useViewer } from "./model/viewer.ts";

const day = (iso: string): string => formatDate(LocalDate.parse(iso.slice(0, 10)));

/** Статья `216.1` читается «216¹». */
const numberLabel = (number: string): string => number.replace(".", "¹");

interface TocGroup {
  readonly title: string;
  readonly entries: readonly LawTocEntry[];
}

function groupToc(toc: readonly LawTocEntry[]): TocGroup[] {
  const groups: { title: string; entries: LawTocEntry[] }[] = [];
  for (const entry of toc) {
    const title = entry.group.join(" · ");
    const last = groups.at(-1);
    if (last !== undefined && last.title === title) last.entries.push(entry);
    else groups.push({ title, entries: [entry] });
  }
  return groups;
}

export function LawReaderPage({
  pravoId,
  search,
}: {
  readonly pravoId: string;
  readonly search: ReaderSearch;
}) {
  const { t } = useTranslation("laws");
  const act = useQuery(orpc.legalBase.act.queryOptions({ input: { pravoId } }));

  if (act.isPending) {
    return (
      <div className={classes.body}>
        <SkeletonText />
        <SkeletonList rows={4} />
      </div>
    );
  }
  if (act.isError) {
    const missing = errorCodeOf(act.error) === "NOT_FOUND";
    return (
      <div className={classes.body}>
        <EmptyState
          tone={missing ? "empty" : "error"}
          icon={BookOpen}
          headingLevel={1}
          title={missing ? t("reader.notFound.title") : t("error.title")}
          description={missing ? t("reader.notFound.text") : t("error.text")}
          actions={
            missing ? (
              <Link to="/laws" className={classes.button}>
                {t("reader.notFound.back")}
              </Link>
            ) : (
              <button type="button" className={classes.button} onClick={() => void act.refetch()}>
                {t("error.retry")}
              </button>
            )
          }
        />
      </div>
    );
  }
  return <Reader view={act.data} article={search.article} />;
}

function Reader({
  view,
  article,
}: {
  readonly view: LawActView;
  readonly article: string | undefined;
}) {
  const { t } = useTranslation("laws");
  const { act, toc } = view;
  const [copied, setCopied] = useState(false);
  const viewer = useViewer();
  const key = article ?? toc[0]?.key;
  const index = toc.findIndex((entry) => entry.key === key);
  const current = index < 0 ? undefined : toc[index];
  const text = useQuery(
    orpc.legalBase.fragments.queryOptions({
      input: { pravoId: act.pravoId, key: key ?? "" },
      enabled: key !== undefined && act.hasText,
    }),
  );
  const prev = index > 0 ? toc[index - 1] : undefined;
  const next = index >= 0 ? toc[index + 1] : undefined;
  const isPage = current?.kind === "page";

  const copy = () => {
    void navigator.clipboard.writeText(window.location.href).then(
      () => setCopied(true),
      // Буфер обмена недоступен (запрет браузера): ссылка остаётся в адресной строке — молча, это не ошибка данных.
      () => undefined,
    );
  };

  // CHAT-08: вопрос об этой статье — в поле ассистента (не отправлен); о статье он знает и из контекста страницы.
  const ask = (entry: LawTocEntry) => {
    const number = numberLabel(entry.number);
    const part = t(entry.kind === "page" ? "reader.askPage" : "reader.askArticle", { number });
    assistantBridge.open(t("reader.askQuestion", { part, act: act.shortName ?? act.title }));
  };

  const subtitle =
    act.editionOn === null ? undefined : t("reader.edition", { date: day(act.editionOn) });

  return (
    <>
      <PageHeader title={act.title} subtitle={subtitle} />
      <div className={classes.body}>
        <nav aria-label={t("reader.breadcrumb")} className={classes.crumbs}>
          <Link to="/laws">{t("title")}</Link>
          {act.group !== null && (
            <>
              <ChevronRight size={14} aria-hidden />
              <Link to="/laws" search={{ group: act.group }}>
                {t(`groups.${act.group}`)}
              </Link>
            </>
          )}
          <ChevronRight size={14} aria-hidden />
          <span aria-current="page">{act.shortName ?? act.title}</span>
        </nav>

        <div className={classes.facts}>
          <LawStatusBadge status={act.status} />
          {view.fetchedAt !== null && (
            <span>{t("reader.fetched", { date: day(view.fetchedAt) })}</span>
          )}
          <LawRefChip label={t("reader.pravo")} href={view.url} external />
          <LawRefChip label={t("reader.card")} href={view.cardUrl} external />
        </div>

        {act.status === "repealed" && act.repealedOn !== null && (
          <p className={classes.notice} role="note">
            <Info size={18} strokeWidth={1.8} aria-hidden />
            {t("reader.repealed", { date: day(act.repealedOn) })}
          </p>
        )}

        {view.pending.map((change) => (
          <div key={change.description} className={classes.notice} role="note">
            <Info size={18} strokeWidth={1.8} aria-hidden />
            <div>
              <p className={classes.noticeTitle}>
                {t("reader.pending.title", { description: change.description })}
              </p>
              <p>{t("reader.pending.text")}</p>
              {change.articles.length > 0 && (
                <p>{t("reader.pending.articles", { articles: change.articles.join(", ") })}</p>
              )}
              {change.inForceOn !== null && (
                <p>{t("reader.pending.inForce", { date: day(change.inForceOn) })}</p>
              )}
            </div>
          </div>
        ))}

        {!act.hasText ? (
          <EmptyState
            icon={FileText}
            title={t("reader.cardOnly.title")}
            description={t("reader.cardOnly.text")}
            actions={
              <a
                className={classes.button}
                href={view.cardUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("reader.card")}
                <ExternalLink size={16} strokeWidth={1.8} aria-hidden />
              </a>
            }
          />
        ) : (
          <div className={classes.layout}>
            <nav aria-label={t("reader.toc")} className={classes.toc}>
              {groupToc(toc).map((group) => (
                <section
                  key={`${group.title}:${group.entries[0]?.key ?? ""}`}
                  className={classes.tocGroup}
                >
                  {group.title !== "" && <h2 className={classes.tocTitle}>{group.title}</h2>}
                  <ul>
                    {group.entries.map((entry) => (
                      <li key={entry.key}>
                        <Link
                          to="/laws/$pravoId"
                          params={{ pravoId: act.pravoId }}
                          search={{ article: entry.key }}
                          className={classes.tocLink}
                          aria-current={entry.key === key ? "page" : undefined}
                        >
                          <span className={classes.tocNo}>
                            {entry.kind === "article"
                              ? t("reader.tocArticle", { number: numberLabel(entry.number) })
                              : t("reader.tocPage", { number: entry.number })}
                          </span>
                          {entry.heading !== null && <span>{entry.heading}</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </nav>

            <article className={classes.article} aria-label={t("reader.article")}>
              {key === undefined || current === undefined ? (
                <EmptyState
                  icon={BookOpen}
                  title={t("reader.partMissing.title")}
                  description={t("reader.partMissing.text")}
                />
              ) : text.isPending ? (
                <SkeletonText />
              ) : text.isError ? (
                <EmptyState
                  tone="error"
                  icon={BookOpen}
                  title={t("error.title")}
                  description={t("error.text")}
                  actions={
                    <button
                      type="button"
                      className={classes.button}
                      onClick={() => void text.refetch()}
                    >
                      {t("error.retry")}
                    </button>
                  }
                />
              ) : (
                <Fragments
                  fragments={text.data.fragments}
                  fallbackTitle={isPage ? t("reader.tocPage", { number: current.number }) : ""}
                  excludedText={t("reader.excluded")}
                />
              )}
              <footer className={classes.actions}>
                <button type="button" className={classes.button} onClick={copy}>
                  <Copy size={16} strokeWidth={1.8} aria-hidden />
                  {t("reader.copyLink")}
                </button>
                {!viewer.pending && viewer.user !== undefined && current !== undefined && (
                  <button type="button" className={classes.button} onClick={() => ask(current)}>
                    <Sparkles size={16} strokeWidth={1.8} aria-hidden />
                    {t("reader.ask")}
                  </button>
                )}
                {!viewer.pending && viewer.user === undefined && (
                  <Link to="/login" className={classes.button}>
                    <Lock size={16} strokeWidth={1.8} aria-hidden />
                    {t("reader.askGuest")}
                  </Link>
                )}
                <a
                  className={classes.link}
                  href={view.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("reader.pravo")}
                  <ExternalLink size={16} strokeWidth={1.8} aria-hidden />
                </a>
                <span className={classes.pager}>
                  {prev !== undefined && (
                    <Link
                      to="/laws/$pravoId"
                      params={{ pravoId: act.pravoId }}
                      search={{ article: prev.key }}
                      className={classes.pagerLink}
                      aria-label={isPage ? t("reader.previousPage") : t("reader.previous")}
                    >
                      <ChevronLeft size={18} aria-hidden />
                    </Link>
                  )}
                  {next !== undefined && (
                    <Link
                      to="/laws/$pravoId"
                      params={{ pravoId: act.pravoId }}
                      search={{ article: next.key }}
                      className={classes.pagerLink}
                      aria-label={isPage ? t("reader.nextPage") : t("reader.next")}
                    >
                      <ChevronRight size={18} aria-hidden />
                    </Link>
                  )}
                </span>
                <output className={classes.copied}>{copied ? t("reader.copied") : ""}</output>
              </footer>
            </article>
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

/** Текст частей: первая строка статьи «Статья 210. Название» — заголовок, остальное — абзацы шрифтом законов (Literata). */
function Fragments({
  fragments,
  fallbackTitle,
  excludedText,
}: {
  readonly fragments: readonly { versionId: string; text: string; excluded: boolean }[];
  readonly fallbackTitle: string;
  readonly excludedText: string;
}) {
  const lines = fragments.flatMap((f) =>
    f.text.split("\n").map((line) => ({ id: f.versionId, line })),
  );
  const first = lines[0]?.line ?? "";
  const hasTitle = /^Статья\s/u.test(first);
  const title = hasTitle ? first : fallbackTitle;
  const body = hasTitle ? lines.slice(1) : lines;
  return (
    <>
      {title !== "" && <h2 className={classes.articleTitle}>{title}</h2>}
      {fragments.some((f) => f.excluded) && <p className={classes.excluded}>{excludedText}</p>}
      <div className={classes.law}>
        {body.map(({ id, line }, i) => (
          <p key={`${id}:${String(i)}`}>{line}</p>
        ))}
      </div>
    </>
  );
}
