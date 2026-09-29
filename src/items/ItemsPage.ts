import { renderItemCard } from "./ItemCard";
import { Component, Notice, setIcon } from "obsidian";
import { ItemService } from "./ItemService";
import { blankItem, cycleMetrics, itemMetrics, localDate, usageHistory, matchesItem, type Item } from "./model";
import { remainingLabel, reminderItems, statusLabel, matchesItemFilter, normalizeItemDateInput, isValidItemDateInput, type ItemFilter } from "./itemPresentation";

const itemFilterOptions: readonly (readonly [ItemFilter, string])[] = [["all", "全部"], ["active", "使用中"], ["idle", "闲置"], ["stock", "有库存"], ["restock", "待补货"], ["retired", "已退役"], ["nostock", "不再买"]];
const itemBadgeTone: Record<ItemFilter, string> = { all: "", active: "active", idle: "idle", stock: "stock", restock: "restock", retired: "retired", nostock: "nostock" };

export class ItemsPage extends Component {
  private body!: HTMLElement;
  private listEl!: HTMLElement;
  private countEl!: HTMLElement;
  private mode: "normal" | "reminders" = "normal";
  private listState = { normal: { query: "", scroll: 0 }, reminders: { query: "", scroll: 0 } };
  private editingUsage = false;
  private dayTimer?: ReturnType<typeof setInterval>;
  private lastDay = localDate();
  private wake = (): void => { if (localDate() !== this.lastDay) { this.lastDay = localDate(); void this.refresh(); } };
  private get query(): string { return this.listState[this.mode].query; }
  private set query(value: string) { this.listState[this.mode].query = value; }
  private filter: ItemFilter = "all";
  private screen: "list" | "detail" | "edit" = "list";
  private selected?: string;
  private urls: string[] = [];
  private generation = 0;
  private busy = false;
  private searchTimer?: ReturnType<typeof setTimeout>;
  constructor(private readonly container: HTMLElement, private readonly service: ItemService) { super(); }
  override onload(): void { this.container.addClass("doudou-items-page"); this.home(); this.dayTimer = setInterval(this.wake, 30000); window.addEventListener("focus", this.wake); document.addEventListener("visibilitychange", this.wake); }
  override onunload(): void { if (this.dayTimer) clearInterval(this.dayTimer); window.removeEventListener("focus", this.wake); document.removeEventListener("visibilitychange", this.wake); this.releaseUrls(); this.generation++; if (this.searchTimer) clearTimeout(this.searchTimer); }
  private releaseUrls(): void { this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls = []; }
  private reset(): HTMLElement {
    this.editingUsage = false;
    if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = undefined; }
    this.releaseUrls(); this.generation++; this.container.empty();
    this.body = this.container.createDiv({ cls: "doudou-items-body" }); return this.body;
  }
  private button(parent: HTMLElement, text: string, action: () => void | Promise<void>): HTMLButtonElement {
    const button = parent.createEl("button", { text, attr: { type: "button" } });
    button.addEventListener("click", () => {
      if (this.busy) return;
      this.busy = true; button.disabled = true;
      void Promise.resolve().then(action).catch(error => new Notice(error instanceof Error ? error.message : "操作失败，请重试")).finally(() => { this.busy = false; button.disabled = false; });
    }); return button;
  }
  home(): void {
    this.screen = "list"; this.selected = undefined;
    const body = this.reset(); body.addClass("doudou-items-home");
    const sticky = body.createDiv({ cls: "doudou-items-sticky" });
    const heading = sticky.createDiv({ cls: "doudou-items-heading" });
    heading.createEl("h2", { text: this.mode === "reminders" ? "小物库 · 提醒" : "小物库" });
    this.countEl = heading.createSpan({ cls: "doudou-items-count", attr: { "aria-live": "polite" } });
    const tools = heading.createDiv({ cls: "doudou-library-heading-tools" });
    const filterTool = tools.createEl("button", { cls: "doudou-round-tool doudou-tag-filter-tool", attr: { type: "button", "aria-label": "筛选小物库", "aria-expanded": "false" } }); setIcon(filterTool, "filter");
    filterTool.hidden = this.mode === "reminders";
    const reminder = this.button(tools, "", () => {
      this.listState[this.mode].scroll = this.listEl.scrollTop;
      this.mode = this.mode === "normal" ? "reminders" : "normal";
      this.home();
    });
    reminder.addClass("doudou-round-tool"); reminder.setAttribute("aria-label", this.mode === "normal" ? "查看周期提醒" : "返回普通小物库");
    reminder.setAttribute("aria-pressed", String(this.mode === "reminders")); setIcon(reminder, this.mode === "normal" ? "bell" : "arrow-left");
    const filterLabel = filterTool.createSpan({ cls: `doudou-item-badge doudou-item-filter-label${this.filter === "all" ? " doudou-item-filter-all" : ""}`, text: itemFilterOptions.find(([value]) => value === this.filter)?.[1] ?? "全部" });
    if (this.filter !== "all") filterLabel.addClass(`doudou-item-badge-${itemBadgeTone[this.filter]}`);
    const searchButton = tools.createEl("button", { cls: "doudou-round-tool", attr: { type: "button", "aria-label": "搜索小物库" } }); setIcon(searchButton, "search");
    const toolbar = sticky.createDiv({ cls: "doudou-items-toolbar" }); toolbar.hidden = !this.query;
    const search = toolbar.createEl("input", { attr: { type: "search", placeholder: "搜索名称或备注", "aria-label": "搜索小物库" } }); search.value = this.query;
    searchButton.addEventListener("click", () => { toolbar.hidden = !toolbar.hidden; if (!toolbar.hidden) search.focus(); else { this.query = ""; this.listState[this.mode].scroll = 0; search.value = ""; void this.refresh(); } });
    search.addEventListener("input", () => {
      this.query = search.value; this.listState[this.mode].scroll = 0;
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => { this.searchTimer = undefined; void this.refresh(); }, 250);
    });
    const filters = sticky.createDiv({ cls: "doudou-items-filters", attr: { role: "menu", "aria-label": "物品筛选" } }); filters.hidden = true;
    const toggleFilters = (): void => { filters.hidden = !filters.hidden; filterTool.setAttribute("aria-expanded", String(!filters.hidden)); };
    filterTool.addEventListener("click", toggleFilters);
    for (const [value, label] of itemFilterOptions) {
      const button = this.button(filters, "", async () => {
        this.filter = value; this.listState[this.mode].scroll = 0;
        for (const entry of Array.from(filters.querySelectorAll("button"))) {
          const selected = entry === button; entry.toggleClass("doudou-is-selected", selected); entry.setAttribute("aria-pressed", String(selected));
        }
        filterLabel.setText(label);
        filterLabel.toggleClass("doudou-item-filter-all", value === "all");
        for (const tone of Object.values(itemBadgeTone)) if (tone) filterLabel.removeClass(`doudou-item-badge-${tone}`);
        if (value !== "all") filterLabel.addClass(`doudou-item-badge-${itemBadgeTone[value]}`);
        filters.hidden = true; filterTool.setAttribute("aria-expanded", "false"); await this.refresh();
      });
      button.createSpan({ cls: `doudou-item-badge${value === "all" ? " doudou-item-filter-all" : ` doudou-item-badge-${itemBadgeTone[value]}`}`, text: label });
      button.toggleClass("doudou-is-selected", this.filter === value); button.setAttribute("aria-pressed", String(this.filter === value));
    }
    this.listEl = body.createDiv({ cls: "doudou-items-list", attr: { "aria-live": "polite" } });
    const list = this.listEl; const mode = this.mode;
    list.addEventListener("scroll", () => { this.listState[mode].scroll = list.scrollTop; });
    void this.refresh();
  }
  create(): void { if (this.screen === "edit") return; this.rememberScroll(); this.edit(blankItem()); }
  private rememberScroll(): void { if (this.screen === "list" && this.listEl) this.listState[this.mode].scroll = this.listEl.scrollTop; }
  async refresh(): Promise<void> {
    if (this.screen === "edit" || this.editingUsage) return;
    const generation = ++this.generation;
    try {
      const items = await this.service.list();
      if (generation !== this.generation) return;
      if (this.screen === "detail") {
        const item = items.find(i => i.id === this.selected);
        if (item) this.detail(item); else this.home(); return;
      }
      this.listEl.empty();
      const source = this.mode === "reminders" ? reminderItems(items) : items.filter(item => matchesItemFilter(item, this.filter));
      const matches = source.filter(item => matchesItem(item, this.query));
      this.countEl.setText(`${matches.length} 件`);
      if (!matches.length) this.listEl.createEl("p", { cls: "doudou-items-empty", text: this.mode === "reminders" ? "没有符合条件的周期提醒。" : this.query || this.filter !== "all" ? "没有找到符合条件的物品。" : "还空着呢。点顶部 +，收进第一件物品吧。" });
      for (const item of matches) renderItemCard(this.listEl, item, this.service, this.button.bind(this), () => { this.rememberScroll(); this.detail(item); }, side => this.stockControls(side, item, false));
      this.listEl.scrollTop = this.listState[this.mode].scroll;
    } catch (error) {
      if (generation !== this.generation) return;
      const message = error instanceof Error ? error.message : "小物库加载失败";
      if (this.screen === "list") this.listEl?.setText(message); else new Notice(message);
    }
  }
  private summary(item: Item): string {
    const metrics = itemMetrics(item);
    return [statusLabel(item), item.inventory?.enabled ? "库存 " + item.inventory.quantity + " 件" : undefined, item.inventory?.enabled && item.inventory.noRestock ? "不再买" : undefined, metrics.days === undefined ? undefined : "拥有 " + metrics.days + " 天", metrics.daily === undefined ? undefined : "¥" + metrics.daily.toFixed(2) + "/天"].filter(Boolean).join(" · ");
  }
  private stockControls(parent: HTMLElement, item: Item, showValue = true): void {
    const controls = parent.createDiv({ cls: "doudou-item-stepper", attr: { role: "group", "aria-label": `${item.name} 数量调节` } });
    const minus = this.button(controls, "−", async () => { this.rememberScroll(); await this.service.adjust(item.id, -1); await this.refresh(); }); minus.disabled = item.inventory!.quantity === 0; minus.setAttribute("aria-label", `${item.name} 减少 1 件`);
    if (showValue) controls.createSpan({ cls: "doudou-item-stepper-value", text: String(item.inventory!.quantity), attr: { "aria-label": `数量 ${item.inventory!.quantity}` } });
    this.button(controls, "+", async () => { this.rememberScroll(); await this.service.adjust(item.id, 1); await this.refresh(); }).setAttribute("aria-label", `${item.name} 增加 1 件`);
  }
  private detail(item: Item): void {
    this.screen = "detail"; this.selected = item.id; const body = this.reset();
    this.button(body, this.mode === "reminders" ? "‹ 返回提醒" : "‹ 返回小物库", () => this.home());
    body.createEl("h2", { text: item.name }); body.createEl("p", { text: this.summary(item), cls: "doudou-items-muted" });
    if (item.inventory?.enabled) this.stockControls(body, item);
    if (item.inventory && !item.inventory.enabled) body.createEl("p", { text: "库存管理已停用，保留 " + item.inventory.quantity + " 件" + (item.inventory.noRestock ? " · 不再买" : "") });
    body.createEl("p", { text: `购买日期：${item.purchased ?? "未填写"}　购买价格：${item.price === undefined ? "未填写" : `¥${item.price.toFixed(2)}`}` });
    if (item.status === "retired") body.createEl("p", { text: `退役日期：${item.retired ?? "未填写（暂不计算拥有天数和日均价）"}` });
    const cycle = cycleMetrics(item);
    if (cycle) body.createEl("p", { cls: "doudou-item-cycle-summary", text: "周期 " + item.cycle!.intervalDays + " 天 · 最近使用 " + cycle.latest + " · 本轮已用 " + cycle.elapsed + " 天 · 下次 " + cycle.next + " · " + remainingLabel(cycle.remaining) });
    else if (item.cycle) body.createEl("p", { text: "周期已关闭，使用记录仍保留" });
    this.usageSection(body, item);
    body.createEl("p", { text: item.notes, cls: "doudou-item-notes" });
    const photos = body.createDiv({ cls: "doudou-items-photos" });
    item.photos.forEach(path => this.photo(photos, this.service.resource(path), item.name));
    const actions = body.createDiv({ cls: "doudou-items-actions" });
    this.button(actions, "编辑", () => this.edit(item));
    this.button(actions, "删除", () => {
      actions.empty(); actions.createEl("p", { text: "确认删除这件物品？关联照片将移入回收站。" });
      this.button(actions, "取消", () => this.detail(item));
      this.button(actions, "确认删除", async () => { await this.service.delete(item); this.home(); });
    });
    if (item.cycle?.enabled) this.button(actions, "重新计时", async () => this.detail(await this.service.recordUsage(item)));
  }

  private usageSection(parent: HTMLElement, item: Item): void {
    const section = parent.createDiv({ cls: "doudou-item-usage" });
    section.createEl("h3", { text: "使用记录" });
    const editorHost = section.createDiv({ cls: "doudou-item-usage-editor" });
    const openEditor = (record?: { id: string; date: string }): void => {
      this.editingUsage = true; this.generation++; editorHost.empty();
      const label = editorHost.createEl("label", { text: record ? "修改使用日期" : "新增使用日期" });
      const date = label.createEl("input", { attr: { type: "text", inputmode: "numeric", placeholder: "例如 20260620", "aria-label": "使用日期" } }); date.value = record?.date ?? localDate();
      this.button(editorHost, "保存日期", async () => { const saved = await this.service.recordUsage(item, normalizeItemDateInput(date.value), record?.id); this.detail(saved); });
      this.button(editorHost, "取消", () => { this.editingUsage = false; void this.refresh(); }); date.focus();
    };
    this.button(section, "新增记录", () => openEditor());
    if (!item.usageRecords.length) section.createEl("p", { text: "暂无使用记录" });
    for (const record of usageHistory(item)) {
      const row = section.createDiv({ cls: "doudou-item-usage-row" });
      row.createSpan({ text: record.date + "　" + (record.interval === undefined ? "首次记录" : "距上次 " + record.interval + " 天") });
      this.button(row, "修改日期", () => openEditor(record));
      this.button(row, "删除记录", () => {
        this.editingUsage = true; this.generation++; editorHost.empty();
        editorHost.createEl("p", { text: item.usageRecords.length === 1 && item.cycle?.enabled ? "删除最后一条使用记录将同时关闭周期，是否继续？" : "确认删除这条使用记录？" });
        this.button(editorHost, "取消", () => { this.editingUsage = false; void this.refresh(); });
        this.button(editorHost, "确认删除记录", async () => this.detail(await this.service.deleteUsage(item, record.id)));
      });
    }
  }
  private photo(parent: HTMLElement, source: string, name: string): void {
    const open = this.button(parent, "", () => {
      const overlay = this.container.createDiv({ cls: "doudou-item-lightbox", attr: { role: "dialog", "aria-label": "查看原图" } });
      const close = this.button(overlay, "关闭原图", () => overlay.remove());
      overlay.createEl("img", { attr: { src: source, alt: name } }); close.focus();
      overlay.addEventListener("keydown", event => { if (event.key === "Escape") { overlay.remove(); open.focus(); } });
    });
    open.createEl("img", { attr: { src: source, alt: name, loading: "lazy" } });
  }
  private edit(original: Item): void {
    this.screen = "edit"; const body = this.reset();
    body.addClass("doudou-items-edit-shell");
    const draft: Item = JSON.parse(JSON.stringify(original)); const pending: File[] = [];
    const header = body.createDiv({ cls: "doudou-record-header doudou-editor-header doudou-items-editor-header" });
    header.createEl("h2", { text: original.revision ? "编辑物品" : "收进小物库" });
    const actions = header.createDiv({ cls: "doudou-editor-actions" });
    const cancel = this.button(actions, "取消", () => original.revision ? this.detail(original) : this.home());
    cancel.addClass("doudou-secondary-button");
    const save = actions.createEl("button", { cls: "doudou-primary-button", text: "保存", attr: { type: "button" } });
    const form = body.createEl("form", { cls: "doudou-items-editor-form" });
    save.addEventListener("click", () => form.requestSubmit());
    const field = (title: string, type: string, value: string): HTMLInputElement => {
      const label = form.createEl("label", { text: title }); const input = label.createEl("input", { attr: { type } }); input.value = value; return input;
    };
    const inventoryEnabled = { value: draft.inventory?.enabled ? "on" : "off" };
    const cycleEnabled = { value: draft.cycle?.enabled ? "on" : "off" };
    const status = { value: draft.status };
    const segment = <T extends string>(label: string, options: readonly (readonly [T, string])[], current: T, select: (value: T) => void): HTMLElement => {
      const group = form.createDiv({ cls: "doudou-item-segments", attr: { role: "group", "aria-label": label } });
      group.createSpan({ cls: "doudou-item-segment-title", text: label });
      for (const [value, text] of options) {
        const button = group.createEl("button", { text, attr: { type: "button", "aria-pressed": String(value === current) } });
        button.addEventListener("click", () => {
          if (this.busy) return;
          for (const entry of Array.from(group.querySelectorAll("button"))) entry.setAttribute("aria-pressed", String(entry === button));
          select(value);
        });
      }
      return group;
    };
    const name = field("名称（必填）", "text", draft.name); name.required = true;
    const cover = field("封面字（可选）", "text", draft.cover ?? ""); cover.maxLength = 2; cover.placeholder = "默认使用名称首字";
    cover.addEventListener("input", () => { const chars = Array.from(cover.value); cover.value = chars[0] ?? ""; });
    const purchased = field("购买日期", "text", draft.purchased ?? "");
    purchased.inputMode = "numeric"; purchased.placeholder = "例如 20260620"; purchased.maxLength = 10;
    purchased.addEventListener("blur", () => { purchased.value = normalizeItemDateInput(purchased.value); });
    purchased.addEventListener("input", () => purchased.setCustomValidity(""));
    const price = field("购买价格（元）", "number", draft.price?.toString() ?? ""); price.min = "0"; price.step = "any";
    price.inputMode = "decimal";
    const purchaseRow = form.createDiv({ cls: "doudou-item-purchase-row" });
    purchaseRow.append(purchased.parentElement!, price.parentElement!);
    segment("物品状态", [["active", "使用中"], ["idle", "闲置"], ["retired", "已退役"]] as const, status.value ?? "", value => { status.value = value as Item["status"]; if (value === "retired" && !retired.value) retired.value = localDate(); updateVisibility(); });
    if (draft.status === null) form.createEl("p", { text: "旧库存物品尚未设置状态，可选择使用中、闲置或已退役。", cls: "doudou-items-muted" });
    segment("库存管理", [["off", "停用"], ["on", "启用"]], inventoryEnabled.value, value => { inventoryEnabled.value = value; updateVisibility(); });
    form.createEl("p", { text: "停用后保留库存数量及补货意愿，再次启用即可恢复。", cls: "doudou-items-muted" });
    const restock = { value: draft.inventory?.noRestock === true ? "stop" : "continue" };
    const restockGroup = segment("补货计划", [["continue", "继续补货"], ["stop", "不再买"]] as const, restock.value, value => { restock.value = value; });
    const retired = field("退役日期", "text", draft.retired ?? ""); retired.inputMode = "numeric"; retired.placeholder = "例如 20260620"; retired.maxLength = 10; retired.addEventListener("blur", () => { retired.value = normalizeItemDateInput(retired.value); });
    const quantity = field("数量", "number", String(draft.inventory?.quantity ?? 0)); quantity.min = "0"; quantity.step = "1";
    segment("使用周期", [["off", "关闭"], ["on", "开启"]], cycleEnabled.value, value => { cycleEnabled.value = value; updateVisibility(); });
    const interval = field("使用周期（天）", "number", String(draft.cycle?.intervalDays ?? 30)); interval.min = "1"; interval.step = "1";
    const firstUsage = field("首次使用日期", "text", localDate()); firstUsage.inputMode = "numeric"; firstUsage.placeholder = "例如 20260620";
    const updateVisibility = (): void => {
      retired.parentElement!.hidden = status.value !== "retired"; retired.disabled = retired.parentElement!.hidden;
      restockGroup.hidden = inventoryEnabled.value !== "on";
      quantity.parentElement!.hidden = inventoryEnabled.value !== "on"; quantity.disabled = quantity.parentElement!.hidden;
      interval.parentElement!.hidden = cycleEnabled.value !== "on"; interval.disabled = interval.parentElement!.hidden;
      firstUsage.parentElement!.hidden = cycleEnabled.value !== "on" || draft.usageRecords.length > 0; firstUsage.disabled = firstUsage.parentElement!.hidden;
    }; updateVisibility();
    const notes = form.createEl("label", { text: "备注" }).createEl("textarea"); notes.value = draft.notes; notes.rows = 3;
    const photos = form.createDiv({ cls: "doudou-items-photos" });
    const renderPhotos = (): void => {
      photos.empty(); this.releaseUrls();
      draft.photos.forEach(path => { const tile = photos.createDiv(); this.photo(tile, this.service.resource(path), draft.name); this.button(tile, "移除照片", () => { draft.photos = draft.photos.filter(p => p !== path); renderPhotos(); }); });
      pending.forEach((file, index) => { const tile = photos.createDiv(); const url = URL.createObjectURL(file); this.urls.push(url); this.photo(tile, url, file.name); this.button(tile, "移除照片", () => { pending.splice(index, 1); renderPhotos(); }); });
    }; renderPhotos();
    const picker = form.createEl("input", { attr: { type: "file", hidden: "", "aria-label": "选择照片" } });
    picker.accept = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,image/avif"; picker.multiple = true;
    const photoActions = form.createDiv({ cls: "doudou-item-photo-actions" });
    const addPhoto = photoActions.createEl("button", { cls: "doudou-item-add-photo", text: "＋ 添加照片", attr: { type: "button" } });
    // Keep the native picker call in the trusted click event for mobile browsers.
    addPhoto.addEventListener("click", () => { if (!this.busy) picker.click(); });
    picker.addEventListener("change", () => { pending.push(...Array.from(picker.files ?? [])); picker.value = ""; renderPhotos(); });
    form.addEventListener("submit", event => {
      event.preventDefault(); if (this.busy) return;
      purchased.value = normalizeItemDateInput(purchased.value);
      if (!isValidItemDateInput(purchased.value)) {
        purchased.setCustomValidity("请输入有效日期，例如 20260620 或 2026-06-20"); purchased.reportValidity(); return;
      }
      this.busy = true; save.disabled = true; cancel.disabled = true;
      const next: Item = { ...draft, name: name.value, cover: cover.value || undefined, notes: notes.value,
        purchased: purchased.value || undefined, price: price.value === "" ? undefined : Number(price.value), status: status.value as Item["status"],
        retired: status.value === "retired" ? normalizeItemDateInput(retired.value) || undefined : draft.retired,
        inventory: inventoryEnabled.value === "on" ? { enabled: true, quantity: quantity.value === "" ? 0 : Number(quantity.value), noRestock: restock.value === "stop" } : draft.inventory ? { ...draft.inventory, enabled: false } : undefined,
        cycle: cycleEnabled.value === "on" ? { enabled: true, intervalDays: Number(interval.value) } : draft.cycle ? { ...draft.cycle, enabled: false } : undefined,
        usageRecords: cycleEnabled.value === "on" && !draft.usageRecords.length ? [{ id: crypto.randomUUID(), date: normalizeItemDateInput(firstUsage.value) }] : draft.usageRecords
      };
      void this.service.save(next, pending).then(item => this.detail(item)).catch(error => new Notice(error instanceof Error ? error.message : "保存失败，草稿已保留")).finally(() => { this.busy = false; save.disabled = false; cancel.disabled = false; });
    });
  }
}
