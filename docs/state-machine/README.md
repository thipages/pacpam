# to-flowchart

Convertit des définitions de machines à états en diagrammes Mermaid.

Aucune dépendance. Fonctionne avec tout objet respectant le contrat ci-dessous.

## Contrat d'entrée

```javascript
const states = {
  STATE_NAME: {
    on: {
      EVENT: 'TARGET',                                    // transition simple
      EVENT: { target: 'TARGET' },                       // transition objet
      EVENT: { target: 'TARGET', guard: { sm, not } },   // avec garde
      EVENT: { target: 'TARGET', emit: { sm, event } },  // avec émission
      EVENT: { target: 'TARGET', action: fn },            // avec action
      EVENT: { target: 'TARGET', actionLabel: 'desc' },   // self-loop / label
      EVENT: { target: 'TARGET', manual: true }            // transition manuelle
    }
  }
};
```

## API

### `toFlowchart(states, options?)`

Convertit une seule machine à états.

**Retour** : `string` — diagramme Mermaid.

| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| `states` | `object` | — | Définitions d'états. |
| `options.initial` | `string` | — | État initial (mis en évidence). |
| `options.direction` | `string` | `'LR'` | Direction du layout. |

### `toFlowchartMulti(machines, options?)`

Convertit plusieurs machines avec subgraphs et cross-links.

**Retour** : `string` — diagramme Mermaid.

| Param | Type | Description |
|-------|------|-------------|
| `machines` | `array` | `[{ id, states, initial, label }]` |
| `options.direction` | `string` | `'LR'` \| `'TB'` \| `'RL'` \| `'BT'` |

```javascript
toFlowchartMulti([
  { id: 'conn', states: connectionStates, initial: 'IDLE', label: 'Connexion' },
  { id: 'cb', states: cbStates, initial: 'CLOSED', label: 'Disjoncteur' }
], { direction: 'LR' });
```

## Fonctionnalités

- **Forward edges** : chemin naturel depuis l'état initial (flèches épaisses)
- **Guards / emits colorés** : références inter-machines avec palette de couleurs
- **Légende contextuelle** : générée automatiquement selon les fonctionnalités utilisées
- **Self-loops** : préfixe ↻ sur les transitions vers le même état
- **Cross-links** : flèches pointillées entre machines (guards et émissions)
- **Transitions manuelles** : colorées en orange

## Version

`// to-flowchart v1.0.0`
