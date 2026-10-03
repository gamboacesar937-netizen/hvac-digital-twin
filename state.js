/**
 * state.js
 *
 * SimulationEngine: motor de simulación CON ESTADO. Es el único lugar del
 * proyecto donde se mantiene memoria entre pasos (tick a tick), en concreto:
 *   - un acumulador térmico del compresor (para que "protector térmico
 *     abierto" pueda dispararse automáticamente por sobrecorriente sostenida,
 *     además de poder forzarse como falla manual), y
 *   - el índice de tick, usado junto con la semilla para el ruido
 *     determinista del modelo eléctrico (misma semilla + mismo tick =>
 *     mismo resultado siempre; ver "Simulación determinista").
 *
 * Todo lo demás (refrigeración, eléctrico, fallas, alarmas) son funciones
 * puras importadas de otros módulos.
 */

'use strict';

import { buildBaselineInputs, applyFaults } from './faults.js';
import { computeElectricalState } from './electrical.js';
import { computeRefrigerationState } from './refrigeration.js';
import { deriveAlarms } from './alarms.js';
import { runSanityChecks } from './sanity.js';

const THERMAL_TRIP_THRESHOLD = 100;
const THERMAL_ACCUMULATION_RATE = 6; // por tick, cuando hay sobrecorriente sostenida
const THERMAL_DECAY_RATE = 2; // por tick, en operación normal

export class SimulationEngine {
  /**
   * @param {{seed?: number, ambientTempF?: number, returnAirTempF?: number}} [options]
   */
  constructor(options = {}) {
    this.seed = options.seed ?? 20260101;
    this.ambientTempF = options.ambientTempF ?? 95;
    this.returnAirTempF = options.returnAirTempF ?? 75;
    this.coolingDemand = true;
    this.activeFaultIds = new Set();
    this.faultOptions = {}; // severidades / variantes por falla
    this.tickIndex = 0;
    this.thermalAccumulator = 0;
    this.thermalTrippedLatched = false; // disparo automático persistente
    this.manualThermalReset = false;
    this.sanityIssues = [];
  }

  /** Activa o desactiva una falla por id. */
  setFault(faultId, enabled) {
    if (enabled) this.activeFaultIds.add(faultId);
    else this.activeFaultIds.delete(faultId);
  }

  /** Reemplaza el conjunto completo de fallas activas. */
  setFaults(faultIds) {
    this.activeFaultIds = new Set(faultIds);
  }

  setFaultOptions(options) {
    this.faultOptions = { ...this.faultOptions, ...options };
  }

  setAmbient(ambientTempF, returnAirTempF) {
    if (typeof ambientTempF === 'number') this.ambientTempF = ambientTempF;
    if (typeof returnAirTempF === 'number') this.returnAirTempF = returnAirTempF;
  }

  setCoolingDemand(demand) {
    this.coolingDemand = !!demand;
  }

  /** RESET SYSTEM: regresa la simulación a estado normal (sin fallas, sin latch térmico). */
  reset() {
    this.activeFaultIds = new Set();
    this.faultOptions = {};
    this.tickIndex = 0;
    this.thermalAccumulator = 0;
    this.thermalTrippedLatched = false;
    this.manualThermalReset = false;
    this.coolingDemand = true;
  }

  /** Intenta reponer manualmente la protección térmica disparada (si ya no hay sobrecorriente sostenida, se libera). */
  acknowledgeThermalReset() {
    this.manualThermalReset = true;
  }

