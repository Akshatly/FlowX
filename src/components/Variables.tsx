import { Plus, Trash2 } from 'lucide-react';
import { variable, type Variable } from '../domain';
import VariableInput from './VariableInput';
export default function Variables({
  variables,
  onChange,
  inherited = [],
  prompts = false,
}: {
  variables: Variable[];
  onChange: (v: Variable[]) => void;
  inherited?: Variable[];
  prompts?: boolean;
}) {
  const patch = (id: string, changes: Partial<Variable>) =>
    onChange(variables.map((v) => (v.id === id ? { ...v, ...changes } : v)));
  return (
    <div className="variables-editor">
      <p className="muted">
        Use <code>{'{name}'}</code> in input fields. Child values override parent values. JSON
        values retain their type when used as a complete body value.
      </p>
      {inherited.length > 0 && (
        <details>
          <summary>Inherited · {inherited.length}</summary>
          {inherited.map((v) => (
            <div className="inherited-variable" key={v.id}>
              <code>{v.name}</code>
              <span>{v.secret ? '••••••' : v.value}</span>
            </div>
          ))}
        </details>
      )}
      {variables.map((v) => (
        <div className="variable-card" key={v.id}>
          <div className="variable-line">
            <input
              aria-label="Variable name"
              placeholder="Variable name"
              value={v.name}
              onChange={(e) => patch(v.id, { name: e.target.value })}
            />
            <select
              aria-label="Variable type"
              value={v.type}
              onChange={(e) => patch(v.id, { type: e.target.value as Variable['type'] })}
            >
              {['text', 'json', 'number', 'boolean', 'date'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <button
              className="icon"
              aria-label={`Delete variable ${v.name}`}
              onClick={() => onChange(variables.filter((x) => x.id !== v.id))}
            >
              <Trash2 size={14} />
            </button>
          </div>
          <VariableInput
            aria-label="Variable value"
            type={v.secret ? 'password' : 'text'}
            value={v.value}
            placeholder={v.prompt ? 'Default prompt value' : 'Value'}
            onChange={(e) => patch(v.id, { value: e.target.value })}
          />
          <input
            aria-label="Variable description"
            placeholder="Description or prompt question"
            value={v.description}
            onChange={(e) => patch(v.id, { description: e.target.value })}
          />
          <div className="variable-line">
            <label>
              <input
                type="checkbox"
                checked={v.secret}
                onChange={(e) => patch(v.id, { secret: e.target.checked })}
              />{' '}
              Secret · session only
            </label>
            {prompts && (
              <label>
                <input
                  type="checkbox"
                  checked={v.prompt || false}
                  onChange={(e) => patch(v.id, { prompt: e.target.checked })}
                />{' '}
                Prompt when running
              </label>
            )}
          </div>
        </div>
      ))}
      <button className="text-button" onClick={() => onChange([...variables, variable()])}>
        <Plus size={14} /> Add variable
      </button>
    </div>
  );
}
