import { App, Modal, Platform } from "obsidian";
import { cleanTagName } from "../data/recordCodec";
import type { TagOption } from "../types";

const POSITION_STYLE_PROPERTIES = [
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "width",
  "height",
  "max-height"
] as const;

interface InlineStyleSnapshot {
  property: typeof POSITION_STYLE_PROPERTIES[number];
  value: string;
  priority: string;
}

export class TagPickerModal extends Modal {
  private selected: string[];
  private options: TagOption[];
  private optionListEl!: HTMLElement;
  private selectedEl!: HTMLElement;
  private newTagRowEl!: HTMLElement;
  private newTagInputEl!: HTMLInputElement;
  private visualViewport: VisualViewport | null = null;
  private viewportResizeHandler: (() => void) | null = null;
  private viewportScrollHandler: (() => void) | null = null;
  private inputVisibilityFrame: number | null = null;
  private focusSyncFrame: number | null = null;
  private focusSyncTimer: number | null = null;
  private diagnosticTimer: number | null = null;
  private pendingDiagnosticEvent = "";
  private newTagFocusHandler: (() => void) | null = null;
  private newTagBlurHandler: (() => void) | null = null;
  private positioningEl: HTMLElement | null = null;
  private originalPositionStyles: InlineStyleSnapshot[] | null = null;
  private newTagEditing = false;

  constructor(
    app: App,
    options: readonly TagOption[],
    selected: readonly string[],
    private readonly onApply: (tags: string[]) => void
  ) {
    super(app);
    this.options = [...options];
    this.selected = [...new Set(selected)];
  }

  override onOpen(): void {
    this.modalEl.addClass("doudou-modal", "doudou-tag-picker-modal");
    this.contentEl.addClass("doudou-modal-content");
    this.contentEl.createEl("h2", { cls: "doudou-modal-title", text: "选择标签" });

    this.selectedEl = this.contentEl.createDiv({ cls: "doudou-picker-selected" });
    this.contentEl.createDiv({
      cls: "doudou-picker-label",
      text: "最近使用 / 已有标签"
    });
    this.optionListEl = this.contentEl.createDiv({ cls: "doudou-picker-options" });
    this.renderSelected();
    this.renderOptions();

    const createButton = this.contentEl.createEl("button", {
      cls: "doudou-new-tag-toggle",
      text: "+ 新建标签",
      attr: { type: "button" }
    });
    createButton.addEventListener("click", () => {
      this.newTagRowEl.removeClass("doudou-is-hidden");
      this.beginNewTagEditing("toggle");
      this.newTagInputEl.focus({ preventScroll: true });
    });

    this.newTagRowEl = this.contentEl.createDiv({
      cls: "doudou-new-tag-row doudou-is-hidden"
    });
    this.newTagInputEl = this.newTagRowEl.createEl("input", {
      cls: "doudou-new-tag-input",
      attr: {
        type: "text",
        placeholder: "标签名称",
        "aria-label": "新标签名称"
      }
    });
    const addButton = this.newTagRowEl.createEl("button", {
      cls: "doudou-secondary-button",
      text: "添加",
      attr: { type: "button" }
    });
    const addNewTag = (): void => {
      const name = cleanTagName(this.newTagInputEl.value);
      if (!name) return;
      if (!this.selected.includes(name)) this.selected.push(name);
      if (!this.options.some((option) => option.name === name)) {
        this.options.unshift({ name, count: 0, lastUsed: "" });
      }
      this.newTagInputEl.value = "";
      this.renderSelected();
      this.renderOptions();
    };
    addButton.addEventListener("click", addNewTag);
    this.newTagInputEl.addEventListener("keydown", (event) => {
      if (!event.isComposing && event.key === "Enter") {
        event.preventDefault();
        addNewTag();
      }
    });
    this.newTagFocusHandler = () => this.beginNewTagEditing("focus");
    this.newTagBlurHandler = () => {
      this.newTagEditing = false;
      this.cancelFocusSync();
      this.restoreMobileViewportPosition();
      this.logViewportDiagnostics("blur", true);
    };
    this.newTagInputEl.addEventListener("focus", this.newTagFocusHandler);
    this.newTagInputEl.addEventListener("blur", this.newTagBlurHandler);

    const actions = this.contentEl.createDiv({ cls: "doudou-modal-actions" });
    const cancel = actions.createEl("button", {
      cls: "doudou-secondary-button",
      text: "取消",
      attr: { type: "button" }
    });
    cancel.addEventListener("click", () => this.close());
    const done = actions.createEl("button", {
      cls: "doudou-primary-button",
      text: "完成",
      attr: { type: "button" }
    });
    done.addEventListener("click", () => {
      this.onApply([...this.selected]);
      this.close();
    });

    this.registerMobileViewportHandling();
  }

