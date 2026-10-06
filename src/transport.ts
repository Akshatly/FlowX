import { invoke, isTauri } from '@tauri-apps/api/core';
import { uid, type Request, type Entry, type HttpResponse } from './model';
import type { FileData } from './domain';
export async function sendRequest(
  request: Request & {
    bodyType?: string;
    fields?: Entry[];
    files?: FileData[];
    binary?: { name: string; bytes: number[] };
  },
  signal?: AbortSignal,
): Promise<HttpResponse> {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Use an http:// or https:// URL.');
  const headers: [string, string][] = request.headers
    .filter((h) => h.enabled && h.key)
    .map((h) => [h.key, h.value]);
  if (request.auth === 'bearer') headers.push(['Authorization', `Bearer ${request.token}`]);
  if (request.auth === 'basic') {
    const bytes = new TextEncoder().encode(`${request.username}:${request.password}`);
    headers.push([
      'Authorization',
      'Basic ' + btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')),
    ]);
  }
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  const bodyType = request.bodyType || 'raw';
  const fields = (request.fields || [])
    .filter((f) => f.enabled && f.key)
    .map((f) => [f.key, f.value] as [string, string]);
  let body: BodyInit | undefined = hasBody ? request.body || undefined : undefined;
  if (hasBody && bodyType === 'form') body = new URLSearchParams(fields);
  if (hasBody && bodyType === 'multipart') {
    const form = new FormData();
    fields.forEach(([key, value]) => form.append(key, value));
    (request.files || []).forEach((f) =>
      form.append(f.key, new Blob([new Uint8Array(f.bytes)], { type: f.mime }), f.name),
    );
    body = form;
  }
  if (hasBody && bodyType === 'binary')
    body = request.binary ? new Uint8Array(request.binary.bytes) : undefined;
  if (
    body &&
    bodyType !== 'multipart' &&
    !headers.some(([key]) => key.toLowerCase() === 'content-type')
  )
    headers.push([
      'Content-Type',
      bodyType === 'form'
        ? 'application/x-www-form-urlencoded'
        : bodyType === 'binary'
          ? 'application/octet-stream'
          : request.format === 'json'
            ? 'application/json'
            : request.format === 'xml'
              ? 'application/xml'
              : 'text/plain',
    ]);
  if (isTauri()) {
    const id = uid();
    let abortError: unknown;
    const abort = () => {
      void invoke('cancel_request', { id }).catch((error) => {
        abortError = error;
      });
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const result = await invoke<HttpResponse>('send_request', {
        id,
        request: {
          method: request.method,
          url: url.href,
          headers,
          body: hasBody ? request.body : '',
          bodyType: hasBody ? bodyType : 'raw',
          fields: hasBody ? fields : [],
          files: hasBody ? request.files || [] : [],
          binary: hasBody ? request.binary?.bytes || [] : [],
        },
      });
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      return result;
    } finally {
      signal?.removeEventListener('abort', abort);
      void abortError;
    }
  }
  const start = performance.now();
  const combined = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
    : AbortSignal.timeout(30000);
  const response = await fetch(url, { method: request.method, headers, body, signal: combined });
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 20 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('Response exceeds the 20 MB preview limit');
      }
      chunks.push(value);
    }
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    size = bytes.length;
    chunks.push(bytes);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((c) => {
    all.set(c, offset);
    offset += c.length;
  });
  return {
    status: response.status,
    statusText: response.statusText,
    headers: Array.from(response.headers.entries()),
    body: new TextDecoder().decode(all),
    duration: Math.round(performance.now() - start),
    size,
  };
}
