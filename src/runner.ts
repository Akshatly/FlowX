import { uid, type HttpResponse } from './model';
import {
  type Store,
  type RichRequest,
  type Output,
  type Run,
  type RunLog,
  type Flow,
  type Variable,
} from './domain';
import {
  inherited,
  valuesOf,
  resolveRequest,
  requestReferences,
  resolveBody,
  substitute,
  resolveVariables,
  dependencyReferences,
  type Values,
} from './variables';
import { getPath, responseData } from './documents';
import { transform } from './transforms';
import { sendRequest } from './transport';
export type Sender = (request: RichRequest, signal?: AbortSignal) => Promise<HttpResponse>;
export type RunOptions = {
  signal?: AbortSignal;
  send?: Sender;
  onUpdate?: (run: Run) => void;
  prompt?: (variables: Variable[]) => Promise<Values>;
};
function check(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Execution cancelled', 'AbortError');
}
export async function extract(response: HttpResponse, outputs: Output[]): Promise<Values> {
  const result: Values = {};
  for (const output of outputs) {
    if (!output.name.trim()) throw new Error('Output variables need a name.');
    if (Object.hasOwn(result, output.name)) throw new Error(`Duplicate output ${output.name}`);
    const source =
      output.source === 'status'
        ? response.status
        : output.source === 'headers'
          ? Object.fromEntries(response.headers)
          : responseData(response.body);
    let value = getPath(source, output.path);
    if (value === undefined) {
      if (output.missing === 'fail')
        throw new Error(`Output ${output.name}: path ${output.path} was not found`);
      value = null;
    }
    result[output.name] = await transform(value, output);
  }
  return result;
}
export function dependencyOrder(store: Store, target: RichRequest): RichRequest[] {
  const peers = store.requests.filter((r) => r.parentId === target.parentId);
  const order: RichRequest[] = [];
  const visiting = new Set<string>();
  const complete = new Set<string>();
  const visit = (request: RichRequest, trail: string[]) => {
    if (complete.has(request.id)) return;
    if (visiting.has(request.id))
      throw new Error(`Dependency cycle: ${[...trail, request.name].join(' → ')}`);
    visiting.add(request.id);
    const vars = inherited(store, request.parentId, request.variables);
    for (const reference of dependencyReferences(request, vars)) {
      const producers = peers.filter((p) =>
        p.outputs.some((o) => `${p.name}.${o.name}` === reference),
      );
      if (producers.length > 1)
        throw new Error(`Ambiguous output {${reference}}. Give requests unique names.`);
      if (!producers.length) throw new Error(`Unknown variable {${reference}} in ${request.name}`);
      visit(producers[0], [...trail, request.name]);
    }
    visiting.delete(request.id);
    complete.add(request.id);
    order.push(request);
  };
  visit(target, []);
  return order;
}
export async function runRequest(
  store: Store,
  target: RichRequest,
  options: RunOptions = {},
): Promise<Run> {
  const order = dependencyOrder(store, target);
  const run: Run = {
    id: uid(),
    targetId: target.id,
    name: target.name,
    started: Date.now(),
    status: 'running',
    logs: order.map((r) => ({ id: r.id, name: r.name, status: 'queued', started: 0, duration: 0 })),
  };
  const values: Values = {};
  const emit = () => options.onUpdate?.(structuredClone(run));
  emit();
  for (let i = 0; i < order.length; i++) {
    const request = order[i];
    const log = run.logs[i];
    try {
      check(options.signal);
      log.status = 'running';
      log.started = Date.now();
      emit();
      const scoped = resolveVariables(
        inherited(store, request.parentId, request.variables),
        values,
        requestReferences(request),
      );
      const resolved = resolveRequest(request, scoped);
      log.request = {
        method: resolved.method,
        url: resolved.url,
        headers: resolved.headers.filter((h) => h.enabled).map((h) => [h.key, h.value]),
        body: resolved.bodyType === 'raw' ? resolved.body : JSON.stringify(resolved.fields),
      };
      const response = await (options.send || sendRequest)(resolved, options.signal);
      check(options.signal);
      log.response = response;
      if (response.status >= 400) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      log.outputs = await extract(response, request.outputs);
      check(options.signal);
      Object.entries(log.outputs).forEach(
        ([name, value]) => (values[`${request.name}.${name}`] = value),
      );
      log.status = 'succeeded';
      log.duration = Date.now() - log.started;
      emit();
    } catch (error) {
      log.status = options.signal?.aborted ? 'cancelled' : 'failed';
      log.message = error instanceof Error ? error.message : String(error);
      log.duration = log.started ? Date.now() - log.started : 0;
      run.logs.slice(i + 1).forEach((l) => (l.status = 'skipped'));
      run.status = log.status;
      emit();
      return run;
    }
  }
  run.status = 'succeeded';
  emit();
  return run;
}
export function validateFlow(store: Store, flow: Flow, trail: string[] = []): void {
  if (trail.includes(flow.id)) throw new Error('Recursive flow calls are not allowed.');
  const start = flow.steps.filter((s) => s.kind === 'start');
  if (start.length !== 1) throw new Error('A flow needs exactly one Start step.');
  const ids = new Set(flow.steps.map((s) => s.id));
  const names = new Set<string>();
  for (const step of flow.steps) {
    if (!step.name.trim() || names.has(step.name))
      throw new Error('Each step needs a unique name.');
    names.add(step.name);
  }
  for (const edge of flow.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target))
      throw new Error('A connector targets a missing step.');
    if (edge.target === start[0].id) throw new Error('Start cannot have incoming connections.');
  }
  for (const step of flow.steps) {
    if (step.kind === 'stop' && flow.edges.some((e) => e.source === step.id))
      throw new Error('Stop cannot have outgoing connections.');
    if (
      step.kind === 'timer' &&
      typeof step.delay === 'number' &&
      (!Number.isFinite(step.delay) || step.delay < 0)
    )
      throw new Error('Timer needs a non-negative duration.');
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) throw new Error('Flow contains a cycle. Loops are not supported yet.');
    if (visited.has(id)) return;
    active.add(id);
    flow.edges.filter((e) => e.source === id).forEach((e) => visit(e.target));
    active.delete(id);
    visited.add(id);
  };
  visit(start[0].id);
  if (visited.size !== flow.steps.length) throw new Error('Connect every step to Start.');
  flow.steps
    .filter((s) => s.kind === 'flow')
    .forEach((step) => {
      const nested = store.flows.find((f) => f.id === step.flowId);
      if (!nested) throw new Error(`Choose a flow for ${step.name}`);
      validateFlow(store, nested, [...trail, flow.id]);
    });
}
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    check(signal);
    const done = () => {
      signal.removeEventListener('abort', cancel);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', cancel, { once: true });
  });
}
export async function runFlow(
  store: Store,
  flow: Flow,
  options: RunOptions = {},
  provided: Values = {},
  trail: string[] = [],
): Promise<Run> {
  validateFlow(store, flow, trail);
  const controller = new AbortController();
  const forward = () => controller.abort();
  options.signal?.addEventListener('abort', forward, { once: true });
  if (options.signal?.aborted) controller.abort();
  const run: Run = {
    id: uid(),
    targetId: flow.id,
    name: flow.name,
    started: Date.now(),
    status: 'running',
    logs: flow.steps.map((s) => ({
      id: s.id,
      name: s.name,
      status: 'queued',
      started: 0,
      duration: 0,
    })),
  };
  const emit = () => options.onUpdate?.(structuredClone(run));
  let stopped = false;
  let failed = false;
  emit();
  try {
    const prompts = flow.variables.filter((v) => v.prompt && !Object.hasOwn(provided, v.name));
    let answers: Values = {};
    if (prompts.length) {
      if (!options.prompt) throw new Error('Flow inputs require a prompt handler');
      answers = await options.prompt(prompts);
    }
    const base = {
      ...resolveVariables(
        inherited(
          store,
          flow.parentId,
          flow.variables.filter((v) => !v.prompt),
        ),
        { ...provided, ...answers },
      ),
      ...provided,
      ...answers,
    };
    const stepValues: Record<string, Values> = {};
    const completed = new Set<string>();
    const predecessors = (id: string): string[] => {
      const result = new Set<string>();
      const walk = (child: string) =>
        flow.edges
          .filter((e) => e.target === child)
          .forEach((e) => {
            if (!result.has(e.source)) {
              result.add(e.source);
              walk(e.source);
            }
          });
      walk(id);
      return [...result];
    };
    const scheduled = new Set<string>();
    const tasks = new Map<string, Promise<void>>();
    while (completed.size < flow.steps.length) {
      check(controller.signal);
      const ready = flow.steps.filter(
        (s) =>
          !scheduled.has(s.id) &&
          flow.edges.filter((e) => e.target === s.id).every((e) => completed.has(e.source)),
      );
      if (!ready.length && !tasks.size) throw new Error('No executable steps remain.');
      ready.forEach((step) => {
        scheduled.add(step.id);
        const task = (async () => {
          const log = run.logs.find((l) => l.id === step.id)!;
          try {
            check(controller.signal);
            log.status = 'running';
            log.started = Date.now();
            emit();
            const inputs = { ...base };
            predecessors(step.id).forEach((id) => Object.assign(inputs, stepValues[id]));
            const mapped: Values = resolveVariables(
              step.inputs.filter((v) => !v.prompt),
              inputs,
            );
            const promptVars = step.inputs.filter((v) => v.prompt);
            if (promptVars.length) {
              if (!options.prompt) throw new Error('Step needs a prompt handler');
              Object.assign(mapped, await options.prompt(promptVars));
            }
            const scope = { ...inputs, ...mapped };
            let output: Values = {};
            if (step.kind === 'request') {
              if (!step.request) throw new Error('Configure a request for this step');
              const resolved = resolveRequest(
                step.request,
                resolveVariables(step.request.variables, scope, requestReferences(step.request)),
              );
              log.request = {
                method: resolved.method,
                url: resolved.url,
                headers: resolved.headers.filter((h) => h.enabled).map((h) => [h.key, h.value]),
                body: resolved.bodyType === 'raw' ? resolved.body : JSON.stringify(resolved.fields),
              };
              const response = await (options.send || sendRequest)(resolved, controller.signal);
              log.response = response;
              if (response.status >= 400)
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
              output = await extract(response, step.request.outputs);
            } else if (step.kind === 'timer') {
              const ms = Number(substitute(String(step.delay), scope));
              if (!Number.isFinite(ms) || ms < 0 || ms > 2147483647)
                throw new Error('Timer needs a duration from 0 to 2147483647 ms');
              await delay(ms, controller.signal);
            } else if (step.kind === 'view') {
              log.view = resolveBody(step.template, 'json', scope);
              output = { value: JSON.parse(log.view) };
            } else if (step.kind === 'flow') {
              const nested = store.flows.find((f) => f.id === step.flowId)!;
              const nestedRun = await runFlow(
                store,
                nested,
                { ...options, signal: controller.signal, onUpdate: undefined },
                mapped,
                [...trail, flow.id],
              );
              if (nestedRun.status !== 'succeeded')
                throw new Error(
                  `Nested flow failed: ${nestedRun.logs.find((l) => l.status === 'failed')?.message || nestedRun.status}`,
                );
              output = Object.fromEntries(
                nestedRun.logs.filter((l) => l.view).map((l) => [l.name, JSON.parse(l.view!)]),
              );
              log.message = `Nested flow: ${nestedRun.logs.length} steps`;
            } else if (step.kind === 'stop') {
              stopped = true;
              controller.abort();
            }
            if (!stopped) check(controller.signal);
            log.outputs = output;
            stepValues[step.id] = Object.fromEntries(
              Object.entries(output).map(([key, value]) => [`${step.name}.${key}`, value]),
            );
            log.status = 'succeeded';
            completed.add(step.id);
          } catch (error) {
            log.status = controller.signal.aborted ? 'cancelled' : 'failed';
            log.message = error instanceof Error ? error.message : String(error);
            if (log.status === 'failed') {
              failed = true;
              controller.abort();
            }
          } finally {
            log.duration = log.started ? Date.now() - log.started : 0;
            emit();
          }
        })().finally(() => tasks.delete(step.id));
        tasks.set(step.id, task);
      });
      if (tasks.size) await Promise.race(tasks.values());
      if (stopped || failed || controller.signal.aborted) {
        await Promise.allSettled(tasks.values());
        break;
      }
    }
    run.status = failed
      ? 'failed'
      : stopped
        ? 'succeeded'
        : controller.signal.aborted
          ? 'cancelled'
          : 'succeeded';
  } catch (error) {
    run.status = options.signal?.aborted ? 'cancelled' : 'failed';
    const log = run.logs.find((l) => l.status === 'queued');
    if (log) {
      log.status = run.status;
      log.message = error instanceof Error ? error.message : String(error);
    }
  } finally {
    run.logs.filter((l) => l.status === 'queued').forEach((l) => (l.status = 'skipped'));
    options.signal?.removeEventListener('abort', forward);
    emit();
  }
  return run;
}
