// Генератор тестов изоляции (ROLE-01, SEC-04, ARCHITECTURE §6.2 замок 5, §12): по реестрам процедур и инструментов
// агента строит случаи «пользователь A вызывает с id из домохозяйства B». Реестры приходят аргументом — пакет тестов
// сервер не импортирует; сам тест живёт на сервере (apps/server/src/main/isolation.*.int.test.ts) и вызывает
// процедуры по-настоящему. Новая процедура или инструмент без фикстуры — проблема с подсказкой «добавьте фикстуру»:
// тест краснеет, пока автор не скажет, как собрать вход из чужих id, или явно не объяснит, почему проверять нечего.

/** Как процедура пускает: по сессии (authed, admin), без неё (public) или только с локального входа (local). */
export type ProcedureAccess = "authed" | "admin" | "public" | "local";

/** Как собрать вход вызова из данных чужого домохозяйства (B), посеянных тестом. */
export interface IsolationFixture<Seed> {
  readonly input: (foreign: Seed) => unknown;
}

/** Проверять нечего — с причиной (публичная процедура без данных, поток, проверенный своим тестом). */
export interface IsolationExemption {
  readonly exempt: string;
}

export type IsolationEntry<Seed> = IsolationFixture<Seed> | IsolationExemption;

export interface IsolationCase<Seed> {
  readonly kind: "procedure" | "tool";
  /** Путь процедуры («accounts.list») или имя инструмента («list_accounts»). */
  readonly name: string;
  /** Для процедуры — как она пускает; у инструмента всегда scope запуска агента. */
  readonly access: ProcedureAccess | "agent";
  readonly input: (foreign: Seed) => unknown;
}

export interface IsolationPlan<Seed> {
  readonly cases: readonly IsolationCase<Seed>[];
  /** Пропущенные с причиной: «путь — причина». */
  readonly exempted: readonly string[];
  /** Что мешает тесту быть полным: нет фикстуры, лишняя фикстура, процедура не реализована. */
  readonly problems: readonly string[];
}

export interface GenerateOptions<Seed> {
  /** Дерево контракта (@kosht/contract): процедура — объект с полем «~orpc». */
  readonly contract: object;
  /** Реализованные процедуры сервера: путь → доступ (по middleware). */
  readonly procedures: Readonly<Record<string, ProcedureAccess>>;
  /** Имена инструментов агента из реестра. */
  readonly tools: Iterable<string>;
  /** Ключ — путь процедуры или «tool:<имя>». */
  readonly fixtures: Readonly<Record<string, IsolationEntry<Seed>>>;
}

/** Пути процедур дерева контракта («system.health»), по алфавиту. */
export function contractProcedurePaths(contract: object, prefix = ""): string[] {
  if ("~orpc" in contract) return [prefix];
  return Object.entries(contract)
    .flatMap(([key, child]: [string, unknown]) =>
      typeof child === "object" && child !== null
        ? contractProcedurePaths(child, prefix === "" ? key : `${prefix}.${key}`)
        : [],
    )
    .toSorted();
}

const hint = (key: string) =>
  `«${key}»: добавьте фикстуру изоляции — fixtures["${key}"] = { input: (b) => вход с id домохозяйства B } ` +
  `или { exempt: "почему проверять нечего" } (apps/server/src/main/isolation.registry.int.test.ts)`;

export function generate<Seed>(options: GenerateOptions<Seed>): IsolationPlan<Seed> {
  const cases: IsolationCase<Seed>[] = [];
  const exempted: string[] = [];
  const problems: string[] = [];
  const used = new Set<string>();

  const plan = (
    key: string,
    entry: IsolationEntry<Seed> | undefined,
    make: (f: IsolationFixture<Seed>) => IsolationCase<Seed>,
  ) => {
    if (entry === undefined) {
      problems.push(hint(key));
      return;
    }
    used.add(key);
    if ("exempt" in entry) {
      if (entry.exempt.trim().length < 10)
        problems.push(`«${key}»: причина исключения — словами, не короче 10 символов`);
      else exempted.push(`${key} — ${entry.exempt}`);
      return;
    }
    cases.push(make(entry));
  };

  for (const path of contractProcedurePaths(options.contract)) {
    const access = options.procedures[path];
    if (access === undefined) {
      problems.push(`«${path}»: процедуры нет в дереве сервера — тест изоляции её не вызовет`);
      continue;
    }
    plan(path, options.fixtures[path], (f) => ({
      kind: "procedure",
      name: path,
      access,
      input: f.input,
    }));
  }
  for (const tool of [...options.tools].toSorted()) {
    const key = `tool:${tool}`;
    plan(key, options.fixtures[key], (f) => ({
      kind: "tool",
      name: tool,
      access: "agent",
      input: f.input,
    }));
  }
  for (const key of Object.keys(options.fixtures)) {
    if (!used.has(key))
      problems.push(`«${key}»: фикстура без процедуры или инструмента — уберите её`);
  }
  return { cases, exempted, problems };
}

/**
 * Пользовательские таблицы без владельца данных (PRIV-05/06): каждая userOwnedTable должна быть в defineUserData
 * какого-то модуля — иначе экспорт «Мои данные» и удаление аккаунта её пропустят.
 */
export function uncoveredUserTables(
  userTables: Iterable<string>,
  owners: ReadonlyMap<string, { readonly tableNames: readonly string[] }>,
): string[] {
  const covered = new Set([...owners.values()].flatMap((owner) => owner.tableNames));
  return [...userTables].filter((table) => !covered.has(table)).toSorted();
}

/** Чужие id, найденные в ответе: ответ как JSON и каждый id B подстрокой (вложенность любая). */
export function leakedIds(output: unknown, foreignIds: Iterable<string>): string[] {
  const text = JSON.stringify(output) ?? "";
  return [...foreignIds].filter((id) => text.includes(id));
}
