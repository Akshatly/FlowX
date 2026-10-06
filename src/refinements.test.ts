import { expect, it, vi } from 'vitest';
import { seed, richRequest, newFlow, newStep, variable, safeStore } from './domain';
import { dependencyOrder, runRequest, runFlow } from './runner';
import { resolveVariables } from './variables';
import { updateRequest, updateFlow } from './references';
import { importOpenApi, importPostman } from './migration';
import { formatDocument, parseDocument } from './documents';
const response = (id = 1) => ({
  status: 200,
  statusText: 'OK',
  headers: [] as [string, string][],
  body: JSON.stringify({ id }),
  duration: 1,
  size: 8,
});
it('renaming request and output names updates dependent references', () => {
  let store = seed();
  store = updateRequest(store, { ...store.requests[0], name: 'Login' });
  expect(store.requests[1].url).toContain('{Login.postId}');
  store = updateRequest(store, {
    ...store.requests[0],
    outputs: store.requests[0].outputs.map((o) => ({ ...o, name: 'newId' })),
  });
  expect(store.requests[1].url).toContain('{Login.newId}');
  expect(dependencyOrder(store, store.requests[1])).toHaveLength(2);
});
it('renaming a workflow step updates its View references', () => {
  let store = seed();
  const flow = store.flows[0];
  store = updateFlow(store, {
    ...flow,
    steps: flow.steps.map((s) => (s.name === 'Get post' ? { ...s, name: 'Fetch' } : s)),
  });
  expect(store.flows[0].steps[2].template).toContain('{Fetch.postId}');
});
it('resolves variable aliases and rejects alias cycles', () => {
  expect(
    resolveVariables([
      { ...variable('base'), value: 'https://api.test' },
      { ...variable('url'), value: '{base}/items' },
    ]).url,
  ).toBe('https://api.test/items');
  expect(() =>
    resolveVariables([
      { ...variable('a'), value: '{b}' },
      { ...variable('b'), value: '{a}' },
    ]),
  ).toThrow('cycle');
});
it('finds request dependencies referenced through variables', async () => {
  const store = seed();
  const target = store.requests[1];
  target.variables = [{ ...variable('id'), value: '{Get a sample post.postId}' }];
  target.url = '{baseUrl}/posts/{id}';
  const send = vi.fn(async (_request: ReturnType<typeof richRequest>) => response(17));
  const run = await runRequest(store, target, { send });
  expect(run.status).toBe('succeeded');
  expect(send.mock.calls[1][0].url).toBe('https://jsonplaceholder.typicode.com/posts/17');
});
it('persists secret definitions and template credentials without secret values', () => {
  const store = seed();
  store.requests[0].token = '{token}';
  store.requests[0].password = 'actual-password';
  store.requests[0].variables = [{ ...variable('token'), value: 'secret-value', secret: true }];
  const saved = safeStore(store);
  expect(saved.requests[0].token).toBe('{token}');
  expect(saved.requests[0].password).toBe('');
  expect(saved.requests[0].variables[0].name).toBe('token');
  expect(saved.requests[0].variables[0].value).toBe('');
});
it('formats element-only XML while preserving mixed-content text', () => {
  const xml = '<root><item>one</item><item>two</item></root>';
  expect(formatDocument(xml, 'xml')).toContain('\n');
  const mixed = '<p>before <b>bold</b> after</p>';
  expect(parseDocument(formatDocument(mixed, 'xml'), 'xml')).toEqual(parseDocument(mixed, 'xml'));
});
it('imports Postman folders as named requests and normalizes variables', () => {
  const store = importPostman({
    info: { name: 'Collection' },
    variable: [{ key: 'host', value: 'https://api.test' }],
    item: [
      {
        name: 'Users',
        item: [{ name: 'List', request: { method: 'GET', url: '{{host}}/users' } }],
      },
    ],
  });
  expect(store.requests[0].name).toBe('Users / List');
  expect(store.requests[0].url).toBe('{host}/users');
  expect(store.nodes).toHaveLength(2);
});
it('imports OpenAPI parameters and sample JSON request bodies', () => {
  const store = importOpenApi({
    openapi: '3.0.3',
    info: { title: 'API' },
    servers: [{ url: 'https://api.test' }],
    paths: {
      '/users/{id}': {
        put: {
          parameters: [
            { in: 'path', name: 'id', schema: { default: 1 } },
            { in: 'query', name: 'active', schema: { default: true } },
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { name: { type: 'string', default: 'User' } },
                },
              },
            },
          },
        },
      },
    },
  });
  expect(store.requests[0].url).toBe('{baseUrl}/users/{id}?active=true');
  expect(JSON.parse(store.requests[0].body)).toEqual({ name: 'User' });
});
it('a fast parallel branch continues without waiting for an unrelated slow branch', async () => {
  const store = seed();
  const flow = newFlow('project', 'Parallel');
  const a = {
    ...newStep('request', 0, 0),
    name: 'Slow',
    request: { ...richRequest('project'), url: 'https://slow.test' },
  };
  const b = {
    ...newStep('request', 0, 0),
    name: 'Fast',
    request: { ...richRequest('project'), url: 'https://fast.test' },
  };
  const view = { ...newStep('view', 0, 0), template: '{}' };
  flow.steps.push(a, b, view);
  flow.edges = [
    { id: 'a', source: flow.steps[0].id, target: a.id },
    { id: 'b', source: flow.steps[0].id, target: b.id },
    { id: 'v', source: b.id, target: view.id },
  ];
  let slowDone = false,
    viewDuringSlow = false;
  const run = await runFlow(store, flow, {
    send: async (request) => {
      if (request.url.includes('slow')) {
        await new Promise((r) => setTimeout(r, 50));
        slowDone = true;
      }
      return response();
    },
    onUpdate: (r) => {
      if (r.logs.find((l) => l.id === view.id)?.status === 'succeeded' && !slowDone)
        viewDuringSlow = true;
    },
  });
  expect(run.status).toBe('succeeded');
  expect(viewDuringSlow).toBe(true);
});
