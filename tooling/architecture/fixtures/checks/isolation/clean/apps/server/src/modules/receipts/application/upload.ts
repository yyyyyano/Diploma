// makeScope и «as Scope» здесь нельзя — scope приходит в s (ARCHITECTURE §6.4).
export async function upload(s: ScopedDb, runner: Runner, files: FileId[]) {
  const note = "as Scope и makeScope в строке — не код";
  await runner.execute(files);
  return { owner: s.scope.userId, note };
}
