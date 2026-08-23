import { App, Menu, Notice, Platform } from "obsidian";
import type { ImageService } from "../attachments/ImageService";

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
  const menu = buildImageActionMenu(app, imageService, path);
  menu.showAtMouseEvent(event);
}

export function showImageActionMenuAtElement(
  app: App,
  imageService: ImageService,
  path: string,
  element: HTMLElement
): void {
  const rect = element.getBoundingClientRect();
  const menu = buildImageActionMenu(app, imageService, path);
  menu.showAtPosition({ x: rect.right, y: rect.bottom, left: true });
}

export async function copyOriginalImage(imageService: ImageService, path: string): Promise<void> {
  try {
    const file = await imageService.readAsFile(path);
    await copyImageFileToClipboard(file);
    new Notice("原图已复制到剪贴板");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    new Notice(reason.includes("format")
      ? "当前图片格式无法直接复制，请使用分享或下载原图"
      : "当前环境无法复制这张图片，请使用分享或下载原图");
  }
}

function buildImageActionMenu(app: App, imageService: ImageService, path: string): Menu {
  const menu = new Menu();
  if (Platform.isDesktopApp) {
    menu.addItem((item) => item
      .setTitle("复制图片")
      .setIcon("copy")
      .onClick(() => void copyOriginalImage(imageService, path)));
  } else {
    menu.addItem((item) => item
      .setTitle("分享图片")
      .setIcon("share-2")
      .onClick(() => void shareOriginalImage(imageService, path)));
  }
  menu.addItem((item) => item
    .setTitle(Platform.isDesktopApp ? "下载原图" : "保存到文件 / 下载")
    .setIcon("download")
    .onClick(() => void downloadOriginalImage(imageService, path)));
  menu.addItem((item) => item
    .setTitle("在 Obsidian 中打开原图")
    .setIcon("external-link")
    .onClick(() => void openOriginalImage(app, imageService, path)));
  return menu;
}

async function shareOriginalImage(imageService: ImageService, path: string): Promise<void> {
  try {
    const file = await imageService.readAsFile(path);
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

async function downloadOriginalImage(imageService: ImageService, path: string): Promise<void> {
  try {
    downloadImageFile(await imageService.readAsFile(path));
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
