import cytoscape from "cytoscape";
import {
  BookOpen,
  ChevronDown,
  CircleDot,
  Database,
  Download,
  FileJson,
  Focus,
  GitBranch,
  KeyRound,
  Layers3,
  ListPlus,
  Lock,
  LogOut,
  Maximize2,
  MousePointer2,
  Network,
  PanelRight,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildGraphElements,
  edgeEntityKey,
  getLayoutOptions,
  nodeEntityKey,
  supportList,
} from "./lib/graph.js";

const DEFAULT_ACCESS_CODE_HASH = "98a171c273aa30eacc9ffa54534ebeb7e33861d97665bdf3978308c5ee12f428";
const AUTH_KEY = "kg_schema_editor_auth_v1";
const ROUTE_ACCESS = "#/access";
const ROUTE_REVIEW = "#/review";
const STORAGE_PREFIX = "kg_schema_editor_state_v1";

function publicPath(path) {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function compactTitle(title) {
  return title
    ?.replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, limit = 120) {
  const text = Array.isArray(value) ? value.join(", ") : String(value ?? "");
  if (text.length <= limit) return text || "empty";
  return `${text.slice(0, limit - 1)}...`;
}

function storageKey(activeId) {
  return `${STORAGE_PREFIX}:${activeId}`;
}

function loadReviewState(activeId) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(activeId)) || "null");
  } catch {
    return null;
  }
}

