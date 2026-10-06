import { describe, it, expect } from 'vitest';
import { seed, upgrade, safeStore } from './domain';
import { sampleCollection, withSamples, nestedJson, nestedXml } from './samples';
import { parseDocument, serializeDocument, responseData } from './documents';
import { exportXml, importXml } from './interchange';

describe('public API samples', () => {
  it('adds samples once without replacing edits or restoring deleted requests', () => {
    const original = seed();
    const updated = withSamples(original);
    expect(updated.requests.slice(0, original.requests.length)).toEqual(original.requests);
    const sample = updated.requests.find((r) => r.name === '01 JSON object')!;
    sample.name = 'My edited sample';
    updated.requests = updated.requests.filter((r) => r.name !== '02 JSON nested lists');
    const reloaded = withSamples(upgrade(safeStore(updated)));
    expect(reloaded.requests).toEqual(updated.requests);
    expect(reloaded.nodes).toEqual(updated.nodes);
  });
  it('exports valid JSON/XML/SOAP requests and preserves nested sample lists', () => {
    const store = sampleCollection();
    expect(importXml(exportXml(store)).requests).toHaveLength(9);
    for (const request of store.requests.filter((r) => r.body)) {
      expect(() => parseDocument(request.body, request.format)).not.toThrow();
    }
    expect(nestedJson.orders[0].items[0].options).toHaveLength(2);
    const roundTrip = serializeDocument(parseDocument(nestedXml, 'xml'), 'xml');
    const xml = responseData(roundTrip) as any;
    expect(xml.catalog.orders.order[0].items.item[0].options.option).toHaveLength(2);
    const soap = store.requests.at(-1)!;
    expect(soap.headers.find((h) => h.key === 'SOAPAction')?.value).toBe('""');
    const encoded = store.requests
      .find((r) => r.name === '08 XML nested-list response')!
      .url.split('/base64/')[1];
    expect(atob(encoded)).toBe(nestedXml);
  });
});
