import { useState } from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { uid, type HttpResponse } from '../model';
import type { Output } from '../domain';
import { responseData, listPaths, getPath } from '../documents';
import { transform } from '../transforms';
import Editor from './Editor';
export default function Outputs({
  outputs,
  onChange,
  response,
  theme,
}: {
  outputs: Output[];
  onChange: (v: Output[]) => void;
  response?: HttpResponse;
  theme: 'dark' | 'light';
}) {
  const [draft, setDraft] = useState<Output>();
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  let data: unknown;
  try {
    data =
      draft?.source === 'headers'
        ? Object.fromEntries(response?.headers || [])
        : draft?.source === 'status'
          ? response?.status
          : response
            ? responseData(response.body)
            : undefined;
  } catch {}
  const paths = data === undefined ? [] : listPaths(data);
  let selected: unknown;
  try {
    selected = draft ? getPath(data, draft.path) : undefined;
  } catch {}
  const update = (patch: Partial<Output>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setPreview('');
    setError('');
  };
  return (
    <div className="outputs-editor">
      <p className="muted">
        Capture response values and reference them with <code>{'{Request name.outputName}'}</code>.
        Sending a dependent request runs its prerequisites first.
      </p>
      {outputs.map((o) => (
        <div className="output-card" key={o.id}>
          <div>
            <strong>{o.name}</strong>
            <p className="muted">
              {o.source} → {o.path || '$'} · {o.mode}
            </p>
          </div>
          <button
            className="icon"
            title={`Edit ${o.name}`}
            onClick={() => {
              setDraft({ ...o });
              setPreview('');
              setError('');
            }}
          >
            <Pencil size={14} />
          </button>
          <button
            className="icon"
            title={`Delete ${o.name}`}
            onClick={() => onChange(outputs.filter((x) => x.id !== o.id))}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        className="text-button"
        onClick={() => {
          setDraft({
            id: uid(),
            name: '',
            source: 'body',
            path: '',
            mode: 'none',
            script: 'return value;',
            missing: 'fail',
            type: 'auto',
          });
          setError('');
          setPreview('');
        }}
      >
        <Plus size={14} /> Add output variable
      </button>
      {draft && (
        <div className="modal-backdrop">
          <form
            className="modal output-modal"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.name.trim()) {
                setError('Give the output a name.');
                return;
              }
              if (outputs.some((o) => o.id !== draft.id && o.name === draft.name)) {
                setError('Output names must be unique.');
                return;
              }
              onChange(
                outputs.some((o) => o.id === draft.id)
                  ? outputs.map((o) => (o.id === draft.id ? draft : o))
                  : [...outputs, draft],
              );
              setDraft(undefined);
            }}
          >
            <div className="modal-heading">
              <h2>Capture an output</h2>
              <button
                type="button"
                className="icon"
                aria-label="Close output dialog"
                onClick={() => setDraft(undefined)}
              >
                <X size={18} />
              </button>
            </div>
            <p>Select a path from the original response, then optionally transform its value.</p>
            <div className="two-fields">
              <label>
                Name
                <input
                  required
                  value={draft.name}
                  onChange={(e) => update({ name: e.target.value })}
                  placeholder="customerId"
                  pattern="[A-Za-z_][A-Za-z0-9_]*"
                />
              </label>
              <label>
                Source
                <select
                  value={draft.source}
                  onChange={(e) => update({ source: e.target.value as Output['source'], path: '' })}
                >
                  <option value="body">Body</option>
                  <option value="headers">Headers</option>
                  <option value="status">Status</option>
                </select>
              </label>
            </div>
            <label>
              Path
              <input
                list="output-paths"
                value={draft.path}
                onChange={(e) => update({ path: e.target.value })}
                placeholder="data.items[0].id · $ for entire value"
              />
              <datalist id="output-paths">
                {paths.map((p) => (
                  <option value={p.path} key={p.path}>
                    {JSON.stringify(p.value)?.slice(0, 100)}
                  </option>
                ))}
              </datalist>
            </label>
            <div className="path-browser">
              {paths
                .filter(
                  (p) => !draft.path || p.path.toLowerCase().includes(draft.path.toLowerCase()),
                )
                .slice(0, 100)
                .map((p) => (
                  <button type="button" key={p.path} onClick={() => update({ path: p.path })}>
                    <code>{p.path}</code>
                    <span>{JSON.stringify(p.value)?.slice(0, 90)}</span>
                  </button>
                ))}
            </div>
            <div className="value-preview">
              <span className="muted">
                Selected value ·{' '}
                {Array.isArray(selected) ? 'list' : selected === null ? 'null' : typeof selected}
              </span>
              <Editor
                value={
                  selected === undefined
                    ? 'Send this request to populate paths and value previews.'
                    : JSON.stringify(selected, null, 2)
                }
                format={selected === undefined ? 'text' : 'json'}
                theme={theme}
                readOnly
              />
            </div>
            <div className="two-fields">
              <label>
                Transform
                <select
                  value={draft.mode}
                  onChange={(e) =>
                    update({
                      mode: e.target.value as Output['mode'],
                      script:
                        e.target.value === 'map'
                          ? 'return item;'
                          : e.target.value === 'filter'
                            ? 'return item.active === true;'
                            : 'return value;',
                    })
                  }
                >
                  <option value="none">None</option>
                  <option value="transform">Entire value</option>
                  <option value="map">Map each list item</option>
                  <option value="filter">Filter list items</option>
                </select>
              </label>
              <label>
                Output type
                <select
                  value={draft.type}
                  onChange={(e) => update({ type: e.target.value as Output['type'] })}
                >
                  <option value="auto">Automatic</option>
                  <option value="text">Text</option>
                  <option value="json">JSON</option>
                  <option value="date">Date (ISO)</option>
                </select>
              </label>
            </div>
            {draft.mode !== 'none' && (
              <>
                <p className="muted">
                  Use <code>value</code> for the whole value; <code>item</code> and{' '}
                  <code>index</code> for list operations. Return your result. Scripts have no
                  network or filesystem access.
                </p>
                <div className="script-editor">
                  <Editor
                    value={draft.script}
                    onChange={(script) => update({ script })}
                    format="javascript"
                    theme={theme}
                  />
                </div>
              </>
            )}
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.secret || false}
                onChange={(e) => update({ secret: e.target.checked })}
              />{' '}
              Mask this output in logs and history
            </label>
            <label>
              Missing path
              <select
                value={draft.missing}
                onChange={(e) => update({ missing: e.target.value as Output['missing'] })}
              >
                <option value="fail">Fail execution</option>
                <option value="null">Use null</option>
              </select>
            </label>
            <button
              type="button"
              className="subtle-button"
              disabled={selected === undefined}
              onClick={async () => {
                try {
                  setPreview(JSON.stringify(await transform(selected, draft), null, 2));
                  setError('');
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Test transform
            </button>
            {preview && (
              <div className="value-preview">
                <Editor value={preview} format="json" theme={theme} readOnly />
              </div>
            )}
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button type="submit" className="send">
              Save output variable
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
