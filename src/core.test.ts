import { describe, it, expect, vi } from 'vitest';
import { seed, richRequest, newFlow, newStep, variable, type Output } from './domain';
import { dependencyOrder, runRequest, runFlow, validateFlow, extract } from './runner';
import { parseDocument, serializeDocument, getPath, responseData } from './documents';
import { inherited, valuesOf, resolveBody } from './variables';
import { transform } from './transforms';
import { exportXml, importXml, exportCurl, importCurl, mergeStore } from './interchange';
import { writeParams, readParams } from './model';
const response = (body: string, status = 200) => ({
  body,
  status,
  statusText: status === 200 ? 'OK' : 'Error',
  headers: [['content-type', 'application/json']] as [string, string][],
  duration: 1,
  size: body.length,
});
const output = (changes: Partial<Output> = {}): Output => ({
  id: 'o',
  name: 'result',
  source: 'body',
  path: '$',
  mode: 'none',
  script: 'return value;',
  missing: 'fail',
  type: 'auto',
  ...changes,
});
describe('structured documents', () => {
  it('round trips nested JSON and null values', () => {
    const body = '{"items":[{"nested":[1,null,false]}]}';
    expect(parseDocument(serializeDocument(parseDocument(body, 'json'), 'json'), 'json')).toEqual(
      JSON.parse(body),
    );
  });
  it('preserves XML attributes, namespaces, repeated elements, mixed text and comments', () => {
    const xml =
      '<root xmlns:x="urn:x"><x:item id="1">before<b>bold</b>after</x:item><!--hello--><x:item id="2">text &amp; more</x:item></root>';
    const parsed = parseDocument(xml, 'xml');
    expect(parseDocument(serializeDocument(parsed, 'xml'), 'xml')).toEqual(parsed);
  });
  it('rejects invalid XML and DTD declarations', () => {
    expect(() => parseDocument('<a><b></a>', 'xml')).toThrow();
    expect(() => parseDocument('<!DOCTYPE root><root/>', 'xml')).toThrow();
  });
  it('extracts indexed and quoted paths without traversing prototypes', () => {
    expect(getPath({ 'a.b': [{ id: 7 }] }, '["a.b"][0].id')).toBe(7);
    expect(getPath({}, '__proto__.x')).toBeUndefined();
    expect(() => getPath({}, 'a[bad]')).toThrow();
    expect(responseData('<root><item>one</item><item>two</item></root>')).toEqual({
      root: { item: ['one', 'two'] },
    });
  });
});
describe('variables', () => {
  it('uses nearest scope and typed JSON substitution', () => {
    const store = seed();
    store.nodes[0].variables = [{ ...variable('id'), value: '1', type: 'number' }];
    store.nodes[1].variables = [{ ...variable('id'), value: '2', type: 'number' }];
    const vars = inherited(store, 'project', [
      { ...variable('items'), value: '[1,2]', type: 'json' },
    ]);
    expect(valuesOf(vars).id).toBe(2);
    expect(
      JSON.parse(
        resolveBody('{"id":"{id}","list":"{items}","label":"ID {id}"}', 'json', valuesOf(vars)),
      ),
    ).toEqual({ id: 2, list: [1, 2], label: 'ID 2' });
  });
  it('escapes variable content in XML', () => {
    expect(resolveBody('<a>{value}</a>', 'xml', { value: '<b>&"' })).toBe(
      '<a>&lt;b&gt;&amp;&quot;</a>',
    );
  });
  it('keeps placeholders readable in query parameters', () => {
    expect(
      writeParams('https://api.test', readParams('https://api.test?q={Request name.result}')),
    ).toBe('https://api.test?q={Request name.result}');
  });
});
describe('sandbox transforms', () => {
  it('maps and filters lists', async () => {
    expect(
      await transform([{ id: 1 }, { id: 2 }], output({ mode: 'map', script: 'return item.id;' })),
    ).toEqual([1, 2]);
    expect(
      await transform([1, 2, 3], output({ mode: 'filter', script: 'return item > 1;' })),
    ).toEqual([2, 3]);
  });
  it('has no host globals and interrupts infinite loops', async () => {
    await expect(
      transform(1, output({ mode: 'transform', script: 'return window.localStorage;' })),
    ).rejects.toThrow();
    await expect(
      transform(1, output({ mode: 'transform', script: 'while(true) {}' })),
    ).rejects.toThrow();
  });
  it('converts dates explicitly and rejects missing required paths', async () => {
    expect(await transform('2026-01-01', output({ type: 'date' }))).toBe(
      '2026-01-01T00:00:00.000Z',
    );
    await expect(extract(response('{}'), [output({ path: 'missing' })])).rejects.toThrow(
      'not found',
    );
  });
});
describe('request dependencies', () => {
  it('runs prerequisites once and resolves outputs into downstream URLs', async () => {
    const store = seed();
    const target = store.requests[1];
    const send = vi.fn(async (r) => response(r.id === 'sample' ? '{"id":42}' : '[]'));
    const result = await runRequest(store, target, { send });
    expect(result.status).toBe('succeeded');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].url).toBe(
      'https://jsonplaceholder.typicode.com/posts/42/comments',
    );
  });
  it('rejects cycles before sending anything', () => {
    const store = seed();
    const a = store.requests[0],
      b = store.requests[1];
    b.outputs = [output()];
    a.url = '{Get comments.result}';
    b.url = '{Get a sample post.postId}';
    expect(() => dependencyOrder(store, b)).toThrow('cycle');
  });
  it('stops downstream requests after an HTTP failure', async () => {
    const store = seed();
    const send = vi.fn(async () => response('failure', 500));
    const run = await runRequest(store, store.requests[1], { send });
    expect(run.status).toBe('failed');
    expect(send).toHaveBeenCalledTimes(1);
    expect(run.logs[1].status).toBe('skipped');
  });
});
describe('workflow execution', () => {
  it('fans out in parallel and waits at a join before producing a view', async () => {
    const store = seed();
    const flow = newFlow('project', 'Parallel');
    const start = flow.steps[0];
    const a = {
      ...newStep('request', 0, 0),
      name: 'A',
      request: {
        ...richRequest('project'),
        url: 'https://a.test',
        outputs: [output({ path: 'id' })],
      },
    };
    const b = {
      ...newStep('request', 0, 0),
      name: 'B',
      request: {
        ...richRequest('project'),
        url: 'https://b.test',
        outputs: [output({ path: 'id' })],
      },
    };
    const view = { ...newStep('view', 0, 0), template: '{"a":"{A.result}","b":"{B.result}"}' };
    flow.steps.push(a, b, view);
    flow.edges = [
      { id: '1', source: start.id, target: a.id },
      { id: '2', source: start.id, target: b.id },
      { id: '3', source: a.id, target: view.id },
      { id: '4', source: b.id, target: view.id },
    ];
    store.flows = [flow];
    let pending = 0,
      max = 0;
    const send = async () => {
      pending++;
      max = Math.max(max, pending);
      await new Promise((r) => setTimeout(r, 10));
      pending--;
      return response('{"id":1}');
    };
    const run = await runFlow(store, flow, { send });
    expect(max).toBe(2);
    expect(run.status).toBe('succeeded');
    expect(JSON.parse(run.logs.find((l) => l.id === view.id)!.view!)).toEqual({ a: 1, b: 1 });
  });
  it('rejects cycles, disconnected steps and recursive nested flows', () => {
    const store = seed();
    const flow = newFlow('project', 'Test');
    flow.steps.push(newStep('timer', 0, 0));
    expect(() => validateFlow(store, flow)).toThrow('Connect');
    flow.edges = [
      { id: 'a', source: flow.steps[0].id, target: flow.steps[1].id },
      { id: 'b', source: flow.steps[1].id, target: flow.steps[0].id },
    ];
    expect(() => validateFlow(store, flow)).toThrow();
    const nested = { ...newStep('flow', 0, 0), flowId: flow.id };
    flow.steps = [flow.steps[0], nested];
    flow.edges = [{ id: 'a', source: flow.steps[0].id, target: nested.id }];
    store.flows = [flow];
    expect(() => validateFlow(store, flow)).toThrow('Recursive');
  });
  it('cancels timer waits', async () => {
    const store = seed();
    const flow = newFlow('project', 'Timer');
    const timer = { ...newStep('timer', 0, 0), delay: 5000 };
    flow.steps.push(timer);
    flow.edges = [{ id: 'a', source: flow.steps[0].id, target: timer.id }];
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 10);
    const run = await runFlow(store, flow, { signal: abort.signal });
    expect(run.status).toBe('cancelled');
    expect(run.logs[1].status).toBe('cancelled');
  });
  it('Stop cancels an active parallel wait and succeeds', async () => {
    const store = seed();
    const flow = newFlow('project', 'Stop');
    const timer = { ...newStep('timer', 0, 0), delay: 5000 };
    const stop = newStep('stop', 0, 0);
    flow.steps.push(timer, stop);
    flow.edges = [
      { id: 'a', source: flow.steps[0].id, target: timer.id },
      { id: 'b', source: flow.steps[0].id, target: stop.id },
    ];
    const run = await runFlow(store, flow);
    expect(run.status).toBe('succeeded');
    expect(run.logs.find((l) => l.id === timer.id)?.status).toBe('cancelled');
  });
});
describe('interchange', () => {
  it('round trips XML including flows and scripts', () => {
    const store = seed();
    expect(importXml(exportXml(store))).toEqual(store);
    const merged = mergeStore(store, importXml(exportXml(store)));
    expect(merged.requests).toHaveLength(4);
    expect(merged.nodes[2].id).not.toBe(store.nodes[0].id);
  });
  it('parses quoted cURL data and does not execute shell expressions', () => {
    const request = importCurl(
      `curl -X POST 'https://api.test' -H 'Content-Type: application/json' --data-raw '{"name":"$HOME"}'`,
      'project',
    );
    expect(request.body).toBe('{"name":"$HOME"}');
    expect(importCurl(exportCurl(request), 'project').body).toBe(request.body);
    expect(() => importCurl('curl --unknown https://api.test', 'project')).toThrow('Unsupported');
  });
  it('rejects an XML import with invalid hierarchy', () => {
    const store = seed();
    store.nodes[0].parentId = 'project';
    expect(() => importXml(exportXml(store))).toThrow();
  });
});
