import { StateRunner } from '../../../src/core/state-runner.js';
import { connectionStates, initial } from '../../../src/core/connection-states.js';
import { TRANSITIONS, byKey, STATE_ORDER, HAPPY_EVENTS } from './transition-ids.js';
import { render as renderGraph } from './sm-graph.js';

const results = new Map();

export default {
  name: 'Machine \u00e0 \u00e9tats connexion',
  run: smCoverage,
  render(container) {
    renderGraph(container);
    renderTimeline(container);
  }
};

async function smCoverage(driver, log) {
  // 1. Vérifier cohérence transition-ids ↔ connectionStates
  log('step', 'Validation du registre');
  validateRegistry();
  log('pass', `${TRANSITIONS.length} IDs correspondent \u00e0 connectionStates`);

  // 2. Tester chaque transition
  for (const state of STATE_ORDER) {
    const config = connectionStates[state];
    if (!config?.on) continue;

    const events = Object.entries(config.on);
    log('step', state);

    const stateResults = new Map();
    results.set(state, stateResults);

    for (const [event, transition] of events) {
      const target = typeof transition === 'string' ? transition : transition.target;
      const hasGuard = typeof transition === 'object' && transition.guard;
      const selfLoop = state === target;
      const tid = byKey.get(`${state}:${event}`);

      const sm = new StateRunner(connectionStates, initial);
      sm.current = state;
      if (hasGuard) sm.checkGuard = () => true;

      const sent = sm.send(event);
      if (!sent) throw new Error(`#${tid.id} ${state}--[${event}]-->${target}: send() false`);
      if (sm.current !== target) throw new Error(`#${tid.id} ${state}--[${event}]-->${target}: got ${sm.current}`);

      if (hasGuard) {
        const sm2 = new StateRunner(connectionStates, initial);
        sm2.current = state;
        sm2.checkGuard = () => false;
        if (sm2.send(event) !== false) throw new Error(`#${tid.id} guard should block`);
        if (sm2.current !== state) throw new Error(`#${tid.id} guard: state changed`);
      }

      stateResults.set(event, { id: tid.id, target, selfLoop, guard: hasGuard });
    }

    const summary = events.map(([ev]) => {
      const r = stateResults.get(ev);
      const label = r.selfLoop ? `${ev}\u21BA` : `${ev}\u2192${r.target}`;
      return `#${r.id} ${label}${r.guard ? ' [guard]' : ''}`;
    }).join(', ');

    log('pass', summary);
  }

  const guardCount = [...results.values()]
    .reduce((n, m) => n + [...m.values()].filter(r => r.guard).length, 0);
  log('step', 'Bilan');
  log('pass', `${TRANSITIONS.length} transitions + ${guardCount} guard = 100%`);
}

function validateRegistry() {
  // Chaque transition du registre doit exister dans connectionStates
  for (const t of TRANSITIONS) {
    const stateConfig = connectionStates[t.from];
    if (!stateConfig?.on) throw new Error(`#${t.id}: \u00e9tat ${t.from} inconnu dans connectionStates`);
    const transition = stateConfig.on[t.event];
    if (!transition) throw new Error(`#${t.id}: \u00e9v\u00e9nement ${t.event} inconnu dans ${t.from}`);
    const target = typeof transition === 'string' ? transition : transition.target;
    if (target !== t.to) throw new Error(`#${t.id}: cible ${t.to} != ${target} dans connectionStates`);
  }

  // Chaque transition de connectionStates doit être dans le registre
  for (const [state, config] of Object.entries(connectionStates)) {
    if (!config.on) continue;
    for (const event of Object.keys(config.on)) {
      if (!byKey.has(`${state}:${event}`)) {
        throw new Error(`${state}:${event} absent du registre transition-ids.js`);
      }
    }
  }
}

function renderTimeline(container) {
  // Légende
  const legend = document.createElement('div');
  legend.className = 'sm-legend';
  legend.innerHTML = `<span class="sm-legend-item peerjs">\u2713 ${TRANSITIONS.length} transitions testées</span>`;
  container.appendChild(legend);

  const el = document.createElement('div');
  el.className = 'sm-timeline';

  for (let i = 0; i < STATE_ORDER.length; i++) {
    const state = STATE_ORDER[i];
    const stateResults = results.get(state);
    const happyEvent = HAPPY_EVENTS[state];

    const node = document.createElement('div');
    node.className = 'sm-node';

    const name = document.createElement('div');
    name.className = 'sm-node-name';
    name.textContent = state;
    node.appendChild(name);

    if (stateResults) {
      for (const [event, r] of stateResults) {
        if (event === happyEvent) continue;
        const dev = document.createElement('div');
        dev.className = 'sm-dev peerjs';
        const label = r.selfLoop ? `${event} \u21BA` : `${event} \u2192 ${r.target}`;
        dev.textContent = `#${r.id} ${label}${r.guard ? ' [guard]' : ''}`;
        node.appendChild(dev);
      }
    }

    el.appendChild(node);

    if (happyEvent && stateResults?.has(happyEvent)) {
      const r = stateResults.get(happyEvent);
      const arrow = document.createElement('div');
      arrow.className = 'sm-arrow';
      arrow.innerHTML = `<span class="sm-arrow-line peerjs">\u2502</span><span class="sm-arrow-label peerjs">#${r.id} ${happyEvent}${r.guard ? ' [guard]' : ''}</span><span class="sm-arrow-line peerjs">\u25BC</span>`;
      el.appendChild(arrow);
    }
  }

  container.appendChild(el);
}
