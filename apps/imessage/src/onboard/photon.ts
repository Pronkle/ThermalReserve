// Adds people to our Photon project's user list (Photon only texts numbers on it), through
// Photon's own CLI (@photon-ai/cli, `photon spectrum users add`). The CLI reads the login token
// that `photon login` saved on this laptop; nothing here sees or stores it.
import { execFile } from 'node:child_process';
import { maskAddress } from '../config';

export interface PhotonUser { firstName: string; lastName: string; email: string; phone: string; }

export interface PhotonUsers {
  phones(): Promise<Set<string>>;
  add(user: PhotonUser): Promise<void>;
}

const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,24}$/i;
const NAME = /^[\p{L}\p{M}' .-]{1,40}$/u;

export function validateUser(u: PhotonUser): string | undefined {
  if (!E164.test(u.phone)) return 'phone must be E.164, like +19075551234';
  if (!EMAIL.test(u.email)) return 'email looks invalid';
  if (!NAME.test(u.firstName) || !NAME.test(u.lastName)) return 'names must be 1–40 letters';
  return undefined;
}

type Run = (args: string[]) => Promise<string>;

// Runs the CLI non-interactively (stdin closed, so it never prompts). CHAT_PHOTON_CMD overrides
// the command, e.g. a globally installed `photon`.
export function cliRunner(env: NodeJS.ProcessEnv = process.env): Run {
  const [cmd, ...base] = (env.CHAT_PHOTON_CMD ?? 'npx -y @photon-ai/cli@2.2.0').split(' ');
  const project = env.PHOTON_PROJECT_ID ?? env.SPECTRUM_PROJECT_ID;
  return args => new Promise((resolve, reject) => {
    const full = [...base, ...args, ...(project ? ['--project', project] : []), '--json'];
    execFile(cmd, full, { timeout: 60_000, env: { ...env, CI: '1' } }, (err, stdout, stderr) => {
      if (err) reject(new Error(`photon ${args.slice(0, 3).join(' ')} failed: ${(stderr || err.message).replace(/\+?\d{10,15}/g, m => maskAddress(m)).slice(0, 300)}`));
      else resolve(stdout);
    });
  });
}

export function photonUsers(run: Run = cliRunner()): PhotonUsers {
  return {
    async phones() {
      const out = JSON.parse(await run(['spectrum', 'users', 'ls'])) as unknown;
      const rows = Array.isArray(out) ? out : (out as { users?: unknown[]; data?: unknown[] }).users ?? (out as { data?: unknown[] }).data ?? [];
      return new Set(rows.map(r => (r as { phoneNumber?: string }).phoneNumber).filter((p): p is string => typeof p === 'string'));
    },
    async add(u) {
      const problem = validateUser(u);
      if (problem) throw new Error(problem);
      await run(['spectrum', 'users', 'add', '--first-name', u.firstName, '--last-name', u.lastName, '--email', u.email, '--phone', u.phone]);
    },
  };
}
