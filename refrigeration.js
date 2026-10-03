/**
 * refrigeration.js
 *
 * Modelo de refrigeración SIMPLIFICADO para una unidad tipo Rooftop/Package
 * de ~30 TR. Ver README.md -> "Simplificaciones físicas" para el detalle
 * completo de cada supuesto. Este módulo NO reproduce tablas termodinámicas
 * reales de un refrigerante específico; usa relaciones causa-efecto
 * monótonas y documentadas, calibradas para que el comportamiento relativo
 * (qué sube, qué baja, y por qué) sea correcto y consistente entre variables.
 *
 * Todas las funciones son puras (sin estado interno) para poder probarlas
 * de forma aislada.
 */

'use strict';

import { clamp, saturationPressureFromTemp } from './physics-utils.js';

export const NOMINAL_CAPACITY_TONS = 30;
export const NOMINAL_CAPACITY_BTUH = NOMINAL_CAPACITY_TONS * 12000; // 360,000 BTU/hr

/**
 * @typedef {Object} RefrigerationInputs
 * @property {number} ambientTempF          Temperatura ambiente exterior (°F)
 * @property {number} returnAirTempF        Temperatura de aire de retorno (°F)
 * @property {boolean} compressorOn         Estado real del compresor (tras eléctrico)
 * @property {boolean} condenserFanOn       Estado real del ventilador de condensador
 * @property {boolean} evapFanOn            Estado real del ventilador/evaporador
 * @property {number} evapAirflowFraction   Fracción de flujo de aire nominal en evaporador (1 = nominal)
 * @property {number} condAirflowFraction   Fracción de flujo de aire nominal en condensador (1 = nominal)
 * @property {number} chargeFraction        Fracción de carga de refrigerante (1 = nominal, <1 baja carga, >1 sobrecarga)
 * @property {number} liquidLineRestriction Restricción en línea de líquido, 0 (ninguna) a 1 (bloqueo total práctico)
 * @property {'none'|'stuck_open'|'stuck_closed'} expansionFault Falla del dispositivo de expansión
 */

/**
 * Calcula el estado completo del ciclo de refrigeración a partir de las
 * condiciones de entrada. Devuelve todas las variables relevantes para
 * HMI, gráficas, diagnóstico y visualización 3D.
 *
 * @param {RefrigerationInputs} inputs
 */
