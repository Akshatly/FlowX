import { useState, useMemo, useRef, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  useReactFlow,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Play, Square, Plus, Trash2 } from 'lucide-react';
import {
  newStep,
  richRequest,
  type Flow,
  type Store,
  type Step,
  type StepKind,
  type Run,
} from '../domain';
import { uid } from '../model';
import { visiblePosition } from '../canvas';
import Variables from './Variables';
import RequestWorkspace from './RequestWorkspace';
import DocumentEditor from './DocumentEditor';
import VariableInput, { Suggestions, Highlight } from './VariableInput';
import { inherited } from '../variables';
import RunConsole from './RunConsole';
import { validateFlow } from '../runner';
const kinds: { kind: StepKind; label: string; hint: string }[] = [
  { kind: 'start', label: 'Start', hint: 'Entry point' },
  { kind: 'stop', label: 'Stop', hint: 'End the entire run' },
  { kind: 'request', label: 'New request', hint: 'An API call' },
  { kind: 'timer', label: 'Timer', hint: 'Wait before continuing' },
  { kind: 'view', label: 'View', hint: 'Display structured results' },
  { kind: 'flow', label: 'Another flow', hint: 'Run a nested workflow' },
];
function StepCard({ data }: NodeProps<Node<{ step: Step; status?: string }>>) {
  return (
    <div className={`flow-node ${data.step.kind} ${data.status || ''}`}>
      {data.step.kind !== 'start' && <Handle type="target" position={Position.Left} />}
      <span className="flow-node-kind">{data.step.kind.toUpperCase()}</span>
      <strong>{data.step.name}</strong>
      <span className="muted">
        {
          <Highlight
            value={
              data.status ||
              (data.step.kind === 'request'
                ? data.step.request?.method + ' ' + (data.step.request?.url || 'Configure request')
                : data.step.kind === 'timer'
                  ? `${data.step.delay} ms`
                  : data.step.kind === 'view'
                    ? 'Structured output'
                    : '')
            }
          />
        }
      </span>
      {data.step.kind !== 'stop' && <Handle type="source" position={Position.Right} />}
    </div>
  );
}
const nodeTypes = { step: StepCard };
export default function FlowDesigner(props: {
  flow: Flow;
  store: Store;
  onChange: (flow: Flow) => void;
  theme: 'dark' | 'light';
  onRun: () => void;
  onCancel: () => void;
  run?: Run;
  busy: boolean;
}) {
  return (
    <ReactFlowProvider>
      <Designer {...props} />
    </ReactFlowProvider>
  );
}
function Designer({
  flow,
  store,
  onChange,
  theme,
  onRun,
  onCancel,
  run,
  busy,
}: {
  flow: Flow;
  store: Store;
  onChange: (flow: Flow) => void;
  theme: 'dark' | 'light';
  onRun: () => void;
  onCancel: () => void;
  run?: Run;
  busy: boolean;
}) {
  const [measurements, setMeasurements] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const [selected, setSelected] = useState<string>();
  const [panel, setPanel] = useState<'step' | 'variables'>('step');
  const reactFlow = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const centerPosition = () => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    return bounds
      ? reactFlow.screenToFlowPosition({
          x: bounds.left + bounds.width / 2 - 95,
          y: bounds.top + bounds.height / 2 - 55,
        })
      : { x: 40, y: 40 };
  };
  const step = flow.steps.find((s) => s.id === selected);
  const update = (patch: Partial<Step>) =>
    onChange({
      ...flow,
      steps: flow.steps.map((s) => (s.id === selected ? { ...s, ...patch } : s)),
    });
  const nodes = useMemo(
    () =>
      flow.steps.map((s) => ({
        id: s.id,
        type: 'step',
        position: s.position,
        data: { step: s, status: run?.logs.find((l) => l.id === s.id)?.status },
        selected: s.id === selected,
        width: 190,
        height: 110,
        measured: measurements[s.id] || { width: 190, height: 110 },
      })),
    [flow, run, selected, measurements],
  );
  const edges = flow.edges.map((e) => ({
    ...e,
    animated: run?.logs.find((l) => l.id === e.source)?.status === 'running',
  }));
  const names = [
    ...inherited(store, flow.parentId, flow.variables).map((v) => v.name),
    ...(step?.inputs.map((v) => v.name) || []),
    ...(step?.request?.variables.map((v) => v.name) || []),
    ...flow.steps.flatMap((s) =>
      s.kind === 'request'
        ? s.request?.outputs.map((o) => `${s.name}.${o.name}`) || []
        : s.kind === 'view'
          ? [`${s.name}.value`]
          : s.kind === 'flow'
            ? store.flows
                .find((f) => f.id === s.flowId)
                ?.steps.filter((n) => n.kind === 'view')
                .map((n) => `${s.name}.${n.name}`) || []
            : [],
    ),
  ];
  function insert(kind: StepKind, position: { x: number; y: number }, requestId?: string) {
    position = visiblePosition(position, flow.steps);
    const added = newStep(kind, position.x, position.y);
    if (requestId) {
      const original = store.requests.find((r) => r.id === requestId);
      if (original) {
        added.request = structuredClone(original);
        added.request.id = uid();
        added.request.variables = inherited(store, original.parentId, original.variables);
        added.request.parentId = flow.parentId;
        added.name = original.name;
      }
    }
    const count = flow.steps.filter((s) => s.name.startsWith(added.name)).length;
    if (count) added.name += ` ${count + 1}`;
    if (added.request && !added.request.parentId) added.request = richRequest(flow.parentId);
    onChange({ ...flow, steps: [...flow.steps, added] });
    setSelected(added.id);
    setPanel('step');
  }
  useEffect(() => {
    if (!selected) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        void reactFlow.fitView({
          nodes: [{ id: selected }],
          padding: 0.35,
          minZoom: 1,
          maxZoom: 1,
          duration: 150,
        });
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [selected, reactFlow]);
  let validation = '';
  try {
    validateFlow(store, flow);
  } catch (e) {
    validation = e instanceof Error ? e.message : String(e);
  }
  return (
    <Suggestions.Provider value={names}>
      <div className="flow-workspace">
        <div className="workspace-heading">
          <div>
            <div className="breadcrumb">
              {store.nodes.find((n) => n.id === flow.parentId)?.name} / Flow
            </div>
            <input
              className="request-name"
              aria-label="Flow name"
              value={flow.name}
              onChange={(e) => onChange({ ...flow, name: e.target.value })}
            />
          </div>
          <div className="flow-actions">
            <button
              className="subtle-button"
              onClick={() => setPanel(panel === 'variables' ? 'step' : 'variables')}
            >
              Flow inputs & variables
            </button>
            <button className="send" onClick={busy ? onCancel : onRun}>
              {busy ? (
                <>
                  <Square size={14} /> Cancel
                </>
              ) : (
                <>
                  <Play size={14} /> Run flow
                </>
              )}
            </button>
          </div>
        </div>
        <div className="flow-help">
          Drag steps or existing requests onto the canvas. Connect handles to set execution order.
          Multiple outgoing connections run in parallel; joins wait for every predecessor.
          {validation && <span className="failure"> Validation: {validation}</span>}
        </div>
        <div className="flow-body">
          <div className="step-palette">
            <strong>STEPS</strong>
            {kinds.map((k) => (
              <button
                key={k.kind}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'copy';
                  e.dataTransfer.setData('application/flowx', JSON.stringify({ kind: k.kind }));
                  e.dataTransfer.setData('text/plain', JSON.stringify({ kind: k.kind }));
                }}
                onClick={() => insert(k.kind, centerPosition())}
              >
                <Plus size={13} />
                <span>
                  {k.label}
                  <small>{k.hint}</small>
                </span>
              </button>
            ))}
            <strong>EXISTING REQUESTS</strong>
            {store.requests.map((r) => (
              <button
                draggable
                key={r.id}
                onDragStart={(e) =>
                  e.dataTransfer.setData(
                    'application/flowx',
                    JSON.stringify({ kind: 'request', requestId: r.id }),
                  )
                }
                onClick={() => insert('request', centerPosition(), r.id)}
              >
                <span className="method-label">{r.method}</span>
                {r.name}
              </button>
            ))}
          </div>
          <div
            ref={canvasRef}
            className="flow-canvas"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={(e) => {
              e.preventDefault();
              const raw =
                e.dataTransfer.getData('application/flowx') || e.dataTransfer.getData('text/plain');
              if (!raw) return;
              try {
                const data = JSON.parse(raw);
                if (kinds.some((k) => k.kind === data.kind))
                  insert(
                    data.kind,
                    reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
                    data.requestId,
                  );
              } catch {}
            }}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={(changes) => {
                const dimensions = changes.filter((c) => c.type === 'dimensions');
                if (dimensions.length)
                  setMeasurements((previous) => {
                    const next = { ...previous };
                    let changed = false;
                    dimensions.forEach((c) => {
                      if (
                        c.type === 'dimensions' &&
                        c.dimensions &&
                        (previous[c.id]?.width !== c.dimensions.width ||
                          previous[c.id]?.height !== c.dimensions.height)
                      ) {
                        next[c.id] = c.dimensions;
                        changed = true;
                      }
                    });
                    return changed ? next : previous;
                  });
                const persisted = changes.filter(
                  (c) => c.type === 'position' || c.type === 'remove',
                );
                if (!persisted.length) return;
                const next = applyNodeChanges(persisted, nodes);
                onChange({
                  ...flow,
                  steps: flow.steps
                    .filter((s) => next.some((n) => n.id === s.id))
                    .map((s) => ({ ...s, position: next.find((n) => n.id === s.id)!.position })),
                  edges: flow.edges.filter(
                    (e) =>
                      next.some((n) => n.id === e.source) && next.some((n) => n.id === e.target),
                  ),
                });
              }}
              onEdgesChange={(changes) => {
                const persisted = changes.filter((c) => c.type !== 'select');
                if (!persisted.length) return;
                onChange({
                  ...flow,
                  edges: applyEdgeChanges(persisted, edges).map(({ id, source, target }) => ({
                    id,
                    source,
                    target,
                  })),
                });
              }}
              onConnect={(connection) => {
                if (
                  !connection.source ||
                  !connection.target ||
                  connection.source === connection.target
                )
                  return;
                onChange({ ...flow, edges: addEdge({ ...connection, id: uid() }, flow.edges) });
              }}
              onNodeClick={(_, node) => {
                setSelected(node.id);
                setPanel('step');
              }}
              fitView
              colorMode={theme}
            >
              <Background />
              <Controls />
              <MiniMap pannable zoomable />
            </ReactFlow>
          </div>
          {(step || panel === 'variables') && (
            <div className="step-inspector">
              {panel === 'variables' ? (
                <>
                  <h3>Flow inputs & variables</h3>
                  <Variables
                    variables={flow.variables}
                    inherited={inherited(store, flow.parentId)}
                    onChange={(variables) => onChange({ ...flow, variables })}
                    prompts
                  />
                </>
              ) : (
                step && (
                  <>
                    <div className="inspector-heading">
                      <h3>Step settings</h3>
                      <button
                        className="icon"
                        title="Delete step"
                        onClick={() => {
                          onChange({
                            ...flow,
                            steps: flow.steps.filter((s) => s.id !== step.id),
                            edges: flow.edges.filter(
                              (e) => e.source !== step.id && e.target !== step.id,
                            ),
                          });
                          setSelected(undefined);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <label>
                      Step name
                      <input value={step.name} onChange={(e) => update({ name: e.target.value })} />
                    </label>
                    {step.kind === 'request' && step.request && (
                      <RequestWorkspace
                        compact
                        request={step.request}
                        store={store}
                        theme={theme}
                        response={run?.logs.find((l) => l.id === step.id)?.response}
                        onChange={(request) => update({ request })}
                      />
                    )}{' '}
                    {step.kind === 'timer' && (
                      <label>
                        Wait duration (milliseconds)
                        <VariableInput
                          value={step.delay}
                          placeholder="1000 or {delayMs}"
                          onChange={(e) => update({ delay: e.target.value })}
                        />
                      </label>
                    )}
                    {step.kind === 'view' && (
                      <>
                        <p className="muted">
                          Create JSON using outputs such as <code>{'{Get post.postId}'}</code>.
                          Complete placeholders preserve data types.
                        </p>
                        <div className="view-template">
                          <DocumentEditor
                            value={step.template}
                            onChange={(template) => update({ template })}
                            format="json"
                            theme={theme}
                          />
                        </div>
                      </>
                    )}
                    {step.kind === 'flow' && (
                      <label>
                        Flow to run
                        <select
                          value={step.flowId}
                          onChange={(e) => update({ flowId: e.target.value })}
                        >
                          <option value="">Choose a flow</option>
                          {store.flows
                            .filter((f) => f.id !== flow.id)
                            .map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    {step.kind === 'stop' && (
                      <p className="muted">
                        Stop ends the entire flow and cancels active parallel branches.
                      </p>
                    )}
                    <details>
                      <summary>Step inputs & prompts</summary>
                      <Variables
                        variables={step.inputs}
                        onChange={(inputs) => update({ inputs })}
                        prompts
                      />
                    </details>
                  </>
                )
              )}
            </div>
          )}
        </div>
        <RunConsole
          run={run}
          theme={theme}
          onSelect={(id) => {
            setSelected(id);
            setPanel('step');
          }}
        />
      </div>
    </Suggestions.Provider>
  );
}
