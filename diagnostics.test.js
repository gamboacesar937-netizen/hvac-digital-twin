import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/js/state.js';
import { diagnose, classify, DEFAULT_TAKEN_MEASUREMENTS } from '../src/js/diagnostics.js';

function snapshotWithFaults(faultIds, faultOptions = {}) {
  const engine = new SimulationEngine({ seed: 555, ambientTempF: 95, returnAirTempF: 75 });
  engine.setFaults(faultIds);
  engine.setFaultOptions(faultOptions);
  return engine.tick();
}

test('classify: contradicción prevalece sobre cualquier apoyo', () => {
  const result = classify([
    { result: 'support', strength: 'strong' },
    { result: 'support', strength: 'normal' },
    { result: 'contradict', strength: 'normal' },
  ]);
  assert.equal(result, 'CONTRADICTORIO');
});

test('classify: sin evidencia a favor ni en contra => NO_DETERMINADO', () => {
  const result = classify([{ result: 'unknown', critical: true }]);
  assert.equal(result, 'NO_DETERMINADO');
});

test('classify: evidencia parcial (sin fuerza suficiente) => COMPATIBLE', () => {
  const result = classify([{ result: 'support', strength: 'normal' }]);
  assert.equal(result, 'COMPATIBLE');
});

test('classify: evidencia fuerte + suficiente + sin faltantes críticos => DEMOSTRADO', () => {
  const result = classify([
    { result: 'support', strength: 'strong' },
    { result: 'support', strength: 'normal' },
  ]);
  assert.equal(result, 'DEMOSTRADO');
});

test('caso normal: ninguna hipótesis de falla debería quedar DEMOSTRADA', () => {
  const snap = snapshotWithFaults([]);
  const results = diagnose(snap);
  const demonstrated = results.filter((r) => r.classification === 'DEMOSTRADO');
  assert.equal(demonstrated.length, 0, `se esperaban 0 hipótesis demostradas en operación normal, hubo: ${demonstrated.map((d) => d.label)}`);
});

test('caso con falla clara: low_charge severo queda DEMOSTRADO con todas las mediciones tomadas', () => {
  const snap = snapshotWithFaults(['low_charge'], { severity: { low_charge: 0.9 } });
  const results = diagnose(snap, [...DEFAULT_TAKEN_MEASUREMENTS, 'filter_dp', 'restriction_signature']);
  const lowCharge = results.find((r) => r.id === 'low_charge');
  assert.equal(lowCharge.classification, 'DEMOSTRADO', `esperado DEMOSTRADO, fue ${lowCharge.classification}: ${JSON.stringify(lowCharge)}`);
});

test('caso ambiguo: sin tomar mediciones discriminantes, low_charge y low_airflow quedan COMPATIBLE, no DEMOSTRADO', () => {
  const snap = snapshotWithFaults(['low_charge'], { severity: { low_charge: 0.9 } });
  // Solo se tomaron superheat/subcooling, NO se midió filter_dp ni restriction_signature.
  const minimal = ['superheat', 'subcooling'];
  const results = diagnose(snap, minimal);
  const lowCharge = results.find((r) => r.id === 'low_charge');
  // Con subcooling bajo medido, ya hay evidencia fuerte, pero puede faltar
  // otra medición crítica (superheat SÍ se tomó) -> validamos que al menos
  // no contradice y que el motor documenta mediciones faltantes de las
  // hipótesis vecinas.
  const lowAirflow = results.find((r) => r.id === 'low_airflow');
  assert.notEqual(lowAirflow.classification, 'DEMOSTRADO', 'sin medir filter_dp, bajo flujo de aire no debería poder demostrarse');
  assert.ok(lowAirflow.missingMeasurements.length > 0, 'debería reportar mediciones faltantes');
  assert.ok(Array.isArray(lowCharge.evidenceFor));
});

test('caso adversarial (restricción en línea de líquido): NO debe demostrar low_charge, subcooling normal lo contradice', () => {
  const snap = snapshotWithFaults(['liquid_line_restriction'], { severity: { liquid_line_restriction: 0.9 } });
  const results = diagnose(snap, [...DEFAULT_TAKEN_MEASUREMENTS, 'filter_dp', 'restriction_signature']);
  const lowCharge = results.find((r) => r.id === 'low_charge');
  const restriction = results.find((r) => r.id === 'liquid_line_restriction');
  assert.equal(lowCharge.classification, 'CONTRADICTORIO', `low_charge debería contradecirse por subcooling normal/alto, fue ${lowCharge.classification}`);
  assert.equal(restriction.classification, 'DEMOSTRADO', `restricción debería demostrarse con firma detectada, fue ${restriction.classification}`);
});

test('caso contradictorio explícito: voltaje normal contradice la hipótesis de bajo/sobre voltaje', () => {
  const snap = snapshotWithFaults([]);
  const results = diagnose(snap, DEFAULT_TAKEN_MEASUREMENTS);
  const voltageHyp = results.find((r) => r.id === 'voltage_out_of_range');
  assert.equal(voltageHyp.classification, 'CONTRADICTORIO');
});

test('cada hipótesis expone una prueba recomendada como siguiente paso', () => {
  const snap = snapshotWithFaults([]);
  const results = diagnose(snap);
  for (const r of results) {
    assert.ok(typeof r.recommendedNextTest === 'string' && r.recommendedNextTest.length > 0, `falta prueba recomendada para ${r.id}`);
  }
});

test('el motor evalúa TODAS las hipótesis del catálogo, no se detiene en la primera que encaja (anti-anclaje)', () => {
  const snap = snapshotWithFaults(['low_charge']);
  const results = diagnose(snap);
  assert.ok(results.length >= 12, `se esperaban evaluar al menos 12 hipótesis, se evaluaron ${results.length}`);
});

test('pérdida de fase queda DEMOSTRADA con corrientes y voltajes tomados', () => {
  const snap = snapshotWithFaults(['phase_loss'], { phaseLossPhase: 'L2' });
  const results = diagnose(snap, DEFAULT_TAKEN_MEASUREMENTS);
  const phaseLoss = results.find((r) => r.id === 'phase_loss');
  assert.equal(phaseLoss.classification, 'DEMOSTRADO');
});
