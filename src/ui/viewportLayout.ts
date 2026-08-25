const KEYBOARD_OPEN_THRESHOLD = 120;

export interface ViewportResizeSource extends EventTarget {
  readonly height: number;
}

export interface ViewportLayoutOptions {
  isMobile: boolean;
  layoutViewportHeight: () => number;
}

export function availableViewportHeight(viewportHeight: number, rootTop: number): number {
  return Math.max(0, viewportHeight - Math.max(0, rootTop));
}

export function registerViewportResizeLayout(
  root: HTMLElement,
  viewport: ViewportResizeSource,
  options: ViewportLayoutOptions
): () => void {
  const sync = (): void => {
    const height = availableViewportHeight(viewport.height, root.getBoundingClientRect().top);
    root.style.setProperty("--doudou-visual-viewport-height", `${height}px`);
    root.classList.toggle(
      "doudou-keyboard-open",
      options.isMobile && options.layoutViewportHeight() - viewport.height > KEYBOARD_OPEN_THRESHOLD
    );
  };

  viewport.addEventListener("resize", sync);
  sync();
  return () => viewport.removeEventListener("resize", sync);
}
