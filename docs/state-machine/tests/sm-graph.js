import { connectionStates } from '../../../src/core/connection-states.js';
import { byKey, HAPPY_EVENTS } from './transition-ids.js';

export { renderGraph as render };

// --- Positions des états sur la grille ---
const POSITIONS = {
  IDLE:           { x: 150, y: 60 },
  INITIALIZING:   { x: 450, y: 60 },
  READY:          { x: 150, y: 210 },
  CONNECTING:     { x: 450, y: 210 },
  CONNECTED:      { x: 150, y: 360 },
  AUTHENTICATING: { x: 450, y: 360 }
};

const NODE_W = 140;
const NODE_H = 32;
const SVG_W = 650;
const SVG_H = 440;

// Offset de courbure par arête (perpendiculaire à la direction from→to).
// Signe : positif = gauche de la direction, négatif = droite.
const EDGE_OFFSETS = {
  'IDLE:INITIALIZING':          20,
  'INITIALIZING:IDLE':          20,
  'INITIALIZING:READY':         30,
  'READY:CONNECTING':           20,
  'CONNECTING:READY':           20,
  'READY:AUTHENTICATING':       25,
  'AUTHENTICATING:READY':       25,
  'READY:IDLE':                 20,
  'CONNECTING:AUTHENTICATING':  20,
  'CONNECTING:IDLE':           -30,
  'AUTHENTICATING:CONNECTED':   20,
  'AUTHENTICATING:IDLE':       -55,
  'CONNECTED:READY':            25,
  'CONNECTED:IDLE':            -45
};

// Arêtes du chemin nominal
const HAPPY_EDGES = new Set(
  Object.entries(HAPPY_EVENTS).map(([state, event]) => {
    const t = connectionStates[state].on[event];
    return `${state}:${typeof t === 'string' ? t : t.target}`;
  })
);

function extractEdges() {
  const edgeMap = new Map();
  for (const [state, config] of Object.entries(connectionStates)) {
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

  // Marker flèche
  const defs = document.createElementNS(ns, 'defs');
  const marker = document.createElementNS(ns, 'marker');
  marker.setAttribute('id', 'arrowhead');
  marker.setAttribute('markerWidth', '8');
  marker.setAttribute('markerHeight', '6');
  marker.setAttribute('refX', '8');
  marker.setAttribute('refY', '3');
  marker.setAttribute('orient', 'auto');
  const poly = document.createElementNS(ns, 'polygon');
  poly.setAttribute('points', '0 0, 8 3, 0 6');
  poly.setAttribute('fill', '#888');
  marker.appendChild(poly);
  defs.appendChild(marker);
  const markerH = marker.cloneNode(true);
  markerH.setAttribute('id', 'arrowhead-happy');
  markerH.querySelector('polygon').setAttribute('fill', '#4b8df8');
  defs.appendChild(markerH);
  svg.appendChild(defs);

  // Dessiner les arêtes
  for (const [key, ids] of edges) {
    const [from, to] = key.split(':');
    const label = ids.map(t => `#${t.id}`).join(' ');

    const key2 = `${from}:${to}`;
    const happy = HAPPY_EDGES.has(key2);
    if (from === to) {
      drawSelfLoop(svg, ns, POSITIONS[from], label);
    } else {
      drawEdge(svg, ns, POSITIONS[from], POSITIONS[to], key2, label, happy);
    }
  }

  // Dessiner les nœuds (par-dessus les arêtes)
  for (const [state, pos] of Object.entries(POSITIONS)) {
    const isInitial = state === 'IDLE';

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
  const cx = pos.x - NODE_W / 2 - 4;
  const cy = pos.y;
  const r = 14;

  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', `M ${cx} ${cy - 8} A ${r} ${r} 0 1 0 ${cx} ${cy + 8}`);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#888');
  path.setAttribute('stroke-width', '1');
  path.setAttribute('marker-end', 'url(#arrowhead)');
  svg.appendChild(path);

  const text = document.createElementNS(ns, 'text');
  text.setAttribute('x', cx - r - 4);
  text.setAttribute('y', cy + 3);
  text.setAttribute('text-anchor', 'end');
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

  // Intersection avec le bord du rectangle
  const hw = NODE_W / 2;
  const hh = NODE_H / 2;
  const start = rectIntersect(from.x, from.y, hw, hh, dx, dy);
  const end = rectIntersect(to.x, to.y, hw, hh, -dx, -dy);

  // Perpendiculaire (gauche de la direction)
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
  path.setAttribute('marker-end', happy ? 'url(#arrowhead-happy)' : 'url(#arrowhead)');
  svg.appendChild(path);

  // Label au point t=0.5 de la bézier quadratique + décalage perpendiculaire
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
