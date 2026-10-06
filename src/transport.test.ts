import { afterEach, expect, it, vi } from 'vitest';
import { newRequest, entry } from './model';
import { sendRequest } from './transport';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
it('sends a typed body, auth and enabled headers, then measures response bytes', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json' } }),
    );
  vi.stubGlobal('fetch', fetchMock);
  const response = await sendRequest({
    ...newRequest('p'),
    url: 'https://api.test/items',
    method: 'POST',
    body: '{"a":1}',
    auth: 'bearer',
    token: 'test-token',
    headers: [entry('X-Test', 'yes'), { ...entry('X-Off', 'no'), enabled: false }],
  });
  const options = fetchMock.mock.calls[0][1];
  expect(options.body).toBe('{"a":1}');
  expect(options.headers).toEqual([
    ['X-Test', 'yes'],
    ['Authorization', 'Bearer test-token'],
    ['Content-Type', 'application/json'],
  ]);
  expect(response.status).toBe(201);
  expect(response.size).toBe(11);
});
it('omits GET bodies and preserves an explicit content type', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('ok'));
  vi.stubGlobal('fetch', fetchMock);
  await sendRequest({
    ...newRequest('p'),
    url: 'https://api.test/',
    body: 'ignored',
    headers: [entry('Content-Type', 'custom/type')],
  });
  expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  expect(fetchMock.mock.calls[0][1].headers).toEqual([['Content-Type', 'custom/type']]);
});
it('rejects non-HTTP URLs before sending', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await expect(sendRequest({ ...newRequest('p'), url: 'file:///tmp/test' })).rejects.toThrow(
    'http://',
  );
  expect(fetchMock).not.toHaveBeenCalled();
});
