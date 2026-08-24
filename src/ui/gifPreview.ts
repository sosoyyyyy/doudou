import type { ImageService } from "../attachments/ImageService";
import type { PendingImage } from "./imageDraft";

export type GifFirstFrameDecoder = (source: Blob) => Promise<Blob>;

interface ObjectUrlApi {
  createObjectURL(source: Blob): string;
  revokeObjectURL(url: string): void;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("GIF preview canvas could not be encoded"));
    }, "image/png");
  });
}

async function drawFirstFrame(source: Blob): Promise<Blob> {
  const bitmapFactory = globalThis.createImageBitmap;
  if (bitmapFactory) {
    const bitmap = await bitmapFactory(source);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("GIF preview canvas is unavailable");
      context.drawImage(bitmap, 0, 0);
      return await canvasBlob(canvas);
    } finally {
      bitmap.close();
    }
  }

  const temporaryUrl = URL.createObjectURL(source);
  try {
    const image = document.createElement("img");
    await new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error("GIF preview could not be decoded")), { once: true });
      image.src = temporaryUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("GIF preview canvas is unavailable");
    context.drawImage(image, 0, 0);
    return await canvasBlob(canvas);
  } finally {
    URL.revokeObjectURL(temporaryUrl);
  }
}

export function isGifPath(path: string): boolean {
  return path.trim().toLocaleLowerCase().endsWith(".gif");
}

export function isGifFile(file: Pick<File, "name" | "type">): boolean {
  return file.type.trim().toLocaleLowerCase() === "image/gif" || isGifPath(file.name);
}

export function addGifBadge(container: HTMLElement): HTMLElement {
  return container.createSpan({ cls: "doudou-gif-badge", text: "GIF", attr: { "aria-hidden": "true" } });
}

export class GifPreviewSession {
  private generation = 0;
  private readonly cache = new Map<string, Promise<string | null>>();
  private readonly urls = new Set<string>();

  constructor(
    private readonly decode: GifFirstFrameDecoder = drawFirstFrame,
    private readonly urlApi: ObjectUrlApi = URL
  ) {}

  applyStored(
    image: HTMLImageElement,
    container: HTMLElement,
    path: string,
    imageService: ImageService,
    originalUrl = image.getAttribute("src") ?? ""
  ): boolean {
    if (!isGifPath(path)) return false;
    addGifBadge(container);
    this.apply(image, `stored:${path}`, originalUrl, () => imageService.readAsFile(path));
    return true;
  }

  applyPending(
    image: HTMLImageElement,
    container: HTMLElement,
    pending: PendingImage,
    originalUrl = pending.previewUrl
  ): boolean {
    if (!isGifFile(pending.file)) return false;
    addGifBadge(container);
    this.apply(image, `pending:${pending.id}`, originalUrl, async () => pending.file);
    return true;
  }

  clear(): void {
    this.generation += 1;
    this.cache.clear();
    for (const url of this.urls) this.urlApi.revokeObjectURL(url);
    this.urls.clear();
  }

  dispose(): void {
    this.clear();
  }

  private apply(
    image: HTMLImageElement,
    key: string,
    originalUrl: string,
    source: () => Promise<Blob>
  ): void {
    const generation = this.generation;
    image.dataset.gifPreview = "loading";
    void this.previewUrl(key, source).then((url) => {
      if (generation !== this.generation || !image.isConnected) return;
      if (url) {
        image.src = url;
        image.dataset.gifPreview = "static";
      } else {
        if (originalUrl) image.src = originalUrl;
        image.dataset.gifPreview = "fallback";
      }
    });
  }

  private previewUrl(key: string, source: () => Promise<Blob>): Promise<string | null> {
    const cached = this.cache.get(key);
    if (cached) return cached;
    const generation = this.generation;
    const pending = source()
      .then((file) => this.decode(file))
      .then((preview) => {
        const url = this.urlApi.createObjectURL(preview);
        if (generation !== this.generation) {
          this.urlApi.revokeObjectURL(url);
          return null;
        }
        this.urls.add(url);
        return url;
      })
      .catch(() => null);
    this.cache.set(key, pending);
    return pending;
  }
}
