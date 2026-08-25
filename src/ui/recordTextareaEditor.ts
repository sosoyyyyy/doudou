import {
  applyManualTagCompletion,
  collectConfirmedManualTagOptions,
  extractConfirmedManualTags,
  findManualTagInput,
  manualTagSuggestions
} from "../services/manualTags";
import type { StoredDoudouRecord } from "../types";

function numericCssValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createRecordTextareaEditor(
  form: HTMLElement,
  initialValue: string,
  records: readonly StoredDoudouRecord[],
  registerCleanup?: (cleanup: () => void) => void
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
  const measurement = wrapper.createEl("textarea", {
    cls: "doudou-editor-content doudou-textarea-measure",
    attr: {
      "aria-hidden": "true",
      tabindex: "-1",
      readonly: "true"
    }
  });
  const suggestions = wrapper.createDiv({
    cls: "doudou-tag-suggestions doudou-is-hidden",
    attr: { role: "listbox", "aria-label": "用户标签建议" }
  });
  const options = collectConfirmedManualTagOptions(records);
  let composing = false;
  let renderedSuggestionsKey: string | null = null;
  let measuredWidth = -1;

  const resizeTextareaToContent = (): void => {
    const computed = window.getComputedStyle(textarea);
    const layoutWidth = textarea.getBoundingClientRect().width;
    const computedWidth = numericCssValue(computed.width);
    if (Math.abs(layoutWidth - measuredWidth) > 0.5) {
      measurement.style.width = `${computedWidth || layoutWidth}px`;
      measuredWidth = layoutWidth;
    }
    measurement.value = textarea.value;
    const borderHeight = numericCssValue(computed.borderTopWidth) + numericCssValue(computed.borderBottomWidth);
    const targetHeight = Math.ceil(Math.max(
      numericCssValue(computed.minHeight),
      measurement.scrollHeight + borderHeight
    ));
    const currentHeight = numericCssValue(textarea.style.height);
    if (Math.abs(targetHeight - currentHeight) <= 0.5) return;
    textarea.style.height = `${targetHeight}px`;
  };

  const resizeObserver = typeof ResizeObserver === "undefined"
    ? null
    : new ResizeObserver(() => {
      const width = textarea.getBoundingClientRect().width;
      if (Math.abs(width - measuredWidth) <= 0.5) return;
      resizeTextareaToContent();
    });
  resizeObserver?.observe(textarea);
  registerCleanup?.(() => {
    resizeObserver?.disconnect();
    measurement.remove();
  });

  const hideSuggestions = (): void => {
    renderedSuggestionsKey = null;
    if (suggestions.hasClass("doudou-is-hidden")) return;
    suggestions.empty();
    suggestions.addClass("doudou-is-hidden");
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
    resizeTextareaToContent();
    hideSuggestions();
    textarea.focus({ preventScroll: true });
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
        applySuggestion(option.name);
      });
      button.addEventListener("click", () => applySuggestion(option.name));
    }
    renderedSuggestionsKey = key;
  };

  textarea.addEventListener("input", () => {
    resizeTextareaToContent();
    if (!composing) updateSuggestions();
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
    resizeTextareaToContent();
    updateSuggestions();
  });
  textarea.addEventListener("focus", updateSuggestions);
  textarea.addEventListener("blur", hideSuggestions);
  resizeTextareaToContent();
  return textarea;
}