export function computeRefrigerationState(inputs) {
  const {
    ambientTempF,
    returnAirTempF,
    compressorOn,
    condenserFanOn,
    evapFanOn,
    evapAirflowFraction,
    condAirflowFraction,
    chargeFraction,
    liquidLineRestriction,
    expansionFault,
  } = inputs;

  const evapAF = clamp(evapAirflowFraction, 0.05, 1.3);
  const condAF = clamp(condAirflowFraction, 0.05, 1.3);
  const charge = clamp(chargeFraction, 0.05, 1.5);
  const restriction = clamp(liquidLineRestriction, 0, 1);

  if (!compressorOn) {
    // Sistema en reposo: sin ciclo activo, las presiones tienden a igualarse
    // (equalización estática). Superheat/subcooling no tienen sentido físico
    // real en este estado y se reportan como null para que la UI/diagnóstico
    // no los interprete como mediciones válidas.
    const staticSatTempF = ambientTempF;
    const staticPressure = saturationPressureFromTemp(staticSatTempF);
    return {
      running: false,
      evapSatTempF: staticSatTempF,
      condSatTempF: staticSatTempF,
      suctionPressurePsig: staticPressure,
      dischargePressurePsig: staticPressure,
      suctionLineTempF: staticSatTempF,
      liquidLineTempF: staticSatTempF,
      superheatF: null,
      subcoolingF: null,
      supplyAirTempF: returnAirTempF,
      capacityBtuh: 0,
      capacityFraction: 0,
      iceRisk: false,
      floodbackRisk: false,
      flashGasRisk: false,
      notes: ['Compresor detenido: presiones equalizadas, sin ciclo activo.'],
    };
  }

  const notes = [];

  // ---------------------------------------------------------------
  // 1. Lado de condensación
  // ---------------------------------------------------------------
  // Aproximación de condensador a temperatura ambiente, base 20°F a flujo
  // de aire nominal y condensador limpio. La falla de ventilador de
  // condensador se modela como una fuerte reducción de condAF (convección
  // natural residual), no como condAF = 0 literal, para evitar división
  // por cero y representar que igual existe algo de intercambio de calor.
  const effectiveCondAF = condenserFanOn ? condAF : 0.12;
  const BASE_CONDENSER_APPROACH_F = 20;
  const condenserApproachF = BASE_CONDENSER_APPROACH_F / effectiveCondAF;
  let condSatTempF = ambientTempF + condenserApproachF;
  condSatTempF = clamp(condSatTempF, ambientTempF, 220);

  if (!condenserFanOn) {
    notes.push('Ventilador de condensador apagado/fallando: temperatura y presión de condensación elevadas por convección natural insuficiente.');
  }

  // ---------------------------------------------------------------
  // 2. Lado de evaporación
  // ---------------------------------------------------------------
  const BASE_EVAP_TD_F = 35; // TD retorno -> saturación evap, a condiciones nominales
  // Menor flujo de aire => coil más frío (mayor TD), relación no lineal suave.
  const airflowTdPenalty = BASE_EVAP_TD_F * (Math.pow(1 / evapAF, 0.8) - 1);
  // Baja carga "hambrea" el evaporador -> TD adicional. Sobrecarga casi no
  // afecta el TD del evaporador (afecta más al subcooling / línea de líquido).
  const chargeTdPenalty = charge < 1 ? (1 - charge) * 22 : 0;
  // Restricción en línea de líquido también hambrea el evaporador.
  const restrictionTdPenalty = restriction * 30;
  // Dispositivo de expansión atascado cerrado = subalimentación severa.
  const expansionClosedPenalty = expansionFault === 'stuck_closed' ? 25 : 0;
  // Dispositivo de expansión atascado abierto = sobrealimentación -> coil
  // más "húmedo"/tibio relativamente, TD algo menor.
  const expansionOpenBonus = expansionFault === 'stuck_open' ? -8 : 0;

  const evapTdTotal = clamp(
    BASE_EVAP_TD_F + airflowTdPenalty + chargeTdPenalty + restrictionTdPenalty + expansionClosedPenalty + expansionOpenBonus,
    5,
    120
  );

  let evapSatTempF = returnAirTempF - evapTdTotal;
  evapSatTempF = clamp(evapSatTempF, -20, 70);

  // ---------------------------------------------------------------
  // 3. Superheat y Subcooling
  // ---------------------------------------------------------------
  const BASE_SUPERHEAT_F = 12;
  const BASE_SUBCOOLING_F = 10;

  let superheatF = BASE_SUPERHEAT_F;
  if (charge < 1) superheatF += (1 - charge) * 45;
  if (charge > 1) superheatF -= (charge - 1) * 30;
  if (evapAF < 1) superheatF += (1 - evapAF) * 10;
  superheatF += restriction * 35;
  if (expansionFault === 'stuck_closed') superheatF += 30;
  if (expansionFault === 'stuck_open') superheatF -= 18;
  superheatF = clamp(superheatF, -10, 90); // se permite negativo momentáneamente para
  // que sanity-check lo detecte como imposible si no se satura correctamente;
  // se satura a 0 más abajo con marca de riesgo.

  let subcoolingF = BASE_SUBCOOLING_F;
  if (charge < 1) subcoolingF -= (1 - charge) * 32;
  if (charge > 1) subcoolingF += (charge - 1) * 35;
  // La restricción en línea de líquido NO reduce el subcooling medido en la
  // válvula de servicio de líquido (aguas arriba de la restricción): de
  // hecho puede subir levemente porque el líquido se "represa" en el
  // condensador. Este es un caso adversarial deliberado (ver README /
  // sección RED TEAM): los síntomas de evaporador hambriento se parecen a
  // baja carga, pero el subcooling NO baja como en baja carga real.
  subcoolingF += restriction * 8;
  if (expansionFault === 'stuck_open') subcoolingF -= 5;
  if (expansionFault === 'stuck_closed') subcoolingF += 4;
  subcoolingF = clamp(subcoolingF, -10, 45);

  const floodbackRisk = superheatF <= 2 && (charge > 1.15 || expansionFault === 'stuck_open');
  const flashGasRisk = subcoolingF <= 1 && charge < 0.9 && expansionFault !== 'stuck_open';

  // Si el superheat calculado es negativo (situación físicamente anómala,
  // p.ej. inundación severa), se satura a 0 para el valor "medido" pero se
  // deja evidencia en notes; sanity.js puede además detectar el caso crudo.
  const superheatMeasuredF = Math.max(0, superheatF);
  const subcoolingMeasuredF = Math.max(0, subcoolingF);

  const suctionLineTempF = evapSatTempF + superheatMeasuredF;
  const liquidLineTempF = condSatTempF - subcoolingMeasuredF;

  const suctionPressurePsig = saturationPressureFromTemp(evapSatTempF);
  const dischargePressurePsig = saturationPressureFromTemp(condSatTempF);

  // ---------------------------------------------------------------
  // 4. Temperatura de suministro
  // ---------------------------------------------------------------
  // A mayor flujo de aire, menor tiempo de contacto con el serpentín ->
  // suministro relativamente más cerca de la temperatura de retorno (menos
  // deshumidificación/enfriamiento por unidad de aire). A menor flujo,
  // mayor contacto -> suministro más cercano a la temperatura del coil.
  const supplyApproachF = clamp(4 + (1 - evapAF) * 10, 2, 25);
  let supplyAirTempF = evapFanOn ? evapSatTempF + supplyApproachF : returnAirTempF;
  supplyAirTempF = clamp(supplyAirTempF, evapSatTempF, returnAirTempF + 2);

  // ---------------------------------------------------------------
  // 5. Capacidad de enfriamiento
  // ---------------------------------------------------------------
  const chargeCapacityFactor = clamp(1 - Math.abs(1 - charge) * 0.65, 0.1, 1);
  const condenserCapacityFactor = clamp(1 - Math.max(0, condSatTempF - 120) * 0.01, 0.2, 1);
  const restrictionCapacityFactor = clamp(1 - restriction * 0.55, 0.15, 1);
  const airflowCapacityFactor = clamp(evapAF, 0.2, 1); // exceso de aire no añade capacidad más allá de nominal
  let expansionCapacityFactor = 1;
  if (expansionFault === 'stuck_open') expansionCapacityFactor = 0.82;
  if (expansionFault === 'stuck_closed') expansionCapacityFactor = 0.4;

  const capacityFraction = evapFanOn
    ? clamp(
        chargeCapacityFactor * condenserCapacityFactor * restrictionCapacityFactor * airflowCapacityFactor * expansionCapacityFactor,
        0,
        1.05
      )
    : 0;
  const capacityBtuh = NOMINAL_CAPACITY_BTUH * capacityFraction;

  // ---------------------------------------------------------------
  // 6. Riesgo de hielo en el serpentín
  // ---------------------------------------------------------------
  const iceRisk = evapSatTempF <= 31 && evapFanOn;
  if (iceRisk) {
    notes.push('Temperatura de saturación de evaporación por debajo de 31°F con ventilador operando: riesgo de formación de hielo en el serpentín.');
  }
  if (floodbackRisk) {
    notes.push('Superheat muy bajo con sobrecarga o válvula de expansión abierta: riesgo de retorno de líquido al compresor.');
  }
  if (flashGasRisk) {
    notes.push('Subcooling muy bajo con carga reducida: riesgo de gas flash en la línea de líquido.');
  }

  // ---------------------------------------------------------------
  // 7. Señales adicionales, medibles por un técnico, pensadas
  //    específicamente para DIFERENCIAR entre causas que producen
  //    síntomas superficialmente parecidos (ver diagnostics.js y
  //    README -> "Casos adversariales").
  // ---------------------------------------------------------------
  // Caída de presión estática estimada en filtro/serpentín (in. w.c.):
  // sube específicamente cuando el AIRFLOW está reducido (filtro sucio o
  // bajo flujo de aire), y NO cuando el problema es de carga o del
  // dispositivo de expansión. Es el discriminador clave entre "baja
  // carga" y "bajo flujo de aire", ambos con superheat alto y baja
  // capacidad.
  const filterDeltaPressureInWc = 0.5 * Math.pow(1 / evapAF, 1.6);

  // Señal de "escarcha/sudoración localizada" en la línea de líquido justo
  // en el punto de restricción (filtro deshidratador obstruido, válvula
  // parcialmente cerrada, etc.). Es una observación típica de campo que
  // NO ocurre por baja carga ni por un TXV mal calibrado.
  const restrictionSignatureDetected = restriction > 0.3;

  return {
    running: true,
    evapSatTempF: evapSatTempF,
    condSatTempF: condSatTempF,
    suctionPressurePsig,
    dischargePressurePsig,
    suctionLineTempF,
    liquidLineTempF,
    superheatF: superheatMeasuredF,
    subcoolingF: subcoolingMeasuredF,
    supplyAirTempF,
    capacityBtuh,
    capacityFraction,
    iceRisk,
    floodbackRisk,
    flashGasRisk,
    filterDeltaPressureInWc,
    restrictionSignatureDetected,
    notes,
  };
}
