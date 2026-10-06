import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { uid, readParams, entry } from './model';
import { safeStore, richRequest, type Store } from './domain';
const variable = z.object({
  id: z.string(),
  name: z.string(),
  value: z.string(),
  type: z.enum(['text', 'json', 'number', 'boolean', 'date']),
  secret: z.boolean(),
  description: z.string(),
  prompt: z.boolean().optional(),
});
const row = z.object({ id: z.string(), key: z.string(), value: z.string(), enabled: z.boolean() });
const output = z.object({
  id: z.string(),
  name: z.string(),
  source: z.enum(['body', 'headers', 'status']),
  path: z.string(),
  mode: z.enum(['none', 'transform', 'map', 'filter']),
  script: z.string(),
  missing: z.enum(['fail', 'null']),
  type: z.enum(['auto', 'text', 'json', 'date']),
  secret: z.boolean().optional(),
});
const bytes = z.array(z.number().int().min(0).max(255)).max(10 * 1024 * 1024);
const request = z.object({
  id: z.string(),
  parentId: z.string(),
  name: z.string(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
  url: z.string(),
  body: z.string(),
  format: z.enum(['json', 'xml', 'text']),
  headers: z.array(row),
  auth: z.enum(['none', 'bearer', 'basic']),
  token: z.string(),
  username: z.string(),
  password: z.string(),
  variables: z.array(variable),
  outputs: z.array(output),
  params: z.array(row),
  bodyType: z.enum(['raw', 'form', 'multipart', 'binary']),
  fields: z.array(row),
  description: z.string(),
  files: z.array(
    z.object({ id: z.string(), key: z.string(), name: z.string(), mime: z.string(), bytes }),
  ),
  binary: z.object({ name: z.string(), bytes }).optional(),
});
const schema = z.object({
  version: z.literal(2),
  nodes: z.array(
    z.object({
      id: z.string(),
      parentId: z.string().nullable(),
      name: z.string(),
      kind: z.enum(['folder', 'project']),
      variables: z.array(variable),
    }),
  ),
  requests: z.array(request),
  flows: z.array(
    z.object({
      id: z.string(),
      parentId: z.string(),
      name: z.string(),
      variables: z.array(variable),
      steps: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          kind: z.enum(['start', 'stop', 'request', 'timer', 'view', 'flow']),
          position: z.object({ x: z.number().finite(), y: z.number().finite() }),
          request: request.optional(),
          delay: z.union([z.number().nonnegative(), z.string()]),
          template: z.string(),
          flowId: z.string(),
          inputs: z.array(variable),
        }),
      ),
      edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string() })),
    }),
  ),
});
export function validateStore(input: unknown): Store {
  const store = schema.parse(input);
  const ids = new Set<string>();
  [...store.nodes, ...store.requests, ...store.flows].forEach((item) => {
    if (ids.has(item.id)) throw new Error('Duplicate item ID in import');
    ids.add(item.id);
  });
  for (const node of store.nodes) {
    if (node.parentId) {
      const parent = store.nodes.find((n) => n.id === node.parentId);
      if (!parent || parent.kind !== 'folder')
        throw new Error('Folders and projects must belong to folders');
    } else if (node.kind !== 'folder') throw new Error('Root items must be folders');
    const seen = new Set<string>();
    let id: string | null = node.id;
    while (id) {
      if (seen.has(id)) throw new Error('Folder cycle in import');
      seen.add(id);
      id = store.nodes.find((n) => n.id === id)?.parentId || null;
    }
  }
  [...store.requests, ...store.flows].forEach((item) => {
    if (store.nodes.find((n) => n.id === item.parentId)?.kind !== 'project')
      throw new Error('Requests and flows must belong to a project');
  });
  for (const flow of store.flows) {
    const stepIds = new Set(flow.steps.map((s) => s.id));
    if (stepIds.size !== flow.steps.length) throw new Error('Duplicate step ID');
    flow.edges.forEach((e) => {
      if (!stepIds.has(e.source) || !stepIds.has(e.target))
        throw new Error('Connector targets missing step');
    });
  }
  return store;
}
export function exportXml(store: Store): string {
  // XML request bodies may contain CDATA. Escape its closing delimiter inside
  // JSON strings so it cannot terminate the outer workspace CDATA section.
  const json = JSON.stringify(safeStore(store)).replace(/\]\]>/g, '\\u005d\\u005d\\u003e');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    new XMLBuilder({ ignoreAttributes: false, cdataPropName: 'payload', format: true }).build({
      FlowX: { '@_version': '2', workspace: { payload: json } },
    })
  );
}
export function importXml(xml: string): Store {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD declarations are not allowed');
  if (XMLValidator.validate(xml) !== true) throw new Error('Invalid XML file');
  const parsed = new XMLParser({
    ignoreAttributes: false,
    cdataPropName: 'payload',
    parseTagValue: false,
  }).parse(xml);
  if (parsed.FlowX?.['@_version'] !== '2') throw new Error('Unsupported FlowX XML version');
  const payload = parsed.FlowX.workspace?.payload;
  if (typeof payload !== 'string') throw new Error('Workspace payload is missing');
  return validateStore(JSON.parse(payload));
}
function shellQuote(value: string) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
export function exportCurl(request: ReturnType<typeof richRequest>): string {
  if (request.bodyType !== 'raw')
    throw new Error(
      'cURL export currently supports raw request bodies. Use XML for files and form bodies.',
    );
  const parts = ['curl', '-X', request.method, shellQuote(request.url)];
  request.headers
    .filter((h) => h.enabled && h.key)
    .forEach((h) => parts.push('-H', shellQuote(`${h.key}: ${h.value}`)));
  if (request.auth === 'bearer') parts.push('-H', shellQuote('Authorization: Bearer {token}'));
  if (request.auth === 'basic') parts.push('-u', shellQuote('{username}:{password}'));
  if (request.body && !['GET', 'HEAD'].includes(request.method)) {
    if (!request.headers.some((h) => h.enabled && h.key.toLowerCase() === 'content-type'))
      parts.push(
        '-H',
        shellQuote(
          request.format === 'json'
            ? 'Content-Type: application/json'
            : request.format === 'xml'
              ? 'Content-Type: application/xml'
              : 'Content-Type: text/plain',
        ),
      );
    parts.push('--data-raw', shellQuote(request.body));
  }
  return parts.join(' ');
}
function tokenize(command: string): string[] {
  const result: string[] = [];
  let current = '';
  let quote = '';
  let active = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === '\\' && quote !== "'") {
      const next = command[++i];
      if (next !== '\n' && next !== undefined) current += next;
      active = true;
      continue;
    }
    if (quote) {
      if (c === quote) quote = '';
      else current += c;
      active = true;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      active = true;
    } else if (/\s/.test(c)) {
      if (active) {
        result.push(current);
        current = '';
        active = false;
      }
    } else {
      current += c;
      active = true;
    }
  }
  if (quote) throw new Error('Unclosed quote in cURL command');
  if (active) result.push(current);
  return result;
}
export function importCurl(command: string, parentId: string) {
  const tokens = tokenize(command.trim());
  if (tokens.shift() !== 'curl') throw new Error('Paste a cURL command beginning with curl');
  const request = richRequest(parentId, 'Imported request');
  const take = (i: number) => {
    if (tokens[i] === undefined) throw new Error('Missing cURL option value');
    return tokens[i];
  };
  let explicit = false;
  for (let i = 0; i < tokens.length; i++) {
    const flag = tokens[i];
    if (flag === '-X' || flag === '--request') {
      request.method = take(++i).toUpperCase();
      explicit = true;
    } else if (flag === '-H' || flag === '--header') {
      const header = take(++i);
      const at = header.indexOf(':');
      if (at < 0) throw new Error('Header needs a colon');
      request.headers.push(entry(header.slice(0, at).trim(), header.slice(at + 1).trim()));
    } else if (['-d', '--data', '--data-raw', '--data-binary'].includes(flag)) {
      request.body = take(++i);
      if (request.body.startsWith('@'))
        throw new Error('File references require selecting a file in the app');
      if (!explicit) request.method = 'POST';
    } else if (flag === '-u' || flag === '--user') {
      const credentials = take(++i);
      const at = credentials.indexOf(':');
      request.auth = 'basic';
      request.username = at < 0 ? credentials : credentials.slice(0, at);
      request.password = at < 0 ? '' : credentials.slice(at + 1);
    } else if (flag === '--url') request.url = take(++i);
    else if (['-L', '--location', '--compressed', '--silent', '-s'].includes(flag)) continue;
    else if (flag.startsWith('-')) throw new Error(`Unsupported cURL option ${flag}`);
    else request.url = flag;
  }
  if (!request.url) throw new Error('cURL command needs a URL');
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(request.method))
    throw new Error('Unsupported HTTP method');
  request.params = readParams(request.url);
  const content = request.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value || '';
  request.format = content.includes('xml') ? 'xml' : content.includes('json') ? 'json' : 'text';
  return request;
}
export function mergeStore(current: Store, incoming: Store): Store {
  const mapping = new Map<string, string>();
  [
    ...incoming.nodes,
    ...incoming.requests,
    ...incoming.flows,
    ...incoming.flows.flatMap((f) => f.steps),
  ].forEach((x) => mapping.set(x.id, uid()));
  const remap = (id: string) => mapping.get(id) || id;
  return {
    ...current,
    nodes: [
      ...current.nodes,
      ...incoming.nodes.map((n) => ({
        ...n,
        id: remap(n.id),
        parentId: n.parentId ? remap(n.parentId) : null,
      })),
    ],
    requests: [
      ...current.requests,
      ...incoming.requests.map((r) => ({ ...r, id: remap(r.id), parentId: remap(r.parentId) })),
    ],
    flows: [
      ...current.flows,
      ...incoming.flows.map((f) => ({
        ...f,
        id: remap(f.id),
        parentId: remap(f.parentId),
        steps: f.steps.map((s) => ({
          ...s,
          id: remap(s.id),
          flowId: remap(s.flowId),
          request: s.request
            ? { ...s.request, id: uid(), parentId: remap(s.request.parentId) }
            : undefined,
        })),
        edges: f.edges.map((e) => ({
          ...e,
          id: uid(),
          source: remap(e.source),
          target: remap(e.target),
        })),
      })),
    ],
  };
}
export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
