const POST_EDIT_SCROLL_TIMEOUT_MS = 50;

interface EditScrollTransaction {
  id: number;
  scrollTop: number;
}

export function protectRecordPageScrollDuringTextareaEdit(
  textarea: HTMLTextAreaElement,
  recordPage: HTMLElement
): () => void {
  const hostWindow = textarea.ownerDocument.defaultView;
  if (!hostWindow) return () => undefined;

  let nextTransactionId = 0;
  let transaction: EditScrollTransaction | null = null;
  let firstFrame: number | null = null;
  let secondFrame: number | null = null;
  let timeout: number | null = null;

  const removeTransientListeners = (): void => {
    recordPage.removeEventListener("pointerdown", cancelTransaction);
    recordPage.removeEventListener("touchstart", cancelTransaction);
    recordPage.removeEventListener("wheel", cancelTransaction);
    hostWindow.removeEventListener("blur", cancelTransaction);
  };

  const clearScheduledChecks = (): void => {
    if (firstFrame !== null) hostWindow.cancelAnimationFrame(firstFrame);
    if (secondFrame !== null) hostWindow.cancelAnimationFrame(secondFrame);
    if (timeout !== null) hostWindow.clearTimeout(timeout);
    firstFrame = null;
    secondFrame = null;
    timeout = null;
  };

  function cancelTransaction(): void {
    transaction = null;
    clearScheduledChecks();
    removeTransientListeners();
  }

  const transactionIsActive = (id: number): boolean =>
    transaction?.id === id &&
    textarea.isConnected &&
    textarea.ownerDocument.activeElement === textarea;

  const restoreRecordPageScroll = (id: number): void => {
    if (!transactionIsActive(id) || !transaction) return;
    if (recordPage.scrollTop !== transaction.scrollTop) {
      recordPage.scrollTop = transaction.scrollTop;
    }
  };

  const finishTransaction = (id: number): void => {
    if (transaction?.id !== id) return;
    transaction = null;
    clearScheduledChecks();
    removeTransientListeners();
  };

  const onBeforeInput = (): void => {
    cancelTransaction();
    transaction = {
      id: ++nextTransactionId,
      scrollTop: recordPage.scrollTop
    };
    recordPage.addEventListener("pointerdown", cancelTransaction, { passive: true });
    recordPage.addEventListener("touchstart", cancelTransaction, { passive: true });
    recordPage.addEventListener("wheel", cancelTransaction, { passive: true });
    hostWindow.addEventListener("blur", cancelTransaction, { once: true });
  };

  const onInput = (): void => {
    if (!transaction) return;
    const id = transaction.id;
    restoreRecordPageScroll(id);
    firstFrame = hostWindow.requestAnimationFrame(() => {
      firstFrame = null;
      restoreRecordPageScroll(id);
      secondFrame = hostWindow.requestAnimationFrame(() => {
        secondFrame = null;
        restoreRecordPageScroll(id);
      });
    });
    timeout = hostWindow.setTimeout(() => {
      timeout = null;
      restoreRecordPageScroll(id);
      finishTransaction(id);
    }, POST_EDIT_SCROLL_TIMEOUT_MS);
  };

  textarea.addEventListener("beforeinput", onBeforeInput);
  textarea.addEventListener("input", onInput);
  textarea.addEventListener("blur", cancelTransaction);

  return () => {
    cancelTransaction();
    textarea.removeEventListener("beforeinput", onBeforeInput);
    textarea.removeEventListener("input", onInput);
    textarea.removeEventListener("blur", cancelTransaction);
  };
}
