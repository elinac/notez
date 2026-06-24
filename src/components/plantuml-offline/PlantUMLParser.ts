/**
 * PlantUML to DOT converter（DOT 生成，供测试等用途；正式渲染走 Tauri 随包 PlantUML）
 * Supports: class, sequence, component, usecase, state, activity, object diagrams
 */

export type PlantUMLDiagramType =
  | 'class'
  | 'sequence'
  | 'component'
  | 'activity'
  | 'usecase'
  | 'state'
  | 'object'
  | 'unknown';

export interface PlantUMLParseResult {
  type: PlantUMLDiagramType;
  dot: string;
  supported: boolean;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Strip @startuml / @enduml wrappers and comments */
function extractBody(source: string): string {
  return source
    .replace(/@startuml[^\n]*/g, '')
    .replace(/@enduml/g, '')
    .replace(/^'\s.*$/gm, '')   // single-line comments
    .replace(/\/'.+?'\//gs, '') // block comments
    .trim();
}

/** Escape special DOT characters inside label strings */
function escapeDot(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[{}|<>]/g, '\\$&');
}

/** Make a safe DOT node ID from an arbitrary string */
function nodeId(s: string): string {
  return s.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '_');
}

// ─────────────────────────────────────────────
// Diagram type detection
// ─────────────────────────────────────────────

export function detectDiagramType(source: string): PlantUMLDiagramType {
  const body = extractBody(source);

  // Activity: must check before state (both use keywords)
  // Note: do NOT treat a lone line `end` as activity here — that matches sequence `alt/opt/loop` fragments.
  if (/^\s*:(.*?);\s*$/m.test(body)) return 'activity';         // :action;
  if (/^\s*(if\s*\(|fork|fork\s+again|end\s+fork|while\s*\()/m.test(body)) return 'activity';
  
  // State machine
  if (/^\s*\[\*\]\s*(-->|->>)/m.test(body)) return 'state';
  if (/^\s*state\s+["']?\w/m.test(body)) return 'state';
  
  // Class diagram
  if (/^\s*(class|interface|abstract\s+class|abstract|enum)\s+["']?\w/m.test(body)) return 'class';
  if (/^\s*\w[\w\s]*\s+(--|<\|-{1,2}|-{1,2}\|>|\.\.|\.\..>|o--|--o|\*--|--\*)\s+\w/m.test(body)) return 'class';
  
  // Use case — must come before sequence (both can have 'actor')
  if (/^\s*usecase\s+/m.test(body)) return 'usecase';
  // (Use Case) line syntax — skip when `participant` exists: sequence messages often break
  // "(续行说明)" onto the next line, which is not a use case node.
  if (!/^\s*participant\s+/m.test(body) && /^\s*\(.*?\)/m.test(body)) return 'usecase';
  
  // Sequence diagram
  if (/^\s*(participant|actor)\s+/m.test(body)) return 'sequence';
  // A -> B : msg  or  A --> B : msg  or  A ->> B : msg  etc.
  if (/^\s*\w+\s*(--?>?>?|-\\\\|\/\/--|-x|->x|->o)\s*\w+\s*:/m.test(body)) return 'sequence';

  // Activity: lone start/stop/end lines (after sequence — avoids alt/end false positive)
  if (/^\s*(start|stop|end)\s*$/m.test(body)) return 'activity';
  
  // Component / deployment
  if (/^\s*\[.+\]\s*(-->?|\.\..>?|--)\s*\[.+\]/m.test(body)) return 'component';
  if (/^\s*(component|package|node|database|cloud|folder)\s+/m.test(body)) return 'component';
  
  // Object diagram
  if (/^\s*object\s+/m.test(body)) return 'object';

  return 'unknown';
}

// ─────────────────────────────────────────────
// Class diagram
// ─────────────────────────────────────────────

function classToDoc(source: string): string {
  const body = extractBody(source);
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);

  // name -> { label lines, stereotype }
  const classes = new Map<string, { members: string[]; stereotype: string }>();
  const edges: string[] = [];

  let currentClass = '';
  let insideClass = false;

  const ensureClass = (name: string) => {
    if (!classes.has(name)) classes.set(name, { members: [], stereotype: '' });
  };

  for (const line of lines) {
    // Class/interface declaration
    const declMatch = line.match(/^(class|interface|abstract\s+class|abstract|enum)\s+["']?([\w<>, ]+?)["']?(?:\s+<<(.+?)>>)?(?:\s+\{)?$/);
    if (declMatch) {
      const kind = declMatch[1].startsWith('abstract') ? 'abstract class' : declMatch[1];
      const rawName = declMatch[2].trim();
      // strip generic for node key
      const name = rawName.replace(/<.*>/, '').trim();
      const stereo = declMatch[3] || kind !== 'class' ? (declMatch[3] || kind) : '';
      ensureClass(name);
      if (stereo) classes.get(name)!.stereotype = stereo;
      currentClass = name;
      insideClass = line.endsWith('{');
      continue;
    }

    // Opening brace alone
    if (line === '{' && currentClass) { insideClass = true; continue; }
    // Closing brace
    if (line === '}') { insideClass = false; currentClass = ''; continue; }

    // Member inside class body: +/-/~ field or method
    if (insideClass && currentClass && /^[+\-~#]/.test(line)) {
      classes.get(currentClass)!.members.push(escapeDot(line));
      continue;
    }

    // Relationship line: A --> B : label
    // Supports: --> -- ..> .. <|-- --|> o-- --o *-- --* <-- <>-- +-- --+
    const relPattern = /^["']?([\w ]+?)["']?\s*(<?\.{2}>?|<?\|?-{1,2}\|?>?|<?\*-{1,2}\*?>?|<?o-{1,2}o?>?)\s*["']?([\w ]+?)["']?(?:\s*:\s*(.+))?$/;
    const relMatch = line.match(relPattern);
    if (relMatch) {
      const from = relMatch[1].trim();
      const rel = relMatch[2].trim();
      const to = relMatch[3].trim();
      const label = relMatch[4]?.trim() ?? '';
      ensureClass(from);
      ensureClass(to);

      let attrs = '';
      if (rel.includes('<|') || rel.includes('|>')) {
        attrs = 'arrowhead=empty, arrowtail=none';
      } else if (rel.includes('*')) {
        attrs = 'arrowhead=diamond';
      } else if (rel.includes('o')) {
        attrs = 'arrowhead=odiamond';
      } else if (rel.includes('..')) {
        attrs = 'style=dashed, arrowhead=open';
      } else if (rel.includes('->') || rel.includes('<-')) {
        attrs = 'arrowhead=open';
      } else {
        attrs = 'arrowhead=none';
      }
      if (label) attrs += `, label="${escapeDot(label)}"`;

      edges.push(`  "${nodeId(from)}" -> "${nodeId(to)}" [${attrs}]`);
      continue;
    }

    // Namespace / package block header - skip
    if (/^(namespace|package)\s+/.test(line) || line === '}') continue;
  }

  // Build record-style nodes
  const nodes: string[] = [];
  for (const [name, info] of classes) {
    const id = nodeId(name);
    const stereoLine = info.stereotype ? `\\n«${escapeDot(info.stereotype)}»` : '';
    const memberLines = info.members.length
      ? '|' + info.members.map(m => escapeDot(m)).join('\\l') + '\\l'
      : '';
    const label = `{${escapeDot(name)}${stereoLine}${memberLines}}`;
    nodes.push(`  "${id}" [shape=record, style=filled, fillcolor=lightyellow, label="${label}"]`);
  }

  return `digraph ClassDiagram {
  graph [rankdir=BT, fontname="Helvetica", splines=ortho, nodesep=0.8]
  node [fontname="Helvetica", shape=record, fontsize=10]
  edge [fontname="Helvetica", fontsize=9]
${nodes.join('\n')}
${edges.join('\n')}
}`;
}

// ─────────────────────────────────────────────
// Sequence diagram
// ─────────────────────────────────────────────

function sequenceToDot(source: string): string {
  const body = extractBody(source);
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);

  const participants = new Map<string, { label: string; shape: string }>();
  const edges: string[] = [];

  const ensureParticipant = (alias: string, label?: string, isActor = false) => {
    if (!participants.has(alias)) {
      participants.set(alias, {
        label: label ?? alias,
        shape: isActor ? 'plaintext' : 'box',
      });
    }
  };

  for (const line of lines) {
    // participant / actor declarations
    const partMatch = line.match(/^(participant|actor)\s+"?([^"]+?)"?(?:\s+as\s+(\w+))?\s*$/);
    if (partMatch) {
      const isActor = partMatch[1] === 'actor';
      const label = partMatch[2].trim();
      const alias = partMatch[3] ?? nodeId(label);
      ensureParticipant(alias, label, isActor);
      continue;
    }

    // Skip note, activate, deactivate, loop, alt, else, end, group lines (layout-only)
    if (/^(note|activate|deactivate|loop|alt|else|opt|group|end|break|ref|hnote|rnote)\b/i.test(line)) continue;

    // Message: A -> B : label   (all arrow variants)
    const msgMatch = line.match(/^(\w+)\s*(->>?|-->>?|-\\\\|\/\/--|->o|o->)\s*(\w+)\s*:\s*(.*)/);
    if (msgMatch) {
      const [, from, arrow, to, label] = msgMatch;
      ensureParticipant(from);
      ensureParticipant(to);
      const isDashed = arrow.startsWith('--');
      const isReturn = arrow.includes('>>');
      const edgeStyle = isDashed ? 'dashed' : 'solid';
      const arrowHead = isReturn ? 'vee' : 'open';
      edges.push(`  "${nodeId(from)}" -> "${nodeId(to)}" [label="${escapeDot(label)}", style=${edgeStyle}, arrowhead=${arrowHead}]`);
      continue;
    }

    // Self-message: A -> A : label
    const selfMatch = line.match(/^(\w+)\s*->>?\s*\1\s*:\s*(.*)/);
    if (selfMatch) {
      const [, who, label] = selfMatch;
      ensureParticipant(who);
      edges.push(`  "${nodeId(who)}" -> "${nodeId(who)}" [label="${escapeDot(label)}", style=dashed]`);
    }
  }

  const nodes = Array.from(participants.entries()).map(([alias, info]) => {
    const id = nodeId(alias);
    return `  "${id}" [label="${escapeDot(info.label)}", shape=${info.shape}, style=filled, fillcolor=lightblue]`;
  });

  return `digraph SequenceDiagram {
  graph [rankdir=LR, fontname="Helvetica", nodesep=1.2]
  node [fontname="Helvetica", fontsize=10]
  edge [fontname="Helvetica", fontsize=9]
${nodes.join('\n')}
${edges.join('\n')}
}`;
}

// ─────────────────────────────────────────────
// State machine diagram
// ─────────────────────────────────────────────

function stateToDot(source: string): string {
  const body = extractBody(source);
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);

  const states = new Set<string>();
  const edges: string[] = [];
  const startNodes: string[] = [];
  const endNodes: string[] = [];

  for (const line of lines) {
    // State declaration with description: state "Long Name" as S1
    const stateAlias = line.match(/^state\s+"([^"]+)"\s+as\s+(\w+)/);
    if (stateAlias) {
      states.add(nodeId(stateAlias[2]));
      continue;
    }
    // Simple state declaration
    const stateDecl = line.match(/^state\s+(\w+)(?:\s*\{)?/);
    if (stateDecl) {
      states.add(nodeId(stateDecl[1]));
      continue;
    }

    // Transition: A --> B : label
    const transMatch = line.match(/^(\[?\*?\]?\w*\[?\*?\]?)\s*(-->?)\s*(\[?\*?\]?\w+\[?\*?\]?)(?:\s*:\s*(.*))?/);
    if (transMatch) {
      const [, from, , to, label] = transMatch;
      const labelAttr = label ? ` [label="${escapeDot(label.trim())}"]` : '';

      if (from === '[*]') {
        const sid = `__start${startNodes.length}`;
        startNodes.push(`  "${sid}" [shape=circle, style=filled, fillcolor=black, width=0.2, label=""]`);
        const toId = nodeId(to);
        states.add(toId);
        edges.push(`  "${sid}" -> "${toId}"${labelAttr}`);
      } else if (to === '[*]') {
        const eid = `__end${endNodes.length}`;
        endNodes.push(`  "${eid}" [shape=doublecircle, style=filled, fillcolor=black, width=0.25, label=""]`);
        const fromId = nodeId(from);
        states.add(fromId);
        edges.push(`  "${fromId}" -> "${eid}"${labelAttr}`);
      } else {
        const fromId = nodeId(from);
        const toId = nodeId(to);
        states.add(fromId);
        states.add(toId);
        edges.push(`  "${fromId}" -> "${toId}"${labelAttr}`);
      }
    }
  }

  const stateNodes = Array.from(states).map(
    id => `  "${id}" [shape=rounded, style=filled, fillcolor=lightcyan, label="${id}"]`
  );

  return `digraph StateDiagram {
  graph [rankdir=TB, fontname="Helvetica", nodesep=0.6]
  node [fontname="Helvetica", fontsize=10]
  edge [fontname="Helvetica", fontsize=9]
${startNodes.join('\n')}
${endNodes.join('\n')}
${stateNodes.join('\n')}
${edges.join('\n')}
}`;
}

// ─────────────────────────────────────────────
// Activity diagram
// ─────────────────────────────────────────────

function activityToDot(source: string): string {
  const body = extractBody(source);
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);

  const nodes: string[] = [];
  const edges: string[] = [];

  let prevId = '';
  let nodeCounter = 0;
  const mkId = (prefix: string) => `${prefix}_${nodeCounter++}`;

  // Pending branch tracking for if/else/endif
  const branchStack: { endIds: string[] }[] = [];

  const connect = (fromId: string, toId: string, label = '') => {
    if (fromId) {
      const lbl = label ? ` [label="${escapeDot(label)}"]` : '';
      edges.push(`  "${fromId}" -> "${toId}"${lbl}`);
    }
  };

  for (const line of lines) {
    // start / stop / end
    if (/^start\s*$/i.test(line)) {
      const id = mkId('start');
      nodes.push(`  "${id}" [shape=circle, style=filled, fillcolor=black, width=0.3, label=""]`);
      connect(prevId, id);
      prevId = id;
      continue;
    }
    if (/^(stop|end)\s*$/i.test(line)) {
      const id = mkId('stop');
      nodes.push(`  "${id}" [shape=doublecircle, style=filled, fillcolor=black, width=0.35, label=""]`);
      connect(prevId, id);
      // also connect pending branch ends
      if (branchStack.length > 0) {
        branchStack[branchStack.length - 1].endIds.forEach(eid => connect(eid, id));
        branchStack.pop();
      }
      prevId = id;
      continue;
    }

    // :action; or :action:
    const actionMatch = line.match(/^:(.*?)[;:]\s*$/);
    if (actionMatch) {
      const id = mkId('act');
      nodes.push(`  "${id}" [shape=box, style="filled,rounded", fillcolor=lightyellow, label="${escapeDot(actionMatch[1].trim())}"]`);
      connect(prevId, id);
      prevId = id;
      continue;
    }

    // if (condition) then (yes)
    const ifMatch = line.match(/^if\s*\((.+?)\)\s*then(?:\s*\((.+?)\))?/i);
    if (ifMatch) {
      const id = mkId('if');
      nodes.push(`  "${id}" [shape=diamond, style=filled, fillcolor=lightyellow, label="${escapeDot(ifMatch[1])}"]`);
      connect(prevId, id, ifMatch[2] ?? 'yes');
      branchStack.push({ endIds: [] });
      prevId = id;
      continue;
    }

    // else (no)
    const elseMatch = line.match(/^else(?:\s*\((.+?)\))?/i);
    if (elseMatch && branchStack.length > 0) {
      // stash current prevId as a branch endpoint, reset to if node
      branchStack[branchStack.length - 1].endIds.push(prevId);
      // find the last diamond node
      const lastDiamond = nodes.slice().reverse().find(n => n.includes('shape=diamond'));
      const diamondId = lastDiamond?.match(/"(\w+)"/)?.[1] ?? '';
      prevId = diamondId;
      continue;
    }

    // endif
    if (/^endif\s*$/i.test(line)) {
      if (branchStack.length > 0) {
        const branch = branchStack.pop()!;
        const mergeId = mkId('merge');
        nodes.push(`  "${mergeId}" [shape=diamond, style=filled, fillcolor=lightgray, width=0.2, label=""]`);
        connect(prevId, mergeId);
        branch.endIds.forEach(eid => connect(eid, mergeId));
        prevId = mergeId;
      }
      continue;
    }

    // fork / fork again / end fork
    if (/^fork(\s+again)?\s*$/i.test(line)) {
      const id = mkId('fork');
      nodes.push(`  "${id}" [shape=box, style=filled, fillcolor=black, width=1.5, height=0.1, label=""]`);
      connect(prevId, id);
      prevId = id;
      continue;
    }
    if (/^end\s+fork\s*$/i.test(line)) {
      const id = mkId('join');
      nodes.push(`  "${id}" [shape=box, style=filled, fillcolor=black, width=1.5, height=0.1, label=""]`);
      connect(prevId, id);
      prevId = id;
      continue;
    }

    // -> bare arrow (anonymous transition label)
    const arrowMatch = line.match(/^-+>\s*(.*)/);
    if (arrowMatch && arrowMatch[1]) {
      const id = mkId('note');
      nodes.push(`  "${id}" [shape=note, style=filled, fillcolor=lightyellow, label="${escapeDot(arrowMatch[1])}"]`);
      connect(prevId, id);
      prevId = id;
      continue;
    }
  }

  return `digraph ActivityDiagram {
  graph [rankdir=TB, fontname="Helvetica", nodesep=0.5, ranksep=0.5]
  node [fontname="Helvetica", fontsize=10]
  edge [fontname="Helvetica", fontsize=9]
${nodes.join('\n')}
${edges.join('\n')}
}`;
}

// ─────────────────────────────────────────────
// Object diagram
// ─────────────────────────────────────────────

function objectToDot(source: string): string {
  const body = extractBody(source);
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);

  const objects = new Map<string, string[]>(); // id -> fields
  const edges: string[] = [];
  let currentObj = '';
  let insideObj = false;

  const ensureObj = (id: string) => { if (!objects.has(id)) objects.set(id, []); };

  for (const line of lines) {
    // object Foo {  or  object "Foo" as f {
    const objMatch = line.match(/^object\s+(?:"([^"]+)"\s+as\s+(\w+)|(\w+))(?:\s*\{)?/);
    if (objMatch) {
      const name = objMatch[1] ?? objMatch[3];
      const alias = objMatch[2] ?? objMatch[3];
      currentObj = nodeId(alias);
      ensureObj(currentObj);
      if (name !== alias) objects.get(currentObj)!.push(`«${escapeDot(name)}»`);
      insideObj = line.includes('{');
      continue;
    }

    if (line === '{' && currentObj) { insideObj = true; continue; }
    if (line === '}') { insideObj = false; currentObj = ''; continue; }

    // field = value inside object
    if (insideObj && currentObj && line.includes('=')) {
      objects.get(currentObj)!.push(escapeDot(line));
      continue;
    }

    // Relationship: obj1 --> obj2 : label
    const relMatch = line.match(/^(\w+)\s*(-->?|--|\.\.|\.\.>)\s*(\w+)(?:\s*:\s*(.+))?/);
    if (relMatch) {
      const [, from, rel, to, label] = relMatch;
      ensureObj(nodeId(from));
      ensureObj(nodeId(to));
      const isDashed = rel.includes('.');
      const lbl = label ? ` [label="${escapeDot(label.trim())}"]` : '';
      edges.push(`  "${nodeId(from)}" -> "${nodeId(to)}" [style=${isDashed ? 'dashed' : 'solid'}${lbl ? ',' + lbl.slice(2, -1) : ''}]`);
    }
  }

  const nodes = Array.from(objects.entries()).map(([id, fields]) => {
    const fieldPart = fields.length ? '|' + fields.join('\\l') + '\\l' : '';
    return `  "${id}" [shape=record, style=filled, fillcolor=lightblue, label="{${id}${fieldPart}}"]`;
  });

  return `digraph ObjectDiagram {
  graph [rankdir=LR, fontname="Helvetica", nodesep=0.8]
  node [fontname="Helvetica", fontsize=10]
  edge [fontname="Helvetica", fontsize=9]
${nodes.join('\n')}
${edges.join('\n')}
}`;
}

// ─────────────────────────────────────────────
// Component diagram
// ─────────────────────────────────────────────

function componentToDot(source: string): string {
  const body = extractBody(source);
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  const nodes = new Map<string, string>(); // id -> DOT line
  const edges: string[] = [];

  const addNode = (name: string, shape = 'component', color = 'lightyellow') => {
    const id = nodeId(name);
    if (!nodes.has(id)) {
      nodes.set(id, `  "${id}" [shape=${shape}, style=filled, fillcolor=${color}, label="${escapeDot(name)}"]`);
    }
    return id;
  };

  for (const line of lines) {
    // [Component] standalone
    const compStandalone = line.match(/^\[([^\]]+)\]$/);
    if (compStandalone) { addNode(compStandalone[1]); continue; }

    // (Interface)
    const intfStandalone = line.match(/^\(([^)]+)\)$/);
    if (intfStandalone) { addNode(intfStandalone[1], 'ellipse', 'lightcyan'); continue; }

    // database/cloud/node keyword
    const kwMatch = line.match(/^(database|cloud|node|folder|package)\s+"?([^"]+)"?\s*(?:\{)?/);
    if (kwMatch) { addNode(kwMatch[2], 'cylinder', 'lightgray'); continue; }

    // Edge: [A] --> [B] or [A] --> (B) or (A) --> [B]
    const edgeMatch = line.match(/[\[(]([^\]\[)]+)[\])]\s*(-->?|\.\.>?|--)[\s]*[\[(]([^\]\[)]+)[\])](?:\s*:\s*(.*))?/);
    if (edgeMatch) {
      const [, from, arrow, to, label] = edgeMatch;
      const fromId = addNode(from.trim());
      const toId = addNode(to.trim());
      const isDashed = arrow.includes('.');
      const lbl = label ? `, label="${escapeDot(label.trim())}"` : '';
      edges.push(`  "${fromId}" -> "${toId}" [style=${isDashed ? 'dashed' : 'solid'}${lbl}]`);
    }
  }

