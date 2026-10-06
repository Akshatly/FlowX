import { newRequest, entry, readParams } from './model';
import type { RichRequest, Store } from './domain';

export const nestedJson = {
  orderId: 'FX-1001',
  customer: { name: 'Alex Example', address: { city: 'Amsterdam', country: 'NL' } },
  paid: false,
  discount: null,
  createdAt: '2026-10-05T10:00:00Z',
  tags: ['demo', 'nested'],
  orders: [
    {
      id: 1,
      items: [
        { sku: 'BOOK', quantity: 2, price: 12.5, options: ['gift wrap', 'blue'] },
        { sku: 'PEN', quantity: 1, price: 3, options: [] },
      ],
    },
    { id: 2, items: [{ sku: 'MUG', quantity: 1, price: 8, options: ['large'] }] },
  ],
  matrix: [
    [1, 2],
    [3, 4],
  ],
  emptyList: [],
};
export const nestedXml = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns="urn:flowx:demo" version="1">
  <customer><name>Alex Example</name><address><city>Amsterdam</city><country>NL</country></address></customer>
  <orders>
    <order id="1"><items>
      <item sku="BOOK"><quantity>2</quantity><price currency="EUR">12.50</price><options><option>gift wrap</option><option>blue</option></options></item>
      <item sku="PEN"><quantity>1</quantity><price currency="EUR">3.00</price><options/></item>
    </items></order>
    <order id="2"><items>
      <item sku="MUG"><quantity>1</quantity><price currency="EUR">8.00</price><options><option>large</option></options></item>
      <item sku="PLATE"><quantity>2</quantity><price currency="EUR">6.00</price><options/></item>
    </items></order>
  </orders>
  <notes><![CDATA[Handle <carefully> & keep dry]]></notes>
  <empty/>
</catalog>`;
export const soapXml = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <NumberToWords xmlns="http://www.dataaccess.com/webservicesserver/">
      <ubiNum>42</ubiNum>
    </NumberToWords>
  </soap:Body>
</soap:Envelope>`;

export function sampleCollection(): Store {
  const folder = 'flowx-public-examples';
  const json = folder + '-json';
  const xml = folder + '-xml';
  const request = (
    id: string,
    parentId: string,
    name: string,
    url: string,
    description: string,
    body = '',
    format: RichRequest['format'] = 'json',
  ): RichRequest => ({
    ...newRequest(parentId, name),
    id: folder + '-' + id,
    url,
    description,
    body,
    format,
    method: body ? 'POST' : 'GET',
    variables: [],
    outputs: [],
    params: readParams(url),
    bodyType: 'raw',
    fields: [],
    files: [],
    headers: body
      ? [entry('Content-Type', format === 'xml' ? 'text/xml; charset=utf-8' : 'application/json')]
      : [],
  });
  const simpleXml =
    '<?xml version="1.0"?><message><title>Hello FlowX</title><count>2</count></message>';
  const requests = [
    request(
      'object',
      json,
      '01 JSON object',
      'https://jsonplaceholder.typicode.com/posts/1',
      'Send to fetch a simple JSON object. Try Response → Form View, edit a field, then return to Code.',
    ),
    request(
      'nested-get',
      json,
      '02 JSON nested lists',
      'https://dummyjson.com/carts?limit=2',
      'Live mock carts contain a carts list with a products list inside every row. Expand a cart in Response → Form View.',
    ),
    request(
      'json-post',
      json,
      '03 POST JSON object',
      'https://postman-echo.com/post',
      'Echo service: the response json field contains your payload. This does not create a persisted record.',
      JSON.stringify({ title: 'Hello FlowX', count: 2, enabled: true }, null, 2),
    ),
    request(
      'nested-post',
      json,
      '04 POST JSON nested lists',
      'https://postman-echo.com/post',
      'Edit Request → Form View. Expand orders → items → options. Includes lists of objects, primitive lists, a matrix, null, booleans and empty lists. Send and inspect response json.',
      JSON.stringify(nestedJson, null, 2),
    ),
    request(
      'xml-get',
      xml,
      '05 XML slideshow',
      'https://httpbin.org/xml',
      'Public XML fixture with attributes, repeated slides/items, empty tags and mixed text. Try Response → Form View.',
      '',
      'xml',
    ),
    request(
      'xml-post',
      xml,
      '06 POST XML object',
      'https://postman-echo.com/post',
      'Edit the XML request in Form View. The echo service returns JSON; the data field contains the XML received, not a SOAP response.',
      simpleXml,
      'xml',
    ),
    request(
      'nested-xml-post',
      xml,
      '07 POST XML nested lists',
      'https://postman-echo.com/post',
      'XML counterpart of the nested JSON example: orders → items → options, attributes, namespace, CDATA and empty elements. The echo response data field contains raw XML.',
      nestedXml,
      'xml',
    ),
    request(
      'nested-xml-get',
      xml,
      '08 XML nested-list response',
      'https://httpbin.org/base64/' + btoa(nestedXml),
      'HTTPBin decodes an encoded FlowX XML fixture. This is a synthetic sample returned over HTTP, not a remote business dataset. Expand repeated orders/items/options in Response → Form View.',
      '',
      'xml',
    ),
    request(
      'soap',
      xml,
      '09 SOAP NumberToWords',
      'https://www.dataaccess.com/webservicesserver/NumberConversion.wso',
      'Real public SOAP 1.1 service. Send 42 and receive words in an XML SOAP envelope. Change ubiNum in Request → Form View. Uses text/xml and an empty SOAPAction as specified by the WSDL.',
      soapXml,
      'xml',
    ),
  ];
  requests.at(-1)!.headers.push(entry('SOAPAction', '""'));
  return {
    version: 2,
    nodes: [
      { id: folder, parentId: null, kind: 'folder', name: 'Public API examples', variables: [] },
      { id: json, parentId: folder, kind: 'project', name: 'JSON examples', variables: [] },
      { id: xml, parentId: folder, kind: 'project', name: 'XML and SOAP examples', variables: [] },
    ],
    requests,
    flows: [],
  };
}

// Apply once when an existing workspace first opens this version. Never replace user edits
// or restore a sample the user subsequently deletes.
export function withSamples(store: Store): Store {
  if (store.samplesVersion === 1) return store;
  const samples = sampleCollection();
  return {
    ...store,
    samplesVersion: 1,
    nodes: [
      ...store.nodes,
      ...samples.nodes.filter((n) => !store.nodes.some((existing) => existing.id === n.id)),
    ],
    requests: [
      ...store.requests,
      ...samples.requests.filter((r) => !store.requests.some((existing) => existing.id === r.id)),
    ],
  };
}
