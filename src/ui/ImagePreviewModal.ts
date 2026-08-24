import { App, Modal, Platform, setIcon } from "obsidian";
import type { ImageService } from "../attachments/ImageService";
import { retainPendingPreviewUrls } from "./imageDraft";
import {
  copyViewerImage, isEditableTarget, shouldCopyImageShortcut,
  showViewerImageActionMenuAtElement, showViewerImageActionMenuAtEvent
} from "./imageActions";
import {
  clampViewerScale, clampViewerTranslation, ImageViewerControlsTimer,
  currentViewerItem, initialViewerState, resetViewerTransform, switchViewerImage,
  type ImageViewerItem, type ImageViewerState
} from "./imageViewer";

interface PointerPosition { x: number; y: number }

export class ImagePreviewModal extends Modal {
  private state: ImageViewerState;
  private image: HTMLImageElement | null = null;
  private frame: HTMLElement | null = null;
  private stage: HTMLElement | null = null;
  private counter: HTMLElement | null = null;
  private previousButton: HTMLButtonElement | null = null;
  private nextButton: HTMLButtonElement | null = null;
  private actionsButton: HTMLButtonElement | null = null;
  private readonly pointers = new Map<number, PointerPosition>();
  private gestureStart: PointerPosition | null = null;
  private gestureOrigin = resetViewerTransform();
  private pinchDistance = 0;
  private swipeBlocked = false;
  private lastTapAt = 0;
  private controls: ImageViewerControlsTimer | null = null;
  private releasePendingPreviews: (() => void) | null = null;

  private readonly keydownHandler = (event: KeyboardEvent): void => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      this.changeImage(event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    const hasSelection = Boolean(document.getSelection()?.toString());
    if (!shouldCopyImageShortcut(event, hasSelection, isEditableTarget(event.target))) return;
    event.preventDefault();
    const item = this.currentItem();
    if (item) void copyViewerImage(this.imageService, item);
  };

  constructor(
    app: App,
    private readonly imageService: ImageService,
    private readonly items: readonly ImageViewerItem[],
    initialIndex = 0,
    private readonly controlsDelay = 3_000
  ) {
    super(app);
    this.state = initialViewerState(initialIndex, items.length);
  }

  override onOpen(): void {
    this.modalEl.addClass("doudou-modal", "doudou-image-preview-modal");
    this.contentEl.addClass("doudou-image-preview-content");
    this.releasePendingPreviews = retainPendingPreviewUrls(
      this.items.flatMap((item) => item.kind === "pending" ? [item.previewUrl] : [])
    );
    this.controls = new ImageViewerControlsTimer((visible) => {
      this.modalEl.toggleClass("doudou-viewer-controls-hidden", !visible);
    }, this.controlsDelay);

    this.frame = this.contentEl.createDiv({ cls: "doudou-image-preview-frame" });
    this.stage = this.frame.createDiv({ cls: "doudou-image-preview-stage" });
    this.bindFrameInteractions(this.frame);
    this.frame.addEventListener("mouseenter", () => this.noteInteraction());
    this.frame.addEventListener("contextmenu", (event) => {
      if (!Platform.isDesktopApp) return;
      event.preventDefault();
      const current = this.currentItem();
      if (current) showViewerImageActionMenuAtEvent(this.app, this.imageService, current, event);
    });

    const controlLayer = this.contentEl.createDiv({ cls: "doudou-image-viewer-controls" });
    this.counter = controlLayer.createDiv({
      cls: "doudou-image-preview-counter doudou-image-viewer-control",
      attr: { "aria-live": "polite" }
    });
    const toolbar = controlLayer.createDiv({ cls: "doudou-image-preview-toolbar" });
    this.actionsButton = toolbar.createEl("button", {
      cls: "doudou-image-toolbar-button doudou-image-action-button doudou-image-viewer-control",
      attr: { type: "button", "aria-label": "图片操作", title: "图片操作" }
    });
    setIcon(this.actionsButton, Platform.isMobileApp ? "share-2" : "ellipsis");
    this.actionsButton.addEventListener("click", () => {
      const item = this.currentItem();
      if (item && this.actionsButton) {
        this.noteInteraction();
        showViewerImageActionMenuAtElement(this.app, this.imageService, item, this.actionsButton);
      }
    });
    const closeButton = toolbar.createEl("button", {
      cls: "doudou-image-toolbar-button doudou-image-close-button",
      attr: { type: "button", "aria-label": "关闭图片查看器", title: "关闭" }
    });
    setIcon(closeButton, "x");
    closeButton.addEventListener("click", () => this.close());
    this.previousButton = controlLayer.createEl("button", {
      cls: "doudou-image-viewer-nav doudou-image-viewer-previous doudou-image-viewer-control",
      text: "‹", attr: { type: "button", "aria-label": "上一张图片" }
    });
    this.nextButton = controlLayer.createEl("button", {
      cls: "doudou-image-viewer-nav doudou-image-viewer-next doudou-image-viewer-control",
      text: "›", attr: { type: "button", "aria-label": "下一张图片" }
    });
    this.previousButton.addEventListener("click", () => { this.noteInteraction(); this.changeImage(-1); });
    this.nextButton.addEventListener("click", () => { this.noteInteraction(); this.changeImage(1); });
    this.renderCurrentImage();
    this.controls.start();
    document.addEventListener("keydown", this.keydownHandler);
  }

