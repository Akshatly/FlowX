import type { Store, RichRequest, Flow, Variable } from './domain';
function replace(text: string, oldName: string, newName: string) {
  return text.split(`{${oldName}.`).join(`{${newName}.`);
}
const vars = (values: Variable[], oldName: string, newName: string) =>
  values.map((v) => ({ ...v, value: replace(v.value, oldName, newName) }));
function rewrite(request: RichRequest, oldName: string, newName: string): RichRequest {
  return {
    ...request,
    url: replace(request.url, oldName, newName),
    body: replace(request.body, oldName, newName),
    token: replace(request.token, oldName, newName),
    username: replace(request.username, oldName, newName),
    password: replace(request.password, oldName, newName),
    headers: request.headers.map((h) => ({
      ...h,
      key: replace(h.key, oldName, newName),
      value: replace(h.value, oldName, newName),
    })),
    fields: request.fields.map((h) => ({
      ...h,
      key: replace(h.key, oldName, newName),
      value: replace(h.value, oldName, newName),
    })),
    variables: vars(request.variables, oldName, newName),
  };
}
export function updateRequest(store: Store, next: RichRequest): Store {
  const previous = store.requests.find((r) => r.id === next.id);
  let requests = store.requests.map((r) => (r.id === next.id ? next : r));
  if (previous && previous.name !== next.name)
    requests = requests.map((r) =>
      r.parentId === next.parentId ? rewrite(r, previous.name, next.name) : r,
    );
  if (previous)
    for (const old of previous.outputs) {
      const updated = next.outputs.find((o) => o.id === old.id);
      if (updated && updated.name !== old.name)
        requests = requests.map((r) =>
          r.parentId === next.parentId
            ? JSON.parse(
                replaceExact(
                  JSON.stringify(r),
                  `${next.name}.${old.name}`,
                  `${next.name}.${updated.name}`,
                ),
              )
            : r,
        );
    }
  return { ...store, requests };
}
export function updateFlow(store: Store, next: Flow): Store {
  const previous = store.flows.find((f) => f.id === next.id);
  if (previous) {
    for (const old of previous.steps) {
      const updated = next.steps.find((s) => s.id === old.id);
      if (updated && updated.name !== old.name) {
        next = {
          ...next,
          steps: next.steps.map((s) => ({
            ...s,
            template: replace(s.template, old.name, updated.name),
            inputs: vars(s.inputs, old.name, updated.name),
            request: s.request ? rewrite(s.request, old.name, updated.name) : undefined,
          })),
        };
      }
      if (updated?.request && old.request)
        for (const output of old.request.outputs) {
          const renamed = updated.request.outputs.find((o) => o.id === output.id);
          if (renamed && renamed.name !== output.name) {
            const from = `${updated.name}.${output.name}`,
              to = `${updated.name}.${renamed.name}`;
            next = {
              ...next,
              steps: next.steps.map((s) => ({
                ...s,
                template: replaceExact(s.template, from, to),
                inputs: s.inputs.map((v) => ({ ...v, value: replaceExact(v.value, from, to) })),
                request: s.request
                  ? JSON.parse(replaceExact(JSON.stringify(s.request), from, to))
                  : undefined,
              })),
            };
          }
        }
    }
  }
  return { ...store, flows: store.flows.map((f) => (f.id === next.id ? next : f)) };
}
function replaceExact(text: string, from: string, to: string) {
  return text.split(`{${from}}`).join(`{${to}}`);
}
