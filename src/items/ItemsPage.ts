import { Component, Notice } from "obsidian";
import { ItemService } from "./ItemService";
import { blankItem, itemMetrics, matchesItem, type Item } from "./model";
import { parseItemImport } from "./itemImport";

export class ItemsPage extends Component {
  private body!: HTMLElement;
  private listEl!: HTMLElement;
  private query = "";
  private screen: "list" | "detail" | "edit" | "import" = "list";
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
    const body = this.reset();
    body.createEl("h2", { text: "小物库" });
    body.createEl("p", { text: "把身边的物品，好好收在这里。", cls: "doudou-items-muted" });
    const search = body.createEl("input", { attr: { type: "search", placeholder: "找一件物品，或搜搜备注…", "aria-label": "搜索小物库" } }); search.value = this.query;
    search.addEventListener("input", () => { this.query = search.value; void this.refresh(); });
    const actions = body.createDiv({ cls: "doudou-items-actions" });
    this.button(actions, "+ 收进小物库", () => this.create());
    this.button(actions, "导入已有物品", () => this.chooseImport());
    this.listEl = body.createDiv({ cls: "doudou-items-list", attr: { "aria-live": "polite" } }); void this.refresh();
  }
  create(): void { if (this.screen === "edit") return; this.edit(blankItem()); }
  async refresh(): Promise<void> {
    if (this.screen === "edit" || this.screen === "import") return;
    const generation = ++this.generation;
    try {
      const items = await this.service.list();
      if (generation !== this.generation) return;
      if (this.screen === "detail") {
        const item = items.find(i => i.id === this.selected);
        if (item) this.detail(item); else this.home(); return;
      }
      this.listEl.empty();
      const matches = items.filter(item => matchesItem(item, this.query));
      if (!matches.length) this.listEl.createEl("p", { cls: "doudou-items-empty", text: this.query ? "没有找到，换个词试试。" : "还空着呢。先收进一件喜欢的物品吧。" });
      for (const item of matches) {
        const card = this.listEl.createDiv({ cls: "doudou-item-card" });
        const open = this.button(card, "", () => this.detail(item)); open.addClass("doudou-item-open");
        if (item.photos[0]) open.createEl("img", { attr: { src: this.service.resource(item.photos[0]), alt: "", loading: "lazy" } });
        const text = open.createSpan(); text.createEl("strong", { text: item.name }); text.createEl("small", { text: this.summary(item) });
        if (item.kind === "stock") this.stockControls(card, item);
      }
    } catch (error) {
      if (generation !== this.generation) return;
      const message = error instanceof Error ? error.message : "小物库加载失败";
      if (this.screen === "list") this.listEl?.setText(message); else new Notice(message);
    }
  }
  private summary(item: Item): string {
    if (item.kind === "stock") return `库存 · ${item.quantity} 件`;
    const metrics = itemMetrics(item);
    return [item.status === "active" ? "使用中" : "已退役", metrics.days === undefined ? undefined : `拥有 ${metrics.days} 天`, metrics.daily === undefined ? undefined : `¥${metrics.daily.toFixed(2)}/天`].filter(Boolean).join(" · ");
  }
  private stockControls(parent: HTMLElement, item: Item): void {
    const controls = parent.createDiv({ cls: "doudou-items-actions" });
    const minus = this.button(controls, "−1", async () => { await this.service.adjust(item.id, -1); await this.refresh(); }); minus.disabled = item.quantity === 0; minus.setAttribute("aria-label", `${item.name} 减少 1 件`);
    this.button(controls, "+1", async () => { await this.service.adjust(item.id, 1); await this.refresh(); }).setAttribute("aria-label", `${item.name} 增加 1 件`);
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
    const draft = { ...original, photos: [...original.photos] }; const pending: File[] = [];
    body.createEl("h2", { text: original.revision ? "编辑物品" : "收进小物库" });
    const form = body.createEl("form");
    const field = (title: string, type: string, value: string): HTMLInputElement => {
      const label = form.createEl("label", { text: title }); const input = label.createEl("input", { attr: { type } }); input.value = value; return input;
    };
    const kindLabel = form.createEl("label", { text: "物品类型" }); const kind = kindLabel.createEl("select");
    kind.createEl("option", { text: "单件物品", value: "single" }); kind.createEl("option", { text: "库存物品", value: "stock" }); kind.value = draft.kind;
    const name = field("名称（必填）", "text", draft.name); name.required = true;
    const purchased = field("购买日期", "date", draft.purchased ?? "");
    const price = field("购买价格（元）", "number", draft.price?.toString() ?? ""); price.min = "0"; price.step = "any";
    const statusLabel = form.createEl("label", { text: "状态" }); const status = statusLabel.createEl("select");
    status.createEl("option", { text: "使用中", value: "active" }); status.createEl("option", { text: "已退役", value: "retired" }); status.value = draft.status;
    const retired = field("退役日期", "date", draft.retired ?? "");
    const quantity = field("数量", "number", String(draft.quantity)); quantity.min = "0"; quantity.step = "1";
    const updateVisibility = (): void => {
      [purchased, price, status].forEach(input => { input.parentElement!.hidden = kind.value !== "single"; input.disabled = kind.value !== "single"; });
      retired.parentElement!.hidden = kind.value !== "single" || status.value !== "retired"; retired.disabled = retired.parentElement!.hidden;
      quantity.parentElement!.hidden = kind.value !== "stock"; quantity.disabled = kind.value !== "stock";
    }; kind.addEventListener("change", updateVisibility); status.addEventListener("change", updateVisibility); updateVisibility();
    const notes = form.createEl("label", { text: "备注" }).createEl("textarea"); notes.value = draft.notes; notes.rows = 4;
    const photos = form.createDiv({ cls: "doudou-items-photos" });
    const renderPhotos = (): void => {
      photos.empty(); this.releaseUrls();
      draft.photos.forEach(path => { const tile = photos.createDiv(); this.photo(tile, this.service.resource(path), draft.name); this.button(tile, "移除照片", () => { draft.photos = draft.photos.filter(p => p !== path); renderPhotos(); }); });
      pending.forEach((file, index) => { const tile = photos.createDiv(); const url = URL.createObjectURL(file); this.urls.push(url); this.photo(tile, url, file.name); this.button(tile, "移除照片", () => { pending.splice(index, 1); renderPhotos(); }); });
    }; renderPhotos();
    const picker = field("添加照片", "file", ""); picker.accept = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,image/avif"; picker.multiple = true;
    picker.addEventListener("change", () => { pending.push(...Array.from(picker.files ?? [])); picker.value = ""; renderPhotos(); });
    const actions = form.createDiv({ cls: "doudou-items-actions" });
    const save = actions.createEl("button", { text: "保存", attr: { type: "submit" } });
    this.button(actions, "取消", () => original.revision ? this.detail(original) : this.home());
    form.addEventListener("submit", event => {
      event.preventDefault(); if (this.busy) return; this.busy = true; save.disabled = true;
      const next: Item = { ...draft, kind: kind.value as Item["kind"], name: name.value, notes: notes.value, purchased: purchased.value || undefined, price: price.value === "" ? undefined : Number(price.value), status: status.value as Item["status"], retired: status.value === "retired" ? retired.value || undefined : undefined, quantity: quantity.value === "" ? 0 : Number(quantity.value) };
      void this.service.save(next, pending).then(item => this.detail(item)).catch(error => new Notice(error instanceof Error ? error.message : "保存失败，草稿已保留")).finally(() => { this.busy = false; save.disabled = false; });
    });
  }
  private chooseImport(): void {
    const generation = this.generation;
    const picker = document.createElement("input"); picker.type = "file"; picker.accept = ".json,application/json";
    picker.addEventListener("change", () => {
      const file = picker.files?.[0]; if (!file) return;
      void (async () => {
        if (file.size > 5 * 1024 * 1024) throw new Error("导入文件不能超过 5 MB");
        const items = parseItemImport(await file.text());
        const existing = await this.service.repository.read();
        if (generation !== this.generation || this.screen !== "list") return;
        const fresh = items.filter(item => !existing.importedKeys.includes(item.importKey!));
        this.screen = "import"; const body = this.reset(); body.createEl("h2", { text: "确认导入" });
        body.createEl("p", { text: `新增 ${fresh.length} 件，跳过已导入 ${items.length - fresh.length} 件。不会覆盖现有物品，也不会修改原表格。` });
        for (const item of fresh) {
          const card = body.createDiv({ cls: "doudou-item-card doudou-import-card" }); card.createEl("strong", { text: item.name });
          card.createEl("p", { text: item.kind === "stock" ? `库存物品 · ${item.quantity} 件` : `单件物品 · ${item.status === "retired" ? "已退役" : "使用中"} · 购买 ${item.purchased ?? "未填写"} · ¥${item.price ?? "未填写"} · 退役 ${item.retired ?? "未填写"}` });
          card.createEl("p", { text: item.notes, cls: "doudou-item-notes" });
        }
        const actions = body.createDiv({ cls: "doudou-items-actions" }); this.button(actions, "取消", () => this.home());
        const confirm = this.button(actions, `确认导入 ${fresh.length} 件`, async () => { const count = await this.service.import(fresh); new Notice(`已导入 ${count} 件物品`); this.home(); }); confirm.disabled = fresh.length === 0;
      })().catch(error => new Notice(error instanceof Error ? error.message : "导入失败"));
    }); picker.click();
  }
}