  override onClose(): void {
    document.removeEventListener("keydown", this.keydownHandler);
    this.controls?.stop();
    this.controls = null;
    this.releasePendingPreviews?.();
    this.releasePendingPreviews = null;
    this.pointers.clear();
    this.image = null;
    this.frame = null;
    this.stage = null;
    this.contentEl.empty();
  }

  private currentItem(): ImageViewerItem | null { return currentViewerItem(this.items, this.state); }

  private renderCurrentImage(): void {
    if (!this.stage) return;
    this.stage.empty();
    this.state = { index: this.state.index, ...resetViewerTransform() };
    this.image = null;
    const item = this.currentItem();
    const source = item?.kind === "stored" ? this.imageService.resourcePath(item.path) : item?.previewUrl ?? null;
    if (!item || !source) {
      this.stage.createDiv({ cls: "doudou-image-missing", text: "这张图片暂时找不到了" });
    } else {
      const image = document.createElement("img");
      image.className = "doudou-image-preview-full";
      image.src = source;
      image.alt = `兜兜记录图片 ${this.state.index + 1}`;
      image.draggable = false;
      this.stage.appendChild(image);
      this.image = image;
      this.applyTransform();
      image.addEventListener("error", () => {
        if (this.image !== image) return;
        image.remove();
        this.image = null;
        this.stage?.createDiv({ cls: "doudou-image-missing", text: "当前设备暂时无法预览这种图片格式" });
      }, { once: true });
    }
    this.updateControls();
  }

  private updateControls(): void {
    const multiple = this.items.length > 1;
    this.counter?.setText(multiple ? `${this.state.index + 1} / ${this.items.length}` : "");
    this.counter?.toggleClass("doudou-is-hidden", !multiple);
    if (this.previousButton) { this.previousButton.hidden = !multiple; this.previousButton.disabled = this.state.index === 0; }
    if (this.nextButton) { this.nextButton.hidden = !multiple; this.nextButton.disabled = this.state.index >= this.items.length - 1; }
    if (this.actionsButton) this.actionsButton.disabled = !this.currentItem();
  }

  private changeImage(offset: number): void {
    const next = switchViewerImage(this.state, offset, this.items.length);
    this.noteInteraction();
    if (next.index === this.state.index) return;
    this.state = next;
    this.renderCurrentImage();
  }

  private bindFrameInteractions(frame: HTMLElement): void {
    frame.addEventListener("wheel", (event) => {
      if (!this.image) return;
      event.preventDefault();
      this.zoomTo(this.state.scale * Math.exp(-event.deltaY * 0.0015));
    }, { passive: false });
    if (Platform.isMobileApp) {
      frame.addEventListener("touchstart", (event) => this.touchStart(event), { passive: false });
      frame.addEventListener("touchmove", (event) => this.touchMove(event), { passive: false });
      frame.addEventListener("touchend", (event) => this.touchEnd(event), { passive: false });
      frame.addEventListener("touchcancel", (event) => this.touchEnd(event), { passive: false });
    } else {
      frame.addEventListener("pointerdown", (event) => this.pointerDown(event));
      frame.addEventListener("pointermove", (event) => this.pointerMove(event));
      frame.addEventListener("pointerup", (event) => this.pointerEnd(event));
      frame.addEventListener("pointercancel", (event) => this.pointerEnd(event));
    }
  }

