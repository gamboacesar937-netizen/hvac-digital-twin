/**
 * scenarios.js
 *
 * Escenarios predefinidos, deterministas y reproducibles. Cada escenario
 * especifica: ambiente, fallas activas y opciones de severidad/variante.
 * Cargar el mismo escenario siempre produce la misma secuencia de estados
 * (misma semilla, mismas entradas).
 */

'use strict';

export const SCENARIOS = [
  {
    id: 'NORMAL',
    label: 'Operación normal',
    description: 'Unidad operando dentro de parámetros de diseño, sin fallas activas.',
    ambientTempF: 95,
    returnAirTempF: 75,
    faults: [],
    faultOptions: {},
  },
  {
    id: 'LOW_CHARGE',
    label: 'Baja carga de refrigerante',
    description: 'Fuga lenta de refrigerante: subcooling bajo, superheat elevado, capacidad reducida.',
    ambientTempF: 95,
    returnAirTempF: 75,
    faults: ['low_charge'],
    faultOptions: { severity: { low_charge: 0.7 } },
  },
  {
    id: 'OVERCHARGE',
    label: 'Sobrecarga de refrigerante',
    description: 'Carga excesiva instalada por error: subcooling alto, superheat bajo, riesgo de retorno de líquido.',
    ambientTempF: 90,
    returnAirTempF: 75,
    faults: ['overcharge'],
    faultOptions: { severity: { overcharge: 0.8 } },
  },
  {
    id: 'LOW_AIRFLOW',
    label: 'Bajo flujo de aire / filtro sucio',
    description: 'Filtro obstruido: alta caída de presión estática, superheat elevado, subcooling normal.',
    ambientTempF: 92,
    returnAirTempF: 76,
    faults: ['dirty_filter'],
    faultOptions: { severity: { dirty_filter: 0.85 } },
  },
  {
    id: 'DIRTY_CONDENSER',
    label: 'Condensador sucio',
    description: 'Serpentín de condensador obstruido con suciedad: presión y temperatura de descarga elevadas.',
    ambientTempF: 98,
    returnAirTempF: 76,
    faults: ['dirty_condenser'],
    faultOptions: { severity: { dirty_condenser: 0.8 } },
  },
  {
    id: 'PHASE_LOSS',
    label: 'Pérdida de fase',
    description: 'Se pierde la fase L2 en la alimentación: corriente nula en L2, corrientes elevadas en L1/L3.',
    ambientTempF: 90,
    returnAirTempF: 75,
    faults: ['phase_loss'],
    faultOptions: { phaseLossPhase: 'L2' },
  },
  {
    id: 'CONTACTOR_FAILURE',
    label: 'Falla de contactor',
    description: 'El contactor principal no cierra: el compresor no recibe energía.',
    ambientTempF: 90,
    returnAirTempF: 78,
    faults: ['contactor_fault'],
    faultOptions: {},
  },
  {
    id: 'COMPRESSOR_LOCKED',
    label: 'Compresor bloqueado',
    description: 'Rotor de compresor trabado: corriente de rotor bloqueado, riesgo de disparo térmico inminente.',
    ambientTempF: 90,
    returnAirTempF: 75,
    faults: ['compressor_locked'],
    faultOptions: {},
  },
  {
    id: 'LIQUID_RESTRICTION',
    label: 'Restricción en línea de líquido',
    description: 'Filtro deshidratador parcialmente obstruido: evaporador hambriento pero subcooling normal/alto (caso adversarial vs. baja carga).',
    ambientTempF: 92,
    returnAirTempF: 75,
    faults: ['liquid_line_restriction'],
    faultOptions: { severity: { liquid_line_restriction: 0.8 } },
  },
  {
    id: 'EXPANSION_PROBLEM',
    label: 'Problema en dispositivo de expansión (subalimentando)',
    description: 'Válvula de expansión con bulbo remoto fallando, subalimentando el evaporador.',
    ambientTempF: 92,
    returnAirTempF: 75,
    faults: ['expansion_device_problem'],
    faultOptions: { expansionVariant: 'stuck_closed' },
  },
];

export function getScenario(id) {
  return SCENARIOS.find((s) => s.id === id) || null;
}

/** Aplica un escenario a una instancia de SimulationEngine. */
export function applyScenario(engine, scenarioId) {
  const scenario = getScenario(scenarioId);
  if (!scenario) throw new Error(`Escenario desconocido: ${scenarioId}`);
  engine.reset();
  engine.setAmbient(scenario.ambientTempF, scenario.returnAirTempF);
  engine.setFaults(scenario.faults);
  engine.setFaultOptions(scenario.faultOptions);
  return scenario;
}
