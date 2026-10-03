/**
 * main.js
 *
 * Orquestador de la aplicación: conecta el motor de simulación con la UI
 * (HMI, modo técnico, panel de fallas, diagnóstico, gráficas, 3D, reporte).
 * No contiene lógica de dominio — solo wiring y el loop de simulación.
 */

'use strict';

import { SimulationEngine } from './state.js';
import { SCENARIOS, applyScenario } from './scenarios.js';
import { FAULT_CATALOG } from './faults.js';
import { diagnose, DEFAULT_TAKEN_MEASUREMENTS } from './diagnostics.js';
import { buildReport, reportToJson, reportToCsv } from './report.js';
import { renderHmi, renderTecnico, renderFaultList, renderDiagnosisTable } from './hmi.js';
import { TimeSeriesChart } from './charts.js';
import { Viz3D } from './viz3d.js';

const TICK_INTERVAL_MS = 1200;

const engine = new SimulationEngine({ seed: 20260928, ambientTempF: 95, returnAirTempF: 75 });
let manualMeasurements = new Set(); // 'filter_dp', 'restriction_signature'
let lastSnapshot = null;
let lastDiagnosis = [];
let running = true;
let intervalHandle = null;

// ---------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------
document.getElementById('tabs').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-tab]');
  if (!btn) return;
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
});

// ---------------------------------------------------------------------
// Selector de escenarios
// ---------------------------------------------------------------------
const scenarioSelect = document.getElementById('scenario-select');
SCENARIOS.forEach((s) => {
  const opt = document.createElement('option');
  opt.value = s.id;
  opt.textContent = `${s.label}`;
  opt.title = s.description;
  scenarioSelect.appendChild(opt);
});
scenarioSelect.addEventListener('change', () => {
  applyScenario(engine, scenarioSelect.value);
  manualMeasurements = new Set();
  tick(); // refresco inmediato, no esperar al próximo intervalo
});

// ---------------------------------------------------------------------
// RESET / Run-Pause
// ---------------------------------------------------------------------
document.getElementById('btn-reset').addEventListener('click', () => {
  engine.reset();
  scenarioSelect.value = 'NORMAL';
  manualMeasurements = new Set();
  tick();
});

const runPauseBtn = document.getElementById('btn-run-pause');
runPauseBtn.addEventListener('click', () => {
  running = !running;
  runPauseBtn.textContent = running ? 'Pausar' : 'Reanudar';
  if (running) startLoop();
  else stopLoop();
});

// ---------------------------------------------------------------------
// Panel de fallas
// ---------------------------------------------------------------------
const faultListContainer = document.getElementById('fault-list');
const faultSeverities = {};
FAULT_CATALOG.forEach((f) => {
  faultSeverities[f.id] = 0.7;
});

function refreshFaultList() {
  renderFaultList(
    faultListContainer,
    engine.activeFaultIds,
    faultSeverities,
    (faultId, enabled) => {
      engine.setFault(faultId, enabled);
      engine.setFaultOptions({ severity: { ...faultSeverities } });
      tick();
      refreshFaultList();
    },
    (faultId, value) => {
      faultSeverities[faultId] = value;
      engine.setFaultOptions({ severity: { ...faultSeverities } });
    }
  );
}
refreshFaultList();

// ---------------------------------------------------------------------
// Modo técnico: mediciones manuales
// ---------------------------------------------------------------------
document.getElementById('btn-measure-filter').addEventListener('click', () => {
  manualMeasurements.add('filter_dp');
  renderAll();
});
document.getElementById('btn-measure-restriction').addEventListener('click', () => {
  manualMeasurements.add('restriction_signature');
  renderAll();
});

// ---------------------------------------------------------------------
// Gráficas
// ---------------------------------------------------------------------
const charts = {
  pressures: new TimeSeriesChart(document.getElementById('chart-pressures'), { colors: ['#38bdf8', '#f97316'] }),
  shsc: new TimeSeriesChart(document.getElementById('chart-shsc'), { colors: ['#a3e635', '#f472b6'] }),
  airtemps: new TimeSeriesChart(document.getElementById('chart-airtemps'), { colors: ['#38bdf8', '#f97316', '#94a3b8'] }),
  currents: new TimeSeriesChart(document.getElementById('chart-currents'), { colors: ['#ef4444', '#facc15', '#38bdf8'] }),
  power: new TimeSeriesChart(document.getElementById('chart-power'), { colors: ['#a78bfa'] }),
  capacity: new TimeSeriesChart(document.getElementById('chart-capacity'), { colors: ['#22c55e'] }),
};

function pushChartData(snapshot) {
  const r = snapshot.refrigeration;
  const e = snapshot.electrical;
  charts.pressures.push('succión', r.suctionPressurePsig);
  charts.pressures.push('descarga', r.dischargePressurePsig);
  charts.shsc.push('superheat', r.superheatF);
  charts.shsc.push('subcooling', r.subcoolingF);
  charts.airtemps.push('retorno', snapshot.returnAirTempF);
  charts.airtemps.push('suministro', r.supplyAirTempF);
  charts.airtemps.push('exterior', snapshot.ambientTempF);
  charts.currents.push('L1', e.currents.L1);
  charts.currents.push('L2', e.currents.L2);
  charts.currents.push('L3', e.currents.L3);
  charts.power.push('kW', e.powerKw);
  charts.capacity.push('capacidad %', r.capacityFraction * 100);
}

function renderCharts() {
  Object.values(charts).forEach((c) => c.render());
}

