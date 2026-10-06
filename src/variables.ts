import { ancestors, type Store, type Variable, type RichRequest } from './domain';
export type Values = Record<string, unknown>;
export function variableValue(v: Variable): unknown {
  if (v.type === 'json') return JSON.parse(v.value);
  if (v.type === 'number') {
    const n = Number(v.value);
    if (!Number.isFinite(n) || !v.value.trim())
      throw new Error(`Variable ${v.name} needs a number`);
    return n;
  }
  if (v.type === 'boolean') {
    if (!['true', 'false'].includes(v.value))
      throw new Error(`Variable ${v.name} must be true or false`);
    return v.value === 'true';
  }
  if (v.type === 'date') {
    const date = new Date(v.value);
    if (Number.isNaN(date.getTime())) throw new Error(`Variable ${v.name} needs a valid date`);
    return date.toISOString();
  }
  return v.value;
}
export function valuesOf(vars: Variable[]): Values {
  return Object.fromEntries(vars.filter((v) => v.name).map((v) => [v.name, variableValue(v)]));
}
export function inherited(store: Store, parentId: string, own: Variable[] = []): Variable[] {
  const map = new Map<string, Variable>();
  [...ancestors(store, parentId).flatMap((n) => n.variables), ...own].forEach((v) => {
    if (v.name) map.set(v.name, v);
  });
  return [...map.values()];
}
export const placeholder = /\{([\w][\w .-]*)\}/g;
export function references(text: string): string[] {
  return Array.from(text.matchAll(placeholder), (m) => m[1]);
}
export function substitute(text: string, values: Values): string {
  return text.replace(placeholder, (_, name: string) => {
    if (!Object.hasOwn(values, name))
      throw new Error(`Variable {${name}} is unavailable. Define it or run its producer.`);
    const value = values[name];
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}
export function resolveBody(body: string, format: string, values: Values): string {
  if (format === 'json') {
    try {
      const document = JSON.parse(body);
      const walk = (v: any): any => {
        if (typeof v === 'string') {
          const matches = references(v);
          if (matches.length === 1 && v === `{${matches[0]}}`) {
            if (!Object.hasOwn(values, matches[0]))
              throw new Error(`Unknown variable {${matches[0]}}`);
            return values[matches[0]];
          }
          return substitute(v, values);
        }
        if (Array.isArray(v)) return v.map(walk);
        if (v && typeof v === 'object')
          return Object.fromEntries(
            Object.entries(v).map(([k, val]) => [substitute(k, values), walk(val)]),
          );
        return v;
      };
      return JSON.stringify(walk(document));
    } catch (error) {
      if (error instanceof SyntaxError) {
        const result = substitute(body, values);
        JSON.parse(result);
        return result;
      }
      throw error;
    }
  }
  if (format === 'xml')
    return body.replace(placeholder, (_, name: string) => {
      const raw = substitute(`{${name}}`, values);
      return raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    });
  return substitute(body, values);
}
export function resolveRequest(request: RichRequest, values: Values): RichRequest {
  const resolve = (s: string) => substitute(s, values);
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  return {
    ...request,
    url: resolve(request.url),
    body:
      hasBody && request.bodyType === 'raw' && request.body
        ? resolveBody(request.body, request.format, values)
        : request.body,
    token: request.auth === 'bearer' ? resolve(request.token) : request.token,
    username: request.auth === 'basic' ? resolve(request.username) : request.username,
    password: request.auth === 'basic' ? resolve(request.password) : request.password,
    headers: request.headers.map((h) =>
      h.enabled ? { ...h, key: resolve(h.key), value: resolve(h.value) } : h,
    ),
    fields:
      hasBody && ['form', 'multipart'].includes(request.bodyType)
        ? request.fields.map((h) =>
            h.enabled ? { ...h, key: resolve(h.key), value: resolve(h.value) } : h,
          )
        : request.fields,
    files: request.files.map((f) => ({
      ...f,
      key: hasBody && request.bodyType === 'multipart' ? resolve(f.key) : f.key,
    })),
  };
}
export function requestReferences(r: RichRequest): string[] {
  const hasBody = !['GET', 'HEAD'].includes(r.method);
  return references(
    [
      r.url,
      hasBody && r.bodyType === 'raw' ? r.body : '',
      r.auth === 'bearer' ? r.token : '',
      r.auth === 'basic' ? r.username + '\n' + r.password : '',
      ...r.headers.filter((h) => h.enabled).flatMap((h) => [h.key, h.value]),
      ...(hasBody && ['form', 'multipart'].includes(r.bodyType)
        ? r.fields.filter((h) => h.enabled).flatMap((h) => [h.key, h.value])
        : []),
      ...(hasBody && r.bodyType === 'multipart' ? r.files.map((f) => f.key) : []),
    ].join('\n'),
  );
}
export function resolveVariables(vars: Variable[], base: Values = {}, only?: string[]): Values {
  const values: Values = { ...base };
  const byName = new Map(vars.filter((v) => v.name).map((v) => [v.name, v]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (name: string): unknown => {
    if (done.has(name)) return values[name];
    const v = byName.get(name);
    if (!v) {
      if (Object.hasOwn(values, name)) return values[name];
      throw new Error(`Unknown variable {${name}}`);
    }
    if (visiting.has(name)) throw new Error(`Variable cycle at {${name}}`);
    visiting.add(name);
    const local = { ...values };
    references(v.value).forEach((ref) => (local[ref] = visit(ref)));
    const resolved =
      v.type === 'json' ? resolveBody(v.value, 'json', local) : substitute(v.value, local);
    values[name] = variableValue({ ...v, value: resolved });
    visiting.delete(name);
    done.add(name);
    return values[name];
  };
  (only || vars.filter((v) => v.name).map((v) => v.name)).forEach(visit);
  return values;
}
export function dependencyReferences(request: RichRequest, vars: Variable[]): string[] {
  const byName = new Map(vars.map((v) => [v.name, v]));
  const outputs = new Set<string>();
  const visiting = new Set<string>();
  const walk = (reference: string) => {
    const v = byName.get(reference);
    if (!v) {
      outputs.add(reference);
      return;
    }
    if (visiting.has(reference)) throw new Error(`Variable cycle at {${reference}}`);
    visiting.add(reference);
    references(v.value).forEach(walk);
    visiting.delete(reference);
  };
  requestReferences(request).forEach(walk);
  return [...outputs];
}
