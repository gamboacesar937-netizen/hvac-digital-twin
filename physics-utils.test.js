import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp,
  saturationPressureFromTemp,
  saturationTempFromPressure,
  round,
  lerp,
  createSeededRandom,
  isBadNumber,
} from '../src/js/physics-utils.js';

test('clamp limita correctamente dentro y fuera de rango', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
  assert.equal(clamp(NaN, 2, 10), 2);
});

test('saturationPressureFromTemp es monótona creciente', () => {
  const p1 = saturationPressureFromTemp(20);
  const p2 = saturationPressureFromTemp(40);
  const p3 = saturationPressureFromTemp(120);
  assert.ok(p2 > p1);
  assert.ok(p3 > p2);
});

test('saturationPressureFromTemp se aproxima a los puntos ancla documentados', () => {
  const p40 = saturationPressureFromTemp(40);
  const p120 = saturationPressureFromTemp(120);
  assert.ok(Math.abs(p40 - 118) < 5, `esperado ~118 psig a 40F, obtuvo ${p40}`);
  assert.ok(Math.abs(p120 - 350) < 10, `esperado ~350 psig a 120F, obtuvo ${p120}`);
});

test('saturationTempFromPressure es la inversa aproximada de saturationPressureFromTemp', () => {
  for (const t of [10, 40, 80, 120, 150]) {
    const p = saturationPressureFromTemp(t);
    const tBack = saturationTempFromPressure(p);
    assert.ok(Math.abs(tBack - t) < 0.5, `round-trip falló para ${t}F -> ${p}psig -> ${tBack}F`);
  }
});

test('round redondea a los decimales indicados', () => {
  assert.equal(round(1.23456, 2), 1.23);
  assert.equal(round(1.005, 2), 1.01);
});

test('lerp interpola linealmente', () => {
  assert.equal(lerp(0, 10, 0), 0);
  assert.equal(lerp(0, 10, 1), 10);
  assert.equal(lerp(0, 10, 0.5), 5);
});

test('createSeededRandom es determinista: misma semilla -> misma secuencia', () => {
  const rngA = createSeededRandom(42);
  const rngB = createSeededRandom(42);
  const seqA = [rngA(), rngA(), rngA()];
  const seqB = [rngB(), rngB(), rngB()];
  assert.deepEqual(seqA, seqB);
});

test('createSeededRandom produce secuencias distintas para semillas distintas', () => {
  const rngA = createSeededRandom(1);
  const rngB = createSeededRandom(2);
  assert.notEqual(rngA(), rngB());
});

test('isBadNumber detecta NaN, Infinity y no-números', () => {
  assert.equal(isBadNumber(NaN), true);
  assert.equal(isBadNumber(Infinity), true);
  assert.equal(isBadNumber(-Infinity), true);
  assert.equal(isBadNumber('5'), true);
  assert.equal(isBadNumber(undefined), true);
  assert.equal(isBadNumber(5), false);
  assert.equal(isBadNumber(0), false);
});
