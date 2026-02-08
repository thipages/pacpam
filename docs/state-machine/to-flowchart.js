// to-flowchart v1.0.0
/**
 * Convertit plusieurs state machines en un diagramme Mermaid flowchart unique
 * avec subgraphs et cross-links pointilles (guards et emits).
 *
 * @param {Array<{id: string, states: object, initial: string, label: string}>} machines
 * @param {object} [options]
 * @param {string} [options.direction] - Direction du layout (LR, TB, RL, BT)
 * @returns {string} Diagramme Mermaid flowchart
 */
export function toFlowchartMulti(machines, options = {}) {
  const direction = options.direction || 'LR';
  const lines = [`flowchart ${direction}`];

  // Index des SM par id
  const smById = {};
  for (const m of machines) smById[m.id] = m;
  const smName = (id) => smById[id]?.label || id;

  // Palette de couleurs par ref (G1, E1, E2, ...)
  const refPalette = ['#3498db', '#27ae60', '#e74c3c', '#e67e22', '#9b59b6', '#1abc9c'];
  let refColorIndex = 0;

  // Refs cross-machine (dedup globale)
  const guardRefs = new Map();
  const emitRefs = new Map();
  let guardCount = 0;
  let emitCount = 0;

  // Tracking pour legende contextuelle
  let hasSelfLoop = false;
  let hasManual = false;
  let hasActionLabel = false;
  let totalForwardEdges = 0;

  function getGuardRef(g) {
    const key = g.not ? `${g.sm}:not:${g.not}` : `${g.sm}:is:${g.is}`;
    if (!guardRefs.has(key)) {
      guardCount++;
      guardRefs.set(key, {
        ref: `G${guardCount}`,
        sm: g.sm,
        smLabel: smName(g.sm),
        shortDesc: g.not ? `si pas ${g.not}` : `si ${g.is}`,
        color: refPalette[refColorIndex++ % refPalette.length],
        targetState: g.not || g.is
      });
    }
    return guardRefs.get(key);
  }

  function getEmitRef(e) {
    const key = `${e.sm}:${e.event}`;
    if (!emitRefs.has(key)) {
      emitCount++;
      emitRefs.set(key, {
        ref: `E${emitCount}`,
        sm: e.sm,
        smLabel: smName(e.sm),
        shortDesc: `notifie ${e.event}`,
        color: refPalette[refColorIndex++ % refPalette.length]
      });
    }
    return emitRefs.get(key);
  }

  function boldIf(label, bold) {
    return bold ? `<b>${label}</b>` : label;
  }

  // Index des liens pour linkStyle (global, toutes SM confondues)
  let linkIndex = 0;
  const manualLinks = [];
  const linkColorMap = new Map();

  function pushLink(line, { manual, color } = {}) {
    lines.push(line);
    if (manual) manualLinks.push(linkIndex);
    if (color) linkColorMap.set(linkIndex, color);
    linkIndex++;
  }

  // Collecter les cross-refs pour les flèches pointillees
  // Dedup par cle (prefixedSource, ref)
  const crossLinks = new Map();

  // Pre-calcul : SM la plus courte (pour y placer la legende)
  const shortest = machines.reduce((a, b) =>
    Object.keys(a.states).length <= Object.keys(b.states).length ? a : b
  );
  const shortestKeys = Object.keys(shortest.states);
  let shortestEndIndex = -1;

  // Generer chaque subgraph
  for (const { id: smId, states, initial, label } of machines) {
    const p = (name) => `${smId}_${name}`;

    // DFS forward edges pour cette SM
    const forwardEdges = new Set();
    if (initial) {
      const visited = new Set();
      const dfs = (state) => {
        if (visited.has(state)) return;
        visited.add(state);
        const transitions = states[state]?.on;
        if (!transitions) return;
        for (const [eventName, transition] of Object.entries(transitions)) {
          if (Array.isArray(transition)) {
            for (const t of transition) {
              if (!visited.has(t.target)) {
                forwardEdges.add(`${state}:${eventName}:${t.target}`);
                dfs(t.target);
              }
            }
          } else {
            const target = typeof transition === 'string' ? transition : transition?.target;
            if (target && target !== state && !visited.has(target)) {
              forwardEdges.add(`${state}:${eventName}:${target}`);
              dfs(target);
            }
          }
        }
      };
      forwardEdges.add(`_start_::${initial}`);
      dfs(initial);
      totalForwardEdges += forwardEdges.size;
    }

    function arrow(from, event, to) {
      return forwardEdges.has(`${from}:${event}:${to}`) ? '==>' : '-->';
    }

    function isForward(from, event, to) {
      return forwardEdges.has(`${from}:${event}:${to}`);
    }

    // Noeud deja declare (pour eviter redeclaration du display name)
    const declared = new Set();
    function node(name) {
      const prefixed = p(name);
      if (declared.has(prefixed)) return prefixed;
      declared.add(prefixed);
      return `${prefixed}["${name}"]`;
    }

    lines.push(`  subgraph ${smId}["<div style='font-size:20px;font-weight:bold'>${label}</div>"]`);

    // Etat initial
    if (initial) {
      const startId = p('start_');
      const startArrow = forwardEdges.has(`_start_::${initial}`) ? '==>' : '-->';
      pushLink(`    ${startId}(( )) ${startArrow} ${node(initial)}`);
    }

    // Transitions
    for (const [stateName, stateConfig] of Object.entries(states)) {
      const transitions = stateConfig.on;
      if (!transitions) continue;

      for (const [eventName, transition] of Object.entries(transitions)) {
        const target = typeof transition === 'string' ? transition : transition?.target;
        const isSelfLoop = target === stateName;
        const selfLoopPrefix = isSelfLoop ? '↻ ' : '';
        if (isSelfLoop) hasSelfLoop = true;

        if (typeof transition === 'string') {
          const forward = isForward(stateName, eventName, transition);
          pushLink(`    ${node(stateName)} ${arrow(stateName, eventName, transition)}|${boldIf(`${selfLoopPrefix}${eventName}`, forward)}| ${node(transition)}`);
        } else if (Array.isArray(transition)) {
          for (const t of transition) {
            const forward = isForward(stateName, eventName, t.target);
            const rawLabel = t.label
              ? `${eventName} #91;${t.label}#93;`
              : eventName;
            pushLink(`    ${node(stateName)} ${arrow(stateName, eventName, t.target)}|${boldIf(rawLabel, forward)}| ${node(t.target)}`);
          }
        } else if (typeof transition === 'object' && transition.target) {
          if (transition.manual) hasManual = true;
          if (transition.actionLabel) hasActionLabel = true;
          const forward = isForward(stateName, eventName, transition.target);
          let label = `${selfLoopPrefix}${eventName}`;
          let linkColor = null;
          if (transition.guardLabel) {
            label += ` #91;${transition.guardLabel}#93;`;
          }
          if (transition.guard) {
            const g = getGuardRef(transition.guard);
            label += ` #91;${g.ref}#93;`;
            linkColor = g.color;
            // Collecter cross-link (guard → etat cible dans la SM cible)
            const crossKey = `${p(stateName)}:${g.ref}`;
            if (!crossLinks.has(crossKey)) {
              crossLinks.set(crossKey, {
                source: p(stateName),
                ref: g.ref,
                target: `${g.sm}_${g.targetState}`,
                color: g.color
              });
            }
          }
          if (transition.actionLabel) {
            label += ` / ${transition.actionLabel}`;
            if (!linkColor) linkColor = '#9b59b6';
          }
          if (transition.emit) {
            const e = getEmitRef(transition.emit);
            linkColor = e.color;
            // Collecter cross-link (emit → subgraph de la SM cible)
            const crossKey = `${p(stateName)}:${e.ref}`;
            if (!crossLinks.has(crossKey)) {
              crossLinks.set(crossKey, {
                source: p(stateName),
                ref: e.ref,
                target: e.sm,
                color: e.color
              });
            }
          }
          pushLink(`    ${node(stateName)} ${arrow(stateName, eventName, transition.target)}|${boldIf(label, forward)}| ${node(transition.target)}`, {
            manual: !!transition.manual,
            color: linkColor
          });
        } else if (typeof transition === 'function') {
          console.warn(`[toFlowchartMulti] Transition opaque (function) ignoree: ${stateName}.on.${eventName}`);
        }
      }
    }

    if (smId === shortest.id) shortestEndIndex = lines.length;
    lines.push(`  end`);
  }

  // Cross-links pointilles (apres tous les subgraphs)
  for (const { source, ref, target, color } of crossLinks.values()) {
    pushLink(`  ${source} -.->|${ref}| ${target}`, { color });
  }

  // Couleurs des etats
  lines.push(`  classDef default fill:#cce5ff,stroke:#0d6efd,color:#000`);

  // Style des noeuds initiaux
  const startNodeIds = machines.map(m => `${m.id}_start_`);
  lines.push(`  classDef startNode fill:#000,stroke:#000,color:#000`);
  lines.push(`  class ${startNodeIds.join(',')} startNode`);

  // Couleurs des liens manuels
  if (manualLinks.length > 0) {
    lines.push(`  linkStyle ${manualLinks.join(',')} stroke:#e67e22,color:#e67e22`);
  }

  // Couleurs des liens par ref
  const colorGroups = new Map();
  for (const [idx, color] of linkColorMap) {
    if (!colorGroups.has(color)) colorGroups.set(color, []);
    colorGroups.get(color).push(idx);
  }
  for (const [color, indices] of colorGroups) {
    lines.push(`  linkStyle ${indices.join(',')} stroke:${color},color:${color}`);
  }

  // Legende contextuelle
  const legendItems = [];
  if (totalForwardEdges > 0) legendItems.push('━━ = chemin naturel');
  if (hasManual) legendItems.push('<font color="#e67e22">━━</font> = manual (dev)');
  if (hasSelfLoop) legendItems.push('↻ = self-loop');
  if (hasActionLabel) legendItems.push('<font color="#9b59b6">━━</font> / = action interne');
  if (crossLinks.size > 0) legendItems.push('-·-·- = cross-link');

  // Details guard dans la legende
  if (guardRefs.size > 0) {
    const byMachine = new Map();
    for (const g of guardRefs.values()) {
      if (!byMachine.has(g.smLabel)) byMachine.set(g.smLabel, []);
      byMachine.get(g.smLabel).push(g);
    }
    for (const [machine, guards] of byMachine) {
      legendItems.push(`---`);
      legendItems.push(`GARDE (${machine})`);
      for (const g of guards) legendItems.push(`<font color="${g.color}">${g.ref} - ${g.shortDesc}</font>`);
    }
  }

  // Details emit dans la legende
  if (emitRefs.size > 0) {
    const byMachine = new Map();
    for (const e of emitRefs.values()) {
      if (!byMachine.has(e.smLabel)) byMachine.set(e.smLabel, []);
      byMachine.get(e.smLabel).push(e);
    }
    for (const [machine, emits] of byMachine) {
      legendItems.push(`---`);
      legendItems.push(`SIGNAL (${machine})`);
      for (const e of emits) legendItems.push(`<font color="${e.color}">${e.ref} - ${e.shortDesc}</font>`);
    }
  }

  if (legendItems.length > 0) {
    const legendText = legendItems.join('<br/>');
    lines.push(`  classDef legend fill:#d4c5f9,stroke:#7c3aed,color:#1a1a2e,text-align:left`);
    // Inserer LEGEND a l'interieur du subgraph le plus court
    // pour qu'elle remplisse l'espace libre au lieu de creer une ile
    if (shortestEndIndex >= 0) {
      lines.splice(shortestEndIndex, 0, `    LEGEND["<div style='text-align:left;font-size:16px'>${legendText}</div>"]:::legend`);
      // Detecter si l'espace libre est a gauche ou a droite
      const incoming = [...crossLinks.values()].filter(cl =>
        !cl.source.startsWith(shortest.id + '_')
      );
      let anchorLeft = false;
      if (incoming.length > 0) {
        let totalPos = 0;
        for (const cl of incoming) {
          const srcMachine = machines.find(m => cl.source.startsWith(m.id + '_'));
          if (srcMachine) {
            const srcState = cl.source.slice(srcMachine.id.length + 1);
            const idx = Object.keys(srcMachine.states).indexOf(srcState);
            totalPos += idx >= 0 ? idx : 0;
          }
        }
        const avgPos = totalPos / incoming.length;
        const longestCount = Math.max(...machines.map(m => Object.keys(m.states).length));
        anchorLeft = avgPos > (longestCount - 1) / 2;
      }
      if (anchorLeft) {
        pushLink(`  LEGEND ~~~ ${shortest.id}_${shortestKeys[0]}`);
      } else {
        pushLink(`  ${shortest.id}_${shortestKeys[shortestKeys.length - 1]} ~~~ LEGEND`);
      }
    } else {
      lines.push(`  LEGEND["<div style='text-align:left;font-size:16px'>${legendText}</div>"]:::legend`);
    }
  }

  return lines.join('\n');
}

