/**
 * faults.js
 *
 * Catálogo de fallas simulables y su lógica de PROPAGACIÓN hacia las
 * variables de entrada de los modelos de refrigeración y eléctrico. Ninguna
 * falla se limita a "mostrar un texto": cada una modifica variables físicas
 * reales que después se propagan por refrigeration.js / electrical.js.
 */

'use strict';

/** Catálogo de fallas disponibles con metadatos para la UI. */
export const FAULT_CATALOG = [
  { id: 'low_charge', label: 'Baja carga de refrigerante', category: 'refrigeración' },
  { id: 'overcharge', label: 'Sobrecarga de refrigerante', category: 'refrigeración' },
  { id: 'dirty_filter', label: 'Filtro de aire obstruido', category: 'aire' },
  { id: 'low_airflow', label: 'Bajo flujo de aire (evaporador)', category: 'aire' },
  { id: 'dirty_condenser', label: 'Condensador sucio', category: 'aire' },
  { id: 'high_ambient', label: 'Temperatura ambiente elevada', category: 'ambiente' },
  { id: 'phase_loss', label: 'Pérdida de fase', category: 'eléctrico' },
  { id: 'low_voltage', label: 'Bajo voltaje', category: 'eléctrico' },
  { id: 'high_voltage', label: 'Sobrevoltaje', category: 'eléctrico' },
  { id: 'contactor_fault', label: 'Contactor defectuoso (no cierra)', category: 'eléctrico' },
  { id: 'contactor_coil_open', label: 'Bobina del contactor abierta', category: 'eléctrico' },
  { id: 'compressor_locked', label: 'Compresor bloqueado (rotor trabado)', category: 'mecánico' },
  { id: 'thermal_protection_open', label: 'Protector térmico abierto', category: 'protección' },
  { id: 'condenser_fan_failure', label: 'Ventilador de condensador fallando', category: 'aire' },
  { id: 'liquid_line_restriction', label: 'Restricción en línea de líquido', category: 'refrigeración' },
  { id: 'expansion_device_problem', label: 'Problema en dispositivo de expansión', category: 'refrigeración' },
];

export const FAULT_IDS = FAULT_CATALOG.map((f) => f.id);

/**
 * Construye el conjunto de entradas "crudas" (antes de fallas) para un
 * escenario base NORMAL, a partir de condiciones ambientales.
 */
export function buildBaselineInputs({ ambientTempF = 95, returnAirTempF = 75 } = {}) {
  return {
    ambientTempF,
    returnAirTempF,
    // control / demanda
    coolingDemand: true, // termostato pidiendo enfriamiento
    // refrigeración
    evapAirflowFraction: 1,
    condAirflowFraction: 1,
    chargeFraction: 1,
    liquidLineRestriction: 0,
    expansionFault: 'none',
    // eléctrico
    contactorHardwareOk: true,
    coilOk: true,
    thermalProtectionOpen: false,
    compressorLocked: false,
    phaseLoss: 'none',
    voltageOffsetPct: 0,
    condenserFanHardwareOk: true,
  };
}

/**
 * Aplica un conjunto de IDs de falla activos sobre las entradas base,
 * devolviendo un nuevo objeto de entradas ya modificado (no muta el
 * original). El orden de aplicación es intencional: primero condiciones
 * ambientales/mecánicas, luego eléctricas, para que combinaciones de
 * fallas se acumulen de forma predecible.
 *
 * @param {ReturnType<typeof buildBaselineInputs>} baseInputs
 * @param {string[]} activeFaultIds
 * @param {{severity?: Record<string, number>}} [options] severidades opcionales por falla (0..1), por defecto 1 (máxima)
 */
export function applyFaults(baseInputs, activeFaultIds, options = {}) {
  const severity = options.severity || {};
  const sev = (id, def = 1) => clampSeverity(severity[id] !== undefined ? severity[id] : def);
  const inputs = { ...baseInputs };
  const active = new Set(activeFaultIds || []);

  if (active.has('high_ambient')) {
    inputs.ambientTempF = inputs.ambientTempF + 20 * sev('high_ambient');
  }

  if (active.has('low_charge')) {
    const s = sev('low_charge');
    inputs.chargeFraction = clampFraction(inputs.chargeFraction - 0.55 * s);
  }
  if (active.has('overcharge')) {
    const s = sev('overcharge');
    inputs.chargeFraction = clampFraction(inputs.chargeFraction + 0.4 * s, 0.05, 1.5);
  }

  if (active.has('dirty_filter')) {
    const s = sev('dirty_filter');
    inputs.evapAirflowFraction = clampFraction(inputs.evapAirflowFraction - 0.45 * s);
  }
  if (active.has('low_airflow')) {
    const s = sev('low_airflow');
    inputs.evapAirflowFraction = clampFraction(inputs.evapAirflowFraction - 0.5 * s);
  }
  if (active.has('dirty_condenser')) {
    const s = sev('dirty_condenser');
    inputs.condAirflowFraction = clampFraction(inputs.condAirflowFraction - 0.5 * s);
  }
  if (active.has('condenser_fan_failure')) {
    inputs.condenserFanHardwareOk = false;
  }
  if (active.has('liquid_line_restriction')) {
    const s = sev('liquid_line_restriction');
    inputs.liquidLineRestriction = clampFraction(inputs.liquidLineRestriction + 0.7 * s, 0, 1);
  }
  if (active.has('expansion_device_problem')) {
    // Determinista: sin severidad continua, es una falla discreta con dos
    // variantes; por defecto se usa "stuck_closed" (subalimentación), que es
    // el modo de falla más común en campo. Se puede forzar la variante desde
    // options.expansionVariant.
    inputs.expansionFault = options.expansionVariant === 'stuck_open' ? 'stuck_open' : 'stuck_closed';
  }

  // --- Eléctricas ---
  if (active.has('phase_loss')) {
    inputs.phaseLoss = options.phaseLossPhase || 'L2';
  }
  if (active.has('low_voltage')) {
    const s = sev('low_voltage');
    inputs.voltageOffsetPct = inputs.voltageOffsetPct - 18 * s;
  }
  if (active.has('high_voltage')) {
    const s = sev('high_voltage');
    inputs.voltageOffsetPct = inputs.voltageOffsetPct + 14 * s;
  }
  if (active.has('contactor_fault')) {
    inputs.contactorHardwareOk = false;
  }
  if (active.has('contactor_coil_open')) {
    inputs.coilOk = false;
  }
  if (active.has('compressor_locked')) {
    inputs.compressorLocked = true;
  }
  if (active.has('thermal_protection_open')) {
    inputs.thermalProtectionOpen = true;
  }

  return inputs;
}

function clampFraction(v, min = 0.05, max = 1.3) {
  return Math.max(min, Math.min(max, v));
}
function clampSeverity(v) {
  return Math.max(0, Math.min(1, v));
}
