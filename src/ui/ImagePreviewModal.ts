import { App, Modal, Platform, setIcon } from "obsidian";
import type { ImageService } from "../attachments/ImageService";
import {
  copyOriginalImage,
  isEditableTarget,
  shouldCopyImageShortcut,
  showImageActionMenuAtElement,
  showImageActionMenuAtEvent
} from "./imageActions";

export class ImagePreviewModal extends Modal {
  private readonly keydownHandler = (event: KeyboardEvent): void => {
    const hasSelection = Boolean(document.getSelection()?.toString());
    if (!shouldCopyImageShortcut(event, hasSelection, isEditableTarget(event.target))) return;
    event.preventDefault();
    void copyOriginalImage(this.imageService, this.path);
  };

  constructor(
    app: App,
    private readonly imageService: ImageService,
    private readonly path: string
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("doudou-modal", "doudou-image-preview-modal");
    this.contentEl.addClass("doudou-image-preview-content");
    const toolbar = this.contentEl.createDiv({ cls: "doudou-image-preview-toolbar" });
    const actions = toolbar.createEl("button", {
      cls: "doudou-image-action-button",
      attr: { type: "button", "aria-label": "图片操作", title: "图片操作" }
    });
    setIcon(actions, Platform.isMobileApp ? "share-2" : "ellipsis");
    actions.addEventListener("click", () => {
      showImageActionMenuAtElement(this.app, this.imageService, this.path, actions);
    });
    const frame = this.contentEl.createDiv({ cls: "doudou-image-preview-frame" });
    const resourcePath = this.imageService.resourcePath(this.path);
    if (!resourcePath) {
      frame.createDiv({
        cls: "doudou-image-missing",
        text: "这张图片暂时找不到了"
      });
      actions.disabled = true;
      return;
    }
    const image = frame.createEl("img", {
      cls: "doudou-image-preview-full",
      attr: { src: resourcePath, alt: "兜兜记录图片" }
    });
    image.addEventListener("contextmenu", (event) => {
      if (!Platform.isDesktopApp) return;
      event.preventDefault();
      showImageActionMenuAtEvent(this.app, this.imageService, this.path, event);
    });
    image.addEventListener("error", () => {
      image.remove();
      frame.createDiv({
        cls: "doudou-image-missing",
        text: "当前设备暂时无法预览这种图片格式"
      });
    }, { once: true });
    if (Platform.isDesktopApp) document.addEventListener("keydown", this.keydownHandler);
  }

  override onClose(): void {
    document.removeEventListener("keydown", this.keydownHandler);
    this.contentEl.empty();
  }
}
