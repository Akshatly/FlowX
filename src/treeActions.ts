import type { Store } from './domain';
import { uid } from './model';
import { dependencyOrder } from './runner';
import { inherited } from './variables';
import { mergeStore } from './interchange';

function descendants(store: Store, id: string) {
  const ids = new Set([id]);
  let size = -1;
  while (size !== ids.size) {
    size = ids.size;
    store.nodes.forEach((n) => {
      if (n.parentId && ids.has(n.parentId)) ids.add(n.id);
    });
  }
  return ids;
}
function subtree(store: Store, id: string): Store {
  const ids = descendants(store, id);
  return {
    version: 2,
    nodes: store.nodes.filter((n) => ids.has(n.id)),
    requests: store.requests.filter((r) => ids.has(r.id) || ids.has(r.parentId)),
    flows: store.flows.filter((f) => ids.has(f.id) || ids.has(f.parentId)),
  };
}
export function exportItem(store: Store, id: string): Store {
  const result = structuredClone(subtree(store, id));
  const request = store.requests.find((r) => r.id === id);
  if (request) {
    try {
      result.requests = structuredClone(dependencyOrder(store, request));
    } catch {
      /* Unfinished requests can still be shared. */
    }
  }
  const flowIds = new Set(result.flows.map((f) => f.id));
  for (let index = 0; index < result.flows.length; index++) {
    for (const step of result.flows[index].steps) {
      if (step.kind !== 'flow' || flowIds.has(step.flowId)) continue;
      const nested = store.flows.find((f) => f.id === step.flowId);
      if (nested) {
        result.flows.push(structuredClone(nested));
        flowIds.add(nested.id);
      }
    }
  }
  const ids = new Set(result.nodes.map((n) => n.id));
  const addParent = (id: string | null) => {
    while (id) {
      const node = store.nodes.find((n) => n.id === id);
      if (!node) break;
      if (!ids.has(id)) {
        ids.add(id);
        result.nodes.push(structuredClone(node));
      }
      id = node.parentId;
    }
  };
  [...result.nodes].forEach((n) => addParent(n.parentId));
  [...result.requests, ...result.flows].forEach((item) => addParent(item.parentId));
  return result;
}
export function duplicateItem(store: Store, id: string): { store: Store; id: string } {
  const subset = structuredClone(subtree(store, id));
  const mapping = new Map<string, string>();
  [
    ...subset.nodes,
    ...subset.requests,
    ...subset.flows,
    ...subset.flows.flatMap((f) => f.steps),
  ].forEach((item) => mapping.set(item.id, uid()));
  const remap = (id: string) => mapping.get(id) || id;
  subset.nodes.forEach((n) => {
    const original = n.id;
    n.id = remap(n.id);
    n.parentId = n.parentId ? remap(n.parentId) : null;
    if (original === id) n.name += ' copy';
  });
  subset.requests.forEach((r) => {
    const original = r.id;
    r.id = remap(r.id);
    r.parentId = remap(r.parentId);
    if (original === id) r.name += ' copy';
  });
  subset.flows.forEach((f) => {
    const original = f.id;
    f.id = remap(f.id);
    f.parentId = remap(f.parentId);
    if (original === id) f.name += ' copy';
    f.steps.forEach((s) => {
      s.id = remap(s.id);
      s.flowId = remap(s.flowId);
      if (s.request) {
        s.request.id = uid();
        s.request.parentId = f.parentId;
      }
    });
    f.edges.forEach((e) => {
      e.id = uid();
      e.source = remap(e.source);
      e.target = remap(e.target);
    });
  });
  return {
    id: remap(id),
    store: {
      ...store,
      nodes: [...store.nodes, ...subset.nodes],
      requests: [...store.requests, ...subset.requests],
      flows: [...store.flows, ...subset.flows],
    },
  };
}
export function importInto(current: Store, incoming: Store, targetId?: string): Store {
  const target = current.nodes.find((n) => n.id === targetId);
  const merged = mergeStore(current, incoming);
  if (!target) return merged;
  const newNodes = merged.nodes.slice(current.nodes.length);
  if (target.kind === 'folder') {
    const roots = new Set(newNodes.filter((n) => !n.parentId).map((n) => n.id));
    return {
      ...merged,
      nodes: merged.nodes.map((n) => (roots.has(n.id) ? { ...n, parentId: target.id } : n)),
    };
  }
  const copiedRequests = merged.requests.slice(current.requests.length);
  const copiedFlows = merged.flows.slice(current.flows.length);
  return {
    ...current,
    requests: [
      ...current.requests,
      ...copiedRequests.map((r, i) => ({
        ...r,
        parentId: target.id,
        variables: inherited(
          incoming,
          incoming.requests[i].parentId,
          incoming.requests[i].variables,
        ),
      })),
    ],
    flows: [
      ...current.flows,
      ...copiedFlows.map((f, i) => ({
        ...f,
        parentId: target.id,
        variables: inherited(incoming, incoming.flows[i].parentId, incoming.flows[i].variables),
        steps: f.steps.map((s) =>
          s.request ? { ...s, request: { ...s.request, parentId: target.id } } : s,
        ),
      })),
    ],
  };
}
