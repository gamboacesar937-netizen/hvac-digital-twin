import test from 'node:test';
import assert from 'node:assert/strict';
import { computeElectricalState, NOMINAL_VOLTAGE, COMPRESSOR_RLA } from '../src/js/electrical.js';

function baseline(overrides = {}) {
  return {
    seed: 12345,
    tickIndex: 0,
    contactorClosed: true,
    compressorLocked: false,
    thermalProtectionOpen: false,
    phaseLoss: 'none',
    voltageOffsetPct: 0,
    evapFanRequested: true,
    ...overrides,
  };
}

test('operación normal: voltajes cerca del nominal, corrientes balanceadas, PF razonable', () => {
  const e = computeElectricalState(baseline());
  assert.ok(Math.abs(e.voltages.average - NOMINAL_VOLTAGE) < 5);
  assert.ok(e.voltages.imbalancePct < 5);
  assert.ok(e.currents.imbalancePct < 5);
  assert.ok(e.powerFactor > 0.6 && e.powerFactor <= 0.95);
  assert.ok(e.powerKw > 0);
});

test('contactor abierto: compresor y ventilador de condensador sin corriente', () => {
  const e = computeElectricalState(baseline({ contactorClosed: false }));
  assert.equal(e.compressorPowered, false);
  assert.equal(e.condenserFanPowered, false);
  assert.ok(e.currents.average < 5, 'no debería haber corriente significativa de compresor/ventilador de condensador');
});

test('protección térmica abierta: el compresor no puede tomar corriente aunque el contactor esté cerrado', () => {
  const e = computeElectricalState(baseline({ thermalProtectionOpen: true }));
  assert.equal(e.compressorPowered, false);
});

test('compresor bloqueado: corriente de rotor bloqueado muy superior a la nominal y PF bajo', () => {
  const normal = computeElectricalState(baseline());
  const locked = computeElectricalState(baseline({ compressorLocked: true }));
  assert.ok(locked.currents.average > normal.currents.average * 3, 'corriente de rotor bloqueado debería ser mucho mayor');
  assert.ok(locked.powerFactor < normal.powerFactor, 'PF debería caer con rotor bloqueado');
  assert.equal(locked.thermalTripImminent, true);
});

test('pérdida de fase: una fase queda con corriente y voltaje casi nulos, las otras se elevan', () => {
  const e = computeElectricalState(baseline({ phaseLoss: 'L2' }));
  assert.ok(e.currents.L2 < 1, 'corriente en la fase perdida debería ser ~0');
  assert.ok(e.currents.L1 > COMPRESSOR_RLA, 'las fases restantes deberían elevar su corriente');
  assert.ok(e.currents.L3 > COMPRESSOR_RLA);
  assert.ok(e.voltages.L1L2 < e.voltages.average * 0.5 || e.voltages.L2L3 < e.voltages.average * 0.5);
});

test('bajo voltaje: el promedio de voltaje cae proporcionalmente al offset', () => {
  const e = computeElectricalState(baseline({ voltageOffsetPct: -15 }));
  assert.ok(e.voltages.average < NOMINAL_VOLTAGE * 0.9);
});

test('sobrevoltaje: el promedio de voltaje sube proporcionalmente al offset', () => {
  const e = computeElectricalState(baseline({ voltageOffsetPct: 12 }));
  assert.ok(e.voltages.average > NOMINAL_VOLTAGE * 1.08);
});

test('determinismo: misma semilla y mismo tick producen exactamente el mismo resultado', () => {
  const e1 = computeElectricalState(baseline({ seed: 777, tickIndex: 3 }));
  const e2 = computeElectricalState(baseline({ seed: 777, tickIndex: 3 }));
  assert.deepEqual(e1, e2);
});

test('reproducibilidad: distinta semilla produce ligera variación (no todo es idéntico)', () => {
  const e1 = computeElectricalState(baseline({ seed: 1 }));
  const e2 = computeElectricalState(baseline({ seed: 2 }));
  assert.notEqual(e1.currents.L1, e2.currents.L1);
});

test('todos los valores numéricos de salida son finitos bajo condiciones extremas', () => {
  const e = computeElectricalState(
    baseline({ compressorLocked: true, phaseLoss: 'L3', voltageOffsetPct: -20, contactorClosed: true })
  );
  for (const v of [e.voltages.average, e.currents.average, e.powerFactor, e.powerKw]) {
    assert.ok(Number.isFinite(v), `valor no finito detectado: ${v}`);
  }
});
