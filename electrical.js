/**
 * electrical.js
 *
 * Modelo eléctrico trifásico SIMPLIFICADO para el circuito de potencia de la
 * unidad (compresor + ventiladores). Ver README.md -> "Simplificaciones
 * físicas". Se asume alimentación nominal de 460V trifásicos (supuesto de
 * diseño documentado; no es una recomendación de ingeniería para un equipo
 * real específico).
 *
 * El ventilador de condensador se asume cableado en el mismo contactor que
 * el compresor (arranque conjunto), y el ventilador/soplador de evaporador
 * en un circuito continuo independiente (supuesto típico en unidades
 * paquete, documentado en README).
 */

'use strict';

import { clamp, createSeededRandom } from './physics-utils.js';

export const NOMINAL_VOLTAGE = 460;
export const COMPRESSOR_RLA = 96; // Amperes nominales de rotor bloqueado/operación asumidos
export const COMPRESSOR_LRA = COMPRESSOR_RLA * 5.8; // Amperes de rotor bloqueado (locked rotor)
export const CONDENSER_FAN_FLA = 4.2;
export const EVAP_FAN_FLA = 12.5;

/**
 * @typedef {Object} ElectricalInputs
 * @property {number} seed                     Semilla determinista para variación de ruido
 * @property {number} tickIndex                Índice de paso de simulación (para variar el ruido en el tiempo, de forma reproducible)
 * @property {boolean} contactorClosed         Estado real del contactor principal (tras evaluar fallas de contactor/bobina/protecciones)
 * @property {boolean} compressorLocked        Falla: rotor bloqueado
 * @property {boolean} thermalProtectionOpen   Falla: protección térmica disparada (compresor no puede tomar corriente)
 * @property {'none'|'L1'|'L2'|'L3'} phaseLoss Fase perdida, si aplica
 * @property {number} voltageOffsetPct         Desviación porcentual de voltaje respecto al nominal (negativo = bajo voltaje, positivo = sobrevoltaje)
 * @property {boolean} evapFanRequested        Si el soplador de evaporador debería estar corriendo (por lógica de control, no por falla)
 */

/**
 * Calcula el estado eléctrico completo del sistema.
 * @param {ElectricalInputs} inputs
 */
