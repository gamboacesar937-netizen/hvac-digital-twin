import test from 'node:test';
import assert from 'node:assert/strict';
import { runSanityChecks } from '../src/js/sanity.js';
import { SimulationEngine } from '../src/js/state.js';

function validSnapshot() {
  const engine = new SimulationEngine({ seed: 1 });
  return engine.tick();
}

test('un snapshot válido no reporta problemas de sanidad', () => {
  const issues = runSanityChecks(validSnapshot());
  assert.deepEqual(issues, []);
});

test('detecta NaN en un campo numérico', () => {
  const snap = validSnapshot();
  snap.refrigeration.suctionPressurePsig = NaN;
  const issues = runSanityChecks(snap);
  assert.ok(issues.some((i) => i.path === 'refrigeration.suctionPressurePsig' && i.problem === 'not-a-finite-number'));
});

test('detecta Infinity en un campo numérico', () => {
  const snap = validSnapshot();
  snap.electrical.powerKw = Infinity;
  const issues = runSanityChecks(snap);
  assert.ok(issues.some((i) => i.path === 'electrical.powerKw' && i.problem === 'not-a-finite-number'));
});

test('detecta presión negativa (imposible)', () => {
  const snap = validSnapshot();
  snap.refrigeration.dischargePressurePsig = -10;
  const issues = runSanityChecks(snap);
  assert.ok(issues.some((i) => i.path === 'refrigeration.dischargePressurePsig' && i.problem.startsWith('below-min')));
});

test('detecta factor de potencia fuera de [0,1]', () => {
  const snap = validSnapshot();
  snap.electrical.powerFactor = 1.5;
  const issues = runSanityChecks(snap);
  assert.ok(issues.some((i) => i.path === 'electrical.powerFactor' && i.problem.startsWith('above-max')));
});

test('detecta undefined en un campo requerido (no nullable)', () => {
  const snap = validSnapshot();
  delete snap.refrigeration.evapSatTempF;
  const issues = runSanityChecks(snap);
  assert.ok(issues.some((i) => i.path === 'refrigeration.evapSatTempF' && i.problem === 'undefined-or-null'));
});

test('superheat/subcooling null es válido cuando el compresor está apagado (no reporta problema)', () => {
  const engine = new SimulationEngine({ seed: 1 });
  engine.setFaults(['contactor_fault']);
  const snap = engine.tick();
  assert.equal(snap.refrigeration.superheatF, null);
  const issues = runSanityChecks(snap);
  assert.equal(issues.filter((i) => i.path.includes('superheatF')).length, 0);
});

test('runSanityChecks nunca lanza excepción, incluso con snapshot vacío o malformado', () => {
  assert.doesNotThrow(() => runSanityChecks({}));
  assert.doesNotThrow(() => runSanityChecks(null));
  assert.doesNotThrow(() => runSanityChecks(undefined));
  const issues = runSanityChecks(null);
  assert.ok(Array.isArray(issues));
});

test('SimulationEngine.tick() bajo fallas extremas combinadas nunca produce sanityIssues', () => {
  const engine = new SimulationEngine({ seed: 2, ambientTempF: 115, returnAirTempF: 65 });
  engine.setFaults(['low_charge', 'low_airflow', 'dirty_condenser', 'high_voltage', 'liquid_line_restriction']);
  engine.setFaultOptions({ severity: { low_charge: 1, low_airflow: 1, dirty_condenser: 1, high_voltage: 1, liquid_line_restriction: 1 } });
  const snap = engine.tick();
  assert.deepEqual(snap.sanityIssues, [], `no deberían existir issues de sanidad: ${JSON.stringify(snap.sanityIssues)}`);
});
