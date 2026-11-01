// Правовой ответ (`data-law-answer`, CHAT-05, CHAT-06, DES-12, LEGAL-03, LEGAL-05): текст целиком, ссылки на статьи — чипы
// `--law`, по клику раскрывающие дословную цитату (Popover на компьютере, нижняя шторка на телефоне) с датой редакции
// и ссылкой на pravo.by. Текст цитаты подставила и проверила программа (`legal-consult`) — здесь он только показывается
// (P3). Пометки (прошлая дата, ставка, «не удалось проверить») идут строками под текстом; последняя — «Не является
// юридической консультацией» (LEGAL-07) — оформлена отдельной строкой со значком.
import { LawAnswerData } from "@kosht/contract";
import { Popover } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { Info, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CitationQuote,
  citationChipLabel,
  citationSource,
  type QuoteCitation,
} from "../../../entities/law/index.ts";
import { LawRefChip, Sheet } from "../../../ui/index.ts";
import { Markdown } from "../Markdown.tsx";
import classes from "./LawAnswerView.module.css";
import { Unavailable } from "./Unavailable.tsx";

const PHONE_QUERY = "(max-width: 760px)";

/** Чип статьи с раскрывающейся цитатой; акт или статья без текста — ссылка на pravo.by с пометкой. */
function Cite({ citation }: { readonly citation: LawAnswerData["citations"][number] }) {
  const { t } = useTranslation("assistant");
  const phone = useMediaQuery(PHONE_QUERY) === true;
  const [opened, setOpened] = useState(false);
  // Esc закрывает цитату, пока фокус на чипе: Popover слушает клавишу только внутри своего окна, а фокус остаётся на кнопке.
  useEffect(() => {
    if (!opened) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpened(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [opened]);
  if (citation.kind === "link") {
    return (
      <span className={classes.link}>
        <LawRefChip label={citationChipLabel(citation)} href={citation.url} external />
        {citation.note !== "" && <span className={classes.linkNote}>{citation.note}</span>}
      </span>
    );
  }
  const label = citationChipLabel(citation);
  const chip = (
    <LawRefChip
      label={label}
      expanded={opened}
      ariaLabel={t("law.chip", { label })}
      onClick={() => setOpened((value) => !value)}
    />
  );
  const quote = <Quote citation={citation} />;
  if (phone) {
    return (
      <>
        {chip}
        <Sheet
          opened={opened}
          onClose={() => setOpened(false)}
          title={t("law.sheetTitle")}
          position="bottom"
        >
          {quote}
        </Sheet>
      </>
    );
  }
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={440}
      position="bottom-start"
      shadow="md"
      withArrow
      trapFocus={false}
    >
      <Popover.Target>{chip}</Popover.Target>
      <Popover.Dropdown aria-label={citationSource(citation)}>{quote}</Popover.Dropdown>
    </Popover>
  );
}

function Quote({ citation }: { readonly citation: QuoteCitation }) {
  const { t } = useTranslation("assistant");
  return (
    <CitationQuote
      citation={citation}
      warning={citation.changedSince ? t("law.changedQuote") : undefined}
    />
  );
}

export function LawAnswerView({ data }: { readonly data: unknown }) {
  const parsed = LawAnswerData.safeParse(data);
  if (!parsed.success) return <Unavailable />;
  const answer = parsed.data;
  const renderCite = (n: number) => {
    const citation = answer.citations[n - 1];
    return citation === undefined ? null : <Cite citation={citation} />;
  };
  const text = answer.parts
    .map((part) =>
      part.type === "text" ? part.text : `[${String(part.n)}](cite:${String(part.n)})`,
    )
    .join("");
  return (
    <>
      {text !== "" && <Markdown renderCite={renderCite}>{text}</Markdown>}
      {answer.notices.map((notice) =>
        notice.kind === "disclaimer" ? (
          <p key={`${notice.kind}-${notice.text}`} className={classes.disclaimer}>
            <Info size={14} strokeWidth={1.8} aria-hidden />
            {notice.text}
          </p>
        ) : (
          <p key={`${notice.kind}-${notice.text}`} className={classes.notice}>
            <TriangleAlert size={14} strokeWidth={1.8} aria-hidden />
            {notice.text}
          </p>
        ),
      )}
    </>
  );
}
