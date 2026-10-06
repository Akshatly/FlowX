# FlowX

FlowX is a local desktop API testing and workflow application built with Tauri 2, Rust, React, TypeScript, CodeMirror, React Flow and SQLite.

## Run

```sh
npm install
npm run desktop
```

Node.js 22.12+ and [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) are required. The desktop script also detects the workspace-local Rust toolchain installed beside this checkout. A normal system Rust installation works on other machines.

For a browser preview:

```sh
npm run dev
```

Open http://127.0.0.1:1420. Browser requests follow the target API's CORS policy; desktop requests run through Rust. Browser and desktop workspaces are stored separately.

## Features

- Resizable sidebar with separate Collections and Flows tabs, hover/focus item action menus with outside-click/Escape dismissal, request/flow tabs and dark/light themes. Collections contains folders, subfolders, projects and their requests; Flows lists only flows. The workbench uses neutral panels, orange selection accents and blue Send controls inspired by Postman.
- Folders contain folders/projects; projects contain requests/flows. Settings expose inherited variables. Deletions can be undone during the session.
- HTTP methods, synchronized URL/query parameters, editable headers, None/Bearer/Basic authentication.
- JSON, XML and other raw bodies; URL-encoded forms, multipart fields/files and binary uploads.
- CodeMirror syntax highlighting and formatting. Request/response panels can be stacked or placed side by side and resized.
- Editable JSON Form View with object fields, array tables, nested expansion, retained data types without type selectors, added fields and rows. XML Form View preserves ordered elements, attributes, namespaces, mixed content, comments and CDATA; repeated elements become tables.
- Response edits affect a local copy. Output variables use the original received response.
- Folder → project → request inheritance; folder → project → flow → step inheritance. Type `{` for variable completion in value fields and editors. References have a distinct purple highlight. Whole JSON placeholders retain their value's type.
- Response-side output variables from body, headers or status, dot/bracket paths, a path browser and syntax-highlighted value previews. Sandbox transforms support entire-value, map and filter modes, explicit date conversion, missing-value policies and secret masking.
- Request dependencies run in order, once per execution, with cycle/ambiguity checks and failure propagation. Project outputs are referenced as `{Request name.outputName}`.
- React Flow drag-and-drop canvas with Start, Stop, New Request, Existing Request snapshots, Timer, View and Another Flow steps. Connections define order; fan-out runs in parallel, joins await all predecessors, and independent branches progress independently.
- Flow and step input mappings, user prompts, nested-flow input passing, cancellation, highlighted step states, a collapsed/resizable console, request/response details, View results and fullscreen results.
- SQLite workspace/run persistence on desktop, localStorage in browser preview, and a local run-history screen.
- Versioned FlowX XML export/import with validation and import preview; cURL raw-request import/export; basic Postman collection JSON and OpenAPI 3 JSON migration.
- Contextual guidance, examples and an in-app help screen.

## Examples

Define a project variable `baseUrl = https://api.example.com`. A request URL can be `{baseUrl}/users`.

After running a request called `Login`, capture an output `token` from `data.token`. Another request can use `{Login.token}` in its Bearer token field. Sending it runs Login first.

For workflows, drag a request onto the canvas, name the step `Get users`, and capture an output `users` from `data.users`. A View step can contain:

```json
{ "users": "{Get users.users}" }
```

Map a selected list with `return item.id;` or filter it with `return item.active === true;`.

## Storage and execution

Desktop storage lives in the platform application-data directory under `com.flowx.desktop/flowx.sqlite`. `FLOWX_DATA_DIR` can override the location for development. Workspace saves are serialized and run history keeps up to 100 entries.

Declared secret variable values, literal Bearer tokens and literal Basic passwords are session only. Variable references in authentication fields are retained. Mark sensitive output variables to mask their values in execution logs/history. Literal values entered in bodies, URLs, ordinary variables or custom headers are saved as entered. XML exports exclude declared secrets and saved credentials.

JavaScript transforms run inside QuickJS with no host network/filesystem globals, a 16 MB runtime memory limit and a 200 ms execution deadline. HTTP calls have a 30-second timeout and a 20 MB response preview limit. Selected files are limited to 10 MB each.

## Validation and packaging

```sh
npm test
npm run build
npm run build:desktop
```

Native checks, with Cargo on PATH:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo check --manifest-path src-tauri/Cargo.toml
```

Installers are published on the [GitHub Releases page](https://github.com/Akshatly/FlowX/releases). Windows users download the x64 setup `.exe`; Mac users download the universal `.dmg` for Apple Silicon and Intel, open it, and drag FlowX to Applications. The first release is an unsigned preview, so operating-system security warnings may appear. Trusted distribution requires Windows code signing and Apple signing/notarization credentials.

Tagging a version (`v0.1.0`, matching `package.json`, `Cargo.toml` and `tauri.conf.json`) runs `.github/workflows/release.yml`. GitHub Actions runs frontend and native tests on Windows/macOS, builds both installers, stages a draft release, and publishes it only when both builds succeed and both installer files are present. Build artifacts are retained if publication fails.

Local macOS build: `npm run build:desktop -- --bundles app,dmg`. Local Windows build, with Rust and Visual Studio C++ build tools installed: `npm run build:desktop -- --bundles nsis`. Linux installers are not part of this release.

## Current boundaries

- Flows are acyclic. Stop cancels the whole current flow; loops and conditional branch nodes are future additions.
- XML output paths use a structured representation: attributes use `@name`, text in mixed elements uses `#text`, and repeated elements use array indexes. These are dot/bracket paths, not XPath.
- Form View supports JSON/XML. Arbitrary text and binary responses do not have a structural form. Binary responses currently show a decoded preview rather than a downloadable binary asset.
- Authentication supports None, Basic and Bearer. API keys can be entered as headers/query parameters; OAuth automation is not implemented.
- Postman migration imports HTTP requests, supported auth/body fields and collection variables; nested folder names are flattened into request names. Collection scripts, external files and unsupported auth modes are not migrated. OpenAPI import supports JSON 3.x documents, basic parameters and JSON body examples, without external reference fetching.
- cURL import supports common raw-request options and rejects unsupported flags. It parses text without executing shell commands.
- FlowX XML uses a versioned XML envelope containing a validated JSON workspace payload. FlowX XML is the complete interchange format for flows, scripts, variables and attached file data.

See [docs/REQUIREMENTS-AUDIT.md](docs/REQUIREMENTS-AUDIT.md) for the full specification audit and [docs/ROADMAP.md](docs/ROADMAP.md) for delivery status and follow-on work.
