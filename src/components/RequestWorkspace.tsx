import { useEffect, useState } from 'react';
import { Send, Square, Columns2, Rows2, HelpCircle, Upload, Trash2 } from 'lucide-react';
import { type RichRequest, type Store } from '../domain';
import { type HttpResponse, readParams, writeParams, uid } from '../model';
import { inherited } from '../variables';
import { dependencyOrder } from '../runner';
import DocumentEditor from './DocumentEditor';
import Entries from './Entries';
import Variables from './Variables';
import Outputs from './Outputs';
import VariableInput from './VariableInput';
import { parseDocument } from '../documents';
export default function RequestWorkspace({
  request,
  onChange,
  store,
  theme,
  response,
  busy,
  onSend,
  onCancel,
  error,
  compact = false,
}: {
  request: RichRequest;
  onChange: (r: RichRequest) => void;
  store: Store;
  theme: 'dark' | 'light';
  response?: HttpResponse;
  busy?: boolean;
  onSend?: () => void;
  onCancel?: () => void;
  error?: string;
  compact?: boolean;
}) {
  const [section, setSection] = useState('Body');
  const [stacked, setStacked] = useState(false);
  const [ratio, setRatio] = useState(50);
  const [responseTab, setResponseTab] = useState('Body');
  const [draft, setDraft] = useState(response?.body || '');
  const [fileError, setFileError] = useState('');
  useEffect(() => {
    setDraft(response?.body || '');
  }, [response]);
  const patch = (changes: Partial<RichRequest>) => onChange({ ...request, ...changes });
  const rows = request.params.length ? request.params : readParams(request.url);
  let plan = '';
  if (!compact) {
    try {
      const order = dependencyOrder(store, request);
      if (order.length > 1) plan = order.map((r) => r.name).join(' → ');
    } catch (e) {
      plan = e instanceof Error ? e.message : String(e);
    }
  }
  const format = response?.headers.find(([key]) => key.toLowerCase() === 'content-type')?.[1] || '';
  const responseFormat = format.includes('xml')
    ? 'xml'
    : format.includes('json')
      ? 'json'
      : (() => {
          if (response?.body.trimStart().startsWith('<?xml')) {
            try {
              parseDocument(response.body, 'xml');
              return 'xml';
            } catch {
              /* Invalid XML remains available in Code view. */
            }
          }
          try {
            JSON.parse(response?.body || '');
            return 'json';
          } catch {
            return 'text';
          }
        })();
  async function upload(file: File, kind: 'binary' | 'multipart') {
    if (file.size > 10 * 1024 * 1024) {
      setFileError('Files are limited to 10 MB in this version.');
      return;
    }
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    if (kind === 'binary') patch({ binary: { name: file.name, bytes } });
    else
      patch({
        files: [
          ...request.files,
          { id: uid(), key: 'file', name: file.name, mime: file.type, bytes },
        ],
      });
    setFileError('');
  }
  return (
    <div className={`request-workspace ${compact ? 'compact' : ''}`}>
      {!compact && (
        <div className="workspace-heading">
          <div>
            <div className="breadcrumb">
              {store.nodes.find((n) => n.id === request.parentId)?.name} / Request
            </div>
            <input
              className="request-name"
              aria-label="Request name"
              value={request.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>
          <button className="subtle-button" onClick={() => setStacked((s) => !s)}>
            {stacked ? <Columns2 size={15} /> : <Rows2 size={15} />}{' '}
            {stacked ? 'Side by side' : 'Stack panels'}
          </button>
        </div>
      )}
      <div className="url-bar">
        <select
          aria-label="HTTP method"
          value={request.method}
          onChange={(e) => patch({ method: e.target.value })}
        >
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <VariableInput
          aria-label="Request URL"
          placeholder="https://api.example.com/resource"
          value={request.url}
          onChange={(e) => patch({ url: e.target.value, params: readParams(e.target.value) })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSend?.();
          }}
        />
        {onSend &&
          (busy ? (
            <button className="send" onClick={onCancel}>
              <Square size={14} /> Cancel
            </button>
          ) : (
            <button className="send" onClick={onSend}>
              Send <Send size={15} />
            </button>
          ))}
      </div>
      {request.description && (
        <div className="dependency-plan">
          <HelpCircle size={13} />
          <span>{request.description}</span>
        </div>
      )}
      {plan && (
        <div className="dependency-plan">
          <HelpCircle size={13} />
          <span>Execution plan: {plan}</span>
        </div>
      )}
      <div className={`panels ${stacked ? 'stacked' : ''}`}>
        <section
          className="panel request-panel"
          style={compact ? undefined : { flex: `0 0 ${ratio}%` }}
        >
          <div className="panel-heading">
            <span>REQUEST</span>
            <span className="muted">Auto-saved locally</span>
          </div>
          <div className="section-tabs">
            {['Body', 'Params', 'Headers', 'Authentication', 'Variables'].map((tab) => (
              <button
                key={tab}
                className={section === tab ? 'active' : ''}
                onClick={() => setSection(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
          {section === 'Body' && (
            <>
              <div className="body-options">
                <select
                  aria-label="Body type"
                  value={request.bodyType}
                  onChange={(e) => patch({ bodyType: e.target.value as RichRequest['bodyType'] })}
                >
                  <option value="raw">Raw body</option>
                  <option value="form">URL-encoded form</option>
                  <option value="multipart">Multipart / files</option>
                  <option value="binary">Binary file</option>
                </select>
                {request.bodyType === 'raw' && (
                  <select
                    aria-label="Body format"
                    value={request.format}
                    onChange={(e) => patch({ format: e.target.value as RichRequest['format'] })}
                  >
                    <option value="json">JSON</option>
                    <option value="xml">XML</option>
                    <option value="text">Text / HTML / other</option>
                  </select>
                )}
              </div>
              {request.bodyType === 'raw' ? (
                <DocumentEditor
                  value={request.body}
                  onChange={(body) => patch({ body })}
                  format={request.format}
                  theme={theme}
                />
              ) : request.bodyType === 'binary' ? (
                <div className="file-section">
                  <label className="subtle-button">
                    <Upload size={15} /> Select file
                    <input
                      type="file"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void upload(file, 'binary');
                      }}
                    />
                  </label>
                  <p>{request.binary?.name || 'No file selected'}</p>
                </div>
              ) : (
                <>
                  <Entries
                    label="field"
                    rows={request.fields}
                    onChange={(fields) => patch({ fields })}
                  />
                  {request.bodyType === 'multipart' && (
                    <div className="file-section">
                      <label className="subtle-button">
                        <Upload size={15} /> Add file
                        <input
                          type="file"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void upload(file, 'multipart');
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {request.files.map((f) => (
                        <div className="file-row" key={f.id}>
                          <VariableInput
                            aria-label="File field name"
                            value={f.key}
                            onChange={(e) =>
                              patch({
                                files: request.files.map((x) =>
                                  x.id === f.id ? { ...x, key: e.target.value } : x,
                                ),
                              })
                            }
                          />
                          <span>{f.name}</span>
                          <button
                            className="icon"
                            aria-label={`Remove ${f.name}`}
                            onClick={() =>
                              patch({ files: request.files.filter((x) => x.id !== f.id) })
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {fileError && <div className="error">{fileError}</div>}
              <div className="help">
                <HelpCircle size={14} />
                {['GET', 'HEAD'].includes(request.method)
                  ? `${request.method} requests are sent without a body.`
                  : 'Use {name} for variables. A complete JSON string placeholder retains the resolved value type.'}
              </div>
            </>
          )}
          {section === 'Params' && (
            <Entries
              label="parameter"
              rows={rows}
              onChange={(params) => patch({ params, url: writeParams(request.url, params) })}
            />
          )}
          {section === 'Headers' && (
            <Entries
              label="header"
              rows={request.headers}
              onChange={(headers) => patch({ headers })}
            />
          )}
          {section === 'Variables' && (
            <Variables
              variables={request.variables}
              inherited={inherited(store, request.parentId)}
              onChange={(variables) => patch({ variables })}
            />
          )}
          {compact && (
            <details className="compact-outputs">
              <summary>Response output variables</summary>
              <Outputs
                outputs={request.outputs}
                response={response}
                onChange={(outputs) => patch({ outputs })}
                theme={theme}
              />
            </details>
          )}
          {section === 'Authentication' && (
            <div className="auth-form">
              <label>
                Authentication type
                <select
                  value={request.auth}
                  onChange={(e) => patch({ auth: e.target.value as RichRequest['auth'] })}
                >
                  <option value="none">None</option>
                  <option value="bearer">Bearer token</option>
                  <option value="basic">Basic authentication</option>
                </select>
              </label>
              {request.auth === 'bearer' && (
                <label>
                  Token
                  <VariableInput
                    type="password"
                    value={request.token}
                    onChange={(e) => patch({ token: e.target.value })}
                  />
                </label>
              )}
              {request.auth === 'basic' && (
                <>
                  <label>
                    Username
                    <VariableInput
                      value={request.username}
                      onChange={(e) => patch({ username: e.target.value })}
                    />
                  </label>
                  <label>
                    Password
                    <VariableInput
                      type="password"
                      value={request.password}
                      onChange={(e) => patch({ password: e.target.value })}
                    />
                  </label>
                </>
              )}
              <p className="muted">
                Use secret variables for credentials. Secret values, tokens and passwords are
                session only.
              </p>
            </div>
          )}
        </section>
        {!compact && (
          <>
            <div
              className="panel-resizer"
              role="separator"
              aria-label="Resize request and response panels"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
                  setRatio((r) => Math.max(25, r - 2));
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
                  setRatio((r) => Math.min(75, r + 2));
              }}
              onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
              onPointerMove={(e) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                const rect = e.currentTarget.parentElement!.getBoundingClientRect();
                setRatio(
                  Math.max(
                    25,
                    Math.min(
                      75,
                      (stacked
                        ? (e.clientY - rect.top) / rect.height
                        : (e.clientX - rect.left) / rect.width) * 100,
                    ),
                  ),
                );
              }}
            />
            <section className="panel response-panel">
              <div className="panel-heading">
                <span>RESPONSE</span>
                {response && (
                  <div className="response-stats">
                    <span className={response.status < 400 ? 'success' : 'failure'}>
                      {response.status} {response.statusText}
                    </span>
                    <span>{response.duration} ms</span>
                    <span>{(response.size / 1024).toFixed(1)} KB</span>
                  </div>
                )}
              </div>
              <div className="section-tabs">
                {['Body', 'Headers', 'Output variables'].map((tab) => (
                  <button
                    key={tab}
                    className={responseTab === tab ? 'active' : ''}
                    onClick={() => setResponseTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              {responseTab === 'Output variables' ? (
                <Outputs
                  outputs={request.outputs}
                  response={response}
                  onChange={(outputs) => patch({ outputs })}
                  theme={theme}
                />
              ) : response ? (
                responseTab === 'Body' ? (
                  <DocumentEditor
                    value={draft}
                    onChange={setDraft}
                    original={response.body}
                    onReset={() => setDraft(response.body)}
                    format={responseFormat}
                    theme={theme}
                  />
                ) : (
                  <div className="response-headers">
                    {response.headers.map(([k, v], i) => (
                      <div key={i}>
                        <strong>{k}</strong>
                        <span>{v}</span>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <div className="empty-response">
                  <h3>{busy ? 'Running requests…' : 'A response starts with a request'}</h3>
                  <p>
                    Send a request to explore its response.
                    <br />
                    Switch to Form View to edit a local copy.
                  </p>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
