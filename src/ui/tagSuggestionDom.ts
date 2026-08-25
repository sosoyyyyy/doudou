const HIDDEN_CLASS = "doudou-is-hidden";

export function hideTagSuggestions(container: HTMLElement): boolean {
  if (container.classList.contains(HIDDEN_CLASS) && container.childNodes.length === 0) return false;
  container.replaceChildren();
  container.classList.add(HIDDEN_CLASS);
  return true;
}
