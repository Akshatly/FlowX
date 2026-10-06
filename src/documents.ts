import { XMLParser, XMLBuilder, XMLValidator } from 'fast-xml-parser';
const options = {
  ignoreAttributes: false,
  preserveOrder: true,
  attributeNamePrefix: '@',
  commentPropName: '#comment',
  cdataPropName: '#cdata',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
};
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export function parseDocument(source: string, format: string): JsonValue {
  if (format === 'json') return JSON.parse(source);
  if (format === 'xml') {
    if (/<!DOCTYPE|<!ENTITY/i.test(source))
      throw new Error('XML DTD and entity declarations are not supported.');
    const valid = XMLValidator.validate(source);
    if (valid !== true) throw new Error(valid.err.msg);
    const parsed = new XMLParser(options).parse(source);
    if (
      parsed.filter((block: Record<string, unknown>) =>
        Object.keys(block).some(
          (key) => !key.startsWith('#') && !key.startsWith('?') && key !== ':@',
        ),
      ).length !== 1
    )
      throw new Error('XML needs exactly one root element.');
    return parsed;
  }
  throw new Error('Form View supports JSON and XML. Use Code view for this body type.');
}
export function serializeDocument(value: JsonValue, format: string): string {
  return format === 'json'
    ? JSON.stringify(value, null, 2)
    : new XMLBuilder({ ...options, format: false, indentBy: '  ' }).build(value);
}
export function responseData(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    if (body.trim().startsWith('<')) {
      parseDocument(body, 'xml');
      return new XMLParser({ ...options, preserveOrder: false, trimValues: true }).parse(body);
    }
    return body;
  }
}
export function getPath(value: unknown, path: string): unknown {
  if (!path.trim() || path === '$') return value;
  const parts: string[] = [];
  const pattern = /(?:^|\.)([^.\[\]]+)|\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\]/g;
  let match: RegExpExecArray | null;
  let end = 0;
  while ((match = pattern.exec(path))) {
    if (match.index !== end) throw new Error('Use a.b[0] or ["key.with.dots"] path notation.');
    parts.push(match[1] ?? match[2] ?? JSON.parse('"' + match[3] + '"'));
    end = pattern.lastIndex;
  }
  if (end !== path.length) throw new Error('Invalid output path.');
  let current: any = value;
  for (const part of parts) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, part))
      return undefined;
    current = current[part];
  }
  return current;
}
export function listPaths(
  value: unknown,
  prefix = '',
  depth = 0,
): { path: string; value: unknown }[] {
  const result = [{ path: prefix || '$', value }];
  if (depth > 12 || value === null || typeof value !== 'object') return result;
  Object.entries(value)
    .slice(0, 150)
    .forEach(([key, child]) => {
      const path = Array.isArray(value)
        ? `${prefix}[${key}]`
        : /^[\w@#:-]+$/.test(key)
          ? `${prefix}${prefix ? '.' : ''}${key}`
          : `${prefix}[${JSON.stringify(key)}]`;
      result.push(...listPaths(child, path, depth + 1));
    });
  return result.slice(0, 1500);
}
export function formatDocument(source: string, format: string): string {
  const parsed = parseDocument(source, format);
  if (format === 'json') return serializeDocument(parsed, format);
  const hasMixed = (value: any): boolean =>
    Array.isArray(value)
      ? (value.some(
          (v) =>
            v && typeof v === 'object' && Object.hasOwn(v, '#text') && String(v['#text']).trim(),
        ) &&
          value.some(
            (v) =>
              v &&
              typeof v === 'object' &&
              Object.keys(v).some((k) => !k.startsWith('#') && k !== ':@'),
          )) ||
        value.some(hasMixed)
      : value && typeof value === 'object'
        ? Object.values(value).some(hasMixed)
        : false;
  if (hasMixed(parsed)) return serializeDocument(parsed, format);
  const clean = (value: any): any =>
    Array.isArray(value)
      ? value
          .filter(
            (v) =>
              !(
                v &&
                typeof v === 'object' &&
                Object.hasOwn(v, '#text') &&
                !String(v['#text']).trim()
              ),
          )
          .map(clean)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)]))
        : value;
  return new XMLBuilder({ ...options, format: true, indentBy: '  ' }).build(clean(parsed));
}
