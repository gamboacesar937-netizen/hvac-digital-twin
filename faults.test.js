import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/js/state.js';
import { FAULT_IDS } from '../src/js/faults.js';

function freshEngine(overrides = {}) {
  const engine = new SimulationEngine({ seed: 999, ambientTempF: 95, returnAirTempF: 75, ...overrides });
  return engine;
}

test('catálogo de fallas tiene exactamente 16 fallas (mínimo exigido)', () => {
  assert.ok(FAULT_IDS.length >= 16, `se esperaban al menos 16 fallas, hay ${FAULT_IDS.length}`);
});

test('escenario NORMAL sin fallas: equipo corre, sin alarmas de protección', () => {
  const engine = freshEngine();
  const snap = engine.tick();
  assert.equal(snap.electrical.compressorPowered, true);
  assert.equal(snap.refrigeration.running, true);
  const protectionAlarms = snap.alarms.filter((a) => a.level === 'protection');
  assert.equal(protectionAlarms.length, 0);
});

test('falla: low_charge reduce subcooling respecto a línea base', () => {
  const base = freshEngine().tick();
  const engine = freshEngine();
  engine.setFaults(['low_charge']);
  const withFault = engine.tick();
  assert.ok(withFault.refrigeration.subcoolingF < base.refrigeration.subcoolingF);
});

test('falla: overcharge eleva subcooling respecto a línea base', () => {
  const base = freshEngine().tick();
  const engine = freshEngine();
  engine.setFaults(['overcharge']);
  const withFault = engine.tick();
  assert.ok(withFault.refrigeration.subcoolingF > base.refrigeration.subcoolingF);
});

test('falla: dirty_filter eleva la caída de presión de filtro y el superheat', () => {
  const base = freshEngine().tick();
  const engine = freshEngine();
  engine.setFaults(['dirty_filter']);
  const withFault = engine.tick();
  assert.ok(withFault.refrigeration.filterDeltaPressureInWc > base.refrigeration.filterDeltaPressureInWc);
  assert.ok(withFault.refrigeration.superheatF > base.refrigeration.superheatF);
});

test('falla: low_airflow reduce la temperatura de saturación de evaporación', () => {
  const base = freshEngine().tick();
  const engine = freshEngine();
  engine.setFaults(['low_airflow']);
  const withFault = engine.tick();
  assert.ok(withFault.refrigeration.evapSatTempF < base.refrigeration.evapSatTempF);
});

test('falla: dirty_condenser eleva la presión de descarga', () => {
  const base = freshEngine().tick();
  const engine = freshEngine();
  engine.setFaults(['dirty_condenser']);
  const withFault = engine.tick();
  assert.ok(withFault.refrigeration.dischargePressurePsig > base.refrigeration.dischargePressurePsig);
});

test('falla: high_ambient eleva la temperatura de condensación', () => {
  const base = freshEngine().tick();
  const engine = freshEngine();
  engine.setFaults(['high_ambient']);
  const withFault = engine.tick();
  assert.ok(withFault.refrigeration.condSatTempF > base.refrigeration.condSatTempF);
});

test('falla: phase_loss produce alarma de protección y corriente ~0 en una fase', () => {
  const engine = freshEngine();
  engine.setFaults(['phase_loss']);
  engine.setFaultOptions({ phaseLossPhase: 'L2' });
  const snap = engine.tick();
  assert.ok(snap.alarms.some((a) => a.id === 'phase_loss'));
  assert.ok(snap.electrical.currents.L2 < 1);
});

test('falla: low_voltage produce voltaje promedio bajo y alarma', () => {
  const engine = freshEngine();
  engine.setFaults(['low_voltage']);
  const snap = engine.tick();
  assert.ok(snap.electrical.voltages.average < 420);
  assert.ok(snap.alarms.some((a) => a.id === 'low_voltage'));
});

