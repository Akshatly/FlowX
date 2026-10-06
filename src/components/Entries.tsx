import VariableInput from './VariableInput';
import { Plus, Trash2 } from 'lucide-react';
import { entry, type Entry } from '../model';
export default function Entries({
  rows,
  onChange,
  label,
}: {
  rows: Entry[];
  onChange: (rows: Entry[]) => void;
  label: string;
}) {
  const update = (id: string, field: keyof Entry, value: string | boolean) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  return (
    <div className="entries">
      <div className="entry-head">
        <span></span>
        <span>KEY</span>
        <span>VALUE</span>
        <span></span>
      </div>
      {rows.map((row) => (
        <div className="entry-row" key={row.id}>
          <input
            aria-label={`Enable ${row.key || label}`}
            type="checkbox"
            checked={row.enabled}
            onChange={(e) => update(row.id, 'enabled', e.target.checked)}
          />
          <VariableInput
            aria-label={`${label} key`}
            placeholder="Key"
            value={row.key}
            onChange={(e) => update(row.id, 'key', e.target.value)}
          />
          <VariableInput
            aria-label={`${label} value`}
            placeholder="Value"
            value={row.value}
            onChange={(e) => update(row.id, 'value', e.target.value)}
          />
          <button
            className="icon"
            aria-label={`Delete ${row.key || label}`}
            onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button className="text-button" onClick={() => onChange([...rows, entry()])}>
        <Plus size={14} /> Add {label}
      </button>
    </div>
  );
}
