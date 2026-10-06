import { describe, expect, it } from 'vitest';
import { seed, newFlow, newStep, variable } from './domain';
import { duplicateItem, exportItem, importInto } from './treeActions';
import { exportXml, importXml, validateStore } from './interchange';

describe('tree item actions', () => {
  it('duplicates a folder without moving originals and preserves request dependencies', () => {
    const store = seed();
    const root = store.nodes.find((n) => !n.parentId)!;
    const result = duplicateItem(store, root.id);
    expect(result.store.nodes.find((n) => n.id === root.id)).toEqual(root);
    expect(result.store.nodes.find((n) => n.id === result.id)?.name).toBe(root.name + ' copy');
    expect(result.store.requests).toHaveLength(store.requests.length * 2);
    expect(validateStore(result.store)).toBeTruthy();
    const clone = result.store.flows.at(-1)!;
    expect(
      clone.steps.map((s) => s.id).some((id) => store.flows[0].steps.some((s) => s.id === id)),
    ).toBe(false);
    expect(
      clone.edges.every(
        (e) =>
          clone.steps.some((s) => s.id === e.source) && clone.steps.some((s) => s.id === e.target),
      ),
    ).toBe(true);
  });
  it('exports a dependent request with its producer and inherited scopes', () => {
    const store = seed();
    const selected = store.requests.find((r) => r.name === 'Get comments')!;
    const exported = importXml(exportXml(exportItem(store, selected.id)));
    expect(exported.requests).toHaveLength(2);
    expect(exported.flows).toHaveLength(0);
    expect(validateStore(exported)).toBeTruthy();
  });
  it('exports nested flow definitions and valid ancestry', () => {
    const store = seed();
    const flow = newFlow(store.flows[0].parentId, 'Parent');
    const call = newStep('flow', 300, 100);
    call.flowId = store.flows[0].id;
    flow.steps.push(call);
    store.flows.push(flow);
    const exported = exportItem(store, flow.id);
    expect(exported.flows).toHaveLength(2);
    expect(validateStore(exported)).toBeTruthy();
  });
  it('imports into a folder and keeps its subtree hierarchy', () => {
    const current = seed();
    const incoming = seed();
    const target = current.nodes.find((n) => !n.parentId)!;
    const merged = importInto(current, incoming, target.id);
    expect(
      merged.nodes.slice(current.nodes.length).find((n) => n.kind === 'folder')?.parentId,
    ).toBe(target.id);
    expect(validateStore(merged)).toBeTruthy();
  });
  it('imports into a project, retaining incoming inherited variables and remapping step IDs', () => {
    const current = seed();
    const incoming = seed();
    const v = variable('shared');
    v.value = 'hello';
    incoming.nodes[0].variables.push(v);
    const target = current.nodes.find((n) => n.kind === 'project')!;
    const merged = importInto(current, incoming, target.id);
    expect(merged.nodes).toHaveLength(current.nodes.length);
    expect(merged.requests.at(-1)?.parentId).toBe(target.id);
    expect(merged.requests.at(-1)?.variables.some((v) => v.name === 'shared')).toBe(true);
    expect(merged.flows.at(-1)?.steps[0].id).not.toBe(incoming.flows[0].steps[0].id);
    expect(validateStore(merged)).toBeTruthy();
  });
});
