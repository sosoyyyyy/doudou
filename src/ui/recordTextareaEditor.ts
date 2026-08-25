export function createRecordTextareaEditor(
  form: HTMLElement,
  initialValue: string
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
  return textarea;
}