  return `digraph ComponentDiagram {
  graph [rankdir=LR, fontname="Helvetica", nodesep=0.8]
  node [fontname="Helvetica", fontsize=10]
  edge [fontname="Helvetica", fontsize=9]
${Array.from(nodes.values()).join('\n')}
${edges.join('\n')}
}`;
}

// ─────────────────────────────────────────────
// Use case diagram
// ─────────────────────────────────────────────

function usecaseToDot(source: string): string {
  const body = extractBody(source);
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  const nodes = new Map<string, string>();
  const edges: string[] = [];

  const addActor = (name: string) => {
    const id = nodeId(name);
    if (!nodes.has(id)) {
      nodes.set(id, `  "${id}" [shape=plaintext, label="${escapeDot(name)}"]`);
    }
    return id;
  };
  const addUsecase = (name: string) => {
    const id = nodeId(name);
    if (!nodes.has(id)) {
      nodes.set(id, `  "${id}" [shape=ellipse, style=filled, fillcolor=lightyellow, label="${escapeDot(name)}"]`);
    }
    return id;
  };

  for (const line of lines) {
    const actorMatch = line.match(/^actor\s+["']?([^"'\n{]+?)["']?(?:\s+as\s+(\w+))?\s*$/);
    if (actorMatch) { addActor(actorMatch[2] ?? actorMatch[1].trim()); continue; }

    // usecase "Name" as UC1
    const ucAliasMatch = line.match(/^(?:usecase|:(.+?):)\s+"?([^"]+)"?\s+as\s+(\w+)/);
    if (ucAliasMatch) { addUsecase(ucAliasMatch[3]); continue; }

    // (Use Case Name)
    const ucMatch = line.match(/^\(([^)]+)\)(?!\s*-->)/);
    if (ucMatch) { addUsecase(ucMatch[1]); continue; }

    // Relationships
    const relMatch = line.match(/^["']?([^"']+?)["']?\s*(-->?|\.\.>\s*(?:<<\w+>>)?|--)\s*["']?([^"':\n]+?)["']?(?:\s*:\s*(.+))?$/);
    if (relMatch) {
      const [, rawFrom, arrow, rawTo, label] = relMatch;
      const from = rawFrom.replace(/[()]/g, '').trim();
      const to = rawTo.replace(/[()]/g, '').trim();
      const fromId = nodes.has(nodeId(from)) ? nodeId(from) : addUsecase(from);
      const toId = nodes.has(nodeId(to)) ? nodeId(to) : addUsecase(to);
      const isDashed = arrow.includes('.');
      const lbl = label ? `, label="${escapeDot(label.trim())}"` : '';
      edges.push(`  "${fromId}" -> "${toId}" [style=${isDashed ? 'dashed' : 'solid'}${lbl}]`);
    }
  }

  return `digraph UsecaseDiagram {
  graph [rankdir=LR, fontname="Helvetica", nodesep=0.8]
  node [fontname="Helvetica", fontsize=10]
  edge [fontname="Helvetica", fontsize=9]
${Array.from(nodes.values()).join('\n')}
${edges.join('\n')}
}`;
}

