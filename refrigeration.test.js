import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRefrigerationState, NOMINAL_CAPACITY_BTUH } from '../src/js/refrigeration.js';

function baseline(overrides = {}) {
  return {
    ambientTempF: 95,
    returnAirTempF: 75,
    compressorOn: true,
    condenserFanOn: true,
    evapFanOn: true,
    evapAirflowFraction: 1,
    condAirflowFraction: 1,
    chargeFraction: 1,
    liquidLineRestriction: 0,
    expansionFault: 'none',
    ...overrides,
  };
}

test('compresor apagado: no hay ciclo activo, superheat/subcooling son null', () => {
  const r = computeRefrigerationState(baseline({ compressorOn: false }));
  assert.equal(r.running, false);
  assert.equal(r.superheatF, null);
  assert.equal(r.subcoolingF, null);
  assert.equal(r.capacityBtuh, 0);
});

test('condiciones nominales producen superheat y subcooling en rango típico', () => {
  const r = computeRefrigerationState(baseline());
  assert.ok(r.running);
  assert.ok(r.superheatF > 5 && r.superheatF < 20, `superheat fuera de rango: ${r.superheatF}`);
  assert.ok(r.subcoolingF > 5 && r.subcoolingF < 20, `subcooling fuera de rango: ${r.subcoolingF}`);
  assert.ok(r.capacityFraction > 0.9, 'capacidad nominal debería estar cerca del 100%');
});

test('baja carga de refrigerante: reduce subcooling y eleva superheat', () => {
  const normal = computeRefrigerationState(baseline());
  const lowCharge = computeRefrigerationState(baseline({ chargeFraction: 0.5 }));
  assert.ok(lowCharge.subcoolingF < normal.subcoolingF, 'subcooling debería bajar con baja carga');
  assert.ok(lowCharge.superheatF > normal.superheatF, 'superheat debería subir con baja carga');
  assert.ok(lowCharge.capacityFraction < normal.capacityFraction, 'capacidad debería reducirse con baja carga');
});

test('sobrecarga de refrigerante: eleva subcooling y reduce superheat', () => {
  const normal = computeRefrigerationState(baseline());
  const overcharge = computeRefrigerationState(baseline({ chargeFraction: 1.4 }));
  assert.ok(overcharge.subcoolingF > normal.subcoolingF, 'subcooling debería subir con sobrecarga');
  assert.ok(overcharge.superheatF < normal.superheatF, 'superheat debería bajar con sobrecarga');
});

test('bajo flujo de aire en evaporador: baja la temperatura de saturación de evaporación y sube superheat', () => {
  const normal = computeRefrigerationState(baseline());
  const lowAirflow = computeRefrigerationState(baseline({ evapAirflowFraction: 0.4 }));
  assert.ok(lowAirflow.evapSatTempF < normal.evapSatTempF, 'evaporación debería enfriarse más con bajo flujo de aire');
  assert.ok(lowAirflow.superheatF > normal.superheatF, 'superheat debería subir con bajo flujo de aire');
  assert.ok(lowAirflow.filterDeltaPressureInWc > 1.0, 'caída de presión de filtro debería ser alta con bajo flujo de aire');
});

test('caso adversarial: bajo flujo de aire vs baja carga tienen subcooling distinto (discriminador)', () => {
  const lowAirflow = computeRefrigerationState(baseline({ evapAirflowFraction: 0.4 }));
  const lowCharge = computeRefrigerationState(baseline({ chargeFraction: 0.5 }));
  // Ambos elevan el superheat (síntoma compartido)...
  assert.ok(lowAirflow.superheatF > 15 && lowCharge.superheatF > 15);
  // ...pero solo la baja carga hunde claramente el subcooling.
  assert.ok(lowCharge.subcoolingF < 6, 'baja carga debe mostrar subcooling bajo');
  assert.ok(lowAirflow.subcoolingF >= 8, 'bajo flujo de aire NO debe hundir el subcooling (discriminador clave)');
});

test('condensador sucio o ventilador de condensador fallando: eleva presión/temperatura de descarga', () => {
  const normal = computeRefrigerationState(baseline());
  const dirtyCondenser = computeRefrigerationState(baseline({ condAirflowFraction: 0.4 }));
  const fanOff = computeRefrigerationState(baseline({ condenserFanOn: false }));
  assert.ok(dirtyCondenser.dischargePressurePsig > normal.dischargePressurePsig);
  assert.ok(fanOff.dischargePressurePsig > normal.dischargePressurePsig);
});

test('restricción en línea de líquido: sube superheat pero NO hunde el subcooling (caso adversarial vs baja carga)', () => {
  const normal = computeRefrigerationState(baseline());
  const restricted = computeRefrigerationState(baseline({ liquidLineRestriction: 0.8 }));
  assert.ok(restricted.superheatF > normal.superheatF, 'superheat debería subir con restricción');
  assert.ok(restricted.subcoolingF >= normal.subcoolingF, 'subcooling NO debería bajar con restricción (discriminador vs baja carga)');
  assert.equal(restricted.restrictionSignatureDetected, true);
});

test('dispositivo de expansión atascado cerrado: superheat muy alto (subalimentación severa)', () => {
  const normal = computeRefrigerationState(baseline());
  const stuckClosed = computeRefrigerationState(baseline({ expansionFault: 'stuck_closed' }));
  assert.ok(stuckClosed.superheatF > normal.superheatF + 15);
  assert.ok(stuckClosed.capacityFraction < normal.capacityFraction);
});

test('dispositivo de expansión atascado abierto: superheat muy bajo, riesgo de retorno de líquido', () => {
  const stuckOpen = computeRefrigerationState(baseline({ expansionFault: 'stuck_open', chargeFraction: 1.0 }));
  assert.ok(stuckOpen.superheatF < 8);
});

test('riesgo de hielo se activa con evaporación muy fría y ventilador operando', () => {
  const iced = computeRefrigerationState(baseline({ evapAirflowFraction: 0.2, returnAirTempF: 68 }));
  assert.equal(iced.iceRisk, true);
});

test('la capacidad nunca excede razonablemente el máximo nominal y nunca es negativa', () => {
  for (const overrides of [
    {},
    { chargeFraction: 1.4 },
    { chargeFraction: 0.2 },
    { evapAirflowFraction: 0.1 },
    { liquidLineRestriction: 1 },
    { expansionFault: 'stuck_closed' },
  ]) {
    const r = computeRefrigerationState(baseline(overrides));
    assert.ok(r.capacityFraction >= 0, `capacidad negativa con ${JSON.stringify(overrides)}`);
    assert.ok(r.capacityBtuh <= NOMINAL_CAPACITY_BTUH * 1.1, `capacidad excede el nominal razonable con ${JSON.stringify(overrides)}`);
  }
});

test('presiones siempre son valores finitos y no negativos bajo condiciones extremas', () => {
  const extreme = computeRefrigerationState(
    baseline({ ambientTempF: 130, returnAirTempF: 60, chargeFraction: 0.05, evapAirflowFraction: 0.05, liquidLineRestriction: 1 })
  );
  assert.ok(Number.isFinite(extreme.suctionPressurePsig));
  assert.ok(Number.isFinite(extreme.dischargePressurePsig));
  assert.ok(extreme.suctionPressurePsig >= 0);
  assert.ok(extreme.dischargePressurePsig >= 0);
});
