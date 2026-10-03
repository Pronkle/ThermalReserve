// Entry point for the root `npm run data`: rebuilds every generated file in data/ OFFLINE,
// from data/raw/ and the hand-edited inputs. (Raw downloads, run by hand: scripts/fetch-acis.ts, scripts/fetch-water.ts.)
// Order matters: calibration → system fit → scenarios (each reads the previous outputs).
import './calibrate.ts';
import './fit-system.ts';
import './make-design.ts';
import './make-replays.ts';
import './build-water-mask.ts';
