/**
 * diagnostics.js
 *
 * Motor de diagnóstico basado en evidencia. NO usa reglas del tipo
 * "síntoma X = falla Y". Cada hipótesis se evalúa contra un conjunto de
 * señales (mediciones), y cada señal puede:
 *   - apoyar la hipótesis ('support'),
 *   - contradecirla ('contradict'), o
 *   - quedar sin evaluar por falta de medición ('unknown', si no fue tomada).
 *
 * Clasificación final de cada hipótesis:
 *   - CONTRADICTORIO: al menos una señal contradice la hipótesis.
 *   - DEMOSTRADO: sin contradicciones, con suficiente evidencia fuerte e
 *     independiente, y sin mediciones críticas faltantes.
 *   - COMPATIBLE: sin contradicciones, con alguna evidencia a favor, pero
 *     insuficiente para "demostrar" (o con mediciones críticas faltantes).
 *   - NO_DETERMINADO: sin evidencia a favor ni en contra (falta de datos).
 *
 * El motor evita "anclaje": siempre evalúa TODAS las hipótesis del catálogo,
 * no se detiene en la primera que "encaja".
 */

'use strict';

export const DEFAULT_TAKEN_MEASUREMENTS = [
  'suction_pressure',
  'discharge_pressure',
  'superheat',
  'subcooling',
  'supply_temp',
  'return_temp',
  'ambient_temp',
  'voltages',
  'currents',
  'power_factor',
  'compressor_status',
  'condenser_fan_status',
  'contactor_state',
  // Las dos siguientes representan pruebas/observaciones DELIBERADAS que un
  // técnico debe decidir realizar (no son lecturas automáticas del panel):
  // 'filter_dp'  -> medir caída de presión estática en filtro/serpentín
  // 'restriction_signature' -> inspeccionar visualmente/al tacto la línea de líquido
];

/**
 * Construye un accesor de mediciones que sabe si una medición fue "tomada"
 * por el técnico (modo técnico) y devuelve su valor si aplica.
 */
function makeMeasurementAccessor(snapshot, takenList) {
  const taken = new Set(takenList);
  const r = snapshot.refrigeration;
  const e = snapshot.electrical;
  const values = {
    suction_pressure: r.suctionPressurePsig,
    discharge_pressure: r.dischargePressurePsig,
    superheat: r.superheatF,
    subcooling: r.subcoolingF,
    supply_temp: r.supplyAirTempF,
    return_temp: snapshot.returnAirTempF,
    ambient_temp: snapshot.ambientTempF,
    voltages: e.voltages,
    currents: e.currents,
    power_factor: e.powerFactor,
    compressor_status: e.compressorPowered,
    condenser_fan_status: e.condenserFanPowered,
    contactor_state: snapshot.control.contactorHardwareOk && snapshot.control.coilOk,
    filter_dp: r.filterDeltaPressureInWc,
    restriction_signature: r.restrictionSignatureDetected,
  };
  return {
    get(key) {
      return { taken: taken.has(key), value: values[key] };
    },
  };
}

function sig(key, result, detail, strength = 'normal', critical = false) {
  return { key, result, detail, strength, critical };
}

/**
 * Catálogo de hipótesis. Cada `evaluate(m)` recibe el accesor de mediciones
 * y devuelve { signals, recommendedNextTest }.
 */