// ─────────────────────────────────────────────
// Generic fallback
// ─────────────────────────────────────────────

function genericToDot(source: string): string {
  const body = extractBody(source);
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  const edgeLines: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const match = line.match(/^["']?([\w][\w\s]*?)["']?\s*(-->?|--)\s*["']?([\w][\w\s]*?)["']?(?:\s*:\s*(.*))?$/);
    if (match) {
      const from = nodeId(match[1].trim());
      const to = nodeId(match[3].trim());
      const lbl = match[4]?.trim();
      seen.add(from);
      seen.add(to);
      edgeLines.push(`  "${from}" -> "${to}"${lbl ? ` [label="${escapeDot(lbl)}"]` : ''}`);
    }
  }

  const nodesDot = Array.from(seen).map(
    n => `  "${n}" [shape=box, style="filled,rounded", fillcolor=lightgray, label="${n}"]`
  );

  return `digraph Diagram {
  graph [fontname="Helvetica", nodesep=0.6]
  node [fontname="Helvetica", fontsize=10]
  edge [fontname="Helvetica", fontsize=9]
${nodesDot.join('\n')}
${edgeLines.join('\n')}
}`;
}

// ─────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────

export function plantUMLToDot(source: string): PlantUMLParseResult {
  const type = detectDiagramType(source);
  let dot = '';
  const supported = true; // all types now produce some output

  switch (type) {
    case 'class':     dot = classToDoc(source);     break;
    case 'sequence':  dot = sequenceToDot(source);  break;
    case 'state':     dot = stateToDot(source);     break;
    case 'activity':  dot = activityToDot(source);  break;
    case 'object':    dot = objectToDot(source);    break;
    case 'component': dot = componentToDot(source); break;
    case 'usecase':   dot = usecaseToDot(source);   break;
    default:          dot = genericToDot(source);   break;
  }

  return { type, dot, supported };
}
