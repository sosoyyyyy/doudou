import { App, Modal } from "obsidian";
import type { ImageService } from "../attachments/ImageService";

export class ImagePreviewModal extends Modal {
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
    const resourcePath = this.imageService.resourcePath(this.path);
    if (!resourcePath) {
      this.contentEl.createDiv({
        cls: "doudou-image-missing",
        text: "这张图片暂时找不到了"
      });
      return;
    }
    const image = this.contentEl.createEl("img", {
      cls: "doudou-image-preview-full",
      attr: { src: resourcePath, alt: "兜兜记录图片" }
    });
    image.addEventListener("error", () => {
      image.remove();
      this.contentEl.createDiv({
        cls: "doudou-image-missing",
        text: "当前设备暂时无法预览这种图片格式"
      });
    }, { once: true });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export function renderStoredImages(
  app: App,
  container: HTMLElement,
  imageService: ImageService,
  paths: readonly string[],
  limit = paths.length
): void {
  if (paths.length === 0) return;
  const visible = paths.slice(0, limit);
  const grid = container.createDiv({
    cls: `doudou-image-grid doudou-image-grid-${Math.min(visible.length, 4)}`
  });
  for (const [index, path] of visible.entries()) {
    const button = grid.createEl("button", {
      cls: "doudou-image-tile",
      attr: { type: "button", "aria-label": `查看第 ${index + 1} 张图片` }
    });
    const resourcePath = imageService.resourcePath(path);
    if (resourcePath) {
      const image = button.createEl("img", {
        cls: "doudou-image-thumbnail",
        attr: { src: resourcePath, alt: "" }
      });
      image.addEventListener("error", () => {
        image.remove();
        button.createDiv({
          cls: "doudou-image-missing",
          text: "暂不支持预览"
        });
      }, { once: true });
    } else {
      button.createDiv({ cls: "doudou-image-missing", text: "图片缺失" });
    }
    if (index === visible.length - 1 && paths.length > visible.length) {
      button.createDiv({
        cls: "doudou-image-more",
        text: `+${paths.length - visible.length}`
      });
    }
    button.addEventListener("click", () => {
      new ImagePreviewModal(app, imageService, path).open();
    });
  }
}
