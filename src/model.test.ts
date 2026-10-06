import { describe, expect, it } from 'vitest';
import { canCreate, readParams, writeParams, entry, type TreeNode } from './model';
describe('workspace hierarchy', () => {
  const folder: TreeNode = { id: 'folder', parentId: null, name: 'Folder', kind: 'folder' };
  const project: TreeNode = { ...folder, id: 'project', parentId: 'folder', kind: 'project' };
  it('requires a folder before creating a project or request', () => {
    expect(canCreate(undefined, 'folder')).toBe(true);
    expect(canCreate(undefined, 'project')).toBe(false);
    expect(canCreate(undefined, 'request')).toBe(false);
  });
  it('prevents folders inside projects and requests outside projects', () => {
    expect(canCreate(folder, 'project')).toBe(true);
    expect(canCreate(folder, 'folder')).toBe(true);
    expect(canCreate(folder, 'request')).toBe(false);
    expect(canCreate(project, 'folder')).toBe(false);
    expect(canCreate(project, 'project')).toBe(false);
    expect(canCreate(project, 'request')).toBe(true);
  });
});
describe('query parameter synchronization', () => {
  it('preserves repeated keys, empty values, encoding and fragments', () => {
    const url = 'https://api.test/users?tag=a&tag=b&empty=&q=hello+world#details';
    const rows = readParams(url);
    expect(rows.map(({ key, value }) => [key, value])).toEqual([
      ['tag', 'a'],
      ['tag', 'b'],
      ['empty', ''],
      ['q', 'hello world'],
    ]);
    expect(writeParams(url, rows)).toBe(url);
  });
  it('excludes disabled rows and replaces existing parameters', () => {
    expect(
      writeParams('https://api.test/?old=1#result', [
        entry('new', 'a&b'),
        { ...entry('hidden', 'x'), enabled: false },
      ]),
    ).toBe('https://api.test/?new=a%26b#result');
  });
  it('does not mistake fragment content for query parameters', () => {
    expect(readParams('https://api.test/#view?foo=bar')).toEqual([]);
    expect(writeParams('https://api.test/?old=1', [])).toBe('https://api.test/');
  });
});
