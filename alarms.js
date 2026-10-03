/**
 * alarms.js
 *
 * Deriva alarmas/advertencias/protecciones a partir de un snapshot completo
 * del sistema (salida combinada de refrigeración + eléctrico + estado de
 * control). Cada alarma tiene un nivel: 'protection' (disparo de protección,
 * el equipo se detiene), 'alarm' (condición anormal seria) o 'warning'
 * (condición a vigilar).
 */

'use strict';

/**
 * @param {object} snapshot Resultado combinado de un tick de SimulationEngine
 * @returns {Array<{id:string, level:'protection'|'alarm'|'warning', message:string}>}
 */
export function deriveAlarms(snapshot) {
  const alarms = [];
  const { refrigeration: r, electrical: e, control } = snapshot;

  if (control.thermalProtectionOpenEffective) {
    alarms.push({
      id: 'thermal_protection',
      level: 'protection',
      message: 'Protección térmica del compresor abierta: el compresor no puede operar hasta reposicionar/reset.',
    });
  }
  if (!control.contactorHardwareOk) {
    alarms.push({ id: 'contactor_fault', level: 'protection', message: 'Contactor principal no cierra (falla mecánica/contactos).' });
  }
  if (!control.coilOk) {
    alarms.push({ id: 'coil_open', level: 'protection', message: 'Circuito de control abierto: bobina del contactor sin continuidad.' });
  }
  if (control.compressorLocked) {
    alarms.push({ id: 'compressor_locked', level: 'protection', message: 'Rotor de compresor bloqueado: corriente de rotor bloqueado detectada.' });
  }
  if (e && e.currents && control.phaseLossActive) {
    alarms.push({ id: 'phase_loss', level: 'protection', message: `Pérdida de fase detectada (${control.phaseLoss}): riesgo severo para el compresor.` });
  }
  if (e && e.voltages) {
    if (e.voltages.average < 414) {
      alarms.push({ id: 'low_voltage', level: 'alarm', message: 'Voltaje promedio por debajo del rango aceptable (~10% bajo nominal).' });
    }
    if (e.voltages.average > 506) {
      alarms.push({ id: 'high_voltage', level: 'alarm', message: 'Voltaje promedio por encima del rango aceptable (~10% sobre nominal).' });
    }
    if (e.voltages.imbalancePct > 4) {
      alarms.push({ id: 'voltage_imbalance', level: 'warning', message: `Desbalance de voltaje elevado (${e.voltages.imbalancePct.toFixed(1)}%).` });
    }
  }
  if (e && e.currents && e.currents.imbalancePct > 10) {
    alarms.push({ id: 'current_imbalance', level: 'warning', message: `Desbalance de corriente elevado (${e.currents.imbalancePct.toFixed(1)}%).` });
  }
  if (e && e.thermalTripImminent) {
    alarms.push({ id: 'overcurrent', level: 'alarm', message: 'Sobrecorriente sostenida: riesgo de disparo térmico inminente.' });
  }
  if (r) {
    if (r.iceRisk) alarms.push({ id: 'ice_risk', level: 'alarm', message: 'Riesgo de formación de hielo en serpentín evaporador.' });
    if (r.floodbackRisk) alarms.push({ id: 'floodback_risk', level: 'alarm', message: 'Riesgo de retorno de líquido refrigerante al compresor.' });
    if (r.flashGasRisk) alarms.push({ id: 'flash_gas_risk', level: 'warning', message: 'Riesgo de gas flash en línea de líquido (subcooling insuficiente).' });
    if (r.running && r.capacityFraction < 0.5) {
      alarms.push({ id: 'low_capacity', level: 'warning', message: `Capacidad de enfriamiento reducida a ${(r.capacityFraction * 100).toFixed(0)}% de nominal.` });
    }
    if (r.running && r.dischargePressurePsig > 420) {
      alarms.push({ id: 'high_discharge', level: 'alarm', message: 'Presión de descarga elevada: revisar condensador/flujo de aire.' });
    }
  }

  return alarms;
}
