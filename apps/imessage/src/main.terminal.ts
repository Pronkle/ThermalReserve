// Development entrypoint: the same companion on Spectrum's terminal provider (no credentials).
// In a non-TTY it reads lines from stdin, which scripted tests use.
import { Spectrum } from 'spectrum-ts';
import { terminal } from 'spectrum-ts/providers/terminal';
import { runCompanion } from './app';
import { spectrumTransport } from './transport/spectrum';

const app = await Spectrum({ providers: [terminal.config()], telemetry: false, options: { logLevel: 'warn' } });
await runCompanion(spectrumTransport(app));
