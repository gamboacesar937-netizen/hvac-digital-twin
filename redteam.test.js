import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/js/state.js';
import { diagnose, DEFAULT_TAKEN_MEASUREMENTS } from '../src/js/diagnostics.js';
import { runSanityChecks } from '../src/js/sanity.js';
import { FAULT_IDS } from '../src/js/faults.js';

const FULL = [...DEFAULT_TAKEN_MEASUREMENTS, 'filter_dp', 'restriction_signature'];

// Ver RED_TEAM.md para el detalle completo de cada hallazgo, causa y corrección.

test('RED TEAM #1: contactor abierto (corriente ~0) no produce desbalance de corriente absurdo (>100%)', () => {
  const engine = new SimulationEngine({ seed: 1 });
  engine.setFaults(['contactor_fault']);
  const snap = engine.tick();
  assert.ok(snap.electrical.currents.imbalancePct <= 100);
  assert.equal(runSanityChecks(snap).length, 0);
});

test('RED TEAM #2: alta temperatura ambiente + contactor abierto no dispara falso positivo de sanidad', () => {
  const engine = new SimulationEngine({ seed: 2, ambientTempF: 100 });
  engine.setFaults(['high_ambient', 'contactor_fault']);
  engine.setFaultOptions({ severity: { high_ambient: 0.8 } });
  const snap = engine.tick();
  assert.equal(runSanityChecks(snap).length, 0, JSON.stringify(runSanityChecks(snap)));
});

test('RED TEAM #3: rotor bloqueado + protección ya disparada sigue siendo diagnosticable vía memoria térmica', () => {
  const engine = new SimulationEngine({ seed: 3 });
  engine.setFaults(['compressor_locked']);
  let snap;
  for (let i = 0; i < 25; i += 1) snap = engine.tick();
  assert.equal(snap.control.thermalProtectionOpenEffective, true);
  const results = diagnose(snap, FULL);
  const locked = results.find((r) => r.id === 'compressor_locked');
  assert.notEqual(locked.classification, 'CONTRADICTORIO', 'no debería contradecirse solo porque ya disparó la protección');
});

test('RED TEAM #4: fallas de severidad leve (10-30%) NO se sobre-diagnostican (correctamente quedan sin apoyo fuerte)', () => {
  const engine = new SimulationEngine({ seed: 4 });
  engine.setFaults(['dirty_filter']);
  engine.setFaultOptions({ severity: { dirty_filter: 0.15 } });
  const snap = engine.tick();
  const results = diagnose(snap, FULL);
  const lowAirflow = results.find((r) => r.id === 'low_airflow');
  assert.notEqual(lowAirflow.classification, 'DEMOSTRADO', 'una falla apenas iniciada no debería demostrarse con certeza');
});

test('RED TEAM #5: todas las fallas activas simultáneamente (peor caso) nunca produce NaN/Infinity', () => {
  const engine = new SimulationEngine({ seed: 5, ambientTempF: 105, returnAirTempF: 80 });
  engine.setFaults(FAULT_IDS.filter((f) => f !== 'thermal_protection_open'));
  let snap;
  for (let i = 0; i < 30; i += 1) snap = engine.tick();
  assert.deepEqual(runSanityChecks(snap), []);
});

test('RED TEAM #6: baja carga severa y restricción severa combinadas siguen siendo distinguibles por subcooling', () => {
  const engine = new SimulationEngine({ seed: 6 });
  engine.setFaults(['low_charge']);
  engine.setFaultOptions({ severity: { low_charge: 0.9 } });
  const lowChargeSnap = engine.tick();

  const engine2 = new SimulationEngine({ seed: 6 });
  engine2.setFaults(['liquid_line_restriction']);
  engine2.setFaultOptions({ severity: { liquid_line_restriction: 0.9 } });
  const restrictionSnap = engine2.tick();

  assert.ok(lowChargeSnap.refrigeration.subcoolingF < restrictionSnap.refrigeration.subcoolingF - 5);
});

test('RED TEAM #7: pérdida de fase con corrientes/voltajes no medidos no se demuestra (respeta mediciones faltantes)', () => {
  const engine = new SimulationEngine({ seed: 7 });
  engine.setFaults(['phase_loss']);
  const snap = engine.tick();
  const results = diagnose(snap, ['superheat', 'subcooling']); // sin currents ni voltages
  const phaseLoss = results.find((r) => r.id === 'phase_loss');
  assert.equal(phaseLoss.classification, 'NO_DETERMINADO');
  assert.ok(phaseLoss.missingMeasurements.length >= 2);
});

test('RED TEAM #8: RESET SYSTEM tras rotor bloqueado + trip térmico limpia completamente el estado', () => {
  const engine = new SimulationEngine({ seed: 8 });
  engine.setFaults(['compressor_locked']);
  for (let i = 0; i < 25; i += 1) engine.tick();
  engine.reset();
  const snap = engine.tick();
  assert.equal(snap.control.thermalAccumulator, 0);
  assert.equal(snap.control.thermalProtectionOpenEffective, false);
  assert.equal(snap.electrical.currents.average < 150, true);
});

test('RED TEAM #9: condiciones ambientales extremas (frío y calor) nunca rompen la simulación', () => {
  for (const ambientTempF of [-20, 0, 150]) {
    const engine = new SimulationEngine({ seed: 9, ambientTempF, returnAirTempF: 70 });
    const snap = engine.tick();
    assert.deepEqual(runSanityChecks(snap), [], `falla en ambientTempF=${ambientTempF}`);
  }
});

test('RED TEAM #10: activar y desactivar rápidamente una falla no deja residuos de estado incorrectos', () => {
  const engine = new SimulationEngine({ seed: 10 });
  engine.setFault('low_charge', true);
  engine.tick();
  engine.setFault('low_charge', false);
  const snap = engine.tick();
  assert.deepEqual(snap.activeFaults, []);
  assert.ok(snap.refrigeration.subcoolingF > 6, 'debería recuperar subcooling normal al desactivar la falla');
});