export function computeElectricalState(inputs) {
  const {
    seed = 1234,
    tickIndex = 0,
    contactorClosed,
    compressorLocked,
    thermalProtectionOpen,
    phaseLoss = 'none',
    voltageOffsetPct = 0,
    evapFanRequested,
  } = inputs;

  const rng = createSeededRandom((seed + tickIndex * 977) >>> 0);
  const smallNoise = () => (rng() - 0.5) * 2; // rango aprox [-1, 1], determinista

  const compressorPowered = contactorClosed && !thermalProtectionOpen;
  const condenserFanPowered = compressorPowered; // mismo contactor, ver docstring del módulo
  const evapFanPowered = !!evapFanRequested; // circuito independiente

  // -----------------------------------------------------------------
  // 1. Voltajes de línea
  // -----------------------------------------------------------------
  const baseV = NOMINAL_VOLTAGE * (1 + voltageOffsetPct / 100);
  // Pequeño desbalance natural determinista entre fases (ruido reproducible)
  const vNoise = [smallNoise() * 1.5, smallNoise() * 1.5, smallNoise() * 1.5];

  let vL1L2 = baseV + vNoise[0];
  let vL2L3 = baseV + vNoise[1];
  let vL3L1 = baseV + vNoise[2];

  if (phaseLoss !== 'none') {
    // Pérdida de fase: las dos líneas que involucran la fase perdida caen
    // drásticamente (queda solo un pequeño voltaje residual de acople);
    // la línea entre las dos fases restantes se mantiene cercana a nominal.
    const residual = baseV * 0.08;
    if (phaseLoss === 'L1') {
      vL1L2 = residual + vNoise[0];
      vL3L1 = residual + vNoise[2];
    } else if (phaseLoss === 'L2') {
      vL1L2 = residual + vNoise[0];
      vL2L3 = residual + vNoise[1];
    } else if (phaseLoss === 'L3') {
      vL2L3 = residual + vNoise[1];
      vL3L1 = residual + vNoise[2];
    }
  }

  vL1L2 = Math.max(0, vL1L2);
  vL2L3 = Math.max(0, vL2L3);
  vL3L1 = Math.max(0, vL3L1);

  const avgV = (vL1L2 + vL2L3 + vL3L1) / 3;
  const voltageImbalancePct = clamp(
    avgV > 1 ? (Math.max(Math.abs(vL1L2 - avgV), Math.abs(vL2L3 - avgV), Math.abs(vL3L1 - avgV)) / avgV) * 100 : 0,
    0,
    100
  );

  // -----------------------------------------------------------------
  // 2. Corrientes por fase
  // -----------------------------------------------------------------
  const compressorLoadA = compressorPowered ? (compressorLocked ? COMPRESSOR_LRA : COMPRESSOR_RLA) : 0;
  const condenserFanLoadA = condenserFanPowered ? CONDENSER_FAN_FLA : 0;
  const evapFanLoadA = evapFanPowered ? EVAP_FAN_FLA : 0;

  const baseCurrent = compressorLoadA + condenserFanLoadA; // el blower se asume en circuito/fase de control separado y no se sensa aquí
  const iNoise = [smallNoise() * 0.8, smallNoise() * 0.8, smallNoise() * 0.8];

  let iL1 = baseCurrent + iNoise[0];
  let iL2 = baseCurrent + iNoise[1];
  let iL3 = baseCurrent + iNoise[2];

  if (phaseLoss !== 'none' && baseCurrent > 0) {
    // Single-phasing: las dos fases restantes intentan sostener el torque,
    // subiendo corriente (~1.6x), la fase perdida no conduce.
    const boosted = baseCurrent * 1.6;
    if (phaseLoss === 'L1') {
      iL1 = 0;
      iL2 = boosted + iNoise[1];
      iL3 = boosted + iNoise[2];
    } else if (phaseLoss === 'L2') {
      iL2 = 0;
      iL1 = boosted + iNoise[0];
      iL3 = boosted + iNoise[2];
    } else if (phaseLoss === 'L3') {
      iL3 = 0;
      iL1 = boosted + iNoise[0];
      iL2 = boosted + iNoise[1];
    }
  }

  iL1 = Math.max(0, iL1);
  iL2 = Math.max(0, iL2);
  iL3 = Math.max(0, iL3);

  const avgI = (iL1 + iL2 + iL3) / 3;
  // Con corriente promedio insignificante (equipo detenido), el porcentaje
  // de desbalance no tiene significado físico útil (ruido de fracciones de
  // amperio se amplifica a porcentajes absurdos); se reporta 0 en ese caso.
  const currentImbalancePct = clamp(
    avgI > 1 ? (Math.max(Math.abs(iL1 - avgI), Math.abs(iL2 - avgI), Math.abs(iL3 - avgI)) / avgI) * 100 : 0,
    0,
    100
  );

  // -----------------------------------------------------------------
  // 3. Factor de potencia y potencia
  // -----------------------------------------------------------------
  let powerFactor = 0.85;
  if (compressorLocked && compressorPowered) powerFactor = 0.42; // rotor bloqueado: PF bajo característico
  if (phaseLoss !== 'none' && baseCurrent > 0) powerFactor -= 0.1;
  powerFactor = clamp(powerFactor, 0.3, 0.95);

  const powerKw = (Math.sqrt(3) * avgV * avgI * powerFactor) / 1000;

  // -----------------------------------------------------------------
  // 4. Indicadores de protección
  // -----------------------------------------------------------------
  const overCurrentRatio = avgI / COMPRESSOR_RLA;
  const thermalTripImminent = compressorPowered && (compressorLocked || overCurrentRatio > 1.3);

  return {
    contactorClosed,
    compressorPowered,
    condenserFanPowered,
    evapFanPowered,
    voltages: {
      L1L2: vL1L2,
      L2L3: vL2L3,
      L3L1: vL3L1,
      average: avgV,
      imbalancePct: voltageImbalancePct,
    },
    currents: {
      L1: iL1,
      L2: iL2,
      L3: iL3,
      average: avgI,
      imbalancePct: currentImbalancePct,
    },
    powerFactor,
    powerKw,
    thermalTripImminent,
  };
}