// ---------------------------------------------------------------------
// 3D
// ---------------------------------------------------------------------
let viz3d = null;
const viz3dContainer = document.getElementById('viz3d-container');
const inspector = document.getElementById('component-inspector');
const COMPONENT_LABELS = {
  compressor: 'Compresor',
  condenser: 'Condensador',
  condenserFan: 'Ventilador de condensador',
  evaporator: 'Evaporador',
  evapFan: 'Ventilador/soplador de evaporador',
  expansionDevice: 'Dispositivo de expansión',
  dischargeLine: 'Línea de descarga',
  liquidLine: 'Línea de líquido',
  suctionLine: 'Línea de succión',
  electrical: 'Circuito eléctrico',
  cabinet: 'Gabinete',
};

function initViz3dIfNeeded() {
  if (viz3d) return;
  try {
    viz3d = new Viz3D(viz3dContainer);
    viz3d.onSelect = (name) => showComponentInfo(name);
    const toggles = document.getElementById('viz3d-toggles');
    Object.keys(COMPONENT_LABELS).forEach((name) => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.addEventListener('change', () => viz3d.setVisibility(name, checkbox.checked));
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(COMPONENT_LABELS[name]));
      toggles.appendChild(label);
    });
    if (lastSnapshot) viz3d.updateFromSnapshot(lastSnapshot);
  } catch (err) {
    viz3dContainer.innerHTML = `<div style="padding:16px;color:#f59e0b;font-size:12px">No se pudo inicializar la visualización 3D (¿WebGL disponible?): ${err.message}</div>`;
  }
}

function showComponentInfo(name) {
  if (!lastSnapshot) return;
  const r = lastSnapshot.refrigeration;
  const e = lastSnapshot.electrical;
  let detail = '';
  switch (name) {
    case 'compressor':
      detail = `Energizado: ${e.compressorPowered ? 'sí' : 'no'} · Corriente prom.: ${e.currents.average.toFixed(1)} A`;
      break;
    case 'condenser':
      detail = `Presión descarga: ${r.dischargePressurePsig.toFixed(0)} psig · Temp. sat.: ${r.condSatTempF.toFixed(1)}°F`;
      break;
    case 'condenserFan':
      detail = `Estado: ${e.condenserFanPowered ? 'girando' : 'detenido'}`;
      break;
    case 'evaporator':
      detail = `Presión succión: ${r.suctionPressurePsig.toFixed(0)} psig · Temp. sat.: ${r.evapSatTempF.toFixed(1)}°F · Riesgo de hielo: ${r.iceRisk ? 'sí' : 'no'}`;
      break;
    case 'evapFan':
      detail = `Estado: ${e.evapFanPowered ? 'girando' : 'detenido'}`;
      break;
    case 'expansionDevice':
      detail = `Superheat: ${r.superheatF === null ? '—' : r.superheatF.toFixed(1) + '°F'}`;
      break;
    case 'dischargeLine':
      detail = `Presión: ${r.dischargePressurePsig.toFixed(0)} psig`;
      break;
    case 'liquidLine':
      detail = `Temp.: ${r.liquidLineTempF.toFixed(1)}°F · Subcooling: ${r.subcoolingF === null ? '—' : r.subcoolingF.toFixed(1) + '°F'}`;
      break;
    case 'suctionLine':
      detail = `Temp.: ${r.suctionLineTempF.toFixed(1)}°F · Superheat: ${r.superheatF === null ? '—' : r.superheatF.toFixed(1) + '°F'}`;
      break;
    case 'electrical':
      detail = `V: ${e.voltages.average.toFixed(0)}V · I: ${e.currents.average.toFixed(1)}A · PF: ${e.powerFactor.toFixed(2)}`;
      break;
    default:
      detail = 'Sin datos adicionales.';
  }
  inspector.innerHTML = `<strong>${COMPONENT_LABELS[name] || name}</strong><br>${detail}`;
}

// Inicializar 3D solo cuando se visita esa pestaña (evita costo si el usuario no la usa)
document.getElementById('tabs').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-tab]');
  if (btn && btn.dataset.tab === 'viz3d') initViz3dIfNeeded();
});

// ---------------------------------------------------------------------
// Reporte
// ---------------------------------------------------------------------
document.getElementById('btn-export-json').addEventListener('click', () => {
  const report = buildReport(lastSnapshot, lastDiagnosis);
  downloadFile('hvac-diagnostico.json', reportToJson(report), 'application/json');
  document.getElementById('report-preview').textContent = reportToJson(report);
});
document.getElementById('btn-export-csv').addEventListener('click', () => {
  const report = buildReport(lastSnapshot, lastDiagnosis);
  downloadFile('hvac-diagnostico.csv', reportToCsv(report), 'text/csv');
});

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------
// Loop de simulación
// ---------------------------------------------------------------------
function currentTakenMeasurements() {
  return [...DEFAULT_TAKEN_MEASUREMENTS, ...manualMeasurements];
}

function tick() {
  lastSnapshot = engine.tick();
  lastDiagnosis = diagnose(lastSnapshot, currentTakenMeasurements());
  renderAll();
}

function renderAll() {
  if (!lastSnapshot) return;
  renderHmi(lastSnapshot);
  renderTecnico(lastSnapshot, manualMeasurements);
  renderDiagnosisTable(document.getElementById('diagnosis-tbody'), lastDiagnosis);
  pushChartData(lastSnapshot);
  renderCharts();
  if (viz3d) viz3d.updateFromSnapshot(lastSnapshot);
  if (lastSnapshot.sanityIssues.length > 0) {
    // eslint-disable-next-line no-console
    console.warn('Problemas de sanidad física detectados (ver sanity.js):', lastSnapshot.sanityIssues);
  }
}

function startLoop() {
  stopLoop();
  intervalHandle = setInterval(tick, TICK_INTERVAL_MS);
}
function stopLoop() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
scenarioSelect.value = 'NORMAL';
tick();
startLoop();
