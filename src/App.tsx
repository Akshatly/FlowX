import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  MoreHorizontal,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Layers,
  Moon,
  Plus,
  Sun,
  X,
  Braces,
  Settings2,
  Workflow,
  Trash2,
  Upload,
  Download,
  History,
  HelpCircle,
} from 'lucide-react';
import { duplicateItem, exportItem, importInto } from './treeActions';
import { uid } from './model';
import {
  seed,
  richRequest,
  newFlow,
  safeStore,
  type Store,
  type RichRequest,
  type RichNode,
  type Run,
  type Variable,
  type Flow,
} from './domain';
import { inherited, valuesOf, type Values } from './variables';
import { runRequest, runFlow } from './runner';
import { updateRequest, updateFlow } from './references';
import { loadStore, saveStore } from './persistence';
import { importJson } from './migration';
import { download, exportXml, importXml, exportCurl, importCurl, mergeStore } from './interchange';
import RequestWorkspace from './components/RequestWorkspace';
import FlowDesigner from './components/FlowDesigner';
import Variables from './components/Variables';
import RunConsole from './components/RunConsole';
import VariableInput, { Suggestions } from './components/VariableInput';
import type { HttpResponse } from './model';
function redact(run: Run, store: Store): Run {
  const secrets = [
    ...store.nodes.flatMap((n) => n.variables),
    ...store.requests.flatMap((r) => r.variables),
    ...store.flows.flatMap((f) => [...f.variables, ...f.steps.flatMap((s) => s.inputs)]),
  ]
    .filter((v) => v.secret && v.value)
    .map((v) => v.value);
  store.requests.forEach((r) => {
    if (r.token) secrets.push(r.token);
    if (r.password) secrets.push(r.password);
  });
  store.flows.forEach((f) =>
    f.steps.forEach((s) => {
      if (s.request?.token) secrets.push(s.request.token);
      if (s.request?.password) secrets.push(s.request.password);
    }),
  );
  run.logs.forEach((log) => {
    const req =
      store.requests.find((r) => r.id === log.id) ||
      store.flows.flatMap((f) => f.steps).find((s) => s.id === log.id)?.request;
    req?.outputs
      .filter((o) => o.secret)
      .forEach((o) => {
        const v = log.outputs?.[o.name];
        if (v !== undefined && v !== null)
          secrets.push(typeof v === 'string' ? v : JSON.stringify(v));
      });
  });
  const walk = (value: any): any =>
    typeof value === 'string'
      ? secrets.reduce((v, s) => v.split(s).join('••••••'), value)
      : Array.isArray(value)
        ? value.length === 2 &&
          typeof value[0] === 'string' &&
          /^(authorization|cookie|set-cookie)$/i.test(value[0])
          ? [value[0], '••••••']
          : value.map(walk)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value).map(([k, v]) => [
                k,
                /^(authorization|cookie|set-cookie|password|token|secret)$/i.test(k)
                  ? '••••••'
                  : walk(v),
              ]),
            )
          : value;
  return walk(run);
}
export default function App() {
  const [store, setStore] = useState<Store>(seed);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState('');
  const [tabs, setTabs] = useState<string[]>([]);
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('flowx.theme') === 'light' ? 'light' : 'dark',
  );
  const [width, setWidth] = useState(264);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [itemMenu, setItemMenu] = useState<string>();
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [importTarget, setImportTarget] = useState<string>();
  const [sidebarTab, setSidebarTab] = useState<'collections' | 'flows'>('collections');
  const [search, setSearch] = useState('');
  const [responses, setResponses] = useState<Record<string, HttpResponse>>({});
  const [runs, setRuns] = useState<Run[]>([]);
  const [currentRun, setCurrentRun] = useState<Run>();
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('Loading workspace…');
  const saves = useRef(Promise.resolve());
  const [creation, setCreation] = useState<{
    parent?: RichNode;
    kind: 'folder' | 'project' | 'request' | 'flow';
  }>();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<string>();
  const [help, setHelp] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [undo, setUndo] = useState<Store>();
  const [transfer, setTransfer] = useState<'import' | 'curl' | 'export'>();
  const [text, setText] = useState('');
  const [incoming, setIncoming] = useState<Store>();
  const [importError, setImportError] = useState('');
  const [targetProject, setTargetProject] = useState('');
  const promptQueue = useRef(Promise.resolve());
  const [prompt, setPrompt] = useState<{
    variables: Variable[];
    resolve: (values: Values) => void;
    reject: (error: Error) => void;
  }>();
  const [answers, setAnswers] = useState<Variable[]>([]);
  const request = store.requests.find((r) => r.id === activeId);
  const flow = store.flows.find((f) => f.id === activeId);
  const selectedScope = store.nodes.find((n) => n.id === scope);
  const names = [
    ...new Set([
      ...(request ? inherited(store, request.parentId, request.variables).map((v) => v.name) : []),
      ...store.requests
        .filter((r) => r.parentId === request?.parentId)
        .flatMap((r) => r.outputs.map((o) => `${r.name}.${o.name}`)),
    ]),
  ];
  useEffect(() => {
    let cancelled = false;
    void loadStore()
      .then(async (data) => {
        if (cancelled) return;
        setStore(data);
        const id = data.requests[0]?.id || data.flows[0]?.id || '';
        setActiveId(id);
        setTabs(id ? [id] : []);
        setLoaded(true);
        setSaving('Saved on this device');
        try {
          const previous = isTauri()
            ? (await invoke<string[]>('load_runs')).map((v) => JSON.parse(v))
            : JSON.parse(localStorage.getItem('flowx.runs') || '[]');
          setRuns(previous);
        } catch (e) {
          setError('Run history could not be loaded: ' + String(e));
        }
      })
      .catch((e) => {
        setError('Workspace could not be loaded: ' + String(e));
        setSaving('Load failed — existing data preserved');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('flowx.theme', theme);
  }, [theme]);
  useEffect(() => {
    if (!loaded) return;
    setSaving('Saving…');
    const timer = setTimeout(() => {
      saves.current = saves.current
        .catch(() => {})
        .then(() => saveStore(store))
        .then(() => setSaving('Saved on this device'))
        .catch((e) => setSaving('Save failed: ' + String(e)));
    }, 350);
    return () => clearTimeout(timer);
  }, [store, loaded]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!itemMenu) return;
    const outside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest('.item-menu, .item-menu-trigger')
      )
        setItemMenu(undefined);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const trigger = document.querySelector<HTMLButtonElement>(
        '.item-menu-trigger[aria-expanded="true"]',
      );
      setItemMenu(undefined);
      trigger?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape);
    };
  }, [itemMenu]);

  function open(id: string) {
    setActiveId(id);
    if (store.flows.some((f) => f.id === id)) {
      if (sidebarTab !== 'flows') setSearch('');
      setSidebarTab('flows');
    } else if (store.requests.some((r) => r.id === id)) {
      if (sidebarTab !== 'collections') setSearch('');
      setSidebarTab('collections');
    }
    setTabs((t) => (t.includes(id) ? t : [...t, id]));
    setShowHistory(false);
    setError('');
    setCurrentRun(runs.find((r) => r.targetId === id));
  }
  function changeRequest(next: RichRequest) {
    setStore((s) => updateRequest(s, next));
  }
  function create() {
    if (!creation || !name.trim()) return;
    const { parent, kind } = creation;
    if (kind === 'folder' || kind === 'project') {
      if (parent?.kind === 'project' || (!parent && kind === 'project')) return;
      setStore((s) => ({
        ...s,
        nodes: [
          ...s.nodes,
          { id: uid(), name: name.trim(), parentId: parent?.id || null, kind, variables: [] },
        ],
      }));
    } else {
      if (parent?.kind !== 'project') return;
      if (kind === 'request') {
        const r = richRequest(parent.id, name.trim());
        setStore((s) => ({ ...s, requests: [...s.requests, r] }));
        setSidebarTab('collections');
        setSearch('');
        open(r.id);
      } else {
        const f = newFlow(parent.id, name.trim());
        setStore((s) => ({ ...s, flows: [...s.flows, f] }));
        setSidebarTab('flows');
        setSearch('');
        open(f.id);
      }
    }
    setCollapsed((c) => c.filter((id) => id !== `collections:${parent?.id}`));
    setCreation(undefined);
    setName('');
  }
  function remove(id: string) {
    setUndo(structuredClone(store));
    const descendants = new Set([id]);
    let size = 0;
    while (size !== descendants.size) {
      size = descendants.size;
      store.nodes.forEach((n) => {
        if (n.parentId && descendants.has(n.parentId)) descendants.add(n.id);
      });
    }
    store.requests.forEach((r) => {
      if (descendants.has(r.parentId)) descendants.add(r.id);
    });
    store.flows.forEach((f) => {
      if (descendants.has(f.parentId)) descendants.add(f.id);
    });
    setStore((s) => ({
      ...s,
      nodes: s.nodes.filter((n) => !descendants.has(n.id)),
      requests: s.requests.filter((r) => !descendants.has(r.id)),
      flows: s.flows.filter((f) => !descendants.has(f.id)),
    }));
    setTabs((t) => t.filter((id) => !descendants.has(id)));
    if (descendants.has(activeId)) setActiveId('');
  }
  async function ask(variables: Variable[]): Promise<Values> {
    const next = promptQueue.current
      .catch(() => {})
      .then(
        () =>
          new Promise<Values>((resolve, reject) => {
            if (controller.current?.signal.aborted) {
              reject(new Error('Execution cancelled'));
              return;
            }
            setAnswers(variables.map((v) => ({ ...v })));
            setPrompt({ variables, resolve, reject });
          }),
      );
    promptQueue.current = next.then(
      () => {},
      () => {},
    );
    return next;
  }
  async function execute() {
    if (busy || (!request && !flow)) return;
    const snapshot = structuredClone(store);
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setCurrentRun(undefined);
    const onUpdate = (run: Run) => {
      setCurrentRun(redact(run, snapshot));
      run.logs.forEach((log) => {
        if (log.response && snapshot.requests.some((r) => r.id === log.id))
          setResponses((rs) => ({ ...rs, [log.id]: log.response! }));
      });
    };
    try {
      const run = request
        ? await runRequest(snapshot, request, { signal: abort.signal, onUpdate })
        : await runFlow(snapshot, flow!, { signal: abort.signal, onUpdate, prompt: ask });
      const safe = redact(run, snapshot);
      setRuns((previous) => [safe, ...previous].slice(0, 100));
      setCurrentRun(safe);
      if (isTauri()) await invoke('save_run', { data: JSON.stringify(safe) });
      else localStorage.setItem('flowx.runs', JSON.stringify([safe, ...runs].slice(0, 30)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      controller.current = undefined;
    }
  }
  function cancel() {
    controller.current?.abort();
    if (prompt) {
      prompt.reject(new Error('Cancelled by user'));
      setPrompt(undefined);
    }
  }
  function beginImport(targetId?: string) {
    const item =
      store.requests.find((r) => r.id === targetId) || store.flows.find((f) => f.id === targetId);
    const target = item?.parentId || targetId;
    setImportTarget(target);
    setTargetProject(
      store.nodes.find((n) => n.id === target && n.kind === 'project')?.id ||
        store.nodes.find((n) => n.kind === 'project')?.id ||
        '',
    );
    setTransfer('import');
    setIncoming(undefined);
    setImportError('');
    setText('');
    setItemMenu(undefined);
  }
  function menu(id: string, section = 'requests') {
    const menuKey = `${section}:${id}`;
    const node = store.nodes.find((n) => n.id === id);
    const item =
      node || store.requests.find((r) => r.id === id) || store.flows.find((f) => f.id === id);
    if (!item) return null;
    const parent = node || store.nodes.find((n) => n.id === item.parentId);
    const add = (kind: 'folder' | 'project' | 'request' | 'flow') => {
      setCreation({ parent, kind });
      setName('');
      setItemMenu(undefined);
    };
    return (
      <div className="item-menu-wrap">
        <button
          className="icon item-menu-trigger"
          aria-label={`Actions for ${item.name}`}
          aria-expanded={itemMenu === menuKey}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setMenuPosition({
              top: Math.max(8, Math.min(rect.bottom, window.innerHeight - 300)),
              left: rect.right + 4,
            });
            setItemMenu(itemMenu === menuKey ? undefined : menuKey);
          }}
        >
          <MoreHorizontal size={16} />
        </button>
        {itemMenu === menuKey && (
          <>
            <div
              className="item-menu"
              style={menuPosition}
              role="menu"
              aria-label={`${item.name} actions`}
            >
              {node?.kind === 'folder' ? (
                <>
                  <button role="menuitem" onClick={() => add('folder')}>
                    Add subfolder
                  </button>
                  <button role="menuitem" onClick={() => add('project')}>
                    Add project
                  </button>
                </>
              ) : (
                <>
                  <button role="menuitem" onClick={() => add('request')}>
                    Add request
                  </button>
                  <button role="menuitem" onClick={() => add('flow')}>
                    Add flow
                  </button>
                </>
              )}
              {node && (
                <button
                  role="menuitem"
                  onClick={() => {
                    setScope(id);
                    setItemMenu(undefined);
                  }}
                >
                  Settings & variables
                </button>
              )}
              <button
                role="menuitem"
                onClick={() => {
                  const copy = duplicateItem(store, id);
                  setStore(copy.store);
                  if (!node) open(copy.id);
                  setItemMenu(undefined);
                }}
              >
                Duplicate
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  download(
                    `${item.name.replace(/[^a-z0-9_-]/gi, '_')}.xml`,
                    exportXml(exportItem(store, id)),
                    'application/xml',
                  );
                  setItemMenu(undefined);
                }}
              >
                Export XML
              </button>
              <button role="menuitem" onClick={() => beginImport(id)}>
                Import
              </button>
              <button
                role="menuitem"
                className="failure"
                onClick={() => {
                  remove(id);
                  setItemMenu(undefined);
                }}
              >
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    );
  }
  function itemRow(item: RichRequest | Flow, depth: number) {
    return (
      <div className={`tree-item ${activeId === item.id ? 'selected' : ''}`} key={item.id}>
        <button
          className="tree-request"
          style={{ paddingLeft: 24 + depth * 14 }}
          onClick={() => open(item.id)}
        >
          {'method' in item ? (
            <span className={`method-label ${item.method.toLowerCase()}`}>{item.method}</span>
          ) : (
            <Workflow size={14} />
          )}
          <span>{item.name}</span>
        </button>
        {menu(item.id)}
      </div>
    );
  }
  function tree(parentId: string | null, depth = 0): React.ReactNode {
    return store.nodes
      .filter((n) => n.parentId === parentId)
      .map((node) => (
        <div key={node.id}>
          <div className="tree-group" style={{ paddingLeft: 12 + depth * 14 }}>
            <button
              className="tree-label"
              onClick={() =>
                setCollapsed((c) =>
                  c.includes(`collections:${node.id}`)
                    ? c.filter((id) => id !== `collections:${node.id}`)
                    : [...c, `collections:${node.id}`],
                )
              }
            >
              {collapsed.includes(`collections:${node.id}`) ? (
                <ChevronRight size={13} />
              ) : (
                <ChevronDown size={13} />
              )}
              {node.kind === 'folder' ? <Folder size={15} /> : <Layers size={15} />}
              <span>{node.name}</span>
            </button>
            {menu(node.id)}
          </div>
          {!collapsed.includes(`collections:${node.id}`) && (
            <>
              {tree(node.id, depth + 1)}
              {store.requests
                .filter(
                  (r) =>
                    r.parentId === node.id && r.name.toLowerCase().includes(search.toLowerCase()),
                )
                .map((item) => itemRow(item, depth + 1))}
            </>
          )}
        </div>
      ));
  }
  return (
    <Suggestions.Provider value={names}>
      <div className="app">
        <header className="app-header">
          <div className="brand">
            <div className="brand-mark">ƒ</div>Flow<span>X</span>
          </div>
          <span className="header-divider" />
          <span className="muted">Personal workspace</span>
          <div className="header-right">
            <button
              className="text-button"
              onClick={() => {
                beginImport();
              }}
            >
              <Upload size={14} /> Import
            </button>
            <button
              className="text-button"
              onClick={() => {
                setTransfer('export');
                setText(exportXml(store));
                setImportError('');
              }}
            >
              <Download size={14} /> Export
            </button>
            <button className="icon" title="Run history" onClick={() => setShowHistory((v) => !v)}>
              <History size={16} />
            </button>
            <button className="icon" title="Help and examples" onClick={() => setHelp(true)}>
              <HelpCircle size={16} />
            </button>
            <button
              className="icon"
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </header>
        <div className="app-content">
          <aside style={{ width }}>
            <div
              className="sidebar-switcher"
              role="tablist"
              aria-label="Workspace navigation"
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 'collections' : event.key === 'End' ? 'flows' : sidebarTab === 'collections' ? 'flows' : 'collections';
                setSidebarTab(next);
                setSearch('');
                setItemMenu(undefined);
                document.getElementById(`${next}-tab`)?.focus();
              }}
            >
              <button
                role="tab"
                id="collections-tab"
                tabIndex={sidebarTab === 'collections' ? 0 : -1}
                aria-controls="collections-panel"
                aria-selected={sidebarTab === 'collections'}
                onClick={() => {
                  setSidebarTab('collections');
                  setSearch('');
                  setItemMenu(undefined);
                }}
              >
                <Folder size={15} />
                Collections
              </button>
              <button
                role="tab"
                id="flows-tab"
                tabIndex={sidebarTab === 'flows' ? 0 : -1}
                aria-controls="flows-panel"
                aria-selected={sidebarTab === 'flows'}
                onClick={() => {
                  setSidebarTab('flows');
                  setSearch('');
                  setItemMenu(undefined);
                }}
              >
                <Workflow size={15} />
                Flows
              </button>
            </div>
            <div className="sidebar-tools">
              <input
                className="search"
                aria-label={sidebarTab === 'collections' ? 'Search collections' : 'Search flows'}
                placeholder={sidebarTab === 'collections' ? 'Search collections' : 'Search flows'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                className="icon"
                title={sidebarTab === 'collections' ? 'Create folder' : 'Create flow'}
                onClick={() => {
                  if (sidebarTab === 'collections') setCreation({ kind: 'folder' });
                  else {
                    const parent = store.nodes.find((n) => n.kind === 'project');
                    if (!parent) {
                      setError('Create a folder and project in Collections before adding a flow.');
                      return;
                    }
                    setCreation({ parent, kind: 'flow' });
                  }
                  setName('');
                }}
              >
                <Plus size={16} />
              </button>
            </div>
            {sidebarTab === 'collections' ? (
              <nav
                id="collections-panel"
                role="tabpanel"
                aria-labelledby="collections-tab"
                aria-label="Collections tree"
              >
                {tree(null)}
              </nav>
            ) : (
              <nav
                id="flows-panel"
                role="tabpanel"
                aria-labelledby="flows-tab"
                aria-label="Flows list"
              >
                {store.flows
                  .filter((f) => f.name.toLowerCase().includes(search.toLowerCase()))
                  .map((f) => itemRow(f, 0))}
                {!store.flows.length && (
                  <div className="sidebar-empty">
                    <Workflow size={24} />
                    <strong>No flows yet</strong>
                    <p>Create a flow to connect requests and transform their results.</p>
                  </div>
                )}
                {!!store.flows.length &&
                  !store.flows.some((f) => f.name.toLowerCase().includes(search.toLowerCase())) && (
                    <p className="sidebar-empty">No matching flows.</p>
                  )}
              </nav>
            )}
            <div className="sidebar-foot">
              <Braces size={17} />
              <div>
                <strong>Your APIs, connected.</strong>
                <p>Requests, data and workflows.</p>
              </div>
            </div>
          </aside>
          <div
            className="sidebar-resizer"
            role="separator"
            aria-label="Resize sidebar"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
                setWidth((w) =>
                  Math.max(200, Math.min(440, w + (e.key === 'ArrowRight' ? 10 : -10))),
                );
            }}
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                setWidth(Math.max(200, Math.min(440, e.clientX)));
            }}
          />
          <main>
            <div className="tabs">
              {tabs.map((id) => {
                const item =
                  store.requests.find((r) => r.id === id) || store.flows.find((f) => f.id === id);
                return (
                  item && (
                    <div className={`request-tab ${id === activeId ? 'active' : ''}`} key={id}>
                      <button onClick={() => open(id)}>
                        {'method' in item ? (
                          <span className="method-label">{item.method}</span>
                        ) : (
                          <Workflow size={13} />
                        )}{' '}
                        {item.name}
                      </button>
                      <button
                        className="icon"
                        aria-label={`Close ${item.name}`}
                        onClick={() => {
                          const next = tabs.filter((t) => t !== id);
                          setTabs(next);
                          if (activeId === id) setActiveId(next.at(-1) || '');
                        }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )
                );
              })}
            </div>
            {error && (
              <div className="error" role="alert">
                {error}
                <button className="icon" aria-label="Dismiss error" onClick={() => setError('')}>
                  <X size={14} />
                </button>
              </div>
            )}
            {showHistory ? (
              <div className="history-page">
                <h2>Run history</h2>
                <p className="muted">
                  Latest runs are stored locally. Declared secret values are masked.
                </p>
                {runs.map((run) => (
                  <button
                    className="history-row"
                    key={run.id}
                    onClick={() => {
                      setCurrentRun(run);
                      setActiveId(run.targetId);
                      setShowHistory(false);
                      setShowConsole(true);
                    }}
                  >
                    <span className={`status-pill ${run.status}`}>{run.status}</span>
                    <strong>{run.name}</strong>
                    <span className="muted">{new Date(run.started).toLocaleString()}</span>
                  </button>
                ))}
                {!runs.length && <p>No executions yet.</p>}
              </div>
            ) : flow ? (
              <FlowDesigner
                key={flow.id}
                flow={flow}
                store={store}
                onChange={(next) => setStore((s) => updateFlow(s, next))}
                theme={theme}
                onRun={() => void execute()}
                onCancel={cancel}
                busy={busy}
                run={currentRun?.targetId === flow.id ? currentRun : undefined}
              />
            ) : request ? (
              <>
                <RequestWorkspace
                  key={`request:${request.id}`}
                  request={request}
                  onChange={changeRequest}
                  store={store}
                  theme={theme}
                  response={responses[request.id]}
                  busy={busy}
                  onSend={() => void execute()}
                  onCancel={cancel}
                />
                <div className="request-bottom-bar">
                  <button
                    className="text-button"
                    onClick={() => {
                      try {
                        setText(exportCurl(request));
                        setTransfer('curl');
                        setImportError('');
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  >
                    Export cURL
                  </button>
                </div>
                <RunConsole
                  key={`console:${request.id}`}
                  run={currentRun}
                  theme={theme}
                  expanded={showConsole}
                  onExpandedChange={setShowConsole}
                />
              </>
            ) : (
              <div className="empty-response">
                <Braces size={38} />
                <h3>{loaded ? 'Make your first connection' : 'Loading FlowX…'}</h3>
                <p>Open a request or flow, or create one inside a project.</p>
              </div>
            )}
            <footer>
              <span>
                <i className="status-dot" />
                {saving}
              </span>
              {undo && (
                <button
                  className="text-button"
                  onClick={() => {
                    setStore(undo);
                    setUndo(undefined);
                  }}
                >
                  Undo deletion
                </button>
              )}
              <span>FlowX · {isTauri() ? 'Desktop / SQLite' : 'Browser preview'}</span>
            </footer>
          </main>
        </div>
        {creation && (
          <div className="modal-backdrop">
            <form
              className="modal"
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              <div className="modal-heading">
                <h2>New {creation.kind}</h2>
                <button
                  type="button"
                  className="icon"
                  aria-label="Close dialog"
                  onClick={() => setCreation(undefined)}
                >
                  <X size={18} />
                </button>
              </div>
              <p>
                {creation.kind === 'folder'
                  ? 'Organize projects and subfolders.'
                  : creation.kind === 'project'
                    ? 'A project contains requests and flows.'
                    : 'Give your new ' + creation.kind + ' a name.'}
              </p>
              {creation.kind === 'flow' && (
                <label>
                  Project
                  <select
                    aria-label="Flow project"
                    value={creation.parent?.id || ''}
                    onChange={(e) =>
                      setCreation({
                        ...creation,
                        parent: store.nodes.find((n) => n.id === e.target.value),
                      })
                    }
                  >
                    {store.nodes
                      .filter((n) => n.kind === 'project')
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                  </select>
                  <span className="muted">
                    Inherits this project's variables. Listed only in the Flows tab.
                  </span>
                </label>
              )}
              <label>
                Name
                <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <button className="send">Create {creation.kind}</button>
            </form>
          </div>
        )}
        {selectedScope && (
          <div className="modal-backdrop">
            <div className="modal scope-modal">
              <div className="modal-heading">
                <h2>{selectedScope.kind} settings</h2>
                <button
                  className="icon"
                  aria-label="Close settings"
                  onClick={() => setScope(undefined)}
                >
                  <X size={18} />
                </button>
              </div>
              <label>
                Name
                <input
                  value={selectedScope.name}
                  onChange={(e) =>
                    setStore((s) => ({
                      ...s,
                      nodes: s.nodes.map((n) =>
                        n.id === scope ? { ...n, name: e.target.value } : n,
                      ),
                    }))
                  }
                />
              </label>
              <Suggestions.Provider value={inherited(store, selectedScope.id).map((v) => v.name)}>
                <Variables
                  variables={selectedScope.variables}
                  inherited={selectedScope.parentId ? inherited(store, selectedScope.parentId) : []}
                  onChange={(variables) =>
                    setStore((s) => ({
                      ...s,
                      nodes: s.nodes.map((n) => (n.id === scope ? { ...n, variables } : n)),
                    }))
                  }
                />
              </Suggestions.Provider>
              <button
                className="text-button failure"
                onClick={() => {
                  remove(selectedScope.id);
                  setScope(undefined);
                }}
              >
                Delete {selectedScope.kind} and its contents
              </button>
            </div>
          </div>
        )}
        {transfer && (
          <div className="modal-backdrop">
            <div className="modal transfer-modal">
              <div className="modal-heading">
                <h2>
                  {transfer === 'import'
                    ? 'Import requests & flows'
                    : transfer === 'curl'
                      ? 'Export cURL'
                      : 'Export workspace XML'}
                </h2>
                <button
                  className="icon"
                  aria-label="Close import export"
                  onClick={() => setTransfer(undefined)}
                >
                  <X size={18} />
                </button>
              </div>
              <p>
                {transfer === 'import'
                  ? 'Paste a cURL command or upload FlowX XML, Postman collection JSON, or OpenAPI 3 JSON. Imports from an item menu are added inside that folder or project.'
                  : 'Secret variable values and saved credentials are excluded. Review literal values in request bodies, URLs and headers before sharing.'}
              </p>
              {transfer === 'import' && (
                <>
                  <label>
                    Target project for cURL
                    <select
                      value={targetProject}
                      onChange={(e) => setTargetProject(e.target.value)}
                    >
                      <option value="">Choose a project</option>
                      {store.nodes
                        .filter((n) => n.kind === 'project')
                        .map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="subtle-button">
                    Upload XML / JSON
                    <input
                      type="file"
                      accept=".xml,.json"
                      onChange={async (e) => {
                        try {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (file.size > 25 * 1024 * 1024)
                            throw new Error('Import is limited to 25 MB');
                          const xml = await file.text();
                          setText(xml);
                          setIncoming(
                            xml.trim().startsWith('<') ? importXml(xml) : importJson(xml),
                          );
                          setImportError('');
                        } catch (e) {
                          setImportError(String(e));
                          setIncoming(undefined);
                        }
                      }}
                    />
                  </label>
                </>
              )}
              <textarea
                aria-label="Import export content"
                rows={8}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setIncoming(undefined);
                }}
                readOnly={transfer !== 'import'}
                placeholder="curl 'https://api.example.com/users'"
              />
              {incoming && (
                <p className="success">
                  Ready to import: {incoming.nodes.length} folders/projects,{' '}
                  {incoming.requests.length} requests, {incoming.flows.length} flows.
                </p>
              )}
              {importError && (
                <div className="error" role="alert">
                  {importError}
                </div>
              )}
              {transfer === 'import' ? (
                <button
                  className="send"
                  onClick={() => {
                    try {
                      if (incoming) {
                        setStore((s) => importInto(s, safeStore(incoming), importTarget));
                        setTransfer(undefined);
                      } else if (text.trim().startsWith('<')) {
                        setIncoming(importXml(text));
                      } else if (text.trim().startsWith('{')) {
                        setIncoming(importJson(text));
                      } else {
                        if (!targetProject) throw new Error('Choose a project');
                        const r = importCurl(text, targetProject);
                        setStore((s) => ({ ...s, requests: [...s.requests, r] }));
                        open(r.id);
                        setTransfer(undefined);
                      }
                    } catch (e) {
                      setImportError(String(e));
                    }
                  }}
                >
                  {incoming ? 'Import workspace' : 'Validate / import'}
                </button>
              ) : (
                <button
                  className="send"
                  onClick={() =>
                    download(
                      transfer === 'curl' ? 'request.curl' : 'FlowX.xml',
                      text,
                      transfer === 'curl' ? 'text/plain' : 'application/xml',
                    )
                  }
                >
                  Download
                </button>
              )}
            </div>
          </div>
        )}
        {prompt && (
          <div className="modal-backdrop">
            <form
              className="modal"
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  prompt.resolve(valuesOf(answers));
                  setPrompt(undefined);
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              <div className="modal-heading">
                <h2>Execution inputs</h2>
                <button
                  type="button"
                  className="icon"
                  aria-label="Cancel execution inputs"
                  onClick={cancel}
                >
                  <X size={18} />
                </button>
              </div>
              <p>Provide the values needed for this flow or step.</p>
              {answers.map((v) => (
                <label key={v.id}>
                  {v.description || v.name}
                  <VariableInput
                    type={v.secret ? 'password' : 'text'}
                    value={v.value}
                    onChange={(e) =>
                      setAnswers((a) =>
                        a.map((x) => (x.id === v.id ? { ...x, value: e.target.value } : x)),
                      )
                    }
                  />
                </label>
              ))}
              <button className="send">Continue execution</button>
            </form>
          </div>
        )}
        {help && (
          <div className="modal-backdrop">
            <div className="modal help-modal">
              <div className="modal-heading">
                <h2>Build with FlowX</h2>
                <button className="icon" aria-label="Close help" onClick={() => setHelp(false)}>
                  <X size={18} />
                </button>
              </div>
              <h3>Organize</h3>
              <p>
                Folders contain subfolders and projects. Projects contain requests and flows. Open
                folder/project settings to define inherited variables.
              </p>
              <h3>Variables</h3>
              <p>
                Type <code>{'{baseUrl}'}</code> in any value field. Request variables override
                project and folder values. Use a whole JSON value such as <code>{'"{items}"'}</code>{' '}
                to insert a typed list or object.
              </p>
              <h3>Capture outputs</h3>
              <p>
                Send a request, open Outputs and select a path such as <code>data.items[0].id</code>
                . Transform with <code>return value;</code>, map with <code>return item.id;</code>,
                or filter with <code>return item.active;</code>.
              </p>
              <h3>Dependencies</h3>
              <p>
                Reference <code>{'{Login.token}'}</code>. FlowX runs Login before the current
                request. Circular dependencies fail before any API call.
              </p>
              <h3>Workflows</h3>
              <p>
                Drag existing requests onto the canvas to create independent copies. Connect Start →
                Request → View. Multiple outgoing connectors run in parallel. A join waits for all
                connected predecessors. View templates use step outputs such as{' '}
                <code>{'{Get post.postId}'}</code>. Stop cancels the whole flow.
              </p>
              <h3>Form View</h3>
              <p>
                JSON objects become fields and lists become tables. Expand nested values. XML
                exposes ordered elements, attributes, text and namespaces. Response edits are local;
                output extraction uses the original response.
              </p>
              <h3>Sharing</h3>
              <p>
                Export XML to share requests and flows together. Import validates the document
                before adding its contents. cURL supports raw-body HTTP requests.
              </p>
            </div>
          </div>
        )}
      </div>
    </Suggestions.Provider>
  );
}
