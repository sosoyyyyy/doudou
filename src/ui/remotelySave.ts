export interface RegisteredCommand {
  id: string;
  name: string;
}

export function findRemotelySaveStartSyncCommand(
  commands: readonly RegisteredCommand[]
): string | null {
  const matches = commands.flatMap((command) => {
    const id = normalize(command.id);
    const name = normalize(command.name);
    const belongsToRemotelySave = id.includes("remotely save") ||
      name.includes("remotely save");
    const startsSync = id.includes("start sync") ||
      name.includes("start sync") ||
      command.id.includes("开始同步") ||
      command.name.includes("开始同步");
    if (!belongsToRemotelySave || !startsSync) return [];

    const score = (id.includes("remotely save") ? 2 : 0) +
      (id.includes("start sync") ? 2 : 0) +
      (name.includes("start sync") || command.name.includes("开始同步") ? 1 : 0);
    return [{ id: command.id, score }];
  });
  matches.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return matches[0]?.id ?? null;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("en-US")
    .replace(/[：:（）()]/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
