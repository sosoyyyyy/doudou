export interface EditorScrollTargetInput {
  initialScrollTop: number;
  caretTop: number;
  caretBottom: number;
  viewportTop: number;
  viewportBottom: number;
  maxScrollTop: number;
  margin?: number;
}

export function editorScrollTarget({
  initialScrollTop,
  caretTop,
  caretBottom,
  viewportTop,
  viewportBottom,
  maxScrollTop,
  margin = 8
}: EditorScrollTargetInput): number {
  let target = initialScrollTop;
  const visibleTop = viewportTop + margin;
  const visibleBottom = viewportBottom - margin;
  if (caretBottom > visibleBottom) target += caretBottom - visibleBottom;
  else if (caretTop < visibleTop) target -= visibleTop - caretTop;
  return Math.min(Math.max(0, target), Math.max(0, maxScrollTop));
}

function textareaCaretBounds(textarea: HTMLTextAreaElement): { top: number; bottom: number } {
  const doc = textarea.ownerDocument;
  const view = doc.defaultView;
  const textareaRect = textarea.getBoundingClientRect();
  if (!view) return { top: textareaRect.top, bottom: textareaRect.bottom };

  const computed = view.getComputedStyle(textarea);
  const measurer = doc.createElement("div");
  const marker = doc.createElement("span");
  const copiedProperties = [
    "font",
    "letterSpacing",
    "lineHeight",
    "padding",
    "border",
    "boxSizing",
    "whiteSpace",
    "overflowWrap",
    "wordBreak",
    "tabSize",
    "textTransform",
    "textIndent"
  ] as const;
  for (const property of copiedProperties) measurer.style[property] = computed[property];
  Object.assign(measurer.style, {
    position: "fixed",
    top: `${textareaRect.top}px`,
    left: `${textareaRect.left}px`,
    width: `${textareaRect.width}px`,
    height: "auto",
    minHeight: "0",
    maxHeight: "none",
    overflow: "hidden",
    visibility: "hidden",
    pointerEvents: "none",
    zIndex: "-1"
  });
  measurer.textContent = textarea.value.slice(0, textarea.selectionEnd).replace(/\r\n/g, "\n");
  marker.textContent = "\u200b";
  measurer.appendChild(marker);
  doc.body.appendChild(measurer);
  try {
    const markerRect = marker.getBoundingClientRect();
    const lineHeight = Number.parseFloat(computed.lineHeight)
      || Number.parseFloat(computed.fontSize) * 1.65
      || 24;
    const top = markerRect.top - textarea.scrollTop;
    return { top, bottom: top + lineHeight };
  } finally {
    measurer.remove();
  }
}

export function stabilizeIosTextareaLineBreaks(
  textarea: HTMLTextAreaElement,
  scrollContainer: HTMLElement
): () => void {
  let initialScrollTop: number | null = null;
  let frame: number | null = null;

  const capture = (): void => {
    initialScrollTop = scrollContainer.scrollTop;
  };
  const onBeforeInput = (event: InputEvent): void => {
    if (
      (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph")
      && initialScrollTop === null
    ) capture();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Enter" && !event.isComposing && initialScrollTop === null) capture();
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === "Enter") initialScrollTop = null;
  };
  const onInput = (): void => {
    if (initialScrollTop === null) return;
    const snapshot = initialScrollTop;
    initialScrollTop = null;
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      frame = null;
      if (!textarea.isConnected || document.activeElement !== textarea) return;
      const viewport = window.visualViewport;
      if (!viewport || window.innerHeight - viewport.height <= 120) return;

      // WebKit may scroll the outer editor while revealing the textarea caret.
      // Restore first, then add only the offset required by the visible viewport.
      scrollContainer.scrollTop = snapshot;
      const caret = textareaCaretBounds(textarea);
      scrollContainer.scrollTop = editorScrollTarget({
        initialScrollTop: snapshot,
        caretTop: caret.top,
        caretBottom: caret.bottom,
        viewportTop: viewport.offsetTop,
        viewportBottom: viewport.offsetTop + viewport.height,
        maxScrollTop: scrollContainer.scrollHeight - scrollContainer.clientHeight
      });
    });
  };

  textarea.addEventListener("beforeinput", onBeforeInput);
  textarea.addEventListener("keydown", onKeyDown);
  textarea.addEventListener("keyup", onKeyUp);
  textarea.addEventListener("input", onInput);
  return () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    textarea.removeEventListener("beforeinput", onBeforeInput);
    textarea.removeEventListener("keydown", onKeyDown);
    textarea.removeEventListener("keyup", onKeyUp);
    textarea.removeEventListener("input", onInput);
  };
}
