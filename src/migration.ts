import { uid, entry, readParams } from './model';
import { richRequest, variable, type Store, type RichRequest } from './domain';
import { validateStore } from './interchange';
const normalize = (value: string) => value.replace(/\{\{([^{}]+)\}\}/g, '{$1}');
function container(name: string): Store {
  const folder = uid(),
    project = uid();
  return {
    version: 2,
    nodes: [
      { id: folder, parentId: null, name: 'Imported', kind: 'folder', variables: [] },
      { id: project, parentId: folder, name, kind: 'project', variables: [] },
    ],
    requests: [],
    flows: [],
  };
}
export function importPostman(data: any): Store {
  if (!data?.info || !Array.isArray(data.item)) throw new Error('Not a Postman collection');
  const store = container(data.info.name || 'Postman collection');
  const project = store.nodes[1];
  project.variables = (data.variable || []).map((v: any) => ({
    ...variable(String(v.key || '')),
    value: normalize(String(v.value ?? '')),
  }));
  const walk = (items: any[], prefix = '') =>
    items.forEach((item) => {
      if (Array.isArray(item.item)) {
        walk(item.item, prefix + item.name + ' / ');
        return;
      }
      const source = item.request;
      if (!source) return;
      const request = richRequest(project.id, prefix + (item.name || 'Imported request'));
      request.method = String(source.method || 'GET').toUpperCase();
      request.url = normalize(typeof source.url === 'string' ? source.url : source.url?.raw || '');
      request.headers = (source.header || []).map((h: any) => ({
        ...entry(normalize(String(h.key)), normalize(String(h.value ?? ''))),
        enabled: !h.disabled,
      }));
      if (source.body?.mode === 'raw') {
        request.body = normalize(source.body.raw || '');
        const language = source.body.options?.raw?.language;
        request.format = language === 'xml' ? 'xml' : language === 'json' ? 'json' : 'text';
      }
      if (source.body?.mode === 'urlencoded') {
        request.bodyType = 'form';
        request.fields = (source.body.urlencoded || []).map((f: any) => ({
          ...entry(f.key, normalize(String(f.value ?? ''))),
          enabled: !f.disabled,
        }));
      }
      if (source.body?.mode === 'formdata') {
        request.bodyType = 'multipart';
        request.fields = (source.body.formdata || [])
          .filter((f: any) => f.type !== 'file')
          .map((f: any) => ({
            ...entry(f.key, normalize(String(f.value ?? ''))),
            enabled: !f.disabled,
          }));
      }
      const auth = source.auth || data.auth;
      if (auth?.type === 'bearer') {
        request.auth = 'bearer';
        request.token = normalize(
          String(auth.bearer?.find((a: any) => a.key === 'token')?.value || ''),
        );
      }
      if (auth?.type === 'basic') {
        request.auth = 'basic';
        request.username = normalize(
          String(auth.basic?.find((a: any) => a.key === 'username')?.value || ''),
        );
        request.password = normalize(
          String(auth.basic?.find((a: any) => a.key === 'password')?.value || ''),
        );
      }
      request.params = readParams(request.url);
      store.requests.push(request);
    });
  walk(data.item);
  return validateStore(store);
}
function example(schema: any, components: any, depth = 0): any {
  if (depth > 6) return null;
  if (schema?.$ref) {
    const key = schema.$ref.split('/').at(-1);
    return example(components?.[key], components, depth + 1);
  }
  if (schema?.example !== undefined) return schema.example;
  if (schema?.default !== undefined) return schema.default;
  if (schema?.enum?.length) return schema.enum[0];
  if (schema?.type === 'array') return [example(schema.items, components, depth + 1)];
  if (schema?.type === 'object' || schema?.properties)
    return Object.fromEntries(
      Object.entries(schema.properties || {}).map(([k, v]) => [
        k,
        example(v, components, depth + 1),
      ]),
    );
  if (schema?.type === 'integer' || schema?.type === 'number') return 0;
  if (schema?.type === 'boolean') return false;
  return '';
}
export function importOpenApi(data: any): Store {
  if (!String(data?.openapi || '').startsWith('3.') || !data.paths)
    throw new Error('Only OpenAPI 3.x JSON documents are supported');
  const store = container(data.info?.title || 'OpenAPI');
  const project = store.nodes[1];
  project.variables = [
    { ...variable('baseUrl'), value: data.servers?.[0]?.url || 'https://api.example.com' },
  ];
  const schemas = data.components?.schemas;
  for (const [path, pathItem] of Object.entries(data.paths) as [string, any][]) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      const operation = pathItem[method];
      if (!operation) continue;
      const request = richRequest(
        project.id,
        operation.summary || operation.operationId || `${method.toUpperCase()} ${path}`,
      );
      request.method = method.toUpperCase();
      request.url = '{baseUrl}' + path;
      request.description = operation.description || '';
      const params = [...(pathItem.parameters || []), ...(operation.parameters || [])];
      params.forEach((p: any) => {
        if (p.$ref) return;
        const value = String(p.example ?? p.schema?.default ?? '');
        if (p.in === 'query') request.params.push(entry(p.name, value));
        else if (p.in === 'header') request.headers.push(entry(p.name, value));
        else if (p.in === 'path')
          request.variables.push({ ...variable(p.name), value, description: p.description || '' });
      });
      if (request.params.length) {
        const query = request.params
          .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
          .join('&');
        request.url += '?' + query;
      }
      const content = operation.requestBody?.content;
      const mime =
        content && (content['application/json'] ? 'application/json' : Object.keys(content)[0]);
      if (mime) {
        request.headers.push(entry('Content-Type', mime));
        request.format = mime.includes('json') ? 'json' : mime.includes('xml') ? 'xml' : 'text';
        const body = content[mime];
        request.body =
          body.example !== undefined
            ? typeof body.example === 'string'
              ? body.example
              : JSON.stringify(body.example, null, 2)
            : request.format === 'json'
              ? JSON.stringify(example(body.schema, schemas), null, 2)
              : '';
      }
      store.requests.push(request);
    }
  }
  return validateStore(store);
}
export function importJson(text: string): Store {
  const data = JSON.parse(text);
  return data?.openapi ? importOpenApi(data) : importPostman(data);
}
