export type Entry = { id: string; key: string; value: string; enabled: boolean };
export type Request = {
  id: string;
  parentId: string;
  name: string;
  method: string;
  url: string;
  body: string;
  format: 'json' | 'xml' | 'text';
  headers: Entry[];
  auth: 'none' | 'bearer' | 'basic';
  token: string;
  username: string;
  password: string;
};
export type TreeNode = {
  id: string;
  parentId: string | null;
  name: string;
  kind: 'folder' | 'project';
};
export type Workspace = { nodes: TreeNode[]; requests: Request[] };
export type HttpResponse = {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
  duration: number;
  size: number;
};
export const uid = () => crypto.randomUUID();
export const entry = (key = '', value = ''): Entry => ({ id: uid(), key, value, enabled: true });
export const newRequest = (parentId: string, name = 'Untitled request'): Request => ({
  id: uid(),
  parentId,
  name,
  method: 'GET',
  url: '',
  body: '',
  format: 'json',
  headers: [],
  auth: 'none',
  token: '',
  username: '',
  password: '',
});
export const initialWorkspace: Workspace = {
  nodes: [
    { id: 'folder', parentId: null, name: 'My workspace', kind: 'folder' },
    { id: 'project', parentId: 'folder', name: 'Getting started', kind: 'project' },
  ],
  requests: [
    {
      ...newRequest('project', 'Get a sample post'),
      id: 'sample',
      url: 'https://jsonplaceholder.typicode.com/posts/1',
    },
  ],
};
export function canCreate(parent: TreeNode | undefined, kind: 'folder' | 'project' | 'request') {
  if (!parent) return kind === 'folder';
  return parent.kind === 'folder' ? kind !== 'request' : kind === 'request';
}
export function readParams(url: string): Entry[] {
  const query = url.split('#')[0].split('?').slice(1).join('?');
  return Array.from(new URLSearchParams(query), ([key, value]) => entry(key, value));
}
export function writeParams(url: string, rows: Entry[]): string {
  const hashAt = url.indexOf('#');
  const hash = hashAt < 0 ? '' : url.slice(hashAt);
  const base = (hashAt < 0 ? url : url.slice(0, hashAt)).split('?')[0];
  const params = new URLSearchParams();
  rows.filter((r) => r.enabled && r.key).forEach((r) => params.append(r.key, r.value));
  const query = params.toString().replace(/%7B(.*?)%7D/g, (token, content) => {
    const name = decodeURIComponent(content.replace(/\+/g, ' '));
    return /^[\w][\w .-]*$/.test(name) ? '{' + name + '}' : token;
  });
  return base + (query ? '?' + query : '') + hash;
}