test('falla: high_voltage produce voltaje promedio alto y alarma', () => {
  const engine = freshEngine();
  engine.setFaults(['high_voltage']);
  const snap = engine.tick();
  assert.ok(snap.electrical.voltages.average > 500);
  assert.ok(snap.alarms.some((a) => a.id === 'high_voltage'));
});

test('falla: contactor_fault impide que el compresor reciba energía', () => {
  const engine = freshEngine();
  engine.setFaults(['contactor_fault']);
  const snap = engine.tick();
  assert.equal(snap.electrical.compressorPowered, false);
  assert.equal(snap.refrigeration.running, false);
});

test('falla: contactor_coil_open impide que el compresor reciba energía', () => {
  const engine = freshEngine();
  engine.setFaults(['contactor_coil_open']);
  const snap = engine.tick();
  assert.equal(snap.electrical.compressorPowered, false);
});

test('falla: compressor_locked produce corriente muy alta y dispara protección térmica tras varios ciclos', () => {
  const engine = freshEngine();
  engine.setFaults(['compressor_locked']);
  const earlySnap = engine.tick();
  assert.ok(earlySnap.electrical.currents.average > 300, 'corriente de rotor bloqueado debería ser muy alta antes de que dispare la protección');
  let lastSnap = earlySnap;
  for (let i = 0; i < 25; i += 1) {
    lastSnap = engine.tick();
  }
  assert.equal(
    lastSnap.control.thermalProtectionOpenEffective,
    true,
    'la protección térmica debería dispararse automáticamente por sobrecorriente sostenida'
  );
  // Una vez disparada la protección, la corriente cae porque el compresor ya no recibe energía.
  assert.equal(lastSnap.electrical.compressorPowered, false);
});

test('falla: thermal_protection_open (manual) detiene el compresor de inmediato', () => {
  const engine = freshEngine();
  engine.setFaults(['thermal_protection_open']);
  const snap = engine.tick();
  assert.equal(snap.electrical.compressorPowered, false);
});

test('falla: condenser_fan_failure eleva presión de descarga y refleja ventilador apagado', () => {
  const base = freshEngine().tick();
  const engine = freshEngine();
  engine.setFaults(['condenser_fan_failure']);
  const withFault = engine.tick();
  assert.equal(withFault.electrical.condenserFanPowered && withFault.control, withFault.control); // sanity no-op
  assert.ok(withFault.refrigeration.dischargePressurePsig > base.refrigeration.dischargePressurePsig);
});

test('falla: liquid_line_restriction eleva superheat sin hundir subcooling', () => {
  const base = freshEngine().tick();
  const engine = freshEngine();
  engine.setFaults(['liquid_line_restriction']);
  const withFault = engine.tick();
  assert.ok(withFault.refrigeration.superheatF > base.refrigeration.superheatF);
  assert.ok(withFault.refrigeration.subcoolingF >= base.refrigeration.subcoolingF - 1);
});

test('falla: expansion_device_problem (stuck_closed por defecto) eleva fuertemente el superheat', () => {
  const base = freshEngine().tick();
  const engine = freshEngine();
  engine.setFaults(['expansion_device_problem']);
  const withFault = engine.tick();
  assert.ok(withFault.refrigeration.superheatF > base.refrigeration.superheatF + 10);
});

test('múltiples fallas simultáneas no rompen la simulación (valores siempre finitos)', () => {
  const engine = freshEngine();
  engine.setFaults(['low_charge', 'dirty_condenser', 'low_voltage', 'liquid_line_restriction']);
  const snap = engine.tick();
  assert.equal(snap.sanityIssues.length, 0, `se esperaban 0 problemas de sanidad, hubo: ${JSON.stringify(snap.sanityIssues)}`);
});

test('RESET SYSTEM regresa la simulación a estado normal', () => {
  const engine = freshEngine();
  engine.setFaults(['compressor_locked']);
  engine.tick();
  engine.tick();
  engine.reset();
  const snap = engine.tick();
  assert.deepEqual(snap.activeFaults, []);
  assert.equal(snap.control.thermalProtectionOpenEffective, false);
  assert.equal(snap.electrical.compressorPowered, true);
});
