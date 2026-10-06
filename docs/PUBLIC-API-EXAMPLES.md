# Public API examples

The app adds this collection once to new and existing workspaces. Your existing requests are preserved; edits and deletions of examples persist.

| Request | What to try |
| --- | --- |
| 01 JSON object | GET a simple JSONPlaceholder object; edit its response copy in Form View. |
| 02 JSON nested lists | GET DummyJSON carts; expand a cart's products list. |
| 03 POST JSON object | Send an editable simple object to Postman Echo; inspect response `json`. |
| 04 POST JSON nested lists | Orders → items → options, primitive arrays, a matrix, empty arrays, null, booleans, numbers, and date strings. |
| 05 XML slideshow | GET HTTPBin XML; attributes, repeated slides and items, empty elements, mixed content. |
| 06 POST XML object | Send a simple XML document to Postman Echo. Its response is JSON with XML inside `data`. |
| 07 POST XML nested lists | XML orders → items → options, attributes, namespace, CDATA, empty elements. Echo response `data` contains the XML sent. |
| 08 XML nested-list response | HTTPBin decodes our encoded XML fixture. The response is XML, with the same nested structure as request 07; it is synthetic example data. |
| 09 SOAP NumberToWords | DataAccess SOAP 1.1: change `ubiNum` (default 42), then Send. Content-Type is text/xml and SOAPAction is empty, as specified by the WSDL. |

Open a request, click Send, and choose Form View in either panel. Expand a table cell containing another list. Edit in Form View and return to Code to inspect the result. Response edits change a local copy; Reset restores the received response. Use Output variables to explore the response paths and previews.

These examples cover the requested JSON/XML form structures, not every possible API protocol or schema. XML does not declare primitive field types; its text values remain text. A single XML element cannot distinguish a singleton list from an object without schema information. Date strings remain editable strings.

Public services may impose limits or become unavailable. The desktop app uses native HTTP; browser previews may be blocked by cross-origin rules, especially SOAP. POST echo requests do not create stored records.

Sources:
- https://jsonplaceholder.typicode.com/guide/
- https://dummyjson.com/docs/carts
- https://www.postman.com/postman/published-postman-templates/documentation/ae2bls2/postman-echo
- https://httpbin.org/
- https://www.dataaccess.com/webservicesserver/NumberConversion.wso?WSDL
