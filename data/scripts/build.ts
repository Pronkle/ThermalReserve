// Entry point for the root `npm run data`: rebuilds every generated file in data/ OFFLINE,
// from data/raw/ and the hand-edited inputs. (Raw downloads: scripts/fetch-acis.ts, run by hand.)
// Order matters: calibration updates constants.json before scenarios read it.
import './calibrate.ts';
import './make-design.ts';
