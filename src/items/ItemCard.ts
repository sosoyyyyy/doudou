import { ItemService } from "./ItemService";
import { cycleMetrics, itemMetrics, type Item } from "./model";
import { matchesItemFilter, remainingLabel, statusLabel } from "./itemPresentation";

type ButtonFactory = (parent: HTMLElement, text: string, action: () => void | Promise<void>) => HTMLButtonElement;
/** The only card renderer, shared unchanged by the ordinary and reminder lists. */
export function renderItemCard(parent: HTMLElement, item: Item, service: ItemService, button: ButtonFactory, openItem: () => void, stockControls: (parent: HTMLElement) => void): void {
  const card = parent.createDiv({ cls: "doudou-item-card" });
  const open = button(card, "", openItem); open.addClass("doudou-item-open");
  const visual = open.createSpan({ cls: "doudou-item-visual" });
  const placeholder = visual.createSpan({ cls: "doudou-item-initial", text: item.cover || Array.from(item.name.trim())[0] || "·", attr: { "aria-hidden": "true" } });
  const source = item.photos[0] ? service.resource(item.photos[0]) : "";
  if (source) {
    placeholder.hidden = true;
    const image = visual.createEl("img", { attr: { src: source, alt: "", loading: "lazy" } });
    image.addEventListener("error", () => { image.remove(); placeholder.hidden = false; }, { once: true });
  }
  const text = open.createSpan({ cls: "doudou-item-copy" });
  text.createEl("strong", { cls: "doudou-item-name", text: item.name, attr: { title: item.name } });
  const info = text.createSpan({ cls: "doudou-item-info" });
  const cycle = cycleMetrics(item);
  const inventory = item.inventory?.enabled ? item.inventory : undefined;
  if (cycle) info.appendText(`已用 ${cycle.elapsed} 天`);
  if (inventory) {
    if (cycle) info.appendText(" · ");
    info.appendText(matchesItemFilter(item, "restock") ? "待补货 " : "库存 ");
    info.createEl("b", { cls: "doudou-item-quantity", text: String(inventory.quantity) });
    if (inventory.noRestock) info.appendText(" · 不再买");
  } else if (!cycle) {
    const metrics = itemMetrics(item);
    info.setText([item.price === undefined ? undefined : `¥${item.price.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`, metrics.days === undefined ? undefined : `${metrics.days} 天`, metrics.daily === undefined ? undefined : `¥${metrics.daily.toFixed(2)}/天`].filter(Boolean).join(" · "));
  }
  info.setAttribute("title", info.textContent ?? "");
  const date = cycle ? remainingLabel(cycle.remaining) : item.purchased ? item.status === "retired" && item.retired ? `${item.purchased} → ${item.retired}` : `购于 ${item.purchased}` : "";
  text.createSpan({ cls: "doudou-item-date", text: date, attr: { title: date } });
  const side = card.createDiv({ cls: "doudou-item-side" });
  side.createSpan({ cls: `doudou-item-badge doudou-item-badge-${item.status ?? "nostock"}`, text: statusLabel(item) });
  if (inventory) stockControls(side);
}
