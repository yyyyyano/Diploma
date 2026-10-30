// Читалка акта: оглавление и текст по частям; статья или часть — `?article=`.
import { createFileRoute } from "@tanstack/react-router";
import { LawReaderPage, ReaderSearch } from "../../features/laws/index.ts";

export const Route = createFileRoute("/_public/laws/$pravoId")({
  validateSearch: ReaderSearch,
  component: () => <LawReaderPage pravoId={Route.useParams().pravoId} search={Route.useSearch()} />,
});
