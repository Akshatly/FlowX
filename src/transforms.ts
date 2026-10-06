import { newQuickJSWASMModule, newVariant, RELEASE_SYNC } from 'quickjs-emscripten';
import wasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url';
import type { Output } from './domain';
let enginePromise: ReturnType<typeof newQuickJSWASMModule> | undefined;
function getEngine() {
  return (enginePromise ??= newQuickJSWASMModule(
    typeof window === 'undefined'
      ? RELEASE_SYNC
      : newVariant(RELEASE_SYNC, { wasmLocation: wasmUrl }),
  ));
}
export async function transform(value: unknown, output: Output): Promise<unknown> {
  let result = value;
  if (output.mode !== 'none') {
    const engine = await getEngine();
    const runtime = engine.newRuntime();
    runtime.setMemoryLimit(16 * 1024 * 1024);
    runtime.setMaxStackSize(512 * 1024);
    const deadline = Date.now() + 200;
    runtime.setInterruptHandler(() => Date.now() > deadline);
    const context = runtime.newContext();
    try {
      const input = JSON.stringify(value);
      if (input === undefined) throw new Error('Cannot transform a missing value.');
      const program = `const value = ${input}; const transform = (value, item, index) => { ${output.script}\n }; JSON.stringify(${output.mode === 'map' ? 'value.map((item,index)=>transform(value,item,index))' : output.mode === 'filter' ? 'value.filter((item,index)=>transform(value,item,index))' : 'transform(value,value,0)'})`;
      if ((output.mode === 'map' || output.mode === 'filter') && !Array.isArray(value))
        throw new Error('Map and filter require a list.');
      const evaluation = context.evalCode(program);
      if (evaluation.error) {
        const error = context.dump(evaluation.error);
        evaluation.error.dispose();
        throw new Error(error.message || String(error));
      }
      const encoded = context.dump(evaluation.value);
      evaluation.value.dispose();
      if (encoded === undefined) throw new Error('Your script must return a value.');
      result = JSON.parse(encoded);
    } finally {
      context.dispose();
      runtime.dispose();
    }
  }
  if (output.type === 'date') {
    const date = new Date(String(result));
    if (Number.isNaN(date.getTime())) throw new Error('Output is not a valid date');
    return date.toISOString();
  }
  if (output.type === 'text') return typeof result === 'string' ? result : JSON.stringify(result);
  if (output.type === 'json' && typeof result === 'string') return JSON.parse(result);
  return result;
}
