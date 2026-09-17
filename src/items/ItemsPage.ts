import { Component, Notice } from "obsidian";
import { ItemService } from "./ItemService";
import { blankItem, itemMetrics, matchesItem, type Item } from "./model";
import { itemDisplayState, matchesItemFilter, normalizeItemDateInput, isValidItemDateInput, type ItemFilter } from "./itemPresentation";

export class ItemsPage extends Component {
  private body!: HTMLElement;
  private listEl!: HTMLElement;
  private countEl!: HTMLElement;
  private query = "";
  private filter: ItemFilter = "all";
  private screen: "list" | "detail" | "edit" = "list";
  private selected?: string;
  private urls: string[] = [];
  private generation = 0;
  private busy = false;
  constructor(private readonly container: HTMLElement, private readonly service: ItemService) { super(); }
  override onload(): void { this.container.addClass("doudou-items-page"); this.home(); }
  override onunload(): void { this.releaseUrls(); this.generation++; }
  private releaseUrls(): void { this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls = []; }
  private reset(): HTMLElement {
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
    const heading = body.createDiv({ cls: "doudou-items-heading" });
    heading.createEl("h2", { text: "小物库" });
    this.countEl = heading.createSpan({ cls: "doudou-items-count", attr: { "aria-live": "polite" } });
    const toolbar = body.createDiv({ cls: "doudou-items-toolbar" });
    const search = toolbar.createEl("input", { attr: { type: "search", placeholder: "搜索名称或备注", "aria-label": "搜索小物库" } }); search.value = this.query;
    search.addEventListener("input", () => { this.query = search.value; void this.refresh(); });
    const filters = body.createDiv({ cls: "doudou-items-filters", attr: { role: "group", "aria-label": "物品筛选" } });
    for (const [value, label] of [["all", "全部"], ["active", "使用中"], ["stock", "库存"], ["restock", "待补货"], ["history", "历史"]] as const) {
      const button = this.button(filters, label, async () => {
        this.filter = value;
        for (const entry of Array.from(filters.querySelectorAll("button"))) {
          const selected = entry === button; entry.toggleClass("doudou-is-selected", selected); entry.setAttribute("aria-pressed", String(selected));
        }
        await this.refresh();
      });
      button.addClass(`doudou-item-filter-${value}`);
      button.toggleClass("doudou-is-selected", this.filter === value); button.setAttribute("aria-pressed", String(this.filter === value));
    }
    this.listEl = body.createDiv({ cls: "doudou-items-list", attr: { "aria-live": "polite" } }); void this.refresh();
  }
  create(): void { if (this.screen === "edit") return; this.edit(blankItem()); }
  async refresh(): Promise<void> {
    if (this.screen === "edit") return;
    const generation = ++this.generation;
    try {
      const items = await this.service.list();
      if (generation !== this.generation) return;
      if (this.screen === "detail") {
        const item = items.find(i => i.id === this.selected);
        if (item) this.detail(item); else this.home(); return;
      }
      this.listEl.empty();
      this.countEl.setText(`${items.length} 件`);
      const matches = items.filter(item => matchesItem(item, this.query) && matchesItemFilter(item, this.filter));
      if (!matches.length) this.listEl.createEl("p", { cls: "doudou-items-empty", text: this.query || this.filter !== "all" ? "没有找到符合条件的物品。" : "还空着呢。点顶部 +，收进第一件物品吧。" });
      for (const item of matches) {
        const card = this.listEl.createDiv({ cls: "doudou-item-card" });
        const open = this.button(card, "", () => this.detail(item)); open.addClass("doudou-item-open");
        const visual = open.createSpan({ cls: "doudou-item-visual" });
        const placeholder = visual.createSpan({ cls: "doudou-item-initial", text: Array.from(item.name.trim())[0] ?? "·", attr: { "aria-hidden": "true" } });
        const source = item.photos[0] ? this.service.resource(item.photos[0]) : "";
        if (source) {
          placeholder.hidden = true;
          const image = visual.createEl("img", { attr: { src: source, alt: "", loading: "lazy" } });
          image.addEventListener("error", () => { image.remove(); placeholder.hidden = false; }, { once: true });
        }
        const text = open.createSpan({ cls: "doudou-item-copy" });
        text.createEl("strong", { cls: "doudou-item-name", text: item.name, attr: { title: item.name } });
        this.cardInfo(text, item);
        if (item.kind === "single" && item.purchased) text.createSpan({ cls: "doudou-item-date", text: `购于 ${item.purchased}` });
        const side = card.createDiv({ cls: "doudou-item-side" });
        const state = itemDisplayState(item);
        const label = state === "history" ? item.kind === "single" ? "已退役" : "不再买" : state === "restock" ? "待补货" : state === "active" ? "使用中" : "库存";
        side.createSpan({ cls: `doudou-item-badge doudou-item-badge-${state}`, text: label });
        if (item.kind === "stock") this.stockControls(side, item);
      }
    } catch (error) {
      if (generation !== this.generation) return;
      const message = error instanceof Error ? error.message : "小物库加载失败";
      if (this.screen === "list") this.listEl?.setText(message); else new Notice(message);
    }
  }
  private cardInfo(parent: HTMLElement, item: Item): void {
    const info = parent.createSpan({ cls: "doudou-item-info" });
    if (item.kind === "stock") {
      info.createSpan({ text: "还剩 ", cls: "doudou-item-caption" });
      info.createEl("b", { text: String(item.quantity), cls: "doudou-item-quantity" });
      info.createSpan({ text: " 件", cls: "doudou-item-caption" });
      return;
    }
    const metrics = itemMetrics(item);
    const details = [item.price === undefined ? undefined : `¥${item.price.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`, metrics.days === undefined ? undefined : `${metrics.days} 天`, metrics.daily === undefined ? undefined : `¥${metrics.daily.toFixed(2)}/天`].filter(Boolean);
    info.setText(details.join(" · "));
  }
  private summary(item: Item): string {
    if (item.kind === "stock") return `${item.noRestock ? "不再买" : item.quantity === 0 ? "待补货" : "库存"} · ${item.quantity} 件`;
    const metrics = itemMetrics(item);
    return [item.status === "active" ? "使用中" : "已退役", metrics.days === undefined ? undefined : `已经陪你 ${metrics.days} 天`, metrics.daily === undefined ? undefined : `¥${metrics.daily.toFixed(2)}/天`].filter(Boolean).join(" · ");
  }
  private stockControls(parent: HTMLElement, item: Item): void {
    const controls = parent.createDiv({ cls: "doudou-item-stepper", attr: { role: "group", "aria-label": `${item.name} 数量调节` } });
    const minus = this.button(controls, "−", async () => { await this.service.adjust(item.id, -1); await this.refresh(); }); minus.disabled = item.quantity === 0; minus.setAttribute("aria-label", `${item.name} 减少 1 件`);
    controls.createSpan({ cls: "doudou-item-stepper-value", text: String(item.quantity), attr: { "aria-label": `数量 ${item.quantity}` } });
    this.button(controls, "+", async () => { await this.service.adjust(item.id, 1); await this.refresh(); }).setAttribute("aria-label", `${item.name} 增加 1 件`);
  }
  private detail(item: Item): void {
    this.screen = "detail"; this.selected = item.id; const body = this.reset();
    this.button(body, "‹ 返回小物库", () => this.home());
    body.createEl("h2", { text: item.name }); body.createEl("p", { text: this.summary(item), cls: "doudou-items-muted" });
    if (item.kind === "stock") this.stockControls(body, item);
    else {
      body.createEl("p", { text: `购买日期：${item.purchased ?? "未填写"}　购买价格：${item.price === undefined ? "未填写" : `¥${item.price.toFixed(2)}`}` });
      if (item.status === "retired") body.createEl("p", { text: `退役日期：${item.retired ?? "未填写（暂不计算拥有天数和日均价）"}` });
    }
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
    const draft = { ...original, photos: [...original.photos] }; const pending: File[] = [];
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
    const kind = { value: draft.kind };
    const status = { value: original.revision ? draft.status : "active" as Item["status"] };
    const segment = <T extends string>(label: string, options: readonly (readonly [T, string])[], current: T, select: (value: T) => void): HTMLElement => {
      const group = form.createDiv({ cls: "doudou-item-segments", attr: { role: "group", "aria-label": label } });
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
    segment("物品类型", [["single", "单件"], ["stock", "库存"]] as const, kind.value, value => { kind.value = value; updateVisibility(); });
    const name = field("名称（必填）", "text", draft.name); name.required = true;
    const purchased = field("购买日期", "text", draft.purchased ?? "");
    purchased.inputMode = "numeric"; purchased.placeholder = "例如 20260620"; purchased.maxLength = 10;
    purchased.addEventListener("blur", () => { purchased.value = normalizeItemDateInput(purchased.value); });
    purchased.addEventListener("input", () => purchased.setCustomValidity(""));
    const price = field("购买价格（元）", "number", draft.price?.toString() ?? ""); price.min = "0"; price.step = "any";
    price.inputMode = "decimal";
    const purchaseRow = form.createDiv({ cls: "doudou-item-purchase-row" });
    purchaseRow.append(purchased.parentElement!, price.parentElement!);
    const statusGroup = segment("物品状态", [["active", "使用中"], ["retired", "已退役"]] as const, status.value, value => { status.value = value; updateVisibility(); });
    const restock = { value: draft.noRestock === true ? "stop" : "continue" };
    const restockGroup = segment("补货计划", [["continue", "继续补货"], ["stop", "不再买"]] as const, restock.value, value => { restock.value = value; });
    const retired = field("退役日期", "date", draft.retired ?? "");
    const quantity = field("数量", "number", String(draft.quantity)); quantity.min = "0"; quantity.step = "1";
    const updateVisibility = (): void => {
      purchaseRow.hidden = kind.value !== "single";
      if (kind.value !== "single") purchased.setCustomValidity("");
      [purchased, price].forEach(input => { input.parentElement!.hidden = kind.value !== "single"; input.disabled = kind.value !== "single"; });
      statusGroup.hidden = !original.revision || kind.value !== "single";
      restockGroup.hidden = !original.revision || kind.value !== "stock";
      retired.parentElement!.hidden = statusGroup.hidden || status.value !== "retired"; retired.disabled = retired.parentElement!.hidden;
      quantity.parentElement!.hidden = kind.value !== "stock"; quantity.disabled = kind.value !== "stock";
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
      if (kind.value === "single" && !isValidItemDateInput(purchased.value)) {
        purchased.setCustomValidity("请输入有效日期，例如 20260620 或 2026-06-20"); purchased.reportValidity(); return;
      }
      this.busy = true; save.disabled = true; cancel.disabled = true;
      const next: Item = { ...draft, kind: kind.value as Item["kind"], name: name.value, notes: notes.value, purchased: kind.value === "single" ? purchased.value || undefined : draft.purchased, price: kind.value === "single" ? (price.value === "" ? undefined : Number(price.value)) : draft.price, status: status.value as Item["status"], retired: status.value === "retired" ? retired.value || undefined : undefined, quantity: quantity.value === "" ? 0 : Number(quantity.value), noRestock: kind.value === "stock" ? restock.value === "stop" : undefined };
      void this.service.save(next, pending).then(item => this.detail(item)).catch(error => new Notice(error instanceof Error ? error.message : "保存失败，草稿已保留")).finally(() => { this.busy = false; save.disabled = false; cancel.disabled = false; });
    });
  }
}