const HYPOTHESES = [
  {
    id: 'low_charge',
    label: 'Baja carga de refrigerante',
    evaluate(m) {
      const signals = [];
      const sh = m.get('superheat');
      const sc = m.get('subcooling');
      const fdp = m.get('filter_dp');
      const rs = m.get('restriction_signature');

      if (sc.taken && sc.value !== null) {
        if (sc.value < 6) signals.push(sig('subcooling_bajo', 'support', `Subcooling bajo (${sc.value.toFixed(1)}°F), típico de carga insuficiente.`, 'strong'));
        else if (sc.value > 14) signals.push(sig('subcooling_normal_alto', 'contradict', `Subcooling normal/alto (${sc.value.toFixed(1)}°F): no es consistente con baja carga.`));
      } else signals.push(sig('subcooling', 'unknown', 'Subcooling no medido.', 'normal', true));

      if (sh.taken && sh.value !== null) {
        if (sh.value > 20) signals.push(sig('superheat_alto', 'support', `Superheat elevado (${sh.value.toFixed(1)}°F).`));
        else if (sh.value < 8) signals.push(sig('superheat_bajo', 'contradict', `Superheat bajo (${sh.value.toFixed(1)}°F): no es consistente con baja carga.`));
      } else signals.push(sig('superheat', 'unknown', 'Superheat no medido.', 'normal', true));

      if (fdp.taken && fdp.value > 1.1) {
        signals.push(sig('filtro_obstruido', 'contradict', 'Caída de presión en filtro/serpentín elevada: el bajo flujo de aire explica mejor los síntomas.'));
      }
      if (rs.taken && rs.value === true) {
        signals.push(sig('restriccion_detectada', 'contradict', 'Se detectó firma de restricción en línea de líquido: explica mejor los síntomas que la baja carga.'));
      }
      return { signals, recommendedNextTest: 'Confirmar con subcooling y verificar ausencia de restricción/obstrucción de aire antes de agregar refrigerante.' };
    },
  },
  {
    id: 'overcharge',
    label: 'Sobrecarga de refrigerante',
    evaluate(m) {
      const signals = [];
      const sh = m.get('superheat');
      const sc = m.get('subcooling');
      if (sc.taken && sc.value !== null) {
        if (sc.value > 16) signals.push(sig('subcooling_alto', 'support', `Subcooling alto (${sc.value.toFixed(1)}°F).`, 'strong'));
        else if (sc.value < 9) signals.push(sig('subcooling_bajo', 'contradict', `Subcooling bajo/normal (${sc.value.toFixed(1)}°F): no es consistente con sobrecarga.`));
      } else signals.push(sig('subcooling', 'unknown', 'Subcooling no medido.', 'normal', true));
      if (sh.taken && sh.value !== null) {
        if (sh.value < 8) signals.push(sig('superheat_bajo', 'support', `Superheat bajo (${sh.value.toFixed(1)}°F).`));
        else if (sh.value > 18) signals.push(sig('superheat_alto', 'contradict', `Superheat elevado (${sh.value.toFixed(1)}°F): no es consistente con sobrecarga.`));
      } else signals.push(sig('superheat', 'unknown', 'Superheat no medido.', 'normal', true));
      if (m.get('discharge_pressure').taken && m.get('discharge_pressure').value > 400) {
        signals.push(sig('descarga_alta', 'support', 'Presión de descarga elevada, compatible con sobrecarga.'));
      }
      return { signals, recommendedNextTest: 'Verificar peso de carga contra placa y recuperar excedente si se confirma.' };
    },
  },
  {
    id: 'low_airflow',
    label: 'Bajo flujo de aire (filtro sucio / obstrucción de aire en evaporador)',
    evaluate(m) {
      const signals = [];
      const fdp = m.get('filter_dp');
      const sh = m.get('superheat');
      const sc = m.get('subcooling');
      const rs = m.get('restriction_signature');

      if (fdp.taken) {
        if (fdp.value > 1.1) signals.push(sig('filtro_dp_alta', 'support', `Caída de presión en filtro/serpentín elevada (${fdp.value.toFixed(2)} in.w.c.).`, 'strong'));
        else if (fdp.value < 0.7) signals.push(sig('filtro_dp_normal', 'contradict', 'Caída de presión en filtro/serpentín claramente normal: no respalda bajo flujo de aire.'));
        // Entre 0.7 y 1.1 in.w.c. la lectura es ambigua/limítrofe: no se
        // cuenta como apoyo ni como contradicción (evita falsos rechazos
        // ante fallas leves o en desarrollo).
      } else signals.push(sig('filter_dp', 'unknown', 'No se ha medido la caída de presión en el filtro/serpentín.', 'normal', true));

      if (sc.taken && sc.value !== null && sc.value < 6) {
        signals.push(sig('subcooling_bajo', 'contradict', 'Subcooling bajo: apunta más a baja carga que a bajo flujo de aire.'));
      }
      if (rs.taken && rs.value === true) {
        signals.push(sig('restriccion_detectada', 'contradict', 'Firma de restricción detectada: explica mejor los síntomas.'));
      }
      if (sh.taken && sh.value !== null && sh.value > 18) {
        signals.push(sig('superheat_alto', 'support', 'Superheat elevado, compatible con evaporador hambriento por bajo flujo de aire.'));
      }
      return { signals, recommendedNextTest: 'Medir caída de presión estática en el filtro y revisar/limpiar filtro y serpentín.' };
    },
  },
  {
    id: 'condenser_airflow_problem',
    label: 'Condensación elevada (condensador sucio o ventilador de condensador fallando)',
    evaluate(m) {
      const signals = [];
      const dp = m.get('discharge_pressure');
      const cf = m.get('condenser_fan_status');
      if (dp.taken) {
        if (dp.value > 380) signals.push(sig('descarga_alta', 'support', `Presión de descarga elevada (${dp.value.toFixed(0)} psig).`, 'strong'));
        else if (dp.value < 340) signals.push(sig('descarga_normal', 'contradict', 'Presión de descarga claramente normal: no respalda esta hipótesis.'));
        // Entre 340 y 380 psig la lectura es limítrofe: no se cuenta como
        // evidencia en ningún sentido.
      } else signals.push(sig('discharge_pressure', 'unknown', 'Presión de descarga no medida.', 'normal', true));

      if (cf.taken) {
        if (cf.value === false) signals.push(sig('ventilador_condensador_apagado', 'support', 'Ventilador de condensador no está girando/energizado.', 'strong'));
      } else signals.push(sig('condenser_fan_status', 'unknown', 'Estado del ventilador de condensador no verificado.', 'normal', true));

      return {
        signals,
        recommendedNextTest: 'Verificar giro y amperaje del ventilador de condensador; si gira normalmente, inspeccionar limpieza física del serpentín condensador.',
      };
    },
  },
  {
    id: 'liquid_line_restriction',
    label: 'Restricción en línea de líquido',
    evaluate(m) {
      const signals = [];
      const rs = m.get('restriction_signature');
      const sc = m.get('subcooling');
      const sh = m.get('superheat');
      if (rs.taken) {
        if (rs.value === true) signals.push(sig('firma_restriccion', 'support', 'Firma de restricción (escarcha/sudoración localizada) detectada en línea de líquido.', 'strong'));
        else signals.push(sig('sin_firma_restriccion', 'contradict', 'No se observa firma de restricción en línea de líquido.'));
      } else signals.push(sig('restriction_signature', 'unknown', 'No se ha inspeccionado la línea de líquido en busca de restricción.', 'normal', true));

      if (sc.taken && sc.value !== null && sc.value < 6) {
        signals.push(sig('subcooling_bajo', 'contradict', 'Subcooling bajo: más consistente con baja carga real que con restricción.'));
      }
      if (sh.taken && sh.value !== null && sh.value > 18 && sc.taken && sc.value !== null && sc.value >= 6) {
        signals.push(sig('superheat_alto_subcooling_normal', 'support', 'Superheat alto con subcooling normal/alto: patrón clásico de evaporador hambriento por restricción (no por baja carga).'));
      }
      return { signals, recommendedNextTest: 'Inspeccionar filtro deshidratador y línea de líquido buscando punto de escarcha/caída de temperatura súbita.' };
    },
  },
  {
    id: 'expansion_device_stuck_closed',
    label: 'Dispositivo de expansión subalimentando (atascado cerrado / bulbo con falla)',
    evaluate(m) {
      const signals = [];
      const sh = m.get('superheat');
      const sc = m.get('subcooling');
      const fdp = m.get('filter_dp');
      const rs = m.get('restriction_signature');

      if (sh.taken && sh.value !== null) {
        if (sh.value > 28) signals.push(sig('superheat_muy_alto', 'support', `Superheat muy elevado (${sh.value.toFixed(1)}°F).`, 'strong'));
        else if (sh.value < 18) signals.push(sig('superheat_no_extremo', 'contradict', 'Superheat claramente no extremo: no respalda esta hipótesis.'));
        // Entre 18 y 28°F la lectura es limítrofe: no se cuenta como
        // evidencia en ningún sentido.
      } else signals.push(sig('superheat', 'unknown', 'Superheat no medido.', 'normal', true));

      if (sc.taken && sc.value !== null && sc.value < 6) {
        signals.push(sig('subcooling_bajo', 'contradict', 'Subcooling bajo: apunta a baja carga real, no a la válvula de expansión.'));
      }
      if (fdp.taken && fdp.value > 1.1) {
        signals.push(sig('filtro_dp_alta', 'contradict', 'Caída de presión de filtro elevada: el bajo flujo de aire explica mejor los síntomas.'));
      }
      if (rs.taken && rs.value === true) {
        signals.push(sig('restriccion_detectada', 'contradict', 'Firma de restricción detectada: explica mejor los síntomas.'));
      }
      return {
        signals,
        recommendedNextTest: 'Descartar baja carga, restricción y bajo flujo de aire; si se descartan y el superheat sigue extremo, revisar bulbo remoto y elemento de la válvula de expansión.',
      };
    },
  },
  {
    id: 'expansion_device_stuck_open',
    label: 'Dispositivo de expansión sobrealimentando (atascado abierto)',
    evaluate(m) {
      const signals = [];
      const sh = m.get('superheat');
      const sc = m.get('subcooling');
      if (sh.taken && sh.value !== null) {
        if (sh.value < 6) signals.push(sig('superheat_muy_bajo', 'support', `Superheat muy bajo (${sh.value.toFixed(1)}°F).`, 'strong'));
        else if (sh.value > 14) signals.push(sig('superheat_no_bajo', 'contradict', 'Superheat claramente no bajo: no respalda esta hipótesis.'));
        // Entre 6 y 14°F la lectura es limítrofe.
      } else signals.push(sig('superheat', 'unknown', 'Superheat no medido.', 'normal', true));
      if (sc.taken && sc.value !== null && sc.value > 16) {
        signals.push(sig('subcooling_alto', 'contradict', 'Subcooling alto: apunta a sobrecarga real, no a la válvula de expansión.'));
      }
      return { signals, recommendedNextTest: 'Verificar peso de carga (descartar sobrecarga) y luego inspeccionar/reemplazar el elemento de expansión.' };
    },
  },
  {
    id: 'phase_loss',
    label: 'Pérdida de fase',
    evaluate(m) {
      const signals = [];
      const cur = m.get('currents');
      const volt = m.get('voltages');
      if (cur.taken) {
        const vals = [cur.value.L1, cur.value.L2, cur.value.L3];
        const zeroCount = vals.filter((v) => v < 1).length;
        if (zeroCount >= 1 && Math.max(...vals) > 1) {
          signals.push(sig('corriente_una_fase_cero', 'support', 'Una fase presenta corriente prácticamente nula mientras las otras están elevadas.', 'strong'));
        } else if (zeroCount === 0 && cur.value.imbalancePct < 8) {
          signals.push(sig('corrientes_balanceadas', 'contradict', 'Las tres fases presentan corriente balanceada: no es consistente con pérdida de fase.'));
        }
        // Con desbalance moderado pero sin ninguna fase en ~0A, la lectura es
        // ambigua (podría ser otra causa de desbalance): no se cuenta como
        // evidencia en ningún sentido.
      } else signals.push(sig('currents', 'unknown', 'Corrientes no medidas.', 'normal', true));

      if (volt.taken) {
        const vals = [volt.value.L1L2, volt.value.L2L3, volt.value.L3L1];
        if (Math.min(...vals) < volt.value.average * 0.3) {
          signals.push(sig('voltaje_fase_bajo', 'support', 'Una línea de voltaje está muy por debajo de lo esperado.', 'strong'));
        }
      } else signals.push(sig('voltages', 'unknown', 'Voltajes no medidos.', 'normal', true));
      return { signals, recommendedNextTest: 'Verificar continuidad y voltaje en cada fase desde la acometida hasta el contactor.' };
    },
  },
  {
    id: 'voltage_out_of_range',
    label: 'Bajo voltaje / sobrevoltaje',
    evaluate(m) {
      const signals = [];
      const volt = m.get('voltages');
      if (volt.taken) {
        if (volt.value.average < 414) signals.push(sig('bajo_voltaje', 'support', `Voltaje promedio bajo (${volt.value.average.toFixed(0)}V).`, 'strong'));
        else if (volt.value.average > 506) signals.push(sig('sobrevoltaje', 'support', `Voltaje promedio elevado (${volt.value.average.toFixed(0)}V).`, 'strong'));
        else if (volt.value.average >= 430 && volt.value.average <= 490) signals.push(sig('voltaje_normal', 'contradict', 'Voltaje claramente dentro de rango normal.'));
        // Entre 414-430V y 490-506V la lectura es limítrofe: no se cuenta
        // como evidencia en ningún sentido.
      } else signals.push(sig('voltages', 'unknown', 'Voltajes no medidos.', 'normal', true));
      return { signals, recommendedNextTest: 'Medir voltaje en la acometida bajo carga y confirmar con la compañía eléctrica si persiste.' };
    },
  },
  {
    id: 'contactor_or_control_circuit_open',
    label: 'Contactor / circuito de control abierto',
    evaluate(m) {
      const signals = [];
      const cs = m.get('contactor_state');
      const comp = m.get('compressor_status');
      if (cs.taken) {
        if (cs.value === false) signals.push(sig('contactor_abierto', 'support', 'Se verificó continuidad abierta en contactor/bobina de control.', 'strong'));
        else signals.push(sig('contactor_ok', 'contradict', 'Contactor y bobina de control verificados con continuidad normal.'));
      } else signals.push(sig('contactor_state', 'unknown', 'Estado de contactor/bobina no verificado.', 'normal', true));
      if (comp.taken && comp.value === false) {
        signals.push(sig('compresor_sin_corriente', 'support', 'Compresor no está tomando corriente.'));
      }
      return { signals, recommendedNextTest: 'Medir continuidad de bobina de contactor y voltaje de control (24V) en la bobina.' };
    },
  },
  {
    id: 'compressor_locked',
    label: 'Compresor con rotor bloqueado',
    evaluate(m, snapshot) {
      const signals = [];
      const cur = m.get('currents');
      const thermalOpen = snapshot && snapshot.control && snapshot.control.thermalProtectionOpenEffective;
      if (cur.taken) {
        if (cur.value.average > 96 * 2) signals.push(sig('corriente_muy_alta', 'support', `Corriente promedio muy elevada (${cur.value.average.toFixed(0)}A).`, 'strong'));
        else if (cur.value.average < 96 * 1.25 && !thermalOpen) {
          // Solo se considera contradictorio si el compresor está realmente
          // operando con corriente normal. Si ya está detenido por disparo
          // de protección térmica, una corriente baja es la lectura
          // ESPERADA (no contradice que haya estado bloqueado momentos antes).
          signals.push(sig('corriente_normal', 'contradict', 'Corriente claramente dentro de rango normal de operación (compresor corriendo).'));
        }
        // Entre 1.25x y 2x RLA la lectura es limítrofe (sobrecorriente leve,
        // podría ser otra causa): no se cuenta como evidencia en ningún sentido.
      } else signals.push(sig('currents', 'unknown', 'Corrientes no medidas.', 'normal', true));

      // Señal adicional basada en "memoria térmica" del compresor: si la
      // corriente YA no es alta porque la protección térmica disparó (el
      // compresor se detuvo), la evidencia de corriente instantánea se
      // pierde. El acumulador térmico (control.thermalAccumulator) conserva
      // el indicio de que hubo sobrecorriente sostenida reciente, evitando
      // que el diagnóstico "olvide" la causa raíz justo después de que la
      // protección actúa.
      if (snapshot && snapshot.control && typeof snapshot.control.thermalAccumulator === 'number') {
        if (snapshot.control.thermalAccumulator > 60) {
          signals.push(sig('memoria_termica_alta', 'support', 'El acumulador térmico del compresor indica sobrecorriente sostenida reciente, compatible con rotor bloqueado.'));
        }
      }
      return { signals, recommendedNextTest: 'Con el sistema desenergizado, verificar manualmente si el eje del compresor gira libremente; medir resistencia de devanados.' };
    },
  },
  {
    id: 'thermal_protection_tripped',
    label: 'Protección térmica del compresor abierta',
    evaluate(m, snapshot) {
      const signals = [];
      if (snapshot.control.thermalProtectionOpenEffective) {
        signals.push(sig('proteccion_abierta', 'support', 'La protección térmica interna está abierta (confirmado por el estado de control).', 'strong'));
      } else {
        signals.push(sig('proteccion_cerrada', 'contradict', 'La protección térmica está cerrada/operativa.'));
      }
      return { signals, recommendedNextTest: 'Esperar tiempo de reposición, corregir causa raíz de sobrecorriente y realizar reset manual si aplica.' };
    },
  },
];

