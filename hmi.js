/**
 * hmi.js
 *
 * Funciones de renderizado del panel HMI, modo técnico, panel de fallas y
 * tabla de diagnóstico. No mantienen estado propio: reciben datos y
 * actualizan el DOM. Mantener esto separado de main.js facilita probarlo
 * visualmente y razonar sobre qué se muestra en cada pestaña.
 */

'use strict';

import { FAULT_CATALOG } from './faults.js';

function fmt(value, decimals = 1, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(decimals)}${suffix}`;
}

export function renderHmi(snapshot) {
  const r = snapshot.refrigeration;
  const e = snapshot.electrical;

  document.getElementById('hmi-equipo-estado').textContent = r.running ? 'ENFRIANDO' : 'DETENIDO';
  document.getElementById('hmi-return').textContent = fmt(snapshot.returnAirTempF, 1, '°F');
  document.getElementById('hmi-supply').textContent = fmt(r.supplyAirTempF, 1, '°F');
  document.getElementById('hmi-ambient').textContent = fmt(snapshot.ambientTempF, 1, '°F');
  document.getElementById('hmi-capacity').textContent = fmt(r.capacityFraction * 100, 0, '%');

  document.getElementById('hmi-suction').textContent = fmt(r.suctionPressurePsig, 0, ' psig');
  document.getElementById('hmi-discharge').textContent = fmt(r.dischargePressurePsig, 0, ' psig');
  document.getElementById('hmi-superheat').textContent = r.superheatF === null ? '—' : fmt(r.superheatF, 1, '°F');
  document.getElementById('hmi-subcooling').textContent = r.subcoolingF === null ? '—' : fmt(r.subcoolingF, 1, '°F');

  document.getElementById('hmi-voltages').textContent = `${fmt(e.voltages.L1L2, 0)} / ${fmt(e.voltages.L2L3, 0)} / ${fmt(e.voltages.L3L1, 0)} V`;
  document.getElementById('hmi-currents').textContent = `${fmt(e.currents.L1, 1)} / ${fmt(e.currents.L2, 1)} / ${fmt(e.currents.L3, 1)} A`;
  document.getElementById('hmi-power').textContent = fmt(e.powerKw, 1, ' kW');
  document.getElementById('hmi-pf').textContent = fmt(e.powerFactor, 2);

  setBadge('hmi-comp-badge', e.compressorPowered);
  setBadge('hmi-condfan-badge', e.condenserFanPowered);
  setBadge('hmi-evapfan-badge', e.evapFanPowered);
  setBadge('hmi-contactor-badge', snapshot.control.contactorHardwareOk && snapshot.control.coilOk);

  const statusPill = document.getElementById('status-pill');
  statusPill.textContent = r.running ? 'OPERANDO' : 'DETENIDO';
  statusPill.className = `status-pill ${r.running ? 'running' : 'stopped'}`;

  const alarmList = document.getElementById('hmi-alarms');
  alarmList.innerHTML = '';
  alarmList.classList.toggle('empty', snapshot.alarms.length === 0);
  snapshot.alarms.forEach((a) => {
    const li = document.createElement('li');
    li.className = a.level;
    li.textContent = `[${a.level.toUpperCase()}] ${a.message}`;
    alarmList.appendChild(li);
  });
}

function setBadge(id, isOn) {
  const el = document.getElementById(id);
  el.textContent = isOn ? 'ON' : 'OFF';
  el.className = `badge ${isOn ? 'on' : 'off'}`;
}

export function renderTecnico(snapshot, manualMeasurements) {
  const r = snapshot.refrigeration;
  const e = snapshot.electrical;
  const set = (id, text) => (document.getElementById(id).textContent = text);

  set('tec-suction', fmt(r.suctionPressurePsig, 0, ' psig'));
  set('tec-discharge', fmt(r.dischargePressurePsig, 0, ' psig'));
  set('tec-suction-temp', fmt(r.suctionLineTempF, 1, '°F'));
  set('tec-liquid-temp', fmt(r.liquidLineTempF, 1, '°F'));
  set('tec-return', fmt(snapshot.returnAirTempF, 1, '°F'));
  set('tec-supply', fmt(r.supplyAirTempF, 1, '°F'));
  set('tec-ambient', fmt(snapshot.ambientTempF, 1, '°F'));
  set('tec-superheat', r.superheatF === null ? '—' : fmt(r.superheatF, 1, '°F'));
  set('tec-subcooling', r.subcoolingF === null ? '—' : fmt(r.subcoolingF, 1, '°F'));

  set('tec-v12', fmt(e.voltages.L1L2, 0, ' V'));
  set('tec-v23', fmt(e.voltages.L2L3, 0, ' V'));
  set('tec-v31', fmt(e.voltages.L3L1, 0, ' V'));
  set('tec-i1', fmt(e.currents.L1, 1, ' A'));
  set('tec-i2', fmt(e.currents.L2, 1, ' A'));
  set('tec-i3', fmt(e.currents.L3, 1, ' A'));
  set('tec-power', fmt(e.powerKw, 1, ' kW'));
  set('tec-pf', fmt(e.powerFactor, 2));

  set('tec-comp-status', e.compressorPowered ? 'Energizado' : 'Sin energía');
  set('tec-fan-status', e.condenserFanPowered ? 'Girando' : 'Detenido');
  set('tec-contactor-status', snapshot.control.contactorHardwareOk && snapshot.control.coilOk ? 'Cerrado / continuidad OK' : 'Abierto / sin continuidad');
  set('tec-alarm-count', String(snapshot.alarms.length));

  set('tec-filter-dp', manualMeasurements.has('filter_dp') ? fmt(r.filterDeltaPressureInWc, 2, ' in.w.c.') : 'no medido');
  set('tec-restriction', manualMeasurements.has('restriction_signature') ? (r.restrictionSignatureDetected ? 'Firma de restricción detectada' : 'Sin firma de restricción') : 'no inspeccionado');
}

/** Construye la lista de fallas con controles de activación/severidad. */
export function renderFaultList(container, activeFaultIds, severities, onToggle, onSeverityChange) {
  container.innerHTML = '';
  const HAS_SEVERITY = new Set(['low_charge', 'overcharge', 'dirty_filter', 'low_airflow', 'dirty_condenser', 'liquid_line_restriction']);
  FAULT_CATALOG.forEach((fault) => {
    const wrapper = document.createElement('div');
    wrapper.className = `fault-toggle${activeFaultIds.has(fault.id) ? ' active' : ''}`;

    const labelWrap = document.createElement('label');
    labelWrap.style.display = 'flex';
    labelWrap.style.alignItems = 'center';
    labelWrap.style.gap = '6px';
    labelWrap.style.flex = '1';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = activeFaultIds.has(fault.id);
    checkbox.addEventListener('change', () => onToggle(fault.id, checkbox.checked));

    const textSpan = document.createElement('span');
    textSpan.innerHTML = `<span class="fault-label">${fault.label}</span><span class="fault-cat">${fault.category}</span>`;

    labelWrap.appendChild(checkbox);
    labelWrap.appendChild(textSpan);
    wrapper.appendChild(labelWrap);

    if (HAS_SEVERITY.has(fault.id)) {
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '10';
      slider.max = '100';
      slider.value = String(Math.round((severities[fault.id] ?? 0.7) * 100));
      slider.addEventListener('input', () => onSeverityChange(fault.id, Number(slider.value) / 100));
      wrapper.appendChild(slider);
    }

    container.appendChild(wrapper);
  });
}

export function renderDiagnosisTable(tbody, results) {
  tbody.innerHTML = '';
  results.forEach((r) => {
    const tr = document.createElement('tr');
    const evFor = r.evidenceFor.length ? `<ul class="evidence-list">${r.evidenceFor.map((e) => `<li>${e}</li>`).join('')}</ul>` : '—';
    const evAgainst = r.evidenceAgainst.length ? `<ul class="evidence-list">${r.evidenceAgainst.map((e) => `<li>${e}</li>`).join('')}</ul>` : '—';
    const missing = r.missingMeasurements.length ? `<ul class="evidence-list">${r.missingMeasurements.map((e) => `<li>${e}</li>`).join('')}</ul>` : '—';
    tr.innerHTML = `
      <td>${r.label}</td>
      <td><span class="class-pill ${r.classification}">${r.classification}</span></td>
      <td>${evFor}</td>
      <td>${evAgainst}</td>
      <td>${missing}</td>
      <td>${r.recommendedNextTest}</td>
    `;
    tbody.appendChild(tr);
  });
}
