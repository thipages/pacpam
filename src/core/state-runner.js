export class StateRunner {
  constructor(states, initial) {
    this.states = states;
    this.current = initial;
    this.actions = {};         // { STATE: { entry: fn, exit: fn } }
    this.onTransition = null;  // (from, to, event) => void
    this.checkGuard = null;    // (guard) => boolean
    this.onEmit = null;        // (emit) => void
  }

  register(stateName, { entry, exit } = {}) {
    this.actions[stateName] = { entry, exit };
  }

  send(event) {
    const stateConfig = this.states[this.current];
    if (!stateConfig?.on) return false;
    const transition = stateConfig.on[event];
    if (!transition) return false;

    const targetState = typeof transition === 'string' ? transition : transition.target;
    if (!this.states[targetState]) return false;

    if (transition.guard && !this.checkGuard?.(transition.guard)) return false;

    const previous = this.current;
    if (previous !== targetState) {
      this.actions[previous]?.exit?.();
      this.current = targetState;
      this.onTransition?.(previous, targetState, event);
    }
    transition.action?.();
    if (previous !== targetState) {
      this.actions[targetState]?.entry?.();
    }
    if (transition.emit) this.onEmit?.(transition.emit);
    return true;
  }

  can(event) { return !!this.states[this.current]?.on?.[event]; }
  is(state) { return this.current === state; }
}
