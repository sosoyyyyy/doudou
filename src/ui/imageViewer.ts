import type { PendingImage } from "./imageDraft";
import type { EditableImageItem } from "./imageReorder";

export const IMAGE_VIEWER_MIN_SCALE = 1;
export const IMAGE_VIEWER_MAX_SCALE = 5;
export const IMAGE_VIEWER_CONTROLS_DELAY = 3_000;

export type ImageViewerItem =
  | { kind: "stored"; path: string }
  | {
    kind: "pending";
    id: string;
    previewUrl: string;
    file: File;
    name: string;
    mime: string;
  };

export interface ImageViewerTransform {
  scale: number;
  translateX: number;
  translateY: number;
}

export interface ImageViewerState extends ImageViewerTransform {
  index: number;
}

type ViewerTimer = ReturnType<typeof setTimeout>;
type ViewerTimerSchedule = (callback: () => void, delay: number) => ViewerTimer;
type ViewerTimerCancel = (timer: ViewerTimer) => void;

export function storedViewerItems(paths: readonly string[]): ImageViewerItem[] {
  return paths.map((path) => ({ kind: "stored", path }));
}

export function pendingViewerItem(image: PendingImage): ImageViewerItem {
  return {
    kind: "pending",
    id: image.id,
    previewUrl: image.previewUrl,
    file: image.file,
    name: image.file.name,
    mime: image.file.type
  };
}

export function editableViewerItems(
  items: readonly EditableImageItem[],
  pendingImages: readonly PendingImage[]
): ImageViewerItem[] {
  const pendingById = new Map(pendingImages.map((image) => [image.id, image]));
  return items.flatMap((item): ImageViewerItem[] => {
    if (item.kind === "stored") return [{ kind: "stored", path: item.path }];
    const pending = pendingById.get(item.id);
    return pending ? [pendingViewerItem(pending)] : [];
  });
}

export function clampViewerIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.min(itemCount - 1, Math.max(0, Math.trunc(index)));
}

export function initialViewerState(index: number, itemCount: number): ImageViewerState {
  return { index: clampViewerIndex(index, itemCount), ...resetViewerTransform() };
}

export function currentViewerItem(
  items: readonly ImageViewerItem[],
  state: Pick<ImageViewerState, "index">
): ImageViewerItem | null {
  return items[state.index] ?? null;
}

export function resetViewerTransform(): ImageViewerTransform {
  return { scale: 1, translateX: 0, translateY: 0 };
}

export function switchViewerImage(
  state: ImageViewerState,
  offset: number,
  itemCount: number
): ImageViewerState {
  const index = clampViewerIndex(state.index + offset, itemCount);
  return index === state.index ? { ...state } : { index, ...resetViewerTransform() };
}

export function clampViewerScale(scale: number): number {
  return Math.min(IMAGE_VIEWER_MAX_SCALE, Math.max(IMAGE_VIEWER_MIN_SCALE, scale));
}

export function clampViewerTranslation(
  transform: ImageViewerTransform,
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number
): ImageViewerTransform {
  const scale = clampViewerScale(transform.scale);
  if (scale === 1) return resetViewerTransform();
  const maxX = Math.max(0, (imageWidth * scale - frameWidth) / 2);
  const maxY = Math.max(0, (imageHeight * scale - frameHeight) / 2);
  return {
    scale,
    translateX: Math.min(maxX, Math.max(-maxX, transform.translateX)),
    translateY: Math.min(maxY, Math.max(-maxY, transform.translateY))
  };
}

export class ImageViewerControlsTimer {
  visible = true;
  private timer: ViewerTimer | null = null;

  constructor(
    private readonly changed: (visible: boolean) => void,
    private readonly delay = IMAGE_VIEWER_CONTROLS_DELAY,
    private readonly schedule: ViewerTimerSchedule = (callback, timeout) =>
      globalThis.setTimeout(callback, timeout),
    private readonly cancel: ViewerTimerCancel = (timer) => globalThis.clearTimeout(timer)
  ) {}

  start(): void {
    this.show();
  }

  show(): void {
    if (!this.visible) {
      this.visible = true;
      this.changed(true);
    }
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = this.schedule(() => {
      this.timer = null;
      this.visible = false;
      this.changed(false);
    }, this.delay);
  }

  stop(): void {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }
}
