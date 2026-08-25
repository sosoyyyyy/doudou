const KEYBOARD_OPEN_THRESHOLD = 120;

export interface ViewportResizeSource extends EventTarget {
  readonly height: number;
  readonly offsetTop: number;
}

export interface ViewportLayoutOptions {
  isMobile: boolean;
  layoutViewportHeight: () => number;
}

export function availableViewportHeight(
  viewportHeight: number,
  viewportOffsetTop: number,
  rootLayoutTop: number
): number {
  return Math.max(0, viewportOffsetTop + viewportHeight - rootLayoutTop);
}

export function registerViewportResizeLayout(
  root: HTMLElement,
  viewport: ViewportResizeSource,
  options: ViewportLayoutOptions
): () => void {
  const hostWindow = root.ownerDocument.defaultView;
  let rootLayoutTop: number | null = null;
  let firstFrame: number | null = null;
  let secondFrame: number | null = null;

  const sync = (): void => {
    const offsetTop = Math.max(0, viewport.offsetTop);
    if (rootLayoutTop === null || offsetTop === 0) {
      rootLayoutTop = root.getBoundingClientRect().top + offsetTop;
    }
    const height = availableViewportHeight(viewport.height, offsetTop, rootLayoutTop);
    root.style.setProperty("--doudou-visual-viewport-height", `${height}px`);
    root.classList.toggle(
      "doudou-keyboard-open",
      options.isMobile && options.layoutViewportHeight() - viewport.height > KEYBOARD_OPEN_THRESHOLD
    );
  };
  const cancelFrames = (): void => {
    if (!hostWindow) return;
    if (firstFrame !== null) hostWindow.cancelAnimationFrame(firstFrame);
    if (secondFrame !== null) hostWindow.cancelAnimationFrame(secondFrame);
    firstFrame = null;
    secondFrame = null;
  };
  const syncUntilStable = (): void => {
    cancelFrames();
    sync();
    if (!hostWindow) return;
    firstFrame = hostWindow.requestAnimationFrame(() => {
      firstFrame = null;
      sync();
      secondFrame = hostWindow.requestAnimationFrame(() => {
        secondFrame = null;
        sync();
      });
    });
  };

  viewport.addEventListener("resize", syncUntilStable);
  viewport.addEventListener("scroll", syncUntilStable);
  syncUntilStable();
  return () => {
    cancelFrames();
    viewport.removeEventListener("resize", syncUntilStable);
    viewport.removeEventListener("scroll", syncUntilStable);
  };
}