  private pointerDown(event: PointerEvent): void {
    if ((event.target as Element | null)?.closest("button")) return;
    this.noteInteraction();
    this.frame?.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 1) {
      this.gestureStart = { x: event.clientX, y: event.clientY };
      this.gestureOrigin = { scale: this.state.scale, translateX: this.state.translateX, translateY: this.state.translateY };
      this.swipeBlocked = false;
    } else if (this.pointers.size === 2) {
      this.pinchDistance = this.pointerDistance();
      this.gestureOrigin = { scale: this.state.scale, translateX: this.state.translateX, translateY: this.state.translateY };
      this.swipeBlocked = true;
    }
  }

  private pointerMove(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return;
    event.preventDefault();
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size >= 2) {
      const distance = this.pointerDistance();
      if (this.pinchDistance > 0) this.zoomTo(this.gestureOrigin.scale * distance / this.pinchDistance);
      return;
    }
    if (!this.gestureStart || this.state.scale <= 1) return;
    const previousX = this.state.translateX;
    const previousY = this.state.translateY;
    this.state.translateX = this.gestureOrigin.translateX + event.clientX - this.gestureStart.x;
    this.state.translateY = this.gestureOrigin.translateY + event.clientY - this.gestureStart.y;
    this.constrainTransform();
    this.applyTransform();
    if (previousX !== this.state.translateX || previousY !== this.state.translateY) this.noteInteraction();
  }

  private pointerEnd(event: PointerEvent): void {
    const ended = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    if (this.pointers.size > 0) {
      const remaining = [...this.pointers.values()][0];
      this.gestureStart = remaining ?? null;
      this.gestureOrigin = { scale: this.state.scale, translateX: this.state.translateX, translateY: this.state.translateY };
      return;
    }
    if (ended && this.gestureStart) this.finishSingleGesture(this.gestureStart, ended);
    this.gestureStart = null;
    this.pinchDistance = 0;
  }

  private touchStart(event: TouchEvent): void {
    if (event.touches.length === 0) return;
    event.preventDefault();
    this.noteInteraction();
    if (event.touches.length === 1) {
      this.gestureStart = this.touchPosition(event.touches[0]);
      this.gestureOrigin = { scale: this.state.scale, translateX: this.state.translateX, translateY: this.state.translateY };
      this.swipeBlocked = false;
    } else {
      this.pinchDistance = this.touchDistance(event.touches[0], event.touches[1]);
      this.gestureOrigin = { scale: this.state.scale, translateX: this.state.translateX, translateY: this.state.translateY };
      this.swipeBlocked = true;
    }
  }

  private touchMove(event: TouchEvent): void {
    if (event.touches.length === 0) return;
    event.preventDefault();
    if (event.touches.length >= 2) {
      const distance = this.touchDistance(event.touches[0], event.touches[1]);
      if (this.pinchDistance > 0) this.zoomTo(this.gestureOrigin.scale * distance / this.pinchDistance);
      return;
    }
    if (!this.gestureStart || this.state.scale <= 1) return;
    const point = this.touchPosition(event.touches[0]);
    const previousX = this.state.translateX;
    const previousY = this.state.translateY;
    this.state.translateX = this.gestureOrigin.translateX + point.x - this.gestureStart.x;
    this.state.translateY = this.gestureOrigin.translateY + point.y - this.gestureStart.y;
    this.constrainTransform();
    this.applyTransform();
    if (previousX !== this.state.translateX || previousY !== this.state.translateY) this.noteInteraction();
  }

  private touchEnd(event: TouchEvent): void {
    event.preventDefault();
    if (event.touches.length > 0) {
      this.gestureStart = this.touchPosition(event.touches[0]);
      this.gestureOrigin = { scale: this.state.scale, translateX: this.state.translateX, translateY: this.state.translateY };
      return;
    }
    const endedTouch = event.changedTouches[0];
    if (endedTouch && this.gestureStart) {
      this.finishSingleGesture(this.gestureStart, this.touchPosition(endedTouch));
    }
    this.gestureStart = null;
    this.pinchDistance = 0;
  }

  private finishSingleGesture(start: PointerPosition, end: PointerPosition): void {
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    if (this.state.scale === 1 && !this.swipeBlocked && Math.abs(deltaX) >= 56 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
      this.changeImage(deltaX < 0 ? 1 : -1);
    } else if (Math.hypot(deltaX, deltaY) < 10) {
      const now = Date.now();
      if (now - this.lastTapAt < 320) { this.zoomTo(this.state.scale > 1 ? 1 : 2); this.lastTapAt = 0; }
      else this.lastTapAt = now;
    }
  }

  private touchPosition(touch: Touch): PointerPosition {
    return { x: touch.clientX, y: touch.clientY };
  }

  private touchDistance(first: Touch, second: Touch): number {
    return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
  }

  private pointerDistance(): number {
    const [first, second] = [...this.pointers.values()];
    return first && second ? Math.hypot(second.x - first.x, second.y - first.y) : 0;
  }

  private zoomTo(scale: number): void {
    const previousScale = this.state.scale;
    const previousX = this.state.translateX;
    const previousY = this.state.translateY;
    this.state.scale = clampViewerScale(scale);
    this.constrainTransform();
    this.applyTransform();
    if (previousScale !== this.state.scale || previousX !== this.state.translateX || previousY !== this.state.translateY) {
      this.noteInteraction();
    }
  }

  private constrainTransform(): void {
    if (!this.frame || !this.image) return;
    const frameRect = this.frame.getBoundingClientRect();
    const constrained = clampViewerTranslation(
      this.state,
      this.image.clientWidth || frameRect.width,
      this.image.clientHeight || frameRect.height,
      frameRect.width,
      frameRect.height
    );
    Object.assign(this.state, constrained);
  }

  private applyTransform(): void {
    if (!this.image) return;
    this.image.style.transform = `translate3d(${this.state.translateX}px, ${this.state.translateY}px, 0) scale(${this.state.scale})`;
    this.image.toggleClass("doudou-is-zoomed", this.state.scale > 1);
  }

  private noteInteraction(): void { this.controls?.show(); }
}
