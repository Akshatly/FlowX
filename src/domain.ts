import {
  initialWorkspace,
  uid,
  newRequest,
  type Entry,
  type Request,
  type TreeNode,
  type HttpResponse,
} from './model';
export type Variable = {
  id: string;
  name: string;
  value: string;
  type: 'text' | 'json' | 'number' | 'boolean' | 'date';
  secret: boolean;
  description: string;
  prompt?: boolean;
};
export type Output = {
  id: string;
  name: string;
  source: 'body' | 'headers' | 'status';
  path: string;
  mode: 'none' | 'transform' | 'map' | 'filter';
  script: string;
  missing: 'fail' | 'null';
  type: 'auto' | 'text' | 'json' | 'date';
  secret?: boolean;
};
export type FileData = { id: string; key: string; name: string; mime: string; bytes: number[] };
export type RichRequest = Request & {
  variables: Variable[];
  outputs: Output[];
  params: Entry[];
  bodyType: 'raw' | 'form' | 'multipart' | 'binary';
  fields: Entry[];
  binary?: { name: string; bytes: number[] };
  description: string;
  files: FileData[];
};
export type RichNode = TreeNode & { variables: Variable[] };
export type StepKind = 'start' | 'stop' | 'request' | 'timer' | 'view' | 'flow';
export type Step = {
  id: string;
  name: string;
  kind: StepKind;
  position: { x: number; y: number };
  request?: RichRequest;
  delay: number | string;
  template: string;
  flowId: string;
  inputs: Variable[];
};
export type Connection = { id: string; source: string; target: string };
export type Flow = {
  id: string;
  parentId: string;
  name: string;
  variables: Variable[];
  steps: Step[];
  edges: Connection[];
};
export type Store = {
  version: 2;
  nodes: RichNode[];
  requests: RichRequest[];
  flows: Flow[];
  samplesVersion?: 1;
};
export type StepStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
export type RunLog = {
  id: string;
  name: string;
  status: StepStatus;
  started: number;
  duration: number;
  message?: string;
  request?: { method: string; url: string; headers: [string, string][]; body: string };
  response?: HttpResponse;
  outputs?: Record<string, unknown>;
  view?: string;
};
export type Run = {
  id: string;
  targetId: string;
  name: string;
  started: number;
  logs: RunLog[];
  status: StepStatus;
};
export function variable(name = ''): Variable {
  return { id: uid(), name, value: '', type: 'text', secret: false, description: '' };
}
export function richRequest(parentId: string, name = 'Untitled request'): RichRequest {
  return {
    ...newRequest(parentId, name),
    variables: [],
    outputs: [],
    params: [],
    bodyType: 'raw',
    fields: [],
    files: [],
    description: '',
  };
}
export function upgrade(data: any): Store {
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.requests))
    throw new Error('Invalid workspace');
  return {
    version: 2,
    samplesVersion: data.samplesVersion === 1 ? 1 : undefined,
    nodes: data.nodes.map((n: any) => ({ ...n, variables: n.variables || [] })),
    requests: data.requests.map((r: any) => ({
      ...richRequest(r.parentId),
      ...r,
      variables: r.variables || [],
      outputs: r.outputs || [],
      params: r.params || [],
      fields: r.fields || [],
      files: r.files || [],
    })),
    flows: data.flows || [],
  };
}
export function seed(): Store {
  const store = upgrade(initialWorkspace);
  store.nodes[1].variables = [
    {
      ...variable('baseUrl'),
      value: 'https://jsonplaceholder.typicode.com',
      description: 'Sample API base URL',
    },
  ];
  store.requests[0].url = '{baseUrl}/posts/1';
  store.requests[0].outputs = [
    {
      id: uid(),
      name: 'postId',
      source: 'body',
      path: 'id',
      mode: 'none',
      script: 'return value;',
      missing: 'fail',
      type: 'auto',
    },
  ];
  const follow = richRequest('project', 'Get comments');
  follow.url = '{baseUrl}/posts/{Get a sample post.postId}/comments';
  store.requests.push(follow);
  const flow = newFlow('project', 'Sample workflow');
  const req = {
    ...newStep('request', 260, 120),
    name: 'Get post',
    request: structuredClone(store.requests[0]),
  };
  const view = {
    ...newStep('view', 520, 120),
    name: 'Post result',
    template: '{\n  "postId": "{Get post.postId}"\n}',
  };
  flow.steps.push(req, view);
  flow.edges = [
    { id: uid(), source: flow.steps[0].id, target: req.id },
    { id: uid(), source: req.id, target: view.id },
  ];
  store.flows.push(flow);
  return store;
}
export function newStep(kind: StepKind, x: number, y: number): Step {
  return {
    id: uid(),
    kind,
    name:
      kind === 'request'
        ? 'New request'
        : kind === 'flow'
          ? 'Another flow'
          : kind.charAt(0).toUpperCase() + kind.slice(1),
    position: { x, y },
    delay: 1000,
    template: '{}',
    flowId: '',
    inputs: [],
    ...(kind === 'request' ? { request: richRequest('') } : {}),
  };
}
export function newFlow(parentId: string, name: string): Flow {
  return {
    id: uid(),
    parentId,
    name,
    variables: [],
    steps: [newStep('start', 20, 120)],
    edges: [],
  };
}
export function ancestors(store: Store, parentId: string): RichNode[] {
  const result: RichNode[] = [];
  const seen = new Set<string>();
  let id: string | null = parentId;
  while (id) {
    if (seen.has(id)) throw new Error('Folder cycle');
    seen.add(id);
    const node = store.nodes.find((n) => n.id === id);
    if (!node) break;
    result.unshift(node);
    id = node.parentId;
  }
  return result;
}
export function safeStore(store: Store): Store {
  return {
    ...store,
    nodes: store.nodes.map((n) => ({
      ...n,
      variables: n.variables.map((v) => (v.secret ? { ...v, value: '' } : v)),
    })),
    requests: store.requests.map(safeRequest),
    flows: store.flows.map((f) => ({
      ...f,
      variables: f.variables.map((v) => (v.secret ? { ...v, value: '' } : v)),
      steps: f.steps.map((s) => ({
        ...s,
        inputs: s.inputs.map((v) => (v.secret ? { ...v, value: '' } : v)),
        request: s.request ? safeRequest(s.request) : undefined,
      })),
    })),
  };
}
function safeRequest(r: RichRequest): RichRequest {
  return {
    ...r,
    token: /^\{[\w][\w .-]*\}$/.test(r.token) ? r.token : '',
    password: /^\{[\w][\w .-]*\}$/.test(r.password) ? r.password : '',
    variables: r.variables.map((v) => (v.secret ? { ...v, value: '' } : v)),
  };
}
