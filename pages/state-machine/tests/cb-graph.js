import { circuitBreakerStates } from '../../../src/security/circuit-breaker-states.js';
import { byKey, CB_HAPPY_EVENTS } from './cb-transition-ids.js';

export { renderGraph as render };

const POSITIONS = {
  CLOSED:    { x: 200, y: 60 },
  OPEN:      { x: 400, y: 60 },
  HALF_OPEN: { x: 300, y: 200 }
};

const NODE_W = 110;
const NODE_H = 32;
const SVG_W = 500;
const SVG_H = 260;

const HAPPY_EDGES = new Set(
  Object.entries(CB_HAPPY_EVENTS).map(([state, event]) => {
    const t = circuitBreakerStates[state].on[event];
    return `${state}:${typeof t === 'string' ? t : t.target}`;
  })
);

const EDGE_OFFSETS = {
  'CLOSED:OPEN':      20,
  'OPEN:CLOSED':      20,
  'OPEN:HALF_OPEN':   20,
  'HALF_OPEN:OPEN':   20,
  'HALF_OPEN:CLOSED': 20
};

function extractEdges() {
  const edgeMap = new Map();
  for (const [state, config] of Object.entries(circuitBreakerStates)) {
    if (!config.on) continue;
    for (const [event, transition] of Object.entries(config.on)) {
      const target = typeof transition === 'string' ? transition : transition.target;
      const t = byKey.get(`${state}:${event}`);
      if (!t) continue;
      const key = `${state}:${target}`;
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push({ id: t.id, event });
    }
  }
  return edgeMap;
}

function rectIntersect(cx, cy, hw, hh, dx, dy) {
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const tx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

function renderGraph(container) {
  const edges = extractEdges();
  const allTransitions = [];
  for (const ids of edges.values()) {
    for (const t of ids) allTransitions.push(t);
  }
  allTransitions.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${SVG_W} ${SVG_H}`);
  svg.setAttribute('width', SVG_W);
  svg.setAttribute('height', SVG_H);
  svg.style.display = 'block';
  svg.style.margin = '8px auto';

  // Markers
  const defs = document.createElementNS(ns, 'defs');
  for (const [id, color] of [['cb-arrow', '#888'], ['cb-arrow-happy', '#4b8df8']]) {
    const marker = document.createElementNS(ns, 'marker');
    marker.setAttribute('id', id);
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('refX', '8');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const poly = document.createElementNS(ns, 'polygon');
    poly.setAttribute('points', '0 0, 8 3, 0 6');
    poly.setAttribute('fill', color);
    marker.appendChild(poly);
    defs.appendChild(marker);
  }
  svg.appendChild(defs);

  // Arêtes
  for (const [key, ids] of edges) {
    const [from, to] = key.split(':');
    const label = ids.map(t => `#${t.id}`).join(' ');
    const happy = HAPPY_EDGES.has(key);

    if (from === to) {
      drawSelfLoop(svg, ns, POSITIONS[from], label);
    } else {
      drawEdge(svg, ns, POSITIONS[from], POSITIONS[to], key, label, happy);
    }
  }

  // Nœuds
  for (const [state, pos] of Object.entries(POSITIONS)) {
    const isInitial = state === 'CLOSED';

    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', pos.x - NODE_W / 2);
    rect.setAttribute('y', pos.y - NODE_H / 2);
    rect.setAttribute('width', NODE_W);
    rect.setAttribute('height', NODE_H);
    rect.setAttribute('rx', 6);
    rect.setAttribute('fill', '#1a1a1a');
    rect.setAttribute('stroke', isInitial ? '#4b8df8' : '#333');
    rect.setAttribute('stroke-width', isInitial ? '2' : '1');
    svg.appendChild(rect);

    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', pos.x);
    text.setAttribute('y', pos.y + 4);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', '#4b8df8');
    text.setAttribute('font-size', '11');
    text.setAttribute('font-family', 'SF Mono, Consolas, Monaco, monospace');
    text.setAttribute('font-weight', '600');
    text.textContent = state;
    svg.appendChild(text);
  }

  container.appendChild(svg);

  // Tableau récapitulatif groupé par état cible
  const byTarget = new Map();
  for (const [key, ids] of edges) {
    const [from, to] = key.split(':');
    if (!byTarget.has(to)) byTarget.set(to, []);
    for (const t of ids) byTarget.get(to).push({ from, to, id: t.id, event: t.event, happy: HAPPY_EDGES.has(key) });
  }

  const table = document.createElement('table');
  table.style.cssText = 'font-size:0.72rem; color:#888; border-collapse:collapse; width:100%; margin-top:8px;';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr style="border-bottom:1px solid #333; color:#aaa;">'
    + '<th style="text-align:left; padding:3px 8px;">Vers</th>'
    + '<th style="text-align:left; padding:3px 8px;">De</th>'
    + '<th style="text-align:left; padding:3px 8px;">#</th>'
    + '<th style="text-align:left; padding:3px 8px;">Événement</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const [target, rows] of byTarget) {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #1a1a1a';
      if (i === 0) tr.style.borderTop = '1px solid #333';
      if (r.happy) tr.style.color = '#4b8df8';
      tr.innerHTML =
        `<td style="padding:2px 8px;">${i === 0 ? (r.from === target ? '↺' : target) : ''}</td>`
        + `<td style="padding:2px 8px;">${r.from === target ? '' : r.from}</td>`
        + `<td style="padding:2px 8px;">#${r.id}</td>`
        + `<td style="padding:2px 8px;">${r.event}</td>`;
      tbody.appendChild(tr);
    }
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

