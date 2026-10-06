import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import Editor from './Editor';
import VariableInput, { VariableTextarea } from './VariableInput';
import XmlForm from './XmlForm';
import { parseDocument, serializeDocument, formatDocument, type JsonValue } from '../documents';
function Primitive({
  value,
  onChange,
}: {
  value: JsonValue;
  onChange: (value: JsonValue) => void;
}) {
  const type = value === null ? 'null' : typeof value;
  const [numeric, setNumeric] = useState(String(value));
  useEffect(() => setNumeric(String(value)), [value]);
  return (
    <div className="primitive">
      {type === 'boolean' ? (
        <select
          aria-label="Boolean value"
          value={String(value)}
          onChange={(e) => onChange(e.target.value === 'true')}
        >
          <option>true</option>
          <option>false</option>
        </select>
      ) : type === 'null' ? (
        <span className="muted">null</span>
      ) : type === 'number' ? (
        <input
          aria-label="Number value"
          type="number"
          value={numeric}
          onChange={(e) => {
            setNumeric(e.target.value);
            if (e.target.value !== '' && Number.isFinite(Number(e.target.value)))
              onChange(Number(e.target.value));
          }}
          onBlur={() => setNumeric(String(value))}
        />
      ) : String(value).includes('\n') ? (
        <VariableTextarea
          aria-label="Text value"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <VariableInput
          aria-label="Text value"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
function ValueForm({
  value,
  onChange,
  depth = 0,
}: {
  value: JsonValue;
  onChange: (value: JsonValue) => void;
  depth?: number;
}) {
  const [newKey, setNewKey] = useState('');
  if (depth > 25)
    return <p className="muted">This value is deeply nested. Edit it in Code view.</p>;
  if (value === null || typeof value !== 'object')
    return <Primitive value={value} onChange={onChange} />;
  if (Array.isArray(value)) {
    const objects =
      value.length > 0 &&
      value.every((v) => v !== null && typeof v === 'object' && !Array.isArray(v));
    const keys = objects ? [...new Set(value.flatMap((v) => Object.keys(v as object)))] : ['Value'];
    return (
      <div className="array-form">
        <div className="form-caption">List · {value.length} rows</div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                {keys.map((k) => (
                  <th key={k}>{label(k)}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {value.map((row, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  {keys.map((k) => {
                    const cell = objects ? (row as { [key: string]: JsonValue })[k] : row;
                    const set = (next: JsonValue) =>
                      onChange(
                        value.map((r, j) =>
                          j === i ? (objects ? { ...(r as object), [k]: next } : next) : r,
                        ),
                      );
                    return (
                      <td key={k}>
                        {cell === undefined ? (
                          <span className="muted">Missing</span>
                        ) : cell !== null && typeof cell === 'object' ? (
                          <details>
                            <summary>
                              Expand {Array.isArray(cell) ? `list (${cell.length})` : 'object'}
                            </summary>
                            <ValueForm value={cell} onChange={set} depth={depth + 1} />
                          </details>
                        ) : (
                          <Primitive value={cell} onChange={set} />
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <button
                      className="icon"
                      aria-label={`Delete row ${i + 1}`}
                      onClick={() => onChange(value.filter((_, j) => j !== i))}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          className="text-button"
          onClick={() =>
            onChange([...value, objects ? Object.fromEntries(keys.map((k) => [k, ''])) : ''])
          }
        >
          <Plus size={13} /> Add row
        </button>
      </div>
    );
  }
  return (
    <div className="object-form">
      {Object.entries(value).map(([key, child]) => (
        <div className="form-field" key={key}>
          <div className="form-field-label">
            <strong>{label(key)}</strong>
            <button
              className="icon"
              aria-label={`Delete field ${key}`}
              onClick={() =>
                onChange(Object.fromEntries(Object.entries(value).filter(([k]) => k !== key)))
              }
            >
              <Trash2 size={12} />
            </button>
          </div>
          {child !== null && typeof child === 'object' ? (
            <details open={depth < 2}>
              <summary>{Array.isArray(child) ? `List · ${child.length} items` : 'Object'}</summary>
              <ValueForm
                value={child}
                onChange={(next) => onChange({ ...value, [key]: next })}
                depth={depth + 1}
              />
            </details>
          ) : (
            <Primitive value={child} onChange={(next) => onChange({ ...value, [key]: next })} />
          )}
        </div>
      ))}
      <div className="add-field">
        <input
          aria-label="New field name"
          placeholder="New field name"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
        />
        <button
          className="text-button"
          disabled={!newKey.trim() || Object.hasOwn(value, newKey.trim())}
          onClick={() => {
            onChange({ ...value, [newKey.trim()]: '' });
            setNewKey('');
          }}
        >
          Add field
        </button>
      </div>
    </div>
  );
}
function label(key: string) {
  return key === ':@'
    ? 'Attributes'
    : key === '#text'
      ? 'Text'
      : key === '#comment'
        ? 'Comment'
        : key === '#cdata'
          ? 'CDATA'
          : key.replace(/^@/, '@ ');
}
export default function DocumentEditor({
  value,
  onChange,
  format,
  theme,
  original,
  onReset,
}: {
  value: string;
  onChange: (value: string) => void;
  format: string;
  theme: 'dark' | 'light';
  original?: string;
  onReset?: () => void;
}) {
  const [view, setView] = useState<'code' | 'form'>('code');
  const [error, setError] = useState('');
  let parsed: JsonValue | undefined;
  let parseError = '';
  if (view === 'form') {
    try {
      parsed = parseDocument(value, format);
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
    }
  }
  return (
    <div className="document-editor">
      <div className="editor-toolbar">
        <div className="segmented">
          <button className={view === 'code' ? 'active' : ''} onClick={() => setView('code')}>
            Code
          </button>
          <button className={view === 'form' ? 'active' : ''} onClick={() => setView('form')}>
            Form View
          </button>
        </div>
        <span className="muted">
          {original !== undefined ? 'Local response copy' : format.toUpperCase()}
        </span>
        <button
          className="text-button"
          onClick={() => {
            try {
              onChange(formatDocument(value, format));
              setError('');
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Format
        </button>
        {onReset && (
          <button className="text-button" onClick={onReset}>
            Reset
          </button>
        )}
      </div>
      {original !== undefined && value !== original && (
        <div className="help">
          Edited locally. Output variables use the original received response.
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {view === 'code' ? (
        <div className="editor-container">
          <Editor value={value} onChange={onChange} format={format} theme={theme} />
        </div>
      ) : parseError ? (
        <div className="error" role="alert">
          {parseError}
          <p>Fix the document in Code view to use Form View.</p>
        </div>
      ) : (
        <div className="form-view">
          {format === 'xml' && (
            <p className="muted">
              Repeated XML elements become tables. Attributes use @ labels; expand nested lists to
              edit their contents.
            </p>
          )}
          {format === 'xml' ? (
            <XmlForm
              value={parsed!}
              onChange={(next) => {
                try {
                  onChange(serializeDocument(next, format));
                  setError('');
                } catch (e) {
                  setError(String(e));
                }
              }}
            />
          ) : (
            <ValueForm
              value={parsed!}
              onChange={(next) => onChange(serializeDocument(next, format))}
            />
          )}
        </div>
      )}
    </div>
  );
}
