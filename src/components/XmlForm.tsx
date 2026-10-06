import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import VariableInput, { VariableTextarea } from './VariableInput';
import type { JsonValue } from '../documents';
type Block = Record<string, JsonValue>;
const tagOf = (block: Block) => Object.keys(block).find((k) => k !== ':@') || '';
const textOnly = (blocks: JsonValue[]) =>
  blocks.every(
    (b) =>
      b && typeof b === 'object' && !Array.isArray(b) && Object.keys(b).every((k) => k === '#text'),
  );
function TextField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return value.includes('\n') ? (
    <VariableTextarea
      aria-label="XML text value"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ) : (
    <VariableInput
      aria-label="XML value"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
function Element({
  block,
  onChange,
  depth,
}: {
  block: Block;
  onChange: (block: Block) => void;
  depth: number;
}) {
  const tag = tagOf(block);
  const children = block[tag];
  const attrs = block[':@'] as Block | undefined;
  return (
    <div className="xml-element">
      {attrs && (
        <div className="xml-attributes">
          {Object.entries(attrs).map(([key, value]) => (
            <label key={key}>
              {key}
              <TextField
                value={String(value)}
                onChange={(text) => onChange({ ...block, ':@': { ...attrs, [key]: text } })}
              />
            </label>
          ))}
        </div>
      )}
      {Array.isArray(children) ? (
        textOnly(children) ? (
          children.map((child, i) => (
            <TextField
              key={i}
              value={String((child as Block)['#text'] ?? '')}
              onChange={(text) =>
                onChange({
                  ...block,
                  [tag]: children.map((c, j) => (j === i ? { '#text': text } : c)),
                })
              }
            />
          ))
        ) : (
          <XmlChildren
            blocks={children as Block[]}
            onChange={(next) => onChange({ ...block, [tag]: next })}
            depth={depth + 1}
          />
        )
      ) : (
        <TextField
          value={String(children ?? '')}
          onChange={(text) => onChange({ ...block, [tag]: text })}
        />
      )}
    </div>
  );
}
function XmlChildren({
  blocks,
  onChange,
  depth = 0,
}: {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  depth?: number;
}) {
  const [name, setName] = useState('');
  if (depth > 25) return <p className="muted">Edit deeply nested XML in Code view.</p>;
  const groups = new Map<string, number[]>();
  blocks.forEach((b, i) => {
    const tag = tagOf(b);
    if (tag === '#text' && !String(b[tag]).trim()) return;
    groups.set(tag, [...(groups.get(tag) || []), i]);
  });
  const patch = (index: number, value: Block) =>
    onChange(blocks.map((b, i) => (i === index ? value : b)));
  return (
    <div className="xml-children">
      {[...groups].map(([tag, indexes]) =>
        tag.startsWith('#') ? (
          <div className="form-field" key={tag}>
            <strong>{tag === '#text' ? 'Text' : tag === '#comment' ? 'Comment' : 'CDATA'}</strong>
            {indexes.map((index) => (
              <Element
                key={index}
                block={blocks[index]}
                onChange={(value) => patch(index, value)}
                depth={depth}
              />
            ))}
          </div>
        ) : indexes.length === 1 ? (
          <div className="form-field" key={tag}>
            <div className="form-field-label">
              <strong>&lt;{tag}&gt;</strong>
              {depth > 0 && (
                <button
                  className="icon"
                  aria-label={`Delete XML element ${tag}`}
                  onClick={() => onChange(blocks.filter((_, i) => i !== indexes[0]))}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
            <Element
              block={blocks[indexes[0]]}
              onChange={(b) => patch(indexes[0], b)}
              depth={depth}
            />
          </div>
        ) : (
          <div className="array-form" key={tag}>
            <div className="form-caption">
              &lt;{tag}&gt; · {indexes.length} rows
            </div>
            <XmlTable
              blocks={indexes.map((i) => blocks[i])}
              onChange={(next) => {
                const positions = new Set(indexes);
                let cursor = 0;
                const result: Block[] = [];
                blocks.forEach((b, i) => {
                  if (positions.has(i)) {
                    if (cursor < next.length) result.push(next[cursor++]);
                  } else result.push(b);
                  if (i === indexes.at(-1)) {
                    while (cursor < next.length) result.push(next[cursor++]);
                  }
                });
                onChange(result);
              }}
              depth={depth}
            />
          </div>
        ),
      )}
      {depth > 0 && (
        <div className="add-field">
          <input
            aria-label="New XML element name"
            placeholder="New element name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="text-button"
            disabled={!/^[A-Za-z_][\w:.-]*$/.test(name)}
            onClick={() => {
              onChange([...blocks, { [name]: [{ '#text': '' }] }]);
              setName('');
            }}
          >
            <Plus size={12} /> Add element
          </button>
        </div>
      )}
    </div>
  );
}
function XmlTable({
  blocks,
  onChange,
  depth,
}: {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  depth: number;
}) {
  const columns = [
    ...new Set(
      blocks.flatMap((block) => {
        const children = block[tagOf(block)];
        return [
          ...Object.keys((block[':@'] as Block) || {}),
          ...(Array.isArray(children)
            ? children
                .map((c) => tagOf(c as Block))
                .filter(
                  (k) =>
                    k !== '#text' ||
                    String(
                      (children.find((c) => tagOf(c as Block) === k) as Block)?.[k] || '',
                    ).trim(),
                )
            : []),
        ];
      }),
    ),
  ];
  const patch = (i: number, b: Block) => onChange(blocks.map((r, j) => (j === i ? b : r)));
  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              {columns.map((c) => (
                <th key={c}>{c === '#text' ? 'Text' : c}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {blocks.map((block, i) => {
              const tag = tagOf(block);
              const children = block[tag] as Block[];
              return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  {columns.map((column) => {
                    if (column.startsWith('@')) {
                      const attrs = block[':@'] as Block | undefined;
                      return (
                        <td key={column}>
                          <TextField
                            value={String(attrs?.[column] ?? '')}
                            onChange={(text) =>
                              patch(i, { ...block, ':@': { ...attrs, [column]: text } })
                            }
                          />
                        </td>
                      );
                    }
                    const indexes = Array.isArray(children)
                      ? children.map((c, j) => (tagOf(c) === column ? j : -1)).filter((j) => j >= 0)
                      : [];
                    const cell = children?.[indexes[0]];
                    const inner = cell?.[column];
                    return (
                      <td key={column}>
                        {!cell ? (
                          <span className="muted">Missing</span>
                        ) : column === '#text' ? (
                          <TextField
                            value={String(inner)}
                            onChange={(text) =>
                              patch(i, {
                                ...block,
                                [tag]: children.map((c, j) =>
                                  j === indexes[0] ? { ...c, [column]: text } : c,
                                ),
                              })
                            }
                          />
                        ) : indexes.length === 1 && Array.isArray(inner) && textOnly(inner) ? (
                          <TextField
                            value={inner.map((c) => String((c as Block)['#text'] || '')).join('')}
                            onChange={(text) =>
                              patch(i, {
                                ...block,
                                [tag]: children.map((c, j) =>
                                  j === indexes[0] ? { ...c, [column]: [{ '#text': text }] } : c,
                                ),
                              })
                            }
                          />
                        ) : (
                          <details>
                            <summary>
                              Expand{' '}
                              {indexes.length > 1 ? `list (${indexes.length})` : 'nested value'}
                            </summary>
                            <XmlChildren
                              blocks={indexes.map((j) => children[j])}
                              depth={depth + 1}
                              onChange={(next) => {
                                const pos = new Set(indexes);
                                let cursor = 0;
                                const result: Block[] = [];
                                children.forEach((child, j) => {
                                  if (pos.has(j)) {
                                    if (cursor < next.length) result.push(next[cursor++]);
                                  } else result.push(child);
                                  if (j === indexes.at(-1))
                                    while (cursor < next.length) result.push(next[cursor++]);
                                });
                                patch(i, { ...block, [tag]: result });
                              }}
                            />
                          </details>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <button
                      className="icon"
                      aria-label={`Delete XML row ${i + 1}`}
                      onClick={() => onChange(blocks.filter((_, j) => j !== i))}
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button
        className="text-button"
        onClick={() => onChange([...blocks, structuredClone(blocks[0])])}
      >
        <Plus size={13} /> Add row
      </button>
    </>
  );
}
export default function XmlForm({
  value,
  onChange,
}: {
  value: JsonValue;
  onChange: (value: JsonValue) => void;
}) {
  return <XmlChildren blocks={value as Block[]} onChange={onChange} />;
}
