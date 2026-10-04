// Prints each household's link code (nickname → code) so a tester can text "Link <code>"
// before /home shows it. Read-only; prints no phone numbers.
import { loadConfig } from './config';
import { linkCode } from './link';
import { Mirror } from './stdb/mirror';

const config = loadConfig();
const mirror: Mirror = new Mirror(config, {
  onChange: () => undefined,
  onHouseholdRemoved: () => undefined,
  onReady: () => {
    for (const h of mirror.households()) console.log(`${linkCode(h.identity)}  ${h.nickname}`);
    if (mirror.households().length === 0) console.log(`no households in ${config.stdbDb}`);
    mirror.disconnect();
    process.exit(0);
  },
  log: () => undefined,
});
mirror.connect();
