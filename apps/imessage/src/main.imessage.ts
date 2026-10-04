// Production entrypoint: cloud iMessage through Photon Spectrum. Reads SPECTRUM_PROJECT_ID and
// SPECTRUM_PROJECT_SECRET from the environment (apps/imessage/.env, gitignored).
import { Spectrum } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers/imessage';
import { runCompanion } from './app';
import { spectrumTransport } from './transport/spectrum';

const app = await Spectrum({ providers: [imessage.config()], telemetry: false, options: { logLevel: 'warn' } });
const im = imessage(app);
await runCompanion(spectrumTransport(app, async address => im.space.create(await im.user(address))));
