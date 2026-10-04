import { useMemo } from 'react';
import { buildOpsData, defaultConfig, integer, scenarios } from '../lib/ops';
import { useSampleHomes, useSimConfig } from '../lib/stdb';
import { MapPreview } from './MapPreview';

export function HouseholdMap() {
  const sim = useSimConfig();
  const samples = useSampleHomes();
  const scenario = scenarios.find(item => item.id === sim?.scenarioId);
  const data = useMemo(() => {
    if (!sim || !scenario) return;
    return buildOpsData(scenario, { ...defaultConfig(scenario), enrolledHomes: sim.enrolledHomes, exemptShare: sim.exemptShare, floorF: sim.floorF, maxDepthF: sim.maxDepthF, overrideRate: sim.overrideRate, capacityMMcfd: sim.capacityMmcfd });
  }, [scenario, sim?.enrolledHomes, sim?.exemptShare, sim?.floorF, sim?.maxDepthF, sim?.overrideRate, sim?.capacityMmcfd]);
  if (!data || !sim || !scenario) return null;
  const homes = samples.length ? samples.map(home => ({ ...home, overrideHour: home.overridden ? 0 : null })) : data.homes;
  return <section className="panel household-map" aria-label="Your home on the Anchorage fleet map">
    <h2>Your home in the community</h2>
    <p className="home-limit">Your home is the green dot. Tap it to see your nickname.</p>
    <div className="map-frame"><MapPreview focusHousehold homes={homes} run={data.runs.BASELINE} hour={Math.max(0, Math.min(scenario.hours - 1, Math.floor(sim.simHour)))} /></div>
    <div className="map-legend"><span><i className="dot holding" />Saving gas now</span><span><i className="dot recovering" />Warming back up</span><span><i className="dot normal" />Normal</span><span><i className="dot own-home" />You</span></div>
    <p className="home-limit">Each small dot ≈ {integer.format(sim.enrolledHomes / homes.length)} homes · assumed participation</p>
  </section>;
}
