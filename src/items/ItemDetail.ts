import type { ItemService } from "./ItemService";
import { cycleMetrics, itemMetrics, localDate, usageHistory, type Item, type UsageRecord } from "./model";
import { normalizeItemDateInput, statusLabel } from "./itemPresentation";

type ButtonFactory = (parent: HTMLElement, text: string, action: () => void | Promise<void>) => HTMLButtonElement;
interface DetailActions {
  button: ButtonFactory;
  service: ItemService;
  backLabel: string;
  back(): void;
  edit(): void;
  removed(): void;
  show(item: Item): void;
  stock(parent: HTMLElement): void;
  photo(parent: HTMLElement, path: string): void;
  beginUsageEdit(): void;
  cancelUsageEdit(): void;
}

function section(parent: HTMLElement, title: string, cls: string): HTMLElement {
  const block = parent.createEl("section", { cls: `doudou-item-detail-section ${cls}`, attr: { "aria-label": title } });
  block.createEl("h3", { text: title });
  return block;
}
function fields(parent: HTMLElement, entries: readonly (readonly [string, string])[]): void {
  const list = parent.createEl("dl", { cls: "doudou-item-detail-fields" });
  for (const [label, value] of entries) {
    list.createEl("dt", { text: label });
    list.createEl("dd", { text: value });
  }
}
function lightButton(actions: DetailActions, parent: HTMLElement, text: string, action: () => void | Promise<void>): HTMLButtonElement {
  const button = actions.button(parent, text, action);
  button.addClass("doudou-item-detail-light-action");
  return button;
}

/** Presentation only: delegates every mutation to the existing ItemService. */
export function renderItemDetail(body: HTMLElement, item: Item, actions: DetailActions): void {
  body.addClass("doudou-item-detail");
  const navigation = body.createDiv({ cls: "doudou-item-detail-nav" });
  lightButton(actions, navigation, actions.backLabel, actions.back).addClass("doudou-item-detail-back");
  const overview = body.createEl("header", { cls: "doudou-item-detail-overview" });
  overview.createEl("h2", { text: item.name });
  overview.createEl("p", { cls: "doudou-item-detail-status", text: [statusLabel(item), item.inventory?.enabled ? `库存 ${item.inventory.quantity} 件` : undefined].filter(Boolean).join(" · ") });

  if (item.inventory?.enabled) {
    const stock = section(body, "库存", "doudou-item-detail-stock");
    actions.stock(stock);
    if (item.inventory.noRestock) stock.createEl("p", { cls: "doudou-item-detail-caption", text: "不再买" });
  }
  const cycle = cycleMetrics(item);
  if (cycle) {
    const block = section(body, "使用周期", "doudou-item-detail-cycle");
    fields(block, [
      ["周期", `${item.cycle!.intervalDays} 天`],
      ["最近使用", cycle.latest],
      ["已使用", `${cycle.elapsed} 天`],
      ["下次提醒", cycle.next],
      [cycle.remaining < 0 ? "已超期" : cycle.remaining === 0 ? "提醒" : "还有", cycle.remaining === 0 ? "今天到期" : `${Math.abs(cycle.remaining)} 天`]
    ]);
  }
  const purchase = section(body, "购买信息", "doudou-item-detail-purchase");
  const metrics = itemMetrics(item);
  const purchaseFields: [string, string][] = [
    ["购买日期", item.purchased ?? "未填写"],
    ["购买价格", item.price === undefined ? "未填写" : `¥${item.price.toFixed(2)}`]
  ];
  if (metrics.days !== undefined) purchaseFields.push(["拥有天数", `${metrics.days} 天`]);
  if (metrics.daily !== undefined) purchaseFields.push(["日均价", `¥${metrics.daily.toFixed(2)}/天`]);
  if (item.status === "retired") purchaseFields.push(["退役日期", item.retired ?? "未填写（暂不计算拥有天数和日均价）"]);
  fields(purchase, purchaseFields);

  if (item.notes || item.photos.length) {
    const extra = section(body, "补充资料", "doudou-item-detail-extra");
    if (item.notes) extra.createEl("p", { text: item.notes, cls: "doudou-item-notes" });
    if (item.photos.length) {
      const photos = extra.createDiv({ cls: "doudou-items-photos" });
      item.photos.forEach(path => actions.photo(photos, path));
    }
  }
  renderUsage(body, item, actions);
  const footer = body.createDiv({ cls: "doudou-items-actions doudou-item-detail-actions", attr: { "aria-label": "物品操作" } });
  actions.button(footer, "编辑", actions.edit);
  actions.button(footer, "删除", () => {
    footer.empty(); footer.createEl("p", { text: "确认删除这件物品？关联照片将移入回收站。" });
    actions.button(footer, "取消", () => actions.show(item));
    actions.button(footer, "确认删除", async () => { await actions.service.delete(item); actions.removed(); });
  });
  if (item.cycle?.enabled) actions.button(footer, "重新计时", async () => actions.show(await actions.service.recordUsage(item)));
}

function renderUsage(parent: HTMLElement, item: Item, actions: DetailActions): void {
  const block = parent.createEl("section", { cls: "doudou-item-detail-section doudou-item-usage", attr: { "aria-label": "使用记录" } });
  const heading = block.createDiv({ cls: "doudou-item-detail-section-heading" });
  heading.createEl("h3", { text: "使用记录" });
  const editor = block.createDiv({ cls: "doudou-item-usage-editor" });
  const openEditor = (record?: UsageRecord): void => {
    actions.beginUsageEdit(); editor.empty();
    const label = editor.createEl("label", { text: record ? "编辑使用日期" : "补录使用日期" });
    const date = label.createEl("input", { attr: { type: "text", inputmode: "numeric", placeholder: "例如 20260620", "aria-label": "使用日期" } });
    date.value = record?.date ?? localDate();
    if (!record) editor.createEl("p", { cls: "doudou-item-detail-caption", text: "补充以前已使用但未记录的日期。" });
    const controls = editor.createDiv({ cls: "doudou-item-usage-editor-actions" });
    actions.button(controls, "保存", async () => actions.show(await actions.service.recordUsage(item, normalizeItemDateInput(date.value), record?.id)));
    if (record) lightButton(actions, controls, "删除记录", () => {
      editor.empty();
      editor.createEl("p", { text: item.usageRecords.length === 1 && item.cycle?.enabled ? "删除最后一条使用记录将同时关闭周期，是否继续？" : "确认删除这条使用记录？" });
      actions.button(editor, "取消", () => openEditor(record));
      actions.button(editor, "确认删除记录", async () => actions.show(await actions.service.deleteUsage(item, record.id)));
    });
    lightButton(actions, controls, "取消", actions.cancelUsageEdit);
    date.focus();
  };
  lightButton(actions, heading, "补录", () => openEditor());
  if (!item.usageRecords.length) block.createEl("p", { cls: "doudou-item-detail-caption", text: "暂无使用记录" });
  for (const record of usageHistory(item)) {
    const row = block.createDiv({ cls: "doudou-item-usage-row" });
    const copy = row.createDiv({ cls: "doudou-item-usage-copy" });
    copy.createEl("time", { text: record.date, attr: { datetime: record.date } });
    copy.createSpan({ cls: "doudou-item-detail-caption", text: record.interval === undefined ? "首次记录" : `距上次 ${record.interval} 天` });
    lightButton(actions, row, "编辑", () => openEditor(record)).setAttribute("aria-label", `编辑 ${record.date} 的使用记录`);
  }
}
