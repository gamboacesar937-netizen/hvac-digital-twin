/**
 * sanity.js
 *
 * Comprobaciones automáticas de sanidad física sobre un snapshot completo.
 * Detecta: NaN, Infinity, valores fuera de rango físicamente razonable,
 * y variables `undefined`/`null` donde no deberían estarlo. NUNCA lanza
 * excepciones — siempre devuelve una lista de "issues" para que la
 * aplicación pueda seguir funcionando (mostrar advertencia) en vez de
 * romperse.
 */

'use strict';

import { isBadNumber } from './physics-utils.js';

function checkNumber(issues, path, value, opts = {}) {
  if (value === undefined || value === null) {
    if (opts.nullable) return;
    issues.push({ path, value, problem: 'undefined-or-null' });
    return;
  }
  if (isBadNumber(value)) {
    issues.push({ path, value, problem: 'not-a-finite-number' });
    return;
  }
  if (opts.min !== undefined && value < opts.min) {
    issues.push({ path, value, problem: `below-min(${opts.min})` });
  }
  if (opts.max !== undefined && value > opts.max) {
    issues.push({ path, value, problem: `above-max(${opts.max})` });
  }
}

/**
 * Recorre el snapshot combinado (refrigeración + eléctrico) y reporta
 * cualquier valor imposible.
 * @param {object} snapshot
 * @returns {Array<{path:string, value:any, problem:string}>}
 */
export function runSanityChecks(snapshot) {
  const issues = [];
  if (!snapshot || typeof snapshot !== 'object') {
    return [{ path: 'snapshot', value: snapshot, problem: 'undefined-or-null' }];
  }

  const r = snapshot.refrigeration || {};
  const e = snapshot.electrical || {};

  // Nota: cuando el compresor está detenido, evapSatTempF se equaliza a la
  // temperatura ambiente (ver refrigeration.js), por lo que el límite
  // superior debe cubrir escenarios de ambiente extremo + falla combinada
  // (p.ej. alta temperatura ambiente + contactor abierto), no solo el rango
  // de evaporación en operación activa.
  checkNumber(issues, 'refrigeration.evapSatTempF', r.evapSatTempF, { min: -50, max: 140 });
  checkNumber(issues, 'refrigeration.condSatTempF', r.condSatTempF, { min: -20, max: 250 });
  checkNumber(issues, 'refrigeration.suctionPressurePsig', r.suctionPressurePsig, { min: 0, max: 600 });
  checkNumber(issues, 'refrigeration.dischargePressurePsig', r.dischargePressurePsig, { min: 0, max: 700 });
  checkNumber(issues, 'refrigeration.superheatF', r.superheatF, { min: 0, max: 150, nullable: true });
  checkNumber(issues, 'refrigeration.subcoolingF', r.subcoolingF, { min: 0, max: 100, nullable: true });
  checkNumber(issues, 'refrigeration.capacityFraction', r.capacityFraction, { min: 0, max: 1.3 });
  checkNumber(issues, 'refrigeration.capacityBtuh', r.capacityBtuh, { min: 0 });
  checkNumber(issues, 'refrigeration.supplyAirTempF', r.supplyAirTempF, { min: -50, max: 150 });

  checkNumber(issues, 'electrical.voltages.average', e.voltages && e.voltages.average, { min: 0, max: 1000 });
  checkNumber(issues, 'electrical.voltages.imbalancePct', e.voltages && e.voltages.imbalancePct, { min: 0, max: 100 });
  checkNumber(issues, 'electrical.currents.average', e.currents && e.currents.average, { min: 0, max: 2000 });
  checkNumber(issues, 'electrical.currents.imbalancePct', e.currents && e.currents.imbalancePct, { min: 0, max: 100 });
  checkNumber(issues, 'electrical.powerKw', e.powerKw, { min: 0, max: 500 });
  checkNumber(issues, 'electrical.powerFactor', e.powerFactor, { min: 0, max: 1 });

  return issues;
}