  override onClose(): void {
    this.unregisterMobileViewportHandling();
    this.contentEl.empty();
  }

  private registerMobileViewportHandling(): void {
    const viewport = window.visualViewport;
    if (!Platform.isMobileApp || !viewport) return;

    this.visualViewport = viewport;
    this.positioningEl = this.modalEl.closest<HTMLElement>(".modal-container") ??
      this.containerEl;
    this.viewportResizeHandler = () => {
      this.syncTagPickerToVisualViewport("resize");
    };
    this.viewportScrollHandler = () => {
      this.syncTagPickerToVisualViewport("scroll");
    };
    viewport.addEventListener("resize", this.viewportResizeHandler);
    viewport.addEventListener("scroll", this.viewportScrollHandler);
  }

  private unregisterMobileViewportHandling(): void {
    if (this.visualViewport && this.viewportResizeHandler) {
      this.visualViewport.removeEventListener("resize", this.viewportResizeHandler);
    }
    if (this.visualViewport && this.viewportScrollHandler) {
      this.visualViewport.removeEventListener("scroll", this.viewportScrollHandler);
    }
    if (this.newTagFocusHandler) {
      this.newTagInputEl.removeEventListener("focus", this.newTagFocusHandler);
    }
    if (this.newTagBlurHandler) {
      this.newTagInputEl.removeEventListener("blur", this.newTagBlurHandler);
    }
    if (this.inputVisibilityFrame !== null) {
      window.cancelAnimationFrame(this.inputVisibilityFrame);
      this.inputVisibilityFrame = null;
    }
    this.cancelFocusSync();
    if (this.diagnosticTimer !== null) {
      window.clearTimeout(this.diagnosticTimer);
      this.diagnosticTimer = null;
    }
    this.newTagEditing = false;
    this.restoreMobileViewportPosition();
    this.visualViewport = null;
    this.viewportResizeHandler = null;
    this.viewportScrollHandler = null;
    this.newTagFocusHandler = null;
    this.newTagBlurHandler = null;
    this.positioningEl = null;
    this.pendingDiagnosticEvent = "";
  }

  private beginNewTagEditing(event: string): void {
    this.newTagEditing = true;
    this.syncTagPickerToVisualViewport(event, true);
    this.scheduleFocusedViewportSync();
    this.keepNewTagInputVisible();
  }

  private syncTagPickerToVisualViewport(event: string, logImmediately = false): void {
    const viewport = this.visualViewport;
    if (!Platform.isMobileApp || !viewport || !this.newTagEditing) {
      this.restoreMobileViewportPosition();
      this.logViewportDiagnostics(event, logImmediately);
      return;
    }

    const positioningEl = this.positioningEl ?? this.containerEl;
    if (!this.originalPositionStyles) {
      this.originalPositionStyles = POSITION_STYLE_PROPERTIES.map((property) => ({
        property,
        value: positioningEl.style.getPropertyValue(property),
        priority: positioningEl.style.getPropertyPriority(property)
      }));
    }
    positioningEl.addClass("doudou-tag-picker-viewport-container");
    positioningEl.style.setProperty("position", "fixed", "important");
    positioningEl.style.setProperty("top", `${viewport.offsetTop}px`, "important");
    positioningEl.style.setProperty("right", "auto", "important");
    positioningEl.style.setProperty("bottom", "auto", "important");
    positioningEl.style.setProperty("left", `${viewport.offsetLeft}px`, "important");
    positioningEl.style.setProperty("width", `${viewport.width}px`, "important");
    positioningEl.style.setProperty("height", `${viewport.height}px`, "important");
    positioningEl.style.setProperty("max-height", `${viewport.height}px`, "important");
    positioningEl.style.setProperty(
      "--doudou-tag-picker-viewport-height",
      `${viewport.height}px`
    );
    this.modalEl.addClass("doudou-tag-picker-keyboard-open");
    this.keepNewTagInputVisible();
    this.logViewportDiagnostics(event, logImmediately);
  }

  private restoreMobileViewportPosition(): void {
    const positioningEl = this.positioningEl ?? this.containerEl;
    if (this.originalPositionStyles) {
      for (const snapshot of this.originalPositionStyles) {
        if (snapshot.value) {
          positioningEl.style.setProperty(
            snapshot.property,
            snapshot.value,
            snapshot.priority
          );
        } else {
          positioningEl.style.removeProperty(snapshot.property);
        }
      }
      this.originalPositionStyles = null;
    }
    positioningEl.removeClass("doudou-tag-picker-viewport-container");
    positioningEl.style.removeProperty("--doudou-tag-picker-viewport-height");
    this.modalEl.removeClass("doudou-tag-picker-keyboard-open");
  }

