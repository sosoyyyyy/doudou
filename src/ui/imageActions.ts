import { App, Menu, Notice, Platform } from "obsidian";
import type { ImageService } from "../attachments/ImageService";
import type { ImageViewerItem } from "./imageViewer";

interface ClipboardItemConstructor {
  new(items: Record<string, Blob>): ClipboardItem;
  supports?(type: string): boolean;
}

export function imageSharePayload(file: File): ShareData {
  return { files: [file], title: file.name };
}

export function canShareImageFile(
  file: File,
  shareNavigator: Pick<Navigator, "share" | "canShare"> = navigator
): boolean {
  if (typeof shareNavigator.share !== "function" || typeof shareNavigator.canShare !== "function") {
    return false;
  }
  try {
    return shareNavigator.canShare(imageSharePayload(file));
  } catch {
    return false;
  }
}

export async function copyImageFileToClipboard(
  file: File,
  clipboard: Pick<Clipboard, "write"> | undefined = navigator.clipboard,
  itemConstructor: ClipboardItemConstructor | undefined = globalThis.ClipboardItem
): Promise<void> {
  if (!clipboard?.write || !itemConstructor) throw new Error("clipboard-unsupported");
  if (itemConstructor.supports && !itemConstructor.supports(file.type)) {
    throw new Error("clipboard-format-unsupported");
  }
  await clipboard.write([new itemConstructor({ [file.type]: file })]);
}

export async function shareImageFile(
  file: File,
  shareNavigator: Pick<Navigator, "share" | "canShare"> = navigator
): Promise<void> {
  if (!canShareImageFile(file, shareNavigator)) throw new Error("share-unsupported");
  await shareNavigator.share!(imageSharePayload(file));
}

export function downloadImageFile(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function shouldCopyImageShortcut(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  hasTextSelection: boolean,
  editableTarget: boolean
): boolean {
  return event.key.toLocaleLowerCase() === "c" &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    !hasTextSelection &&
    !editableTarget;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

export function showImageActionMenuAtEvent(
  app: App,
  imageService: ImageService,
  path: string,
  event: MouseEvent
): void {
  const menu = buildImageActionMenu(app, imageService, { kind: "stored", path });
  menu.showAtMouseEvent(event);
}

export function showImageActionMenuAtElement(
  app: App,
  imageService: ImageService,
  path: string,
  element: HTMLElement
): void {
  const rect = element.getBoundingClientRect();
  const menu = buildImageActionMenu(app, imageService, { kind: "stored", path });
  menu.showAtPosition({ x: rect.right, y: rect.bottom, left: true });
}

export async function copyOriginalImage(imageService: ImageService, path: string): Promise<void> {
  return copyViewerImage(imageService, { kind: "stored", path });
}

export function showViewerImageActionMenuAtEvent(
  app: App,
  imageService: ImageService,
  item: ImageViewerItem,
  event: MouseEvent
): void {
  buildImageActionMenu(app, imageService, item).showAtMouseEvent(event);
}

export function showViewerImageActionMenuAtElement(
  app: App,
  imageService: ImageService,
  item: ImageViewerItem,
  element: HTMLElement
): void {
  const rect = element.getBoundingClientRect();
  buildImageActionMenu(app, imageService, item).showAtPosition({
    x: rect.right,
    y: rect.bottom,
    left: true
  });
}

export function viewerItemFile(imageService: ImageService, item: ImageViewerItem): Promise<File> {
  return item.kind === "stored" ? imageService.readAsFile(item.path) : Promise.resolve(item.file);
}

export async function copyViewerImage(imageService: ImageService, item: ImageViewerItem): Promise<void> {
  try {
    const file = await viewerItemFile(imageService, item);
    await copyImageFileToClipboard(file);
    new Notice("原图已复制到剪贴板");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    new Notice(reason.includes("format")
      ? "当前图片格式无法直接复制，请使用分享或下载原图"
      : "当前环境无法复制这张图片，请使用分享或下载原图");
  }
}

function buildImageActionMenu(app: App, imageService: ImageService, item: ImageViewerItem): Menu {
  const menu = new Menu();
  if (Platform.isDesktopApp) {
    menu.addItem((menuItem) => menuItem
      .setTitle("复制图片")
      .setIcon("copy")
      .onClick(() => void copyViewerImage(imageService, item)));
  } else {
    menu.addItem((menuItem) => menuItem
      .setTitle("分享图片")
      .setIcon("share-2")
      .onClick(() => void shareOriginalImage(imageService, item)));
  }
  menu.addItem((menuItem) => menuItem
    .setTitle(Platform.isDesktopApp ? "下载原图" : "保存到文件 / 下载")
    .setIcon("download")
    .onClick(() => void downloadOriginalImage(imageService, item)));
  if (item.kind === "stored") {
    menu.addItem((menuItem) => menuItem
      .setTitle("在 Obsidian 中打开原图")
      .setIcon("external-link")
      .onClick(() => void openOriginalImage(app, imageService, item.path)));
  }
  return menu;
}

async function shareOriginalImage(imageService: ImageService, item: ImageViewerItem): Promise<void> {
  try {
    const file = await viewerItemFile(imageService, item);
    if (!canShareImageFile(file)) {
      new Notice("当前设备不支持直接分享文件，可使用下载或打开原图");
      return;
    }
    await shareImageFile(file);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    new Notice("图片分享失败，可使用下载或打开原图");
  }
}

async function downloadOriginalImage(imageService: ImageService, item: ImageViewerItem): Promise<void> {
  try {
    downloadImageFile(await viewerItemFile(imageService, item));
  } catch {
    new Notice("原图下载失败，请确认文件仍存在");
  }
}

async function openOriginalImage(app: App, imageService: ImageService, path: string): Promise<void> {
  const file = imageService.getFile(path);
  if (!file) {
    new Notice("这张图片暂时找不到了");
    return;
  }
  try {
    await app.workspace.getLeaf(true).openFile(file);
  } catch {
    new Notice("Obsidian 暂时无法打开这种图片格式");
  }
}
