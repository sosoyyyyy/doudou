export type EditableImageItem =
  | { kind: "stored"; id: string; path: string }
  | { kind: "pending"; id: string };

export type ImageOrderItem =
  | { kind: "stored"; path: string }
  | { kind: "pending"; index: number };

export function moveImageItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) {
    return [...items];
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return next;
  next.splice(to, 0, item);
  return next;
}

export function buildImageSavePlan(items: readonly EditableImageItem[]): {
  pendingIds: string[];
  order: ImageOrderItem[];
} {
  const pendingIds: string[] = [];
  const order = items.map((item): ImageOrderItem => {
    if (item.kind === "stored") return { kind: "stored", path: item.path };
    const index = pendingIds.length;
    pendingIds.push(item.id);
    return { kind: "pending", index };
  });
  return { pendingIds, order };
}

export function resolveImageOrder(
  order: readonly ImageOrderItem[],
  createdPaths: readonly string[]
): string[] {
  return order.map((item) => {
    if (item.kind === "stored") return item.path;
    const path = createdPaths[item.index];
    if (!path) throw new Error("Image order references a missing pending image");
    return path;
  });
}
