import {
  applyManualTagCompletion,
  collectConfirmedManualTagOptions,
  extractConfirmedManualTags,
  findManualTagInput,
  manualTagSuggestions,
  parseConfirmedManualTagRanges
} from "../services/manualTags";
import type { StoredDoudouRecord } from "../types";

export function createRecordTextareaEditor(
  form: HTMLElement,
  initialValue: string,
  records: readonly StoredDoudouRecord[]
): HTMLTextAreaElement {
  const wrapper = form.createDiv({ cls: "doudou-textarea-editor" });
  const textarea = wrapper.createEl("textarea", {
    cls: "doudou-editor-content",
    attr: {
      placeholder: "记下此刻……\n\n直接输入 #标签",
      "aria-label": "正文",
      rows: "10",
      autocomplete: "off",
      spellcheck: "true"
    }
  });
  textarea.value = initialValue;
  const suggestions = wrapper.createDiv({
    cls: "doudou-tag-suggestions doudou-is-hidden",
    attr: { role: "listbox", "aria-label": "用户标签建议" }
  });
  const confirmation = wrapper.createDiv({
    cls: "doudou-tag-confirmation doudou-is-hidden",
    attr: { role: "status", "aria-live": "polite" }
  });
  const options = collectConfirmedManualTagOptions(records);
  let composing = false;
  let renderedSuggestionsKey: string | null = null;
  let confirmationTimer: number | null = null;

  const hideSuggestions = (): void => {
    renderedSuggestionsKey = null;
    if (suggestions.hasClass("doudou-is-hidden")) return;
    suggestions.empty();
    suggestions.addClass("doudou-is-hidden");
  };
  const showConfirmation = (name: string): void => {
    if (confirmationTimer !== null) window.clearTimeout(confirmationTimer);
    confirmation.setText(`已确认 #${name}`);
    confirmation.removeClass("doudou-is-hidden");
    confirmationTimer = window.setTimeout(() => {
      confirmation.addClass("doudou-is-hidden");
      confirmationTimer = null;
    }, 1200);
  };
  const applySuggestion = (name: string): void => {
    const input = findManualTagInput(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd
    );
    if (!input) return;
    const completion = applyManualTagCompletion(textarea.value, input, name);
    textarea.value = completion.value;
    textarea.setSelectionRange(completion.selectionStart, completion.selectionEnd);
    textarea.focus({ preventScroll: true });
    showConfirmation(name);
  };
  const fitVisibleSuggestions = (): void => {
    const availableWidth = suggestions.clientWidth;
    if (availableWidth <= 0) return;
    const style = window.getComputedStyle(suggestions);
    const contentWidth = availableWidth -
      (Number.parseFloat(style.paddingLeft) || 0) -
      (Number.parseFloat(style.paddingRight) || 0);
    const gap = Number.parseFloat(style.columnGap) || 0;
    let occupied = 0;
    for (const button of suggestions.querySelectorAll<HTMLElement>(".doudou-tag-suggestion")) {
      button.removeClass("doudou-is-clipped");
      const width = button.offsetWidth;
      if (width <= 0) continue;
      const nextWidth = occupied === 0 ? width : occupied + gap + width;
      button.toggleClass("doudou-is-clipped", nextWidth > contentWidth);
      if (nextWidth <= contentWidth) occupied = nextWidth;
    }
  };
  const updateSuggestions = (): void => {
    if (composing || document.activeElement !== textarea) {
      hideSuggestions();
      return;
    }
    const input = findManualTagInput(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd
    );
    if (!input) {
      hideSuggestions();
      return;
    }
    const confirmed = new Set(extractConfirmedManualTags(textarea.value));
    const matches = manualTagSuggestions(options, input.query, confirmed);
    if (matches.length === 0) {
      hideSuggestions();
      return;
    }
    const key = `${input.replacementStart}:${input.replacementEnd}:${matches.map((option) => option.name).join("\u0000")}`;
    if (renderedSuggestionsKey === key && !suggestions.hasClass("doudou-is-hidden")) return;
    suggestions.empty();
    suggestions.removeClass("doudou-is-hidden");
    for (const option of matches) {
      const button = suggestions.createEl("button", {
        cls: "doudou-tag-suggestion",
        text: `#${option.name}`,
        attr: { type: "button", role: "option" }
      });
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      button.addEventListener("pointerup", (event) => {
        event.stopPropagation();
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        applySuggestion(option.name);
        hideSuggestions();
      });
    }
    renderedSuggestionsKey = key;
    fitVisibleSuggestions();
    window.requestAnimationFrame(() => {
      if (renderedSuggestionsKey === key && suggestions.isConnected) fitVisibleSuggestions();
    });
  };

  textarea.addEventListener("input", (event) => {
    if (composing) return;
    const inputEvent = event as InputEvent;
    const caret = textarea.selectionStart;
    if (
      inputEvent.inputType === "insertText" &&
      inputEvent.data === " " &&
      caret === textarea.selectionEnd &&
      textarea.value[caret - 1] === " "
    ) {
      const confirmed = parseConfirmedManualTagRanges(textarea.value)
        .find((range) => range.end === caret - 1);
      if (confirmed) showConfirmation(confirmed.name);
    }
    updateSuggestions();
  });
  textarea.addEventListener("select", updateSuggestions);
  textarea.addEventListener("click", updateSuggestions);
  textarea.addEventListener("keyup", updateSuggestions);
  textarea.addEventListener("compositionstart", () => {
    composing = true;
    hideSuggestions();
  });
  textarea.addEventListener("compositionend", () => {
    composing = false;
    updateSuggestions();
  });
  textarea.addEventListener("focus", updateSuggestions);
  textarea.addEventListener("blur", hideSuggestions);
  return textarea;
}
