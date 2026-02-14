import { StateRunner } from '../../../src/core/state-runner.js';
import { circuitBreakerStates, initial } from '../../../src/security/circuit-breaker-states.js';
import { connectionStates } from '../../../src/core/connection-states.js';
import { CB_TRANSITIONS, byKey, CB_STATE_ORDER } from './cb-transition-ids.js';
import { byKey as smByKey } from './transition-ids.js';
import { render as renderGraph } from './cb-graph.js';

const results = new Map();

export default {
  name: 'Disjoncteur',
  run: cbCoverage,
  render(container) {
    renderGraph(container);
    renderLinks(container);
    renderTimeline(container);
  }
};

async function cbCoverage(driver, log) {
  log('step', 'Validation du registre');
  validateRegistry();
  log('pass', `${CB_TRANSITIONS.length} IDs correspondent à circuitBreakerStates`);

  for (const state of CB_STATE_ORDER) {
    const config = circuitBreakerStates[state];
    if (!config?.on) continue;

    const events = Object.entries(config.on);
    log('step', state);

    const stateResults = new Map();
    results.set(state, stateResults);

    for (const [event, transition] of events) {
      const target = typeof transition === 'string' ? transition : transition.target;
      const selfLoop = state === target;
      const tid = byKey.get(`${state}:${event}`);

      const sm = new StateRunner(circuitBreakerStates, initial);
      sm.current = state;

      const sent = sm.send(event);
      if (!sent) throw new Error(`#${tid.id} ${state}--[${event}]-->${target}: send() false`);
      if (sm.current !== target) throw new Error(`#${tid.id} ${state}--[${event}]-->${target}: got ${sm.current}`);

      stateResults.set(event, { id: tid.id, target, selfLoop });
    }

    const summary = events.map(([ev]) => {
      const r = stateResults.get(ev);
      const label = r.selfLoop ? `${ev}↺` : `${ev}→${r.target}`;
      return `#${r.id} ${label}`;
    }).join(', ');

    log('pass', summary);
  }

  log('step', 'Bilan');
  log('pass', `${CB_TRANSITIONS.length} transitions = 100%`);
}

function validateRegistry() {
  for (const t of CB_TRANSITIONS) {
    const stateConfig = circuitBreakerStates[t.from];
    if (!stateConfig?.on) throw new Error(`#${t.id}: état ${t.from} inconnu dans circuitBreakerStates`);
    const transition = stateConfig.on[t.event];
    if (!transition) throw new Error(`#${t.id}: événement ${t.event} inconnu dans ${t.from}`);
    const target = typeof transition === 'string' ? transition : transition.target;
    if (target !== t.to) throw new Error(`#${t.id}: cible ${t.to} != ${target}`);
  }

  for (const [state, config] of Object.entries(circuitBreakerStates)) {
    if (!config.on) continue;
    for (const event of Object.keys(config.on)) {
      if (!byKey.has(`${state}:${event}`)) {
        throw new Error(`${state}:${event} absent du registre cb-transition-ids.js`);
      }
    }
  }
}

function extractLinks() {
  const guards = [];
  const emits = [];
  for (const [state, config] of Object.entries(connectionStates)) {
    if (!config.on) continue;
    for (const [event, transition] of Object.entries(config.on)) {
      if (typeof transition !== 'object') continue;
      const smId = smByKey.get(`${state}:${event}`);
      const id = smId ? smId.id : '?';
      const target = transition.target;
      if (transition.guard?.sm === 'cb') {
        guards.push({ id, from: state, event, target, not: transition.guard.not });
      }
      if (transition.emit?.sm === 'cb') {
        emits.push({ id, from: state, event, target, cbEvent: transition.emit.event });
      }
    }
  }
  return { guards, emits };
}

function renderLinks(container) {
  const { guards, emits } = extractLinks();

  const section = document.createElement('div');
  section.style.cssText = 'font-size:0.72rem; color:#888; margin:8px 0; padding:6px 10px; border:1px solid #222; border-radius:4px; background:#161616;';

  const title = document.createElement('div');
  title.style.cssText = 'font-weight:600; color:#aaa; margin-bottom:4px;';
  title.textContent = 'Liens SM connexion → disjoncteur';
  section.appendChild(title);

  // Guards
  if (guards.length) {
    const h = document.createElement('div');
    h.style.cssText = 'color:#ff9800; margin-top:4px;';
    h.textContent = 'Gardes (consulte le CB avant transition)';
    section.appendChild(h);
    for (const g of guards) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:1px 0 1px 12px;';
      row.textContent = `#${g.id} ${g.from} → ${g.target} [${g.event}] — bloqué si CB = ${g.not}`;
      section.appendChild(row);
    }
  }

  // Emits
  if (emits.length) {
    const h = document.createElement('div');
    h.style.cssText = 'color:#4caf50; margin-top:4px;';
    h.textContent = 'Signaux (notifie le CB après transition)';
    section.appendChild(h);
    for (const e of emits) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:1px 0 1px 12px;';
      row.textContent = `#${e.id} ${e.from} → ${e.target} [${e.event}] — envoie ${e.cbEvent} au CB`;
      section.appendChild(row);
    }
  }

  container.appendChild(section);
}

function renderTimeline(container) {
  const legend = document.createElement('div');
  legend.className = 'sm-legend';
  legend.innerHTML = `<span class="sm-legend-item peerjs">✓ ${CB_TRANSITIONS.length} transitions testées</span>`;
  container.appendChild(legend);

  const el = document.createElement('div');
  el.className = 'sm-timeline';

  for (let i = 0; i < CB_STATE_ORDER.length; i++) {
    const state = CB_STATE_ORDER[i];
    const stateResults = results.get(state);

    const node = document.createElement('div');
    node.className = 'sm-node';

    const name = document.createElement('div');
    name.className = 'sm-node-name';
    name.textContent = i === 0 ? `▶ ${state}` : state;
    node.appendChild(name);

    if (stateResults) {
      for (const [event, r] of stateResults) {
        const dev = document.createElement('div');
        dev.className = 'sm-dev peerjs';
        const label = r.selfLoop ? `${event} ↺` : `${event} → ${r.target}`;
        dev.textContent = `#${r.id} ${label}`;
        node.appendChild(dev);
      }
    }

    el.appendChild(node);

    if (i < CB_STATE_ORDER.length - 1) {
      const arrow = document.createElement('div');
      arrow.className = 'sm-arrow';
      arrow.innerHTML = '<span class="sm-arrow-line peerjs">│</span><span class="sm-arrow-line peerjs">▼</span>';
      el.appendChild(arrow);
    }
  }

  container.appendChild(el);
}
