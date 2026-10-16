import { KimiAdapter } from './adapter.mjs';

const instance = Symbol.for('magpie.kimi-desktop.adapter.v1');

export default async function KimiDesktop(input) {
  if (!globalThis[instance]) {
    const log = code => {
      try {
        void input?.client?.app?.log?.({ body: { service: 'kimi-desktop', level: 'warn', message: code } })?.catch?.(() => {});
      } catch { /* No configuration, credentials or raw RPC errors in logs. */ }
    };
    const adapter = await new KimiAdapter({ log }).start();
    globalThis[instance] = adapter;
    process.once('exit', () => adapter.restoreFileOnExit());
    // A signal already asks this host to exit. Restore before its termination.
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
      void adapter.stop().finally(() => process.exit(0));
    });
  }
  return {};
}
