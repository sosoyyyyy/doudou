export interface TextareaOuterScrollTargetInput {
  initialScrollTop: number;
  textareaBottom: number;
  viewportBottom: number;
  maxScrollTop: number;
  margin?: number;
}

export function textareaOuterScrollTarget({
  initialScrollTop,
  textareaBottom,
  viewportBottom,
  maxScrollTop,
  margin = 8
}: TextareaOuterScrollTargetInput): number {
  const hiddenDistance = Math.max(0, textareaBottom - (viewportBottom - margin));
  return Math.min(initialScrollTop + hiddenDistance, Math.max(0, maxScrollTop));
}

interface PendingInputScroll {
  outerScrollTop: number;
  textareaBottom: number;
}

export function stabilizeIosTextareaInput(
  textarea: HTMLTextAreaElement,
  scrollContainer: HTMLElement
): () => void {
  let pending: PendingInputScroll | null = null;
  let frame: number | null = null;

  const capture = (): void => {
    if (frame !== null) return;
    pending = {
      outerScrollTop: scrollContainer.scrollTop,
      textareaBottom: textarea.getBoundingClientRect().bottom
    };
  };
  const onBeforeInput = (): void => capture();
  const onInput = (): void => {
    if (!pending) return;
    const snapshot = pending;
    pending = null;
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      frame = null;
      if (!textarea.isConnected || document.activeElement !== textarea) return;
      const viewport = window.visualViewport;
      if (!viewport || window.innerHeight - viewport.height <= 120) return;

      const target = textareaOuterScrollTarget({
        initialScrollTop: snapshot.outerScrollTop,
        textareaBottom: snapshot.textareaBottom,
        viewportBottom: viewport.offsetTop + viewport.height,
        maxScrollTop: scrollContainer.scrollHeight - scrollContainer.clientHeight
      });
      if (scrollContainer.scrollTop !== target) scrollContainer.scrollTop = target;
    });
  };

  textarea.addEventListener("beforeinput", onBeforeInput);
  textarea.addEventListener("input", onInput);
  return () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    textarea.removeEventListener("beforeinput", onBeforeInput);
    textarea.removeEventListener("input", onInput);
  };
}