/**
 * Convertit une definition de state machine en diagramme Mermaid flowchart.
 *
 * @param {object} states - Objet conforme au contrat state machine
 * @param {object} [options]
 * @param {string} [options.initial] - Etat initial (genere _start_ --> INITIAL)
 * @param {object} [options.smNames] - Noms lisibles des machines externes ({ cb: 'Circuit Breaker' })
 * @param {string} [options.direction] - Direction du layout (LR, TB, RL, BT)
 * @returns {string} Diagramme Mermaid flowchart
 */
export function toFlowchart(states, options = {}) {
  const direction = options.direction || 'LR';
  const lines = [`flowchart ${direction}`];
  const smNames = options.smNames || {};
  const smName = (id) => smNames[id] || id;

  // Palette de couleurs par ref (G1, E1, E2, ...)
  const refPalette = ['#3498db', '#27ae60', '#e74c3c', '#e67e22', '#9b59b6', '#1abc9c'];
  let refColorIndex = 0;

  // Refs cross-machine (dedup globale)
  const guardRefs = new Map();
  const emitRefs = new Map();
  let guardCount = 0;
  let emitCount = 0;

  // Tracking pour legende contextuelle
  let hasSelfLoop = false;
  let hasManual = false;
  let hasActionLabel = false;

  function getGuardRef(g) {
    const key = g.not ? `${g.sm}:not:${g.not}` : `${g.sm}:is:${g.is}`;
    if (!guardRefs.has(key)) {
      guardCount++;
      guardRefs.set(key, {
        ref: `G${guardCount}`,
        smLabel: smName(g.sm),
        shortDesc: g.not ? `si pas ${g.not}` : `si ${g.is}`,
        color: refPalette[refColorIndex++ % refPalette.length]
      });
    }
    return guardRefs.get(key);
  }

  function getEmitRef(e) {
    const key = `${e.sm}:${e.event}`;
    if (!emitRefs.has(key)) {
      emitCount++;
      emitRefs.set(key, {
        ref: `E${emitCount}`,
        smLabel: smName(e.sm),
        shortDesc: `notifie ${e.event}`,
        color: refPalette[refColorIndex++ % refPalette.length]
      });
    }
    return emitRefs.get(key);
  }

  // DFS : calculer les forward edges (chemin naturel, fleches epaisses)
  const forwardEdges = new Set();
  if (options.initial) {
    const visited = new Set();
    const dfs = (state) => {
      if (visited.has(state)) return;
      visited.add(state);
      const transitions = states[state]?.on;
      if (!transitions) return;
      for (const [eventName, transition] of Object.entries(transitions)) {
        if (Array.isArray(transition)) {
          for (const t of transition) {
            if (!visited.has(t.target)) {
              forwardEdges.add(`${state}:${eventName}:${t.target}`);
              dfs(t.target);
            }
          }
        } else {
          const target = typeof transition === 'string' ? transition : transition?.target;
          if (target && target !== state && !visited.has(target)) {
            forwardEdges.add(`${state}:${eventName}:${target}`);
            dfs(target);
          }
        }
      }
    };
    forwardEdges.add(`_start_::${options.initial}`);
    dfs(options.initial);
  }

  // Index des liens pour linkStyle
  let linkIndex = 0;
  const manualLinks = [];
  const linkColorMap = new Map();

  function arrow(from, event, to) {
    return forwardEdges.has(`${from}:${event}:${to}`) ? '==>' : '-->';
  }

  function isForward(from, event, to) {
    return forwardEdges.has(`${from}:${event}:${to}`);
  }

  function pushLink(line, { manual, color } = {}) {
    lines.push(line);
    if (manual) manualLinks.push(linkIndex);
    if (color) linkColorMap.set(linkIndex, color);
    linkIndex++;
  }

  function boldIf(label, bold) {
    return bold ? `<b>${label}</b>` : label;
  }

  // Etat initial
  if (options.initial) {
    const startArrow = forwardEdges.has(`_start_::${options.initial}`) ? '==>' : '-->';
    pushLink(`  _start_(( )) ${startArrow} ${options.initial}`);
  }

  // Transitions
  for (const [stateName, stateConfig] of Object.entries(states)) {
    const transitions = stateConfig.on;
    if (!transitions) continue;

    for (const [eventName, transition] of Object.entries(transitions)) {
      const target = typeof transition === 'string' ? transition : transition?.target;
      const isSelfLoop = target === stateName;
      const selfLoopPrefix = isSelfLoop ? '↻ ' : '';
      if (isSelfLoop) hasSelfLoop = true;

      if (typeof transition === 'string') {
        const forward = isForward(stateName, eventName, transition);
        pushLink(`  ${stateName} ${arrow(stateName, eventName, transition)}|${boldIf(`${selfLoopPrefix}${eventName}`, forward)}| ${transition}`);
      } else if (Array.isArray(transition)) {
        for (const t of transition) {
          const forward = isForward(stateName, eventName, t.target);
          const rawLabel = t.label
            ? `${eventName} #91;${t.label}#93;`
            : eventName;
          pushLink(`  ${stateName} ${arrow(stateName, eventName, t.target)}|${boldIf(rawLabel, forward)}| ${t.target}`);
        }
      } else if (typeof transition === 'object' && transition.target) {
        if (transition.manual) hasManual = true;
        if (transition.actionLabel) hasActionLabel = true;
        const forward = isForward(stateName, eventName, transition.target);
        let label = `${selfLoopPrefix}${eventName}`;
        let linkColor = null;
        if (transition.guardLabel) {
          label += ` #91;${transition.guardLabel}#93;`;
        }
        if (transition.guard) {
          const g = getGuardRef(transition.guard);
          label += ` #91;${g.ref}#93;`;
          linkColor = g.color;
        }
        if (transition.actionLabel) {
          label += ` / ${transition.actionLabel}`;
          if (!linkColor) linkColor = '#9b59b6';
        }
        if (transition.emit) {
          const e = getEmitRef(transition.emit);
          linkColor = e.color;
        }
        pushLink(`  ${stateName} ${arrow(stateName, eventName, transition.target)}|${boldIf(label, forward)}| ${transition.target}`, {
          manual: !!transition.manual,
          color: linkColor
        });
      } else if (typeof transition === 'function') {
        console.warn(`[toFlowchart] Transition opaque (function) ignoree: ${stateName}.on.${eventName}`);
      }
    }
  }

  // Couleurs des etats
  const allStateNames = Object.keys(states);
  if (allStateNames.length > 0) {
    lines.push(`  classDef default fill:#cce5ff,stroke:#0d6efd,color:#000`);
  }

  // Style du noeud initial
  if (options.initial) {
    lines.push(`  classDef startNode fill:#000,stroke:#000,color:#000`);
    lines.push(`  class _start_ startNode`);
  }

  // Couleurs des liens manuels (priorite basse, ecrasee par ref si overlap)
  if (manualLinks.length > 0) {
    lines.push(`  linkStyle ${manualLinks.join(',')} stroke:#e67e22,color:#e67e22`);
  }

  // Couleurs des liens par ref (chaque ref a sa propre couleur)
  const colorGroups = new Map();
  for (const [idx, color] of linkColorMap) {
    if (!colorGroups.has(color)) colorGroups.set(color, []);
    colorGroups.get(color).push(idx);
  }
  for (const [color, indices] of colorGroups) {
    lines.push(`  linkStyle ${indices.join(',')} stroke:${color},color:${color}`);
  }

  // Legende contextuelle
  const legendItems = [];
  if (forwardEdges.size > 0) legendItems.push('━━ = chemin naturel');
  if (hasManual) legendItems.push('<font color="#e67e22">━━</font> = manual (dev)');
  if (hasSelfLoop) legendItems.push('↻ = self-loop');
  if (hasActionLabel) legendItems.push('<font color="#9b59b6">━━</font> / = action interne');

  // Details guard dans la legende
  if (guardRefs.size > 0) {
    const byMachine = new Map();
    for (const g of guardRefs.values()) {
      if (!byMachine.has(g.smLabel)) byMachine.set(g.smLabel, []);
      byMachine.get(g.smLabel).push(g);
    }
    for (const [machine, guards] of byMachine) {
      legendItems.push(`---`);
      legendItems.push(`GARDE (${machine})`);
      for (const g of guards) legendItems.push(`<font color="${g.color}">${g.ref} - ${g.shortDesc}</font>`);
    }
  }

  // Details emit dans la legende
  if (emitRefs.size > 0) {
    const byMachine = new Map();
    for (const e of emitRefs.values()) {
      if (!byMachine.has(e.smLabel)) byMachine.set(e.smLabel, []);
      byMachine.get(e.smLabel).push(e);
    }
    for (const [machine, emits] of byMachine) {
      legendItems.push(`---`);
      legendItems.push(`SIGNAL (${machine})`);
      for (const e of emits) legendItems.push(`<font color="${e.color}">${e.ref} - ${e.shortDesc}</font>`);
    }
  }

  if (legendItems.length > 0) {
    const legendText = legendItems.join('<br/>');
    lines.push(`  classDef legend fill:#d4c5f9,stroke:#7c3aed,color:#1a1a2e,text-align:left`);
    lines.push(`  LEGEND["<div style='text-align:left;font-size:16px'>${legendText}</div>"]:::legend`);
  }

  return lines.join('\n');
}
