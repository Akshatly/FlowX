import {
  createContext,
  useContext,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ChangeEvent,
} from 'react';
export const Suggestions = createContext<string[]>([]);
export function Highlight({ value, hidden = false }: { value: string; hidden?: boolean }) {
  return (
    <>
      {value.split(/(\{[A-Za-z_][\w .-]*\})/g).map((part, i) =>
        /^\{[A-Za-z_][\w .-]*\}$/.test(part) ? (
          <mark className="variable-token" key={i}>
            {part}
          </mark>
        ) : (
          <span key={i}>{hidden ? part.replace(/./g, '•') : part}</span>
        ),
      )}
    </>
  );
}
export default function VariableInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const names = useContext(Suggestions);
  const ref = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [selected, setSelected] = useState(0);
  const options =
    query === null
      ? []
      : names.filter((n) => n.toLowerCase().includes(query.toLowerCase())).slice(0, 30);
  function inspect() {
    const input = ref.current;
    if (!input) return;
    const caret = input.selectionStart || 0;
    const before = input.value.slice(0, caret);
    const match = /\{([\w .-]*)$/.exec(before);
    setQuery(match ? match[1] : null);
    setAt(match ? caret - match[0].length : 0);
    setSelected(0);
  }
  function choose(name: string) {
    const input = ref.current;
    if (!input) return;
    const caret = input.selectionStart || 0;
    const suffix = input.value.slice(caret).replace(/^\}/, '');
    const value = input.value.slice(0, at) + `{${name}}` + suffix;
    props.onChange?.({
      target: { ...input, value },
      currentTarget: { ...input, value },
    } as ChangeEvent<HTMLInputElement>);
    setQuery(null);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(at + name.length + 2, at + name.length + 2);
    });
  }
  return (
    <div
      className={`variable-input ${String(props.value ?? '').match(/\{[A-Za-z_][\w .-]*\}/) ? 'has-variables' : ''}`}
    >
      <div className="variable-highlight" aria-hidden="true">
        <Highlight value={String(props.value ?? '')} hidden={props.type === 'password'} />
      </div>
      <input
        {...props}
        ref={ref}
        onChange={(e) => {
          props.onChange?.(e);
          inspect();
        }}
        onScroll={(e) => {
          const layer = e.currentTarget.previousElementSibling as HTMLElement;
          layer.scrollLeft = e.currentTarget.scrollLeft;
          layer.scrollTop = e.currentTarget.scrollTop;
        }}
        onClick={inspect}
        onKeyDown={(e) => {
          if (options.length && e.key === 'ArrowDown') {
            e.preventDefault();
            setSelected((i) => (i + 1) % options.length);
            return;
          }
          if (options.length && e.key === 'ArrowUp') {
            e.preventDefault();
            setSelected((i) => (i + options.length - 1) % options.length);
            return;
          }
          if (options.length && e.key === 'Enter') {
            e.preventDefault();
            choose(options[selected]);
            return;
          }
          if (e.key === 'Escape') setQuery(null);
          props.onKeyDown?.(e);
        }}
        onBlur={(e) => {
          setQuery(null);
          props.onBlur?.(e);
        }}
      />
      {options.length > 0 && (
        <div className="variable-options" role="listbox" aria-label="Available variables">
          {options.map((name, i) => (
            <button
              type="button"
              key={name}
              role="option"
              aria-selected={i === selected}
              className={i === selected ? 'selected' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(name);
              }}
            >
              <code>{`{${name}}`}</code>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function VariableTextarea(
  props: import('react').TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  const names = useContext(Suggestions);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [selected, setSelected] = useState(0);
  const options =
    query === null
      ? []
      : names.filter((n) => n.toLowerCase().includes(query.toLowerCase())).slice(0, 30);
  function inspect() {
    const input = ref.current;
    if (!input) return;
    const caret = input.selectionStart || 0;
    const match = /\{([\w .-]*)$/.exec(input.value.slice(0, caret));
    setQuery(match ? match[1] : null);
    setAt(match ? caret - match[0].length : 0);
    setSelected(0);
  }
  function choose(name: string) {
    const input = ref.current;
    if (!input) return;
    const caret = input.selectionStart || 0;
    const value =
      input.value.slice(0, at) + `{${name}}` + input.value.slice(caret).replace(/^\}/, '');
    props.onChange?.({
      target: { ...input, value },
      currentTarget: { ...input, value },
    } as import('react').ChangeEvent<HTMLTextAreaElement>);
    setQuery(null);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(at + name.length + 2, at + name.length + 2);
    });
  }
  return (
    <div
      className={`variable-input ${String(props.value ?? '').match(/\{[A-Za-z_][\w .-]*\}/) ? 'has-variables' : ''}`}
    >
      <div className="variable-highlight multiline" aria-hidden="true">
        <Highlight value={String(props.value ?? '')} />
      </div>
      <textarea
        {...props}
        ref={ref}
        onChange={(e) => {
          props.onChange?.(e);
          inspect();
        }}
        onScroll={(e) => {
          const layer = e.currentTarget.previousElementSibling as HTMLElement;
          layer.scrollLeft = e.currentTarget.scrollLeft;
          layer.scrollTop = e.currentTarget.scrollTop;
        }}
        onClick={inspect}
        onKeyDown={(e) => {
          if (options.length && e.key === 'ArrowDown') {
            e.preventDefault();
            setSelected((i) => (i + 1) % options.length);
            return;
          }
          if (options.length && e.key === 'ArrowUp') {
            e.preventDefault();
            setSelected((i) => (i + options.length - 1) % options.length);
            return;
          }
          if (options.length && e.key === 'Enter') {
            e.preventDefault();
            choose(options[selected]);
            return;
          }
          if (e.key === 'Escape') setQuery(null);
          props.onKeyDown?.(e);
        }}
        onBlur={(e) => {
          setQuery(null);
          props.onBlur?.(e);
        }}
      />
      {options.length > 0 && (
        <div className="variable-options">
          {options.map((name, i) => (
            <button
              type="button"
              key={name}
              className={i === selected ? 'selected' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(name);
              }}
            >
              <code>{`{${name}}`}</code>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
