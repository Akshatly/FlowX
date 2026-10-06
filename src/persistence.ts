import { invoke, isTauri } from '@tauri-apps/api/core';
import { safeStore, seed, upgrade, type Store } from './domain';
import { withSamples } from './samples';
export const STORAGE = 'flowx.workspace.v2';
export async function loadStore(): Promise<Store> {
  const raw = isTauri()
    ? await invoke<string | null>('load_workspace')
    : localStorage.getItem(STORAGE) || localStorage.getItem('flowx.workspace.v1');
  return withSamples(raw ? upgrade(JSON.parse(raw)) : seed());
}
export async function saveStore(store: Store) {
  const data = JSON.stringify(safeStore(store));
  if (isTauri()) await invoke('save_workspace', { data });
  else localStorage.setItem(STORAGE, data);
}
