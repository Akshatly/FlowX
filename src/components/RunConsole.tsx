import { useState, useRef } from 'react';
import { Maximize2, X, ChevronDown, ChevronUp } from 'lucide-react';
import type { Run } from '../domain';
import DocumentEditor from './DocumentEditor';
export default function RunConsole({
  run,
  theme,
  onSelect,
  expanded,
  onExpandedChange,
}: {
  run?: Run;
  theme: 'dark' | 'light';
  onSelect?: (id: string) => void;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const isExpanded = expanded ?? localExpanded;
  const toggle = (value: boolean) => {
    setLocalExpanded(value);
    onExpandedChange?.(value);
  };
  const [height, setHeight] = useState(240);
  const resize = useRef({ y: 0, height: 240 });
  const [tab, setTab] = useState('Console');
  const [fullscreen, setFullscreen] = useState(false);
  const [copies, setCopies] = useState<Record<string, string>>({});
  return (
    <div
      className={`run-console ${fullscreen ? 'fullscreen' : ''} ${isExpanded || fullscreen ? '' : 'collapsed'}`}
      style={fullscreen ? undefined : { height: isExpanded ? height : 40 }}
    >
      {isExpanded && !fullscreen && (
        <div
          className="console-resizer"
          role="separator"
          aria-label="Resize execution console"
          aria-orientation="horizontal"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown')
              setHeight((h) =>
                Math.max(
                  100,
                  Math.min(window.innerHeight * 0.65, h + (e.key === 'ArrowUp' ? 20 : -20)),
                ),
              );
          }}
          onPointerDown={(e) => {
            resize.current = { y: e.clientY, height };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              setHeight(
                Math.max(
                  100,
                  Math.min(
                    window.innerHeight * 0.65,
                    resize.current.height + resize.current.y - e.clientY,
                  ),
                ),
              );
          }}
          onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
        />
      )}
      <div className="console-heading">
        <button
          className="text-button console-toggle"
          aria-expanded={isExpanded || fullscreen}
          onClick={() => {
            if (fullscreen) setFullscreen(false);
            toggle(!isExpanded);
          }}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />} Execution console
        </button>
        <div className="section-tabs">
          {['Console', 'Views'].map((t) => (
            <button
              key={t}
              className={tab === t ? 'active' : ''}
              onClick={() => {
                setTab(t);
                toggle(true);
              }}
            >
              {t}
              {t === 'Views' && run && <small>{run.logs.filter((l) => l.view).length}</small>}
            </button>
          ))}
        </div>
        <span className="muted">{run ? `${run.name} · ${run.status}` : 'Execution results'}</span>
        <button
          className="icon"
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen results'}
          onClick={() => setFullscreen((v) => !v)}
        >
          {fullscreen ? <X size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>
      {(isExpanded || fullscreen) && (
        <div className="console-content">
          {!run ? (
            <p className="muted">
              Run a request or flow to inspect each step, response and captured output.
            </p>
          ) : tab === 'Console' ? (
            run.logs.map((log) => (
              <details
                className={`log-entry ${log.status}`}
                key={log.id}
                open={log.status === 'failed'}
              >
                <summary>
                  <span className={`status-pill ${log.status}`}>{log.status}</span>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      onSelect?.(log.id);
                    }}
                  >
                    {log.name}
                  </button>
                  <span className="muted">{log.duration} ms</span>
                </summary>
                {log.message && (
                  <p className={log.status === 'failed' ? 'failure' : 'muted'}>{log.message}</p>
                )}
                {log.request && (
                  <details>
                    <summary>
                      Request · {log.request.method} {log.request.url}
                    </summary>
                    <pre>{JSON.stringify(log.request, null, 2)}</pre>
                  </details>
                )}
                {log.outputs && <pre>{JSON.stringify(log.outputs, null, 2)}</pre>}
                {log.response && (
                  <>
                    <p className="muted">
                      HTTP {log.response.status} · {log.response.duration} ms · {log.response.size}{' '}
                      bytes
                    </p>
                    <div className="log-response">
                      <DocumentEditor
                        value={copies[`${run.id}:${log.id}`] ?? log.response.body}
                        onChange={(v) => setCopies((c) => ({ ...c, [`${run.id}:${log.id}`]: v }))}
                        original={log.response.body}
                        format={
                          log.response.headers.some(
                            ([k, v]) => k.toLowerCase() === 'content-type' && v.includes('xml'),
                          )
                            ? 'xml'
                            : (() => {
                                try {
                                  JSON.parse(log.response.body);
                                  return 'json';
                                } catch {
                                  return 'text';
                                }
                              })()
                        }
                        theme={theme}
                      />
                    </div>
                  </>
                )}
              </details>
            ))
          ) : (
            <div className="view-results">
              {run.logs
                .filter((l) => l.view)
                .map((log) => (
                  <section key={log.id}>
                    <h3>{log.name}</h3>
                    <DocumentEditor
                      value={copies[`${run.id}:${log.id}:view`] ?? log.view!}
                      onChange={(v) =>
                        setCopies((c) => ({ ...c, [`${run.id}:${log.id}:view`]: v }))
                      }
                      format="json"
                      theme={theme}
                    />
                  </section>
                ))}
              {!run.logs.some((l) => l.view) && (
                <p className="muted">Connect a View step to display flow outputs here.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