  /**
   * Avanza un paso de simulación y devuelve un snapshot completo del sistema.
   */
  tick() {
    const baseline = buildBaselineInputs({ ambientTempF: this.ambientTempF, returnAirTempF: this.returnAirTempF });
    baseline.coolingDemand = this.coolingDemand;

    const faultsAppliedInputs = applyFaults(baseline, Array.from(this.activeFaultIds), this.faultOptions);

    // La falla "thermal_protection_open" seleccionada manualmente por el
    // usuario se combina (OR) con el disparo automático por sobrecorriente.
    const manualThermalFault = this.activeFaultIds.has('thermal_protection_open');
    let thermalProtectionOpenEffective = manualThermalFault || this.thermalTrippedLatched;

    if (this.manualThermalReset && !manualThermalFault) {
      thermalProtectionOpenEffective = false;
      this.thermalTrippedLatched = false;
    }
    this.manualThermalReset = false;

    const contactorClosed =
      faultsAppliedInputs.contactorHardwareOk &&
      faultsAppliedInputs.coilOk &&
      !thermalProtectionOpenEffective &&
      this.coolingDemand;

    const evapFanOn = this.coolingDemand;

    const electrical = computeElectricalState({
      seed: this.seed,
      tickIndex: this.tickIndex,
      contactorClosed,
      compressorLocked: faultsAppliedInputs.compressorLocked,
      thermalProtectionOpen: thermalProtectionOpenEffective,
      phaseLoss: faultsAppliedInputs.phaseLoss,
      voltageOffsetPct: faultsAppliedInputs.voltageOffsetPct,
      evapFanRequested: evapFanOn,
    });

    // --- Acumulador térmico (con memoria entre ticks) ---
    const overCurrentRatio = electrical.currents.average / 96; // COMPRESSOR_RLA
    if (electrical.compressorPowered && (faultsAppliedInputs.compressorLocked || overCurrentRatio > 1.25)) {
      this.thermalAccumulator = Math.min(THERMAL_TRIP_THRESHOLD, this.thermalAccumulator + THERMAL_ACCUMULATION_RATE);
    } else {
      this.thermalAccumulator = Math.max(0, this.thermalAccumulator - THERMAL_DECAY_RATE);
    }
    if (this.thermalAccumulator >= THERMAL_TRIP_THRESHOLD) {
      this.thermalTrippedLatched = true;
    }

    const condenserFanOn = electrical.condenserFanPowered && faultsAppliedInputs.condenserFanHardwareOk;

    const refrigeration = computeRefrigerationState({
      ambientTempF: faultsAppliedInputs.ambientTempF,
      returnAirTempF: faultsAppliedInputs.returnAirTempF,
      compressorOn: electrical.compressorPowered,
      condenserFanOn,
      evapFanOn: electrical.evapFanPowered,
      evapAirflowFraction: faultsAppliedInputs.evapAirflowFraction,
      condAirflowFraction: faultsAppliedInputs.condAirflowFraction,
      chargeFraction: faultsAppliedInputs.chargeFraction,
      liquidLineRestriction: faultsAppliedInputs.liquidLineRestriction,
      expansionFault: faultsAppliedInputs.expansionFault,
    });

    const control = {
      coolingDemand: this.coolingDemand,
      contactorHardwareOk: faultsAppliedInputs.contactorHardwareOk,
      coilOk: faultsAppliedInputs.coilOk,
      compressorLocked: faultsAppliedInputs.compressorLocked,
      thermalProtectionOpenEffective,
      thermalAccumulator: this.thermalAccumulator,
      phaseLoss: faultsAppliedInputs.phaseLoss,
      phaseLossActive: faultsAppliedInputs.phaseLoss !== 'none',
    };

    const snapshot = {
      tickIndex: this.tickIndex,
      timestamp: Date.now(),
      activeFaults: Array.from(this.activeFaultIds),
      ambientTempF: faultsAppliedInputs.ambientTempF,
      returnAirTempF: faultsAppliedInputs.returnAirTempF,
      control,
      electrical,
      refrigeration,
    };

    const issues = runSanityChecks(snapshot);
    this.sanityIssues = issues;
    snapshot.sanityIssues = issues;
    snapshot.alarms = deriveAlarms(snapshot);

    this.tickIndex += 1;
    return snapshot;
  }
}


