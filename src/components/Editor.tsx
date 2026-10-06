import { useContext, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { javascript } from '@codemirror/lang-javascript';
import { autocompletion } from '@codemirror/autocomplete';
import { EditorView, ViewPlugin, MatchDecorator, Decoration } from '@codemirror/view';
const variableMatcher = new MatchDecorator({
  regexp: /\{[A-Za-z_][\w .-]*\}/g,
  decoration: Decoration.mark({ class: 'variable-token' }),
});
const variableHighlight = ViewPlugin.fromClass(
  class {
    decorations;
    constructor(view: EditorView) {
      this.decorations = variableMatcher.createDeco(view);
    }
    update(update: import('@codemirror/view').ViewUpdate) {
      this.decorations = variableMatcher.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
import { Suggestions } from './VariableInput';
export default function Editor({
  value,
  onChange,
  format,
  theme,
  readOnly = false,
}: {
  value: string;
  onChange?: (value: string) => void;
  format: string;
  theme: 'dark' | 'light';
  readOnly?: boolean;
}) {
  const names = useContext(Suggestions);
  const extensions = useMemo(
    () => [
      ...(format === 'json'
        ? [json()]
        : format === 'xml'
          ? [xml()]
          : format === 'javascript'
            ? [javascript()]
            : []),
      EditorView.lineWrapping,
      variableHighlight,
      autocompletion({
        override: [
          (context) => {
            const match = context.matchBefore(/\{[\w .-]*/);
            if (!match) return null;
            return {
              from: match.from,
              options: names.map((name) => ({
                label: `{${name}}`,
                type: 'variable',
                apply: `{${name}}`,
              })),
              validFor: /^\{[\w .-]*$/,
            };
          },
        ],
      }),
    ],
    [format, names],
  );
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme={theme}
      extensions={extensions}
      readOnly={readOnly}
      height="100%"
      basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly }}
    />
  );
}
