import {
  applyManualTagCompletion,
  collectConfirmedManualTagOptions,
  extractConfirmedManualTags,
  findManualTagInput,
  manualTagSuggestions
} from "../services/manualTags";
import type { StoredDoudouRecord } from "../types";
import { hideTagSuggestions } from "./tagSuggestionDom";
import { renderManualTagText } from "./uiHelpers";

export function resizeTextareaToContent(textarea: HTMLTextAreaElement): void {
  textarea.style.height = "auto";
  const borderHeight = Math.max(0, textarea.offsetHeight - textarea.clientHeight);
  textarea.style.height = `${textarea.scrollHeight + borderHeight}px`;
}

export function createManualTagEditor(
  form: HTMLElement,
  initialValue: string,
  records: readonly StoredDoudouRecord[]
): HTMLTextAreaElement {
  const wrapper = form.createDiv({ cls: "doudou-tag-editor" });
  const mirror = wrapper.createDiv({
    cls: "doudou-editor-content doudou-tag-editor-mirror",
    attr: { "aria-hidden": "true" }
  });
  const textarea = wrapper.createEl("textarea", {
    cls: "doudou-editor-content doudou-tag-editor-input",
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
  const options = collectConfirmedManualTagOptions(records);
  let composing = false;
  let renderedSuggestionsKey: string | null = null;

  const syncEditorSurface = (): void => {
    renderManualTagText(mirror, textarea.value, true);
    resizeTextareaToContent(textarea);
  };
  const hideSuggestions = (): void => {
    renderedSuggestionsKey = null;
    hideTagSuggestions(suggestions);
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
    syncEditorSurface();
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
    syncEditorSurface();
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
    syncEditorSurface();
    updateSuggestions();
  });
  textarea.addEventListener("focus", updateSuggestions);
  textarea.addEventListener("blur", hideSuggestions);
  syncEditorSurface();
  return textarea;
}
