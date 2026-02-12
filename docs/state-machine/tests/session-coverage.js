import { StateRunner } from '../../../src/core/state-runner.js';
import { sessionStates, sessionInitial } from '../../../src/sync/session.js';
import { SESSION_TRANSITIONS, byKey, SESSION_STATE_ORDER } from './session-transition-ids.js';

const results = new Map();

export default {
  name: 'Session',
  run: sessionCoverage,
  render(container) {
    renderTimeline(container);
  }
};

async function sessionCoverage(driver, log) {
  log('step', 'Validation du registre');
  validateRegistry();
  log('pass', `${SESSION_TRANSITIONS.length} IDs correspondent à sessionStates`);

  for (const state of SESSION_STATE_ORDER) {
    const config = sessionStates[state];
    if (!config?.on) continue;

    const events = Object.entries(config.on);
    log('step', state);

    const stateResults = new Map();
    results.set(state, stateResults);

    for (const [event, transition] of events) {
      const target = typeof transition === 'string' ? transition : transition.target;
      const selfLoop = state === target;
      const tid = byKey.get(`${state}:${event}`);

      const sm = new StateRunner(sessionStates, sessionInitial);
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
  log('pass', `${SESSION_TRANSITIONS.length} transitions = 100%`);
}

function validateRegistry() {
  for (const t of SESSION_TRANSITIONS) {
    const stateConfig = sessionStates[t.from];
    if (!stateConfig?.on) throw new Error(`#${t.id}: état ${t.from} inconnu dans sessionStates`);
    const transition = stateConfig.on[t.event];
    if (!transition) throw new Error(`#${t.id}: événement ${t.event} inconnu dans ${t.from}`);
    const target = typeof transition === 'string' ? transition : transition.target;
    if (target !== t.to) throw new Error(`#${t.id}: cible ${t.to} != ${target}`);
  }

  for (const [state, config] of Object.entries(sessionStates)) {
    if (!config.on) continue;
    for (const event of Object.keys(config.on)) {
      if (!byKey.has(`${state}:${event}`)) {
        throw new Error(`${state}:${event} absent du registre session-transition-ids.js`);
      }
    }
  }
}

function renderTimeline(container) {
  const legend = document.createElement('div');
  legend.className = 'sm-legend';
  legend.innerHTML = `<span class="sm-legend-item peerjs">✓ ${SESSION_TRANSITIONS.length} transitions testées</span>`;
  container.appendChild(legend);

  const el = document.createElement('div');
  el.className = 'sm-timeline';

  for (let i = 0; i < SESSION_STATE_ORDER.length; i++) {
    const state = SESSION_STATE_ORDER[i];
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

    if (i < SESSION_STATE_ORDER.length - 1) {
      const arrow = document.createElement('div');
      arrow.className = 'sm-arrow';
      arrow.innerHTML = '<span class="sm-arrow-line peerjs">│</span><span class="sm-arrow-line peerjs">▼</span>';
      el.appendChild(arrow);
    }
  }

  container.appendChild(el);
}
