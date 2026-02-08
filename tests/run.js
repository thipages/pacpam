import './setup.js';
await import('./state-runner.test.js');
await import('./connection-states.test.js');
await import('./auth.test.js');
await import('./locale.test.js');
await import('./message-validator.test.js');
await import('./rate-limiter.test.js');
await import('./circuit-breaker.test.js');
await import('./p2p-sync.test.js');
await import('./network.test.js');

// Force exit — --experimental-test-module-mocks garde des handles ouverts
process.on('exit', () => {});
setTimeout(() => process.exit(0), 500);
