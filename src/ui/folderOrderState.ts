export type FolderOrderLoadState =
  | { status: "loading"; names: [] }
  | { status: "loaded"; names: string[] }
  | { status: "error"; names: []; error: unknown };

export async function loadFolderOrderState(
  loadNames: () => Promise<string[]>,
  onState: (state: FolderOrderLoadState) => void
): Promise<FolderOrderLoadState> {
  onState({ status: "loading", names: [] });
  let names: string[];
  try {
    names = await loadNames();
  } catch (error) {
    const state: FolderOrderLoadState = { status: "error", names: [], error };
    onState(state);
    return state;
  }
  const state: FolderOrderLoadState = { status: "loaded", names };
  onState(state);
  return state;
}
