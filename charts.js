/**
 * charts.js
 *
 * Graficador de líneas basado en <canvas> nativo (sin librerías externas,
 * para no depender de CDNs adicionales solo para graficar). Mantiene un
 * buffer circular de N muestras por serie y se redibuja bajo demanda.
 */

'use strict';

export class TimeSeriesChart {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{maxPoints?: number, colors?: string[], yLabel?: string}} [options]
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.maxPoints = options.maxPoints || 90;
    this.colors = options.colors || ['#38bdf8', '#f97316', '#a3e635', '#f472b6', '#fbbf24'];
    this.yLabel = options.yLabel || '';
    /** @type {Record<string, number[]>} */
    this.series = {};
    this.seriesOrder = [];
  }

  /** Agrega una muestra a una serie (creándola si no existe). */
  push(seriesName, value) {
    if (!this.series[seriesName]) {
      this.series[seriesName] = [];
      this.seriesOrder.push(seriesName);
    }
    const arr = this.series[seriesName];
    arr.push(typeof value === 'number' && Number.isFinite(value) ? value : null);
    if (arr.length > this.maxPoints) arr.shift();
  }

  clear() {
    this.series = {};
    this.seriesOrder = [];
  }

  render() {
    const { ctx, canvas } = this;
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || 300;
    const cssHeight = canvas.clientHeight || 160;
    if (canvas.width !== cssWidth * dpr || canvas.height !== cssHeight * dpr) {
      canvas.width = cssWidth * dpr;
      canvas.height = cssHeight * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const padding = { top: 10, right: 10, bottom: 18, left: 40 };
    const plotW = cssWidth - padding.left - padding.right;
    const plotH = cssHeight - padding.top - padding.bottom;
    if (plotW <= 0 || plotH <= 0) return;

    const allValues = this.seriesOrder.flatMap((name) => this.series[name].filter((v) => v !== null));
    if (allValues.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px monospace';
      ctx.fillText('Sin datos aún…', padding.left, padding.top + 12);
      return;
    }
    let min = Math.min(...allValues);
    let max = Math.max(...allValues);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const margin = (max - min) * 0.1;
    min -= margin;
    max += margin;

    // Ejes
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + plotH);
    ctx.lineTo(padding.left + plotW, padding.top + plotH);
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.fillText(max.toFixed(1), 2, padding.top + 8);
    ctx.fillText(min.toFixed(1), 2, padding.top + plotH);

    this.seriesOrder.forEach((name, idx) => {
      const values = this.series[name];
      const color = this.colors[idx % this.colors.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      let started = false;
      values.forEach((v, i) => {
        if (v === null) {
          started = false;
          return;
        }
        const x = padding.left + (i / Math.max(1, this.maxPoints - 1)) * plotW;
        const y = padding.top + plotH - ((v - min) / (max - min)) * plotH;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    });

    // Leyenda
    let lx = padding.left;
    const ly = padding.top + plotH + 14;
    ctx.font = '10px monospace';
    this.seriesOrder.forEach((name, idx) => {
      const color = this.colors[idx % this.colors.length];
      ctx.fillStyle = color;
      ctx.fillRect(lx, ly - 8, 8, 8);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText(name, lx + 11, ly);
      lx += ctx.measureText(name).width + 30;
    });
  }
}