function drawSelfLoop(svg, ns, pos, label) {
  const cx = pos.x;
  const cy = pos.y - NODE_H / 2 - 4;
  const r = 14;

  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', `M ${cx - 8} ${cy} A ${r} ${r} 0 1 1 ${cx + 8} ${cy}`);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#888');
  path.setAttribute('stroke-width', '1');
  path.setAttribute('marker-end', 'url(#cb-arrow)');
  svg.appendChild(path);

  const text = document.createElementNS(ns, 'text');
  text.setAttribute('x', cx);
  text.setAttribute('y', cy - r - 4);
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('fill', '#aaa');
  text.setAttribute('font-size', '9');
  text.setAttribute('font-family', 'SF Mono, Consolas, Monaco, monospace');
  text.textContent = label;
  svg.appendChild(text);
}

function drawEdge(svg, ns, from, to, edgeKey, label, happy) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = dx / len;
  const ny = dy / len;

  const hw = NODE_W / 2;
  const hh = NODE_H / 2;
  const start = rectIntersect(from.x, from.y, hw, hh, dx, dy);
  const end = rectIntersect(to.x, to.y, hw, hh, -dx, -dy);

  const perpX = -ny;
  const perpY = nx;
  const offset = EDGE_OFFSETS[edgeKey] || 0;

  const mx = (start.x + end.x) / 2 + perpX * offset;
  const my = (start.y + end.y) / 2 + perpY * offset;

  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', `M ${start.x} ${start.y} Q ${mx} ${my} ${end.x} ${end.y}`);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', happy ? '#4b8df8' : '#555');
  path.setAttribute('stroke-width', happy ? '2.5' : '1');
  path.setAttribute('marker-end', happy ? 'url(#cb-arrow-happy)' : 'url(#cb-arrow)');
  svg.appendChild(path);

  const lx = 0.25 * start.x + 0.5 * mx + 0.25 * end.x;
  const ly = 0.25 * start.y + 0.5 * my + 0.25 * end.y;
  const labelPush = offset > 0 ? 8 : offset < 0 ? -8 : 0;

  const text = document.createElementNS(ns, 'text');
  text.setAttribute('x', lx + perpX * labelPush);
  text.setAttribute('y', ly + perpY * labelPush - 2);
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('fill', happy ? '#4b8df8' : '#aaa');
  text.setAttribute('font-size', '10');
  text.setAttribute('font-weight', happy ? '700' : '400');
  text.setAttribute('font-family', 'SF Mono, Consolas, Monaco, monospace');
  text.textContent = label;
  svg.appendChild(text);
}