/**
 * Ejecuta el motor de diagnóstico completo sobre un snapshot.
 *
 * @param {object} snapshot Snapshot de SimulationEngine.tick()
 * @param {string[]} [takenMeasurements] Lista de mediciones que el técnico ya tomó en "modo técnico"
 */
export function diagnose(snapshot, takenMeasurements = DEFAULT_TAKEN_MEASUREMENTS) {
  const m = makeMeasurementAccessor(snapshot, takenMeasurements);

  return HYPOTHESES.map((h) => {
    const { signals, recommendedNextTest } = h.evaluate(m, snapshot);
    const classification = classify(signals);
    const missing = signals.filter((s) => s.result === 'unknown').map((s) => s.detail);
    return {
      id: h.id,
      label: h.label,
      classification,
      evidenceFor: signals.filter((s) => s.result === 'support').map((s) => s.detail),
      evidenceAgainst: signals.filter((s) => s.result === 'contradict').map((s) => s.detail),
      missingMeasurements: missing,
      recommendedNextTest,
    };
  });
}

/**
 * Clasifica un conjunto de señales evaluadas para UNA hipótesis.
 * Exportada para pruebas unitarias directas.
 */
export function classify(signals) {
  const supports = signals.filter((s) => s.result === 'support');
  const contradicts = signals.filter((s) => s.result === 'contradict');
  const criticalMissing = signals.filter((s) => s.result === 'unknown' && s.critical);

  if (contradicts.length > 0) return 'CONTRADICTORIO';
  if (supports.length === 0) return 'NO_DETERMINADO';

  const strongSupports = supports.filter((s) => s.strength === 'strong');
  if (strongSupports.length >= 1 && supports.length >= 2 && criticalMissing.length === 0) {
    return 'DEMOSTRADO';
  }
  return 'COMPATIBLE';
}

export { HYPOTHESES };
