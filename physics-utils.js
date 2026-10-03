/**
 * physics-utils.js (ES module — usado tanto en navegador como en pruebas Node)
 *
 * Utilidades matemáticas y relaciones presión/temperatura SIMPLIFICADAS.
 *
 * SIMPLIFICACIÓN DOCUMENTADA (ver README.md sección "Simplificaciones físicas"):
 * En lugar de usar tablas termodinámicas reales de un refrigerante específico
 * (p.ej. R-410A), se usa una aproximación polinómica de la curva de presión
 * de saturación en función de la temperatura, ajustada para que el
 * comportamiento CUALITATIVO (pendiente creciente, rango de presiones típico
 * de un sistema comercial de ~30 TR) sea coherente. Esto permite que todas
 * las relaciones causa-efecto del sistema (temperatura <-> presión) se
 * mantengan consistentes entre sí, sin pretender exactitud de tabla de
 * refrigerante real. Todo consumidor de esta función debe tratar los valores
 * de presión como "unidades de simulación" (psig aproximados), no como datos
 * de ingeniería certificados de un refrigerante real.
 */

'use strict';

/** Limita un valor entre un mínimo y un máximo. */
export function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Presión de saturación aproximada (psig) para una temperatura dada (°F).
 * Ajuste polinómico simplificado, monótono creciente en el rango de interés,
 * calibrado para que:
 *   - 40°F  (evaporación típica)  => ~118 psig
 *   - 120°F (condensación típica) => ~350 psig
 * Esta NO es una tabla de refrigerante real; es una aproximación suave
 * usada únicamente para mantener coherencia interna de la simulación.
 */
export function saturationPressureFromTemp(tempF) {
  const t = clamp(tempF, -40, 200);
  // Coeficientes resueltos exactamente para pasar por los dos puntos ancla:
  // (40°F, 118 psig) y (120°F, 350 psig), con c=45 fijado como intercepto.
  const a = 86 / 9600; // ≈0.0089583
  const b = 58.66667 / 40; // ≈1.466667
  const c = 45;
  return a * t * t + b * t + c;
}

/**
 * Inversa aproximada: temperatura de saturación (°F) para una presión dada (psig).
 * Resuelve la cuadrática a*t^2 + b*t + (c - P) = 0 con la raíz físicamente
 * válida (creciente).
 */
export function saturationTempFromPressure(pressurePsig) {
  const a = 86 / 9600;
  const b = 58.66667 / 40;
  const c = 45;
  const p = Math.max(0, pressurePsig);
  const discriminant = b * b - 4 * a * (c - p);
  const safeDisc = Math.max(0, discriminant);
  const t = (-b + Math.sqrt(safeDisc)) / (2 * a);
  return clamp(t, -40, 200);
}

/** Redondea a n decimales (por defecto 2), útil para reportes/UI. */
export function round(value, decimals = 2) {
  const f = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Interpolación lineal simple. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Generador de números pseudoaleatorios determinista (PRNG tipo mulberry32).
 * Dado el mismo seed, produce siempre la misma secuencia de valores en [0,1)
 * -> reproducibilidad exigida por el proyecto ("Simulación determinista").
 */
export function createSeededRandom(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** true si el valor no es un número finito válido — usado en chequeos de sanidad física. */
export function isBadNumber(value) {
  return typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value);
}