function saveReviewState(activeId, schema, changes) {
  if (!activeId || !schema) return;
  localStorage.setItem(
    storageKey(activeId),
    JSON.stringify({
      schema,
      changes,
      saved_at: new Date().toISOString(),
    }),
  );
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function navigateTo(hash) {
  if (window.location.hash !== hash) {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
  }
}

function findFirstItem(index) {
  return index?.kgs?.find((kg) => kg.items?.length)?.items?.[0] ?? null;
}

function findItem(index, id) {
  for (const kg of index?.kgs ?? []) {
    const item = kg.items?.find((candidate) => candidate.id === id);
    if (item) return { kg, item };
  }
  return null;
}

function propertyCount(schema) {
  const nodeProps = (schema?.node_types ?? []).reduce((total, node) => total + (node.properties?.length ?? 0), 0);
  const edgeProps = (schema?.edge_types ?? []).reduce((total, edge) => total + (edge.properties?.length ?? 0), 0);
  return nodeProps + edgeProps;
}

function makeChange(partial) {
  return {
    id: `chg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    affectedKeys: partial.affectedKeys ?? [partial.entityKey].filter(Boolean),
    ...partial,
  };
}

function listLines(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function downloadFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function latestByEntity(changes) {
  const map = new Map();
  for (const change of changes) {
    if (change.revoked) continue;
    for (const key of change.affectedKeys ?? [change.entityKey]) {
      if (key) map.set(key, change);
    }
  }
  return map;
}

function latestByField(changes) {
  const map = new Map();
  for (const change of changes) {
    if (!change.fieldPath || change.revoked) continue;
    map.set(change.fieldPath, change);
  }
  return map;
}

function resolveSelected(schema, selected) {
  if (!schema || !selected?.entityKey) return null;
  if (selected.kind === "node") {
    const type = selected.entityKey.replace(/^node:/, "");
    const index = (schema.node_types ?? []).findIndex((node) => node.type === type);
    if (index < 0) return null;
    return { kind: "node", entity: schema.node_types[index], index, entityKey: selected.entityKey };
  }

  if (selected.kind === "edge") {
    const index = Number(selected.schemaIndex);
    if (Number.isInteger(index) && schema.edge_types?.[index]) {
      const edge = schema.edge_types[index];
      return { kind: "edge", entity: edge, index, entityKey: edgeEntityKey(edge, index) };
    }
    const foundIndex = (schema.edge_types ?? []).findIndex((edge, edgeIndex) => edgeEntityKey(edge, edgeIndex) === selected.entityKey);
    if (foundIndex < 0) return null;
    return { kind: "edge", entity: schema.edge_types[foundIndex], index: foundIndex, entityKey: selected.entityKey };
  }

  return null;
}

function fieldPathFor(entityKey, field, propertyIndex = null, propertyName = "") {
  if (propertyIndex == null) return `${entityKey}.${field}`;
  return `${entityKey}.properties.${propertyIndex}.${propertyName || "property"}.${field}`;
}

function nodeTypeFromEntityKey(entityKey) {
  return String(entityKey ?? "").replace(/^node:/, "");
}

function sameEdge(edge, reference) {
  if (!edge || !reference) return false;
  return edge.source_type === reference.source_type && edge.relation === reference.relation && edge.target_type === reference.target_type;
}

function findNodeIndex(schema, ...types) {
  const wanted = new Set(types.filter(Boolean));
  return (schema?.node_types ?? []).findIndex((node) => wanted.has(node.type));
}

function findEdgeIndex(schema, change, ...references) {
  const edges = schema?.edge_types ?? [];
  const preferred = [change?.oldEntity, change?.newEntity, ...references].filter((edge) => edge?.source_type || edge?.relation || edge?.target_type);
  for (const reference of preferred) {
    const index = edges.findIndex((edge) => sameEdge(edge, reference));
    if (index >= 0) return index;
  }

  const entityKey = change?.entityKey;
  if (entityKey) {
    const index = edges.findIndex((edge, edgeIndex) => edgeEntityKey(edge, edgeIndex) === entityKey);
    if (index >= 0) return index;
  }

  if (Number.isInteger(change?.edgeIndex) && edges[change.edgeIndex]) return change.edgeIndex;
  return -1;
}

function upsertNode(schema, node, ...oldTypes) {
  if (!node?.type) return;
  const nextNode = deepClone(node);
  delete nextNode.removedEdges;
  const index = findNodeIndex(schema, ...oldTypes, nextNode.type);
  if (index >= 0) schema.node_types[index] = nextNode;
  else schema.node_types = [...(schema.node_types ?? []), nextNode];
}

function upsertEdge(schema, edge, change) {
  if (!edge?.source_type || !edge?.relation || !edge?.target_type) return;
  const index = findEdgeIndex(schema, change, edge);
  if (index >= 0) schema.edge_types[index] = deepClone(edge);
  else schema.edge_types = [...(schema.edge_types ?? []), deepClone(edge)];
}

function replacePropertyOwner(schema, change, owner) {
  if (!owner) return;
  if (change.ownerKind === "node") {
    upsertNode(schema, owner, change.oldEntity?.type, nodeTypeFromEntityKey(change.entityKey));
    return;
  }
  upsertEdge(schema, owner, change);
}

function propertyIndexFromChange(change) {
  const match = String(change?.fieldPath ?? "").match(/\.properties\.(\d+)\./);
  return match ? Number(match[1]) : -1;
}

function applyChangeToSchema(schema, change) {
  const next = deepClone(schema);
  next.node_types = Array.isArray(next.node_types) ? next.node_types : [];
  next.edge_types = Array.isArray(next.edge_types) ? next.edge_types : [];

  if (change.entityKind === "node") {
    const oldType = change.oldEntity?.type ?? nodeTypeFromEntityKey(change.affectedKeys?.[0] ?? change.entityKey);
    const newNode = change.newEntity ?? change.newValue;
    if (change.action === "add") {
      upsertNode(next, newNode);
    } else if (change.action === "edit") {
      upsertNode(next, newNode, oldType);
      if (oldType && newNode?.type && oldType !== newNode.type) {
        next.edge_types = next.edge_types.map((edge) => ({
          ...edge,
          source_type: edge.source_type === oldType ? newNode.type : edge.source_type,
          target_type: edge.target_type === oldType ? newNode.type : edge.target_type,
        }));
      }
    } else if (change.action === "delete") {
      next.node_types = next.node_types.filter((node) => node.type !== oldType);
      next.edge_types = next.edge_types.filter((edge) => edge.source_type !== oldType && edge.target_type !== oldType);
    }
    return next;
  }

  if (change.entityKind === "edge") {
    if (change.action === "add") {
      upsertEdge(next, change.newEntity ?? change.newValue, change);
    } else if (change.action === "edit") {
      upsertEdge(next, change.newEntity, change);
    } else if (change.action === "delete") {
      const index = findEdgeIndex(next, change, change.oldEntity);
      if (index >= 0) next.edge_types.splice(index, 1);
    }
    return next;
  }

  if (change.entityKind === "property") {
    if ((change.action === "add" || change.action === "edit") && change.newEntity) {
      replacePropertyOwner(next, change, change.newEntity);
    } else if (change.action === "delete") {
      if (change.ownerKind === "node") {
        const index = findNodeIndex(next, nodeTypeFromEntityKey(change.entityKey));
        const owner = next.node_types[index];
        const propertyIndex = propertyIndexFromChange(change);
        if (owner?.properties?.length) {
          if (propertyIndex >= 0 && owner.properties[propertyIndex]) owner.properties.splice(propertyIndex, 1);
          else owner.properties = owner.properties.filter((property) => property.name !== change.oldEntity?.name);
        }
      } else {
        const index = findEdgeIndex(next, change);
        const owner = next.edge_types[index];
        const propertyIndex = propertyIndexFromChange(change);
        if (owner?.properties?.length) {
          if (propertyIndex >= 0 && owner.properties[propertyIndex]) owner.properties.splice(propertyIndex, 1);
          else owner.properties = owner.properties.filter((property) => property.name !== change.oldEntity?.name);
        }
      }
    }
  }

  return next;
}

function rebuildSchemaWithChanges(baseSchema, changes) {
  return changes
    .slice()
    .reverse()
    .reduce((currentSchema, change) => applyChangeToSchema(currentSchema, change), deepClone(baseSchema));
}

function AccessGate({ onReady }) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    navigateTo(ROUTE_ACCESS);
  }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("Checking access...");
    try {
      const expected = import.meta.env.VITE_ACCESS_CODE_HASH || DEFAULT_ACCESS_CODE_HASH;
      const actual = await sha256Hex(code.trim());
      if (actual !== expected) {
        setStatus("Invalid access code.");
        return;
      }
      sessionStorage.setItem(AUTH_KEY, "yes");
      navigateTo(ROUTE_REVIEW);
      onReady();
    } catch (error) {
      setStatus(error?.message || "Could not verify the access code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="access-shell">
      <section className="access-panel">
        <div className="access-kicker">
          <Lock size={15} />
          Expert access
        </div>
        <h1>Knowledge Graph Refinement</h1>
        <p>Review, edit, and track schema changes with graph-level evidence.</p>
        <form className="access-form" onSubmit={submit}>
          <label htmlFor="access-code">Access code</label>
          <div className="access-input">
            <KeyRound size={18} />
            <input
              id="access-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              autoFocus
            />
          </div>
          <button type="submit" disabled={!code.trim() || busy}>
            {busy ? "Opening..." : "Enter review"}
          </button>
        </form>
        {status && <div className={`access-status ${status.includes("Invalid") ? "warning" : ""}`}>{status}</div>}
      </section>
    </main>
  );
}

function Sidebar({ index, activeId, onSelect, changeCounts, collapsed, onToggleCollapsed }) {
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    if (index?.kgs) {
      setExpanded(Object.fromEntries(index.kgs.map((kg) => [kg.id, true])));
    }
  }, [index]);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Network size={22} />
        </div>
        <div className="brand-copy">
          <h1>KG Editor</h1>
          <p>Schema review workspace</p>
        </div>
        <button className="sidebar-toggle" type="button" onClick={onToggleCollapsed} title={collapsed ? "Expand navigation" : "Collapse navigation"}>
          <PanelRight size={17} />
        </button>
      </div>

      <div className="kg-menu">
        {(index?.kgs ?? []).map((kg) => {
          const isExpanded = expanded[kg.id];
          return (
            <section className={`kg-section ${isExpanded ? "expanded" : "collapsed"}`} key={kg.id}>
              <button className="kg-heading" type="button" onClick={() => setExpanded((current) => ({ ...current, [kg.id]: !current[kg.id] }))}>
                <span className="kg-accent" style={{ background: kg.accent }} />
                <span>{kg.title}</span>
                <small>{kg.stats?.books ?? 0} books</small>
                <ChevronDown className="kg-chevron" size={16} />
              </button>

              <div className="kg-items-frame" aria-hidden={!isExpanded}>
                <div className="kg-items">
                  {(kg.items ?? []).map((item) => {
                    const active = item.id === activeId;
                    const count = changeCounts[item.id] ?? 0;
                    return (
                      <button className={`schema-item ${active ? "active" : ""}`} key={item.id} type="button" onClick={() => onSelect(item.id)}>
                        <span className="schema-icon">{item.kind === "fused" ? <Database size={15} /> : <BookOpen size={15} />}</span>
                        <span className="schema-copy">
                          <span>{compactTitle(item.title)}</span>
                          <small>{item.stats?.nodes ?? 0} nodes - {item.stats?.edges ?? 0} relations</small>
                        </span>
                        {count > 0 && <span className="schema-change-count">{count}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function Toolbar({
  query,
  setQuery,
  category,
  setCategory,
  graph,
  rightRailOpen,
  onToggleRightRail,
  onFit,
  onZoom,
  onRelayout,
  onAddNode,
  onAddEdge,
  onExport,
  onReset,
  onLogout,
}) {
  return (
    <div className="toolbar">
      <div className="search-box">
        <Search size={17} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search nodes, relations, properties" />
      </div>

      <div className="segmented category-filter">
        <button className={category === "all" ? "active" : ""} type="button" onClick={() => setCategory("all")}>
          All
        </button>
        {(graph?.categories ?? []).map((item) => (
          <button className={category === item.id ? "active" : ""} key={item.id} type="button" onClick={() => setCategory(item.id)} style={{ "--chip": item.color }}>
            <span className="dot" />
            {item.label}
            <small>{item.count}</small>
          </button>
        ))}
      </div>

      <div className="toolbar-actions">
        <button className="text-tool" type="button" onClick={onAddNode} title="Add node type">
          <Plus size={16} />
          Node
        </button>
        <button className="text-tool" type="button" onClick={onAddEdge} title="Add relation type">
          <Workflow size={16} />
          Relation
        </button>
        <button type="button" onClick={onRelayout} title="Run layout">
          <RefreshCw size={17} />
        </button>
        <button type="button" onClick={onToggleRightRail} className={rightRailOpen ? "active" : ""} title={rightRailOpen ? "Hide details and review trail" : "Show details and review trail"}>
          <PanelRight size={17} />
        </button>
        <button type="button" onClick={() => onZoom(1.45)} title="Zoom in">
          <ZoomIn size={17} />
        </button>
        <button type="button" onClick={() => onZoom(0.69)} title="Zoom out">
          <ZoomOut size={17} />
        </button>
        <button type="button" onClick={onFit} title="Fit graph">
          <Maximize2 size={17} />
        </button>
        <button type="button" onClick={onExport} title="Export review package">
          <Download size={17} />
        </button>
        <button type="button" onClick={onReset} title="Reset local edits">
          <RotateCcw size={17} />
        </button>
        <button type="button" onClick={onLogout} title="Logout">
          <LogOut size={17} />
        </button>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }) {
  return (
    <div className="stat-card">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SchemaHeader({ schema, active, changes }) {
  return (
    <header className="schema-header">
      <div>
        <p className="eyebrow">{schema?.kg_title ?? "Schema"} - {active?.item?.kind === "fused" ? "Fused" : "Textbook"}</p>
        <h2>{compactTitle(active?.item?.title ?? schema?.schema_name ?? "Schema")}</h2>
      </div>
      <div className="schema-stats">
        <StatCard icon={<CircleDot size={18} />} label="Nodes" value={schema?.node_types?.length ?? 0} />
        <StatCard icon={<GitBranch size={18} />} label="Relations" value={schema?.edge_types?.length ?? 0} />
        <StatCard icon={<Layers3 size={18} />} label="Changes" value={changes.length} />
      </div>
    </header>
  );
}

function FieldDiff({ change }) {
  if (!change) return null;
  return (
    <span className={`field-diff ${change.action}`}>
      {change.action === "add" ? "added" : change.action === "delete" ? "deleted" : "changed"}
      <span className="diff-popover">
        <strong>{change.fieldLabel || "Field"}</strong>
        <span className="diff-line old"><em>Before</em>{truncate(change.oldValue, 240)}</span>
        <span className="diff-line new"><em>After</em>{truncate(change.newValue, 240)}</span>
      </span>
    </span>
  );
}

function EditableField({ label, value, multiline = false, onCommit, diff }) {
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  function commit() {
    const normalizedDraft = String(draft ?? "");
    const normalizedValue = String(value ?? "");
    if (normalizedDraft !== normalizedValue) {
      onCommit(normalizedDraft);
    }
  }

  return (
    <label className="edit-field">
      <span>
        {label}
        <FieldDiff change={diff} />
      </span>
      {multiline ? (
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} rows={4} />
      ) : (
        <input value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} />
      )}
    </label>
  );
}

function PropertiesEditor({ owner, ownerKind, onEdit, onAdd, onDelete, fieldChanges }) {
  const properties = Array.isArray(owner.entity.properties) ? owner.entity.properties : [];
  return (
    <div className="property-editor">
      <div className="section-topline">
        <h4>Properties</h4>
        <button className="mini-action" type="button" onClick={onAdd}>
          <ListPlus size={14} />
          Add property
        </button>
      </div>
      {properties.length === 0 && <p className="muted">No properties declared.</p>}
      {properties.map((property, index) => {
        const base = fieldPathFor(owner.entityKey, "properties", index, property.name);
        return (
          <div className="property-card" key={`${property.name}-${index}`}>
            <EditableField
              label="Name"
              value={property.name ?? ""}
              diff={fieldChanges.get(`${base}.name`)}
              onCommit={(value) => onEdit(index, "name", value)}
            />
            <EditableField
              label="Description"
              value={property.description ?? ""}
              multiline
              diff={fieldChanges.get(`${base}.description`)}
              onCommit={(value) => onEdit(index, "description", value)}
            />
            <button className="delete-row" type="button" onClick={() => onDelete(index)}>
              <Trash2 size={14} />
              Delete property
            </button>
          </div>
        );
      })}
      <p className="editor-note">Edits autosave locally and appear immediately in the graph and change log.</p>
    </div>
  );
}

function SupportEditor({ owner, onCommit, fieldChanges }) {
  const value = supportList(owner.entity).join("\n");
  return (
    <EditableField
      label="Support sources"
      value={value}
      multiline
      diff={fieldChanges.get(fieldPathFor(owner.entityKey, "supported_by_books"))}
      onCommit={onCommit}
    />
  );
}

function EmptyInspector({ schema, active, graph }) {
  return (
    <div className="inspector-empty">
      <div className="inspector-icon">
        <MousePointer2 size={22} />
      </div>
      <h3>{compactTitle(active?.item?.title ?? schema?.schema_name)}</h3>

      <div className="category-list">
        {(graph?.categories ?? []).map((category) => (
          <div className="category-row" key={category.id}>
            <span className="dot" style={{ "--chip": category.color }} />
            <span>{category.label}</span>
            <strong>{category.count}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function Inspector({
  selected,
  schema,
  active,
  graph,
  fieldChanges,
  onClose,
  onEditNodeField,
  onEditEdgeField,
  onEditProperty,
  onAddProperty,
  onDeleteProperty,
  onDeleteSelected,
}) {
  const resolved = resolveSelected(schema, selected);

  return (
    <aside className="inspector">
      <div className="inspector-title">
        <button className="rail-toggle" type="button" onClick={onClose} title="Hide details and review trail">
          <PanelRight size={18} />
        </button>
        <span>Details and edits</span>
      </div>

      {!resolved ? (
        <EmptyInspector schema={schema} active={active} graph={graph} />
      ) : (
        <div className="inspector-content">
          <div className="selection-type">{resolved.kind === "edge" ? "Relation type" : "Node type"}</div>
          <h3>{resolved.kind === "edge" ? resolved.entity.relation : resolved.entity.type}</h3>

          {resolved.kind === "node" ? (
            <>
              <EditableField
                label="Type"
                value={resolved.entity.type ?? ""}
                diff={fieldChanges.get(fieldPathFor(resolved.entityKey, "type"))}
                onCommit={(value) => onEditNodeField(resolved.index, "type", value)}
              />
              <EditableField
                label="Description"
                value={resolved.entity.description ?? ""}
                multiline
                diff={fieldChanges.get(fieldPathFor(resolved.entityKey, "description"))}
                onCommit={(value) => onEditNodeField(resolved.index, "description", value)}
              />
              <SupportEditor
                owner={resolved}
                fieldChanges={fieldChanges}
                onCommit={(value) => onEditNodeField(resolved.index, "supported_by_books", listLines(value))}
              />
              <PropertiesEditor
                owner={resolved}
                ownerKind="node"
                fieldChanges={fieldChanges}
                onEdit={(propertyIndex, field, value) => onEditProperty("node", resolved.index, propertyIndex, field, value)}
                onAdd={() => onAddProperty("node", resolved.index)}
                onDelete={(propertyIndex) => onDeleteProperty("node", resolved.index, propertyIndex)}
              />
              <button className="danger-action" type="button" onClick={() => onDeleteSelected(resolved)}>
                <Trash2 size={16} />
                Delete node and connected relations
              </button>
            </>
          ) : (
            <>
              <div className="edge-route">
                <span>{resolved.entity.source_type}</span>
                <strong>{resolved.entity.relation}</strong>
                <span>{resolved.entity.target_type}</span>
              </div>
              <EditableField
                label="Source node type"
                value={resolved.entity.source_type ?? ""}
                diff={fieldChanges.get(fieldPathFor(resolved.entityKey, "source_type"))}
                onCommit={(value) => onEditEdgeField(resolved.index, "source_type", value)}
              />
              <EditableField
                label="Relation"
                value={resolved.entity.relation ?? ""}
                diff={fieldChanges.get(fieldPathFor(resolved.entityKey, "relation"))}
                onCommit={(value) => onEditEdgeField(resolved.index, "relation", value)}
              />
              <EditableField
                label="Target node type"
                value={resolved.entity.target_type ?? ""}
                diff={fieldChanges.get(fieldPathFor(resolved.entityKey, "target_type"))}
                onCommit={(value) => onEditEdgeField(resolved.index, "target_type", value)}
              />
              <EditableField
                label="Description"
                value={resolved.entity.description ?? ""}
                multiline
                diff={fieldChanges.get(fieldPathFor(resolved.entityKey, "description"))}
                onCommit={(value) => onEditEdgeField(resolved.index, "description", value)}
              />
              <SupportEditor
                owner={resolved}
                fieldChanges={fieldChanges}
                onCommit={(value) => onEditEdgeField(resolved.index, "supported_by_books", listLines(value))}
              />
              <PropertiesEditor
                owner={resolved}
                ownerKind="edge"
                fieldChanges={fieldChanges}
                onEdit={(propertyIndex, field, value) => onEditProperty("edge", resolved.index, propertyIndex, field, value)}
                onAdd={() => onAddProperty("edge", resolved.index)}
                onDelete={(propertyIndex) => onDeleteProperty("edge", resolved.index, propertyIndex)}
              />
              <button className="danger-action" type="button" onClick={() => onDeleteSelected(resolved)}>
                <Trash2 size={16} />
                Delete relation
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

function ChangeLog({ changes, activeChangeId, onSelectChange, onRevertChange, onSave }) {
  return (
    <aside className="change-log">
      <div className="change-log-header">
        <div>
          <span>Review trail</span>
          <strong>{changes.length} changes</strong>
        </div>
        <button className="change-log-save" type="button" onClick={onSave} title="Save review package">
          <Save size={18} />
        </button>
      </div>
      {changes.length === 0 ? (
        <div className="empty-log">
          <FileJson size={22} />
          <span>No edits yet.</span>
        </div>
      ) : (
        <div className="change-stack">
          {changes.map((change) => (
            <article
              className={`change-card ${change.action} ${change.id === activeChangeId ? "active" : ""}`}
              key={change.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectChange(change)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectChange(change);
                }
              }}
            >
              <div className="change-card-top">
                <span>{change.action}</span>
                <small>{new Date(change.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
              </div>
              <strong>{change.targetLabel}</strong>
              <em>{change.fieldLabel || change.entityKind}</em>
              <div className="change-diff">
                {change.action !== "add" && <del>{truncate(change.oldValue ?? change.oldEntity, 72)}</del>}
                {change.action !== "delete" && <ins>{truncate(change.newValue ?? change.newEntity, 72)}</ins>}
              </div>
              <div className="change-actions">
                <button
                  type="button"
                  title="Focus this change"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectChange(change);
                  }}
                >
                  <Focus size={13} /> Focus
                </button>
                <button
                  type="button"
                  title="Revert this change"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRevertChange(change.id);
                  }}
                >
                  <RotateCcw size={13} /> Revert
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </aside>
  );
}

function GraphCanvas({ graph, query, category, selected, setSelected, cyRef, relayoutSignal }) {
  const containerRef = useRef(null);
  const layoutRef = useRef(null);

  function stopActiveLayout() {
    const activeLayout = layoutRef.current;
    if (activeLayout?.stop) {
      try {
        activeLayout.stop();
      } catch {
        // Cytoscape layouts may already be stopped during React teardown.
      }
    }
    layoutRef.current = null;
  }

  function runLayout(cy) {
    if (!cy || (typeof cy.destroyed === "function" && cy.destroyed())) return;
    stopActiveLayout();
    const nextLayout = cy.layout(getLayoutOptions(graph?.stats?.nodes ?? 0));
    layoutRef.current = nextLayout;
    nextLayout.one("layoutstop", () => {
      if (layoutRef.current === nextLayout) layoutRef.current = null;
      requestAnimationFrame(() => {
        if (!cy || (typeof cy.destroyed === "function" && cy.destroyed())) return;
        cy.fit(cy.elements().not(".hidden-by-filter"), 58);
      });
    });
    nextLayout.run();
  }

  useEffect(() => {
    if (!containerRef.current || !graph?.elements?.length) return undefined;

    const cy = cytoscape({
      container: containerRef.current,
      elements: graph.elements,
      boxSelectionEnabled: false,
      autoungrabify: true,
      autounselectify: true,
      selectionType: "single",
      minZoom: 0.03,
      maxZoom: 5,
      wheelSensitivity: 0.32,
      style: [
        {
          selector: "core",
          style: {
            "active-bg-color": "transparent",
            "active-bg-opacity": 0,
            "active-bg-size": 0,
            "selection-box-color": "transparent",
            "selection-box-opacity": 0,
            "selection-box-border-width": 0,
          },
        },
        {
          selector: "node",
          style: {
            width: "data(nodeSize)",
            height: "data(nodeSize)",
            "background-color": "data(color)",
            "border-width": 2,
            "border-color": "#ffffff",
            label: "data(label)",
            color: "#172033",
            "font-size": 11,
            "font-weight": 800,
            "text-wrap": "wrap",
            "text-max-width": "data(textMaxWidth)",
            "text-valign": "center",
            "text-halign": "center",
            "line-height": 1.08,
            "overlay-opacity": 0,
            "overlay-padding": 0,
          },
        },
        {
          selector: "node.placeholder",
          style: {
            "border-color": "#9ca3af",
            "border-style": "dashed",
            "background-opacity": 0.72,
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.7,
            "curve-style": "bezier",
            "target-arrow-shape": "triangle",
            "target-arrow-color": "#8b93a3",
            "line-color": "#b4bac6",
            label: "",
            "font-size": 8.5,
            color: "#334155",
            "text-background-color": "#ffffff",
            "text-background-opacity": 0.86,
            "text-background-padding": 2,
            "text-rotation": "autorotate",
            "overlay-opacity": 0,
            "overlay-padding": 0,
          },
        },
        {
          selector: ".change-added",
          style: {
            "border-width": 3,
            "border-color": "#139a63",
            "line-color": "#139a63",
            "target-arrow-color": "#139a63",
            "background-color": "#35b779",
            "z-index": 25,
          },
        },
        {
          selector: ".change-edited",
          style: {
            "border-width": 3,
            "border-color": "#d89b00",
            "line-color": "#d89b00",
            "target-arrow-color": "#d89b00",
            "z-index": 25,
          },
        },
        {
          selector: ".change-removed",
          style: {
            "border-width": 3,
            "border-color": "#d64545",
            "line-color": "#d64545",
            "target-arrow-color": "#d64545",
            "background-color": "#f06c68",
            "line-style": "dashed",
            opacity: 0.88,
            "z-index": 28,
          },
        },
        {
          selector: ".ghost",
          style: {
            opacity: 0.72,
            "border-style": "dashed",
          },
        },
        {
          selector: "node.active-change",
          style: {
            "border-width": 3,
            "underlay-color": "#d89b00",
            "underlay-opacity": 0.12,
            "underlay-padding": 7,
            "z-index": 50,
          },
        },
        {
          selector: "edge.active-change",
          style: {
            width: 3.2,
            "z-index": 50,
          },
        },
        {
          selector: ".dimmed",
          style: { opacity: 0.1 },
        },
        {
          selector: ".hidden-by-filter",
          style: { display: "none" },
        },
        {
          selector: ".matched",
          style: {
            "border-width": 5,
            "border-color": "#111827",
            "line-color": "#111827",
            "target-arrow-color": "#111827",
            "z-index": 30,
          },
        },
        {
          selector: "node.selected",
          style: {
            "border-width": 2,
            "border-color": "#0b1324",
            "underlay-color": "#0b1324",
            "underlay-opacity": 0.16,
            "underlay-padding": 8,
            "overlay-opacity": 0,
            "overlay-padding": 0,
            opacity: 1,
            "z-index": 60,
          },
        },
        {
          selector: "edge.selected",
          style: {
            width: 3,
            "line-color": "#0b1324",
            "target-arrow-color": "#0b1324",
            "overlay-opacity": 0,
            "overlay-padding": 0,
            opacity: 1,
            "z-index": 60,
          },
        },
        {
          selector: "node:selected, edge:selected",
          style: {
            "overlay-color": "transparent",
            "overlay-opacity": 0,
            "overlay-padding": 0,
          },
        },
        {
          selector: "node:active, edge:active",
          style: {
            "overlay-color": "transparent",
            "overlay-opacity": 0,
            "overlay-padding": 0,
            "underlay-opacity": 0,
          },
        },
        {
          selector: ".neighbor",
          style: {
            opacity: 1,
            "border-color": "#111827",
            "line-color": "#111827",
            "target-arrow-color": "#111827",
          },
        },
      ],
      layout: { name: "grid", fit: false, animate: false },
    });

    cyRef.current = cy;
    cy.on("tap", "node, edge", (event) => setSelected(event.target.data()));
    cy.on("tap", (event) => {
      if (event.target === cy) setSelected(null);
    });

    return () => {
      stopActiveLayout();
      cy.removeAllListeners();
      cy.elements().stop(true);
      cy.stop(true);
      if (!(typeof cy.destroyed === "function" && cy.destroyed())) cy.destroy();
      if (cyRef.current === cy) cyRef.current = null;
    };
  }, [graph, setSelected, cyRef]);

  useEffect(() => {
    runLayout(cyRef.current);
  }, [relayoutSignal, graph, cyRef]);

  useEffect(() => {
    const cy = cyRef.current;
    const container = containerRef.current;
    if (!cy || !container || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(() => {
      if (typeof cy.destroyed === "function" && cy.destroyed()) return;
      cy.resize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [cyRef, graph]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const normalizedQuery = query.trim().toLowerCase();
    cy.elements().removeClass("hidden-by-filter dimmed matched selected neighbor");

    if (category !== "all") {
      cy.nodes().forEach((node) => {
        if (node.data("category") !== category) node.addClass("hidden-by-filter");
      });
      cy.edges().forEach((edge) => {
        if (edge.source().hasClass("hidden-by-filter") || edge.target().hasClass("hidden-by-filter")) edge.addClass("hidden-by-filter");
      });
    }

    if (normalizedQuery) {
      const matched = cy.elements().filter((element) => !element.hasClass("hidden-by-filter") && String(element.data("searchText") ?? "").includes(normalizedQuery));
      const context = matched.union(matched.connectedEdges()).union(matched.connectedEdges().connectedNodes());
      cy.elements().not(context).not(".hidden-by-filter").addClass("dimmed");
      matched.addClass("matched");
    }

    if (selected?.entityKey) {
      const selectedElement = cy.elements().filter((element) => element.data("entityKey") === selected.entityKey).first();
      if (selectedElement?.length) {
        const focusSet = selectedElement.isNode()
          ? selectedElement.closedNeighborhood()
          : selectedElement.union(selectedElement.connectedNodes());
        const visibleFocusSet = focusSet.not(".hidden-by-filter");
        cy.elements().not(visibleFocusSet).not(".hidden-by-filter").addClass("dimmed");
        visibleFocusSet.removeClass("dimmed").addClass("neighbor");
        selectedElement.addClass("selected");
      }
    }
  }, [query, category, selected, graph, cyRef]);

  return <div className="graph-canvas" ref={containerRef} />;
}

function EntityModal({ mode, schema, onClose, onCreate }) {
  const [form, setForm] = useState({
    type: "",
    description: "",
    source_type: "",
    relation: "",
    target_type: "",
  });

  const nodeTypes = (schema?.node_types ?? []).map((node) => node.type);
  const isNode = mode === "node";
  const canSubmit = isNode ? form.type.trim() : form.source_type.trim() && form.relation.trim() && form.target_type.trim();

  function submit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    onCreate(form);
  }

  return (
    <div className="modal-backdrop">
      <form className="modal-panel" onSubmit={submit}>
        <div className="modal-header">
          <h3>{isNode ? "Add node type" : "Add relation type"}</h3>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {isNode ? (
          <>
            <label>Type<input value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))} autoFocus /></label>
            <label>Description<textarea rows={5} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
          </>
        ) : (
          <>
            <label>Source node type<input list="node-types" value={form.source_type} onChange={(event) => setForm((current) => ({ ...current, source_type: event.target.value }))} autoFocus /></label>
            <label>Relation<input value={form.relation} onChange={(event) => setForm((current) => ({ ...current, relation: event.target.value }))} /></label>
            <label>Target node type<input list="node-types" value={form.target_type} onChange={(event) => setForm((current) => ({ ...current, target_type: event.target.value }))} /></label>
            <label>Description<textarea rows={5} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
            <datalist id="node-types">
              {nodeTypes.map((type) => <option key={type} value={type} />)}
            </datalist>
          </>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={!canSubmit}>{isNode ? "Add node" : "Add relation"}</button>
        </div>
      </form>
    </div>
  );
}

function ReviewWorkspace({ onLogout }) {
  const [index, setIndex] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [baseSchema, setBaseSchema] = useState(null);
  const [schema, setSchema] = useState(null);
  const [changes, setChanges] = useState([]);
  const [selected, setSelected] = useState(null);
  const [activeChangeId, setActiveChangeId] = useState(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [leftNavOpen, setLeftNavOpen] = useState(true);
  const [rightRailOpen, setRightRailOpen] = useState(false);
  const [relayoutSignal, setRelayoutSignal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);
  const schemaRef = useRef(null);
  const changesRef = useRef([]);
  const cyRef = useRef(null);

  useEffect(() => {
    schemaRef.current = schema;
  }, [schema]);

  useEffect(() => {
    changesRef.current = changes;
  }, [changes]);

  useEffect(() => {
    let cancelled = false;
    fetch(publicPath("data/schema-index.json"))
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load schema index (${response.status})`);
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        setIndex(data);
        setActiveId(findFirstItem(data)?.id ?? null);
      })
      .catch((caught) => setError(caught.message))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const active = useMemo(() => findItem(index, activeId), [index, activeId]);

  useEffect(() => {
    if (!active?.item?.schemaPath) return undefined;
    let cancelled = false;
    setLoading(true);
    setSelected(null);
    setActiveChangeId(null);
    setQuery("");
    setCategory("all");
    setError("");

    fetch(publicPath(active.item.schemaPath))
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load schema (${response.status})`);
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        const local = loadReviewState(active.item.id);
        setBaseSchema(data);
        setSchema(local?.schema ?? data);
        setChanges(Array.isArray(local?.changes) ? local.changes : []);
      })
      .catch((caught) => setError(caught.message))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    saveReviewState(activeId, schema, changes);
  }, [activeId, schema, changes]);

  const reviewGraphState = useMemo(
    () => ({
      latestByEntity: latestByEntity(changes),
    }),
    [changes],
  );
  const graph = useMemo(() => buildGraphElements(schema, reviewGraphState), [schema, reviewGraphState]);
  const fieldChanges = useMemo(() => latestByField(changes), [changes]);

  const changeCounts = useMemo(() => {
    const counts = {};
    for (const kg of index?.kgs ?? []) {
      for (const item of kg.items ?? []) {
        counts[item.id] = (loadReviewState(item.id)?.changes ?? []).length;
      }
    }
    if (activeId) counts[activeId] = changes.length;
    return counts;
  }, [index, activeId, changes.length]);

  function commit(nextSchema, change, nextSelected = null) {
    schemaRef.current = nextSchema;
    setSchema(nextSchema);
    setChanges((current) => [change, ...current]);
    setActiveChangeId(change.id);
    if (nextSelected) {
      setSelected(nextSelected);
      setRightRailOpen(true);
    }
  }

  function editNodeField(index, field, value) {
    const current = schemaRef.current;
    const node = current?.node_types?.[index];
    if (!node) return;
    const oldValue = node[field];
    if (JSON.stringify(oldValue ?? "") === JSON.stringify(value ?? "")) return;

    const next = deepClone(current);
    const nextNode = next.node_types[index];
    const oldType = nextNode.type;
    let newEntityKey = nodeEntityKey(oldType);
    const oldEntityKey = nodeEntityKey(oldType);

    if (field === "type") {
      const nextType = String(value || "").trim();
      if (!nextType || next.node_types.some((candidate, candidateIndex) => candidateIndex !== index && candidate.type === nextType)) {
        window.alert("Node type must be unique and non-empty.");
        return;
      }
      nextNode.type = nextType;
      next.edge_types = (next.edge_types ?? []).map((edge) => ({
        ...edge,
        source_type: edge.source_type === oldType ? nextType : edge.source_type,
        target_type: edge.target_type === oldType ? nextType : edge.target_type,
      }));
      newEntityKey = nodeEntityKey(nextType);
    } else {
      nextNode[field] = value;
    }

    const change = makeChange({
      action: "edit",
      entityKind: "node",
      entityKey: newEntityKey,
      affectedKeys: [oldEntityKey, newEntityKey],
      targetLabel: field === "type" ? String(value) : nextNode.type,
      fieldLabel: field.replace(/_/g, " "),
      fieldPath: fieldPathFor(newEntityKey, field),
      oldValue,
      newValue: value,
      oldEntity: node,
      newEntity: nextNode,
    });
    commit(next, change, { kind: "node", entityKey: newEntityKey });
  }

  function editEdgeField(index, field, value) {
    const current = schemaRef.current;
    const edge = current?.edge_types?.[index];
    if (!edge) return;
    const oldValue = edge[field];
    if (JSON.stringify(oldValue ?? "") === JSON.stringify(value ?? "")) return;

    const next = deepClone(current);
    const oldKey = edgeEntityKey(edge, index);
    next.edge_types[index][field] = value;
    const newEdge = next.edge_types[index];
    const newKey = edgeEntityKey(newEdge, index);
    const change = makeChange({
      action: "edit",
      entityKind: "edge",
      entityKey: newKey,
      affectedKeys: [oldKey, newKey],
      edgeIndex: index,
      targetLabel: `${newEdge.source_type} -> ${newEdge.relation} -> ${newEdge.target_type}`,
      fieldLabel: field.replace(/_/g, " "),
      fieldPath: fieldPathFor(newKey, field),
      oldValue,
      newValue: value,
      oldEntity: edge,
      newEntity: newEdge,
    });
    commit(next, change, { kind: "edge", entityKey: newKey, schemaIndex: index });
  }

  function editProperty(ownerKind, ownerIndex, propertyIndex, field, value) {
    const current = schemaRef.current;
    const collection = ownerKind === "node" ? current?.node_types : current?.edge_types;
    const owner = collection?.[ownerIndex];
    const property = owner?.properties?.[propertyIndex];
    if (!property) return;
    const oldValue = property[field];
    if (String(oldValue ?? "") === String(value ?? "")) return;

    const next = deepClone(current);
    const nextOwner = (ownerKind === "node" ? next.node_types : next.edge_types)[ownerIndex];
    const ownerKey = ownerKind === "node" ? nodeEntityKey(owner.type) : edgeEntityKey(owner, ownerIndex);
    nextOwner.properties[propertyIndex][field] = value;
    const change = makeChange({
      action: "edit",
      entityKind: "property",
      ownerKind,
      entityKey: ownerKey,
      affectedKeys: [ownerKey],
      edgeIndex: ownerKind === "edge" ? ownerIndex : null,
      targetLabel: ownerKind === "node" ? owner.type : owner.relation,
      fieldLabel: `property ${property.name || propertyIndex + 1} ${field}`,
      fieldPath: `${fieldPathFor(ownerKey, "properties", propertyIndex, nextOwner.properties[propertyIndex].name)}.${field}`,
      oldValue,
      newValue: value,
      oldEntity: owner,
      newEntity: nextOwner,
    });
    commit(next, change, ownerKind === "node" ? { kind: "node", entityKey: ownerKey } : { kind: "edge", entityKey: ownerKey, schemaIndex: ownerIndex });
  }

  function addProperty(ownerKind, ownerIndex) {
    const current = schemaRef.current;
    const next = deepClone(current);
    const owner = (ownerKind === "node" ? next.node_types : next.edge_types)?.[ownerIndex];
    if (!owner) return;
    const ownerKey = ownerKind === "node" ? nodeEntityKey(owner.type) : edgeEntityKey(owner, ownerIndex);
    const newProperty = { name: "new_property", description: "Describe this property." };
    owner.properties = Array.isArray(owner.properties) ? owner.properties : [];
    owner.properties.push(newProperty);
    const change = makeChange({
      action: "add",
      entityKind: "property",
      ownerKind,
      entityKey: ownerKey,
      affectedKeys: [ownerKey],
      edgeIndex: ownerKind === "edge" ? ownerIndex : null,
      targetLabel: ownerKind === "node" ? owner.type : owner.relation,
      fieldLabel: "property",
      fieldPath: `${fieldPathFor(ownerKey, "properties", owner.properties.length - 1, newProperty.name)}.name`,
      oldValue: "",
      newValue: newProperty,
      oldEntity: null,
      newEntity: owner,
    });
    commit(next, change, ownerKind === "node" ? { kind: "node", entityKey: ownerKey } : { kind: "edge", entityKey: ownerKey, schemaIndex: ownerIndex });
  }

  function deleteProperty(ownerKind, ownerIndex, propertyIndex) {
    const current = schemaRef.current;
    const next = deepClone(current);
    const owner = (ownerKind === "node" ? next.node_types : next.edge_types)?.[ownerIndex];
    if (!owner?.properties?.[propertyIndex]) return;
    const ownerKey = ownerKind === "node" ? nodeEntityKey(owner.type) : edgeEntityKey(owner, ownerIndex);
    const oldProperty = owner.properties[propertyIndex];
    owner.properties.splice(propertyIndex, 1);
    const change = makeChange({
      action: "delete",
      entityKind: "property",
      ownerKind,
      entityKey: ownerKey,
      affectedKeys: [ownerKey],
      edgeIndex: ownerKind === "edge" ? ownerIndex : null,
      targetLabel: ownerKind === "node" ? owner.type : owner.relation,
      fieldLabel: `property ${oldProperty.name}`,
      fieldPath: `${fieldPathFor(ownerKey, "properties", propertyIndex, oldProperty.name)}.name`,
      oldValue: oldProperty,
      newValue: "",
      oldEntity: oldProperty,
      newEntity: null,
    });
    commit(next, change, ownerKind === "node" ? { kind: "node", entityKey: ownerKey } : { kind: "edge", entityKey: ownerKey, schemaIndex: ownerIndex });
  }

  function deleteSelected(resolved) {
    const current = schemaRef.current;
    const next = deepClone(current);
    if (resolved.kind === "node") {
      const node = current.node_types[resolved.index];
      const removedEdges = (current.edge_types ?? []).filter((edge) => edge.source_type === node.type || edge.target_type === node.type);
      next.node_types.splice(resolved.index, 1);
      next.edge_types = (next.edge_types ?? []).filter((edge) => edge.source_type !== node.type && edge.target_type !== node.type);
      const entityKey = nodeEntityKey(node.type);
      const oldEntity = { ...node, removedEdges };
      const change = makeChange({
        action: "delete",
        entityKind: "node",
        entityKey,
        affectedKeys: [entityKey],
        targetLabel: node.type,
        fieldLabel: "node",
        oldValue: oldEntity,
        newValue: "",
        oldEntity,
        newEntity: null,
      });
      commit(next, change, null);
      setSelected({ kind: "node", entityKey });
      return;
    }

    const edge = current.edge_types[resolved.index];
    next.edge_types.splice(resolved.index, 1);
    const entityKey = edgeEntityKey(edge, resolved.index);
    const change = makeChange({
      action: "delete",
      entityKind: "edge",
      entityKey,
      affectedKeys: [entityKey],
      edgeIndex: resolved.index,
      targetLabel: `${edge.source_type} -> ${edge.relation} -> ${edge.target_type}`,
      fieldLabel: "relation",
      oldValue: edge,
      newValue: "",
      oldEntity: edge,
      newEntity: null,
    });
    commit(next, change, { kind: "edge", entityKey, schemaIndex: resolved.index });
  }

  function createNode(form) {
    const current = schemaRef.current;
    if (!current) return;
    const type = form.type.trim();
    if ((current.node_types ?? []).some((node) => node.type === type)) {
      window.alert("Node type already exists.");
      return;
    }
    const next = deepClone(current);
    const node = { type, description: form.description.trim(), properties: [], supported_by_books: [] };
    next.node_types = [...(next.node_types ?? []), node];
    const entityKey = nodeEntityKey(type);
    const change = makeChange({
      action: "add",
      entityKind: "node",
      entityKey,
      affectedKeys: [entityKey],
      targetLabel: type,
      fieldLabel: "node",
      oldValue: "",
      newValue: node,
      oldEntity: null,
      newEntity: node,
    });
    setModal(null);
    commit(next, change, { kind: "node", entityKey });
  }

  function createEdge(form) {
    const current = schemaRef.current;
    if (!current) return;
    const next = deepClone(current);
    const edge = {
      source_type: form.source_type.trim(),
      relation: form.relation.trim(),
      target_type: form.target_type.trim(),
      description: form.description.trim(),
      properties: [],
      supported_by_books: [],
    };
    next.edge_types = [...(next.edge_types ?? []), edge];
    const index = next.edge_types.length - 1;
    const entityKey = edgeEntityKey(edge, index);
    const change = makeChange({
      action: "add",
      entityKind: "edge",
      entityKey,
      affectedKeys: [entityKey, nodeEntityKey(edge.source_type), nodeEntityKey(edge.target_type)],
      edgeIndex: index,
      targetLabel: `${edge.source_type} -> ${edge.relation} -> ${edge.target_type}`,
      fieldLabel: "relation",
      oldValue: "",
      newValue: edge,
      oldEntity: null,
      newEntity: edge,
    });
    setModal(null);
    commit(next, change, { kind: "edge", entityKey, schemaIndex: index });
  }

  function selectChange(change) {
    setActiveChangeId(change.id);
    if (change.entityKind === "edge" || change.ownerKind === "edge") setSelected({ kind: "edge", entityKey: change.entityKey, schemaIndex: change.edgeIndex });
    else setSelected({ kind: "node", entityKey: change.entityKey });
    setRightRailOpen(true);
  }

  function revertChange(changeId) {
    if (!baseSchema) return;
    const currentChanges = changesRef.current;
    const remainingChanges = currentChanges.filter((change) => change.id !== changeId);
    const nextSchema = rebuildSchemaWithChanges(baseSchema, remainingChanges);
    schemaRef.current = nextSchema;
    setSchema(nextSchema);
    setChanges(remainingChanges);
    if (activeChangeId === changeId) setActiveChangeId(null);
    setSelected(null);
  }

  function resetLocalEdits() {
    if (!baseSchema || !window.confirm("Reset this schema to the generated source and clear its local change trail?")) return;
    localStorage.removeItem(storageKey(activeId));
    setSchema(baseSchema);
    setChanges([]);
    setSelected(null);
    setActiveChangeId(null);
  }

  function exportReview() {
    downloadFile(`${activeId || "kg"}_review_package.json`, {
      schema_id: activeId,
      exported_at: new Date().toISOString(),
      final_schema: schema,
      changes,
    });
  }

  const fitGraph = () => cyRef.current?.fit(undefined, 76);
  const zoomGraph = (factor) => {
    const cy = cyRef.current;
    if (!cy) return;
    const level = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor));
    cy.animate(
      { zoom: { level, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } } },
      { duration: 90, easing: "ease-out" },
    );
  };
  const handleGraphSelection = useCallback((nextSelected) => {
    setSelected(nextSelected);
    if (nextSelected) setRightRailOpen(true);
  }, []);

  return (
    <div className={`app-shell ${leftNavOpen ? "nav-open" : "nav-collapsed"} ${rightRailOpen ? "rail-open" : "rail-closed"}`}>
      <Sidebar
        index={index}
        activeId={activeId}
        onSelect={setActiveId}
        changeCounts={changeCounts}
        collapsed={!leftNavOpen}
        onToggleCollapsed={() => setLeftNavOpen((value) => !value)}
      />

      <main className="workspace">
        <SchemaHeader schema={schema} active={active} changes={changes} />
        <Toolbar
          query={query}
          setQuery={setQuery}
          category={category}
          setCategory={setCategory}
          graph={graph}
          rightRailOpen={rightRailOpen}
          onToggleRightRail={() => setRightRailOpen((value) => !value)}
          onFit={fitGraph}
          onZoom={zoomGraph}
          onRelayout={() => setRelayoutSignal((value) => value + 1)}
          onAddNode={() => setModal("node")}
          onAddEdge={() => setModal("edge")}
          onExport={exportReview}
          onReset={resetLocalEdits}
          onLogout={onLogout}
        />

        <section className="graph-panel">
          {error && <div className="error-panel">{error}</div>}
          {loading && <div className="loading-panel">Loading schema</div>}
          {!loading && schema && (
            <GraphCanvas
              graph={graph}
              query={query}
              category={category}
              selected={selected}
              setSelected={handleGraphSelection}
              cyRef={cyRef}
              relayoutSignal={relayoutSignal}
            />
          )}
          <div className="graph-readout">
            <span>{graph.stats.declaredNodes ?? 0} node types</span>
            <span>{graph.stats.edges ?? 0} relation types</span>
            <span>{graph.stats.properties ?? 0} properties</span>
          </div>
        </section>
      </main>

      <div className="right-rail" aria-hidden={!rightRailOpen}>
        <Inspector
          selected={selected}
          schema={schema}
          active={active}
          graph={graph}
          fieldChanges={fieldChanges}
          onClose={() => setRightRailOpen(false)}
          onEditNodeField={editNodeField}
          onEditEdgeField={editEdgeField}
          onEditProperty={editProperty}
          onAddProperty={addProperty}
          onDeleteProperty={deleteProperty}
          onDeleteSelected={deleteSelected}
        />
        <ChangeLog changes={changes} activeChangeId={activeChangeId} onSelectChange={selectChange} onRevertChange={revertChange} onSave={exportReview} />
      </div>

      {modal && <EntityModal mode={modal} schema={schema} onClose={() => setModal(null)} onCreate={modal === "node" ? createNode : createEdge} />}
    </div>
  );
}

export default function App() {
  const [authorized, setAuthorized] = useState(() => sessionStorage.getItem(AUTH_KEY) === "yes");

  useEffect(() => {
    if (!authorized) navigateTo(ROUTE_ACCESS);
    else if (window.location.hash !== ROUTE_REVIEW) navigateTo(ROUTE_REVIEW);

    const onHashChange = () => {
      if (window.location.hash === ROUTE_REVIEW && sessionStorage.getItem(AUTH_KEY) !== "yes") {
        navigateTo(ROUTE_ACCESS);
        setAuthorized(false);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [authorized]);

  if (!authorized) {
    return <AccessGate onReady={() => setAuthorized(true)} />;
  }

  return (
    <ReviewWorkspace
      onLogout={() => {
        sessionStorage.removeItem(AUTH_KEY);
        setAuthorized(false);
        navigateTo(ROUTE_ACCESS);
      }}
    />
  );
}