  private scheduleFocusedViewportSync(): void {
    this.cancelFocusSync();
    this.focusSyncFrame = window.requestAnimationFrame(() => {
      this.focusSyncFrame = null;
      this.syncTagPickerToVisualViewport("focus-frame");
    });
    this.focusSyncTimer = window.setTimeout(() => {
      this.focusSyncTimer = null;
      this.syncTagPickerToVisualViewport("focus-delay");
    }, 180);
  }

  private cancelFocusSync(): void {
    if (this.focusSyncFrame !== null) {
      window.cancelAnimationFrame(this.focusSyncFrame);
      this.focusSyncFrame = null;
    }
    if (this.focusSyncTimer !== null) {
      window.clearTimeout(this.focusSyncTimer);
      this.focusSyncTimer = null;
    }
  }

  private logViewportDiagnostics(event: string, immediately = false): void {
    this.pendingDiagnosticEvent = event;
    if (immediately) {
      if (this.diagnosticTimer !== null) {
        window.clearTimeout(this.diagnosticTimer);
        this.diagnosticTimer = null;
      }
      this.emitViewportDiagnostics(event);
      return;
    }
    if (this.diagnosticTimer !== null) return;
    this.diagnosticTimer = window.setTimeout(() => {
      this.diagnosticTimer = null;
      this.emitViewportDiagnostics(this.pendingDiagnosticEvent);
    }, 120);
  }

  private emitViewportDiagnostics(event: string): void {
    const viewport = this.visualViewport;
    const positioningEl = this.positioningEl ?? this.containerEl;
    const containerRect = positioningEl.getBoundingClientRect();
    const modalRect = this.modalEl.getBoundingClientRect();
    const contentRect = this.contentEl.getBoundingClientRect();
    const number = (value: number | undefined): string =>
      value === undefined ? "n/a" : value.toFixed(1);
    console.debug(
      `[doudou][tag-picker] event=${event}`,
      `focused=${document.activeElement === this.newTagInputEl}`,
      `editing=${this.newTagEditing}`,
      `vv.height=${number(viewport?.height)}`,
      `vv.offsetTop=${number(viewport?.offsetTop)}`,
      `vv.bottom=${number(viewport ? viewport.offsetTop + viewport.height : undefined)}`,
      `innerHeight=${number(window.innerHeight)}`,
      `clientHeight=${number(document.documentElement.clientHeight)}`,
      `container.class=${JSON.stringify(positioningEl.className)}`,
      `container.top=${number(containerRect.top)}`,
      `container.bottom=${number(containerRect.bottom)}`,
      `modal.top=${number(modalRect.top)}`,
      `modal.bottom=${number(modalRect.bottom)}`,
      `content.top=${number(contentRect.top)}`,
      `content.bottom=${number(contentRect.bottom)}`
    );
  }

  private keepNewTagInputVisible(): void {
    if (this.inputVisibilityFrame !== null) {
      window.cancelAnimationFrame(this.inputVisibilityFrame);
    }
    this.inputVisibilityFrame = window.requestAnimationFrame(() => {
      this.inputVisibilityFrame = null;
      if (document.activeElement !== this.newTagInputEl) return;
      this.newTagInputEl.scrollIntoView({
        block: "center",
        inline: "nearest"
      });
    });
  }

  private toggleTag(tag: string): void {
    this.selected = this.selected.includes(tag)
      ? this.selected.filter((value) => value !== tag)
      : [...this.selected, tag];
    this.renderSelected();
    this.renderOptions();
  }

  private renderSelected(): void {
    this.selectedEl.empty();
    if (this.selected.length === 0) {
      this.selectedEl.createSpan({
        cls: "doudou-picker-empty",
        text: "还没有选择标签"
      });
      return;
    }

    for (const tag of this.selected) {
      const chip = this.selectedEl.createEl("button", {
        cls: "doudou-tag-chip doudou-is-selected",
        text: `#${tag} ×`,
        attr: { type: "button", "aria-label": `移除标签 ${tag}` }
      });
      chip.addEventListener("click", () => this.toggleTag(tag));
    }
  }

  private renderOptions(): void {
    this.optionListEl.empty();
    if (this.options.length === 0) {
      this.optionListEl.createSpan({
        cls: "doudou-picker-empty",
        text: "还没有用过标签"
      });
      return;
    }

    for (const option of this.options) {
      const selected = this.selected.includes(option.name);
      const button = this.optionListEl.createEl("button", {
        cls: `doudou-picker-option${selected ? " doudou-is-selected" : ""}`,
        text: `#${option.name}`,
        attr: {
          type: "button",
          "aria-pressed": String(selected),
          title: option.count > 0 ? `使用过 ${option.count} 次` : "新标签"
        }
      });
      button.addEventListener("click", () => this.toggleTag(option.name));
    }
  }
}
