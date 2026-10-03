/**
 * report.js
 *
 * Genera el reporte exportable de diagnóstico: fecha/hora, estado del
 * equipo, mediciones, fallas activas, hipótesis, evidencias y pruebas
 * recomendadas. Soporta exportación a JSON y a CSV (aplanado).
 */

'use strict';

/**
 * @param {object} snapshot Snapshot de SimulationEngine.tick()
 * @param {Array} diagnosisResults Resultado de diagnostics.diagnose()
 */
export function buildReport(snapshot, diagnosisResults) {
  const r = snapshot.refrigeration;
  const e = snapshot.electrical;
  return {
    generatedAt: new Date(snapshot.timestamp).toISOString(),
    tickIndex: snapshot.tickIndex,
    equipmentState: {
      running: r.running,
      compressorPowered: e.compressorPowered,
      condenserFanPowered: e.condenserFanPowered,
      evapFanPowered: e.evapFanPowered,
      ambientTempF: snapshot.ambientTempF,
      returnAirTempF: snapshot.returnAirTempF,
    },
    measurements: {
      suctionPressurePsig: r.suctionPressurePsig,
      dischargePressurePsig: r.dischargePressurePsig,
      superheatF: r.superheatF,
      subcoolingF: r.subcoolingF,
      supplyAirTempF: r.supplyAirTempF,
      capacityFraction: r.capacityFraction,
      voltageL1L2: e.voltages.L1L2,
      voltageL2L3: e.voltages.L2L3,
      voltageL3L1: e.voltages.L3L1,
      currentL1: e.currents.L1,
      currentL2: e.currents.L2,
      currentL3: e.currents.L3,
      powerKw: e.powerKw,
      powerFactor: e.powerFactor,
    },
    activeFaults: snapshot.activeFaults,
    alarms: snapshot.alarms,
    sanityIssues: snapshot.sanityIssues,
    diagnosis: diagnosisResults.map((d) => ({
      hypothesis: d.label,
      classification: d.classification,
      evidenceFor: d.evidenceFor,
      evidenceAgainst: d.evidenceAgainst,
      missingMeasurements: d.missingMeasurements,
      recommendedNextTest: d.recommendedNextTest,
    })),
  };
}

export function reportToJson(report) {
  return JSON.stringify(report, null, 2);
}

/** Convierte el reporte a un CSV simple con una fila por hipótesis (mediciones repetidas en cada fila). */
export function reportToCsv(report) {
  const headers = [
    'generatedAt',
    'hypothesis',
    'classification',
    'evidenceFor',
    'evidenceAgainst',
    'missingMeasurements',
    'recommendedNextTest',
    'suctionPressurePsig',
    'dischargePressurePsig',
    'superheatF',
    'subcoolingF',
    'capacityFraction',
    'voltageL1L2',
    'voltageL2L3',
    'voltageL3L1',
    'currentL1',
    'currentL2',
    'currentL3',
    'powerKw',
    'powerFactor',
    'activeFaults',
  ];
  const csvEscape = (v) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
  const rows = report.diagnosis.map((d) =>
    [
      report.generatedAt,
      d.hypothesis,
      d.classification,
      d.evidenceFor.join(' | '),
      d.evidenceAgainst.join(' | '),
      d.missingMeasurements.join(' | '),
      d.recommendedNextTest,
      report.measurements.suctionPressurePsig,
      report.measurements.dischargePressurePsig,
      report.measurements.superheatF,
      report.measurements.subcoolingF,
      report.measurements.capacityFraction,
      report.measurements.voltageL1L2,
      report.measurements.voltageL2L3,
      report.measurements.voltageL3L1,
      report.measurements.currentL1,
      report.measurements.currentL2,
      report.measurements.currentL3,
      report.measurements.powerKw,
      report.measurements.powerFactor,
      report.activeFaults.join(' | '),
    ]
      .map(csvEscape)
      .join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}
