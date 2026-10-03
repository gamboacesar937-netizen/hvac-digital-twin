/**
 * viz3d.js
 *
 * Representación 3D esquemática (no CAD) de una unidad Rooftop/Package.
 * Es deliberadamente simple: primitivas geométricas (cajas, cilindros,
 * esferas) en vez de modelos importados, para que el proyecto funcione
 * 100% desde GitHub Pages sin activos binarios adicionales.
 *
 * TODA la apariencia (rotación de ventiladores, color de líneas de
 * refrigerante, "pulso" del compresor) se deriva del snapshot real de la
 * simulación en cada tick — no hay animación decorativa independiente.
 */

'use strict';

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const COLORS = {
  cabinet: 0x334155,
  compressorOn: 0xef4444,
  compressorOff: 0x475569,
  condenser: 0x94a3b8,
  evaporator: 0x38bdf8,
  fanBlade: 0xcbd5e1,
  discharge: 0xf97316,
  suctionCold: 0x38bdf8,
  suctionWarm: 0xfacc15,
  liquidNormal: 0x60a5fa,
  liquidWarm: 0xf59e0b,
  electrical: 0xfbbf24,
  fault: 0xef4444,
};

export class Viz3D {
  constructor(container) {
    this.container = container;
    this.width = container.clientWidth || 600;
    this.height = container.clientHeight || 420;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05080f);

    this.camera = new THREE.PerspectiveCamera(45, this.width / this.height, 0.1, 100);
    this.camera.position.set(7, 6, 9);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 1, 0);

    this._addLights();
    this._buildComponents();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.onSelect = null;
    this.renderer.domElement.addEventListener('click', (ev) => this._handleClick(ev));

    this._resizeObserver = new ResizeObserver(() => this._handleResize());
    this._resizeObserver.observe(container);

    this._animate = this._animate.bind(this);
    this._rafId = requestAnimationFrame(this._animate);
  }

  dispose() {
    cancelAnimationFrame(this._rafId);
    this._resizeObserver.disconnect();
    this.renderer.dispose();
  }

  _addLights() {
    const hemi = new THREE.HemisphereLight(0x8899aa, 0x0b1220, 1.1);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(5, 8, 4);
    this.scene.add(dir);
  }

  _buildComponents() {
    this.parts = {};

    // Gabinete (marco tipo wireframe)
    const cabinetGeo = new THREE.BoxGeometry(6, 2.6, 4);
    const cabinetEdges = new THREE.EdgesGeometry(cabinetGeo);
    const cabinet = new THREE.LineSegments(cabinetEdges, new THREE.LineBasicMaterial({ color: COLORS.cabinet }));
    cabinet.position.set(0, 1.3, 0);
    this.scene.add(cabinet);
    this.parts.cabinet = cabinet;

    // Piso de referencia
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 10),
      new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 1 })
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // Compresor (cilindro/domo)
    const compGeo = new THREE.CylinderGeometry(0.55, 0.65, 1.1, 20);
    const compMat = new THREE.MeshStandardMaterial({ color: COLORS.compressorOff, metalness: 0.4, roughness: 0.4 });
    const compressor = new THREE.Mesh(compGeo, compMat);
    compressor.position.set(-1.8, 0.85, 0.8);
    compressor.name = 'compressor';
    this.scene.add(compressor);
    this.parts.compressor = compressor;

    // Condensador (serpentín + aletas esquemáticas)
    const condenserGroup = new THREE.Group();
    const condenserBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 1.6, 3.2),
      new THREE.MeshStandardMaterial({ color: COLORS.condenser, metalness: 0.3, roughness: 0.6 })
    );
    condenserBody.position.set(2.5, 1.1, 0);
    condenserGroup.add(condenserBody);
    for (let i = -1.4; i <= 1.4; i += 0.25) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.55, 0.02), new THREE.MeshStandardMaterial({ color: 0x64748b }));
      fin.position.set(2.5, 1.1, i);
      condenserGroup.add(fin);
    }
    condenserGroup.name = 'condenser';
    this.scene.add(condenserGroup);
    this.parts.condenser = condenserGroup;

    // Ventilador de condensador (encima, tipo propela)
    const condFanGroup = new THREE.Group();
    const condFanHub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 12), new THREE.MeshStandardMaterial({ color: 0x334155 }));
    condFanGroup.add(condFanHub);
    for (let i = 0; i < 4; i += 1) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.18), new THREE.MeshStandardMaterial({ color: COLORS.fanBlade }));
      blade.rotation.y = (i * Math.PI) / 2;
      blade.position.x = 0.4 * Math.cos((i * Math.PI) / 2);
      blade.position.z = 0.4 * Math.sin((i * Math.PI) / 2);
      condFanGroup.add(blade);
    }
    condFanGroup.position.set(2.5, 2.35, 0);
    condFanGroup.rotation.x = Math.PI / 2;
    condFanGroup.name = 'condenserFan';
    this.scene.add(condFanGroup);
    this.parts.condenserFan = condFanGroup;

    // Evaporador (coil tipo A, inclinado)
    const evapGroup = new THREE.Group();
    const evapPanelA = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 1.1, 0.15),
      new THREE.MeshStandardMaterial({ color: COLORS.evaporator, metalness: 0.3, roughness: 0.5 })
    );
    evapPanelA.rotation.z = Math.PI / 8;
    evapPanelA.position.set(-2.2, 1, -1.2);
    const evapPanelB = evapPanelA.clone();
    evapPanelB.rotation.z = -Math.PI / 8;
    evapPanelB.position.set(-2.2, 1, -0.6);
    evapGroup.add(evapPanelA, evapPanelB);
    evapGroup.name = 'evaporator';
    this.scene.add(evapGroup);
    this.parts.evaporator = evapGroup;

    // Ventilador/soplador de evaporador (cilindro tipo blower)
    const evapFan = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 0.7, 16),
      new THREE.MeshStandardMaterial({ color: 0x475569 })
    );
    evapFan.rotation.z = Math.PI / 2;
    evapFan.position.set(-2.2, 1, 0.4);
    evapFan.name = 'evapFan';
    this.scene.add(evapFan);
    this.parts.evapFan = evapFan;

    // Dispositivo de expansión (pequeña esfera dorada)
    const expansion = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 12), new THREE.MeshStandardMaterial({ color: 0xfbbf24 }));
    expansion.position.set(-0.2, 0.5, -1.0);
    expansion.name = 'expansionDevice';
    this.scene.add(expansion);
    this.parts.expansionDevice = expansion;

    // Líneas de refrigerante (tubos)
    this.parts.dischargeLine = this._makeTube([
      new THREE.Vector3(-1.8, 1.3, 0.8),
      new THREE.Vector3(0, 2.2, 0.6),
      new THREE.Vector3(2.5, 1.9, 0),
    ], 0.06, COLORS.discharge);
    this.parts.dischargeLine.name = 'dischargeLine';
    this.scene.add(this.parts.dischargeLine);

    this.parts.liquidLine = this._makeTube([
      new THREE.Vector3(2.5, 0.4, 0),
      new THREE.Vector3(0.8, 0.3, -0.6),
      new THREE.Vector3(-0.2, 0.5, -1.0),
    ], 0.045, COLORS.liquidNormal);
    this.parts.liquidLine.name = 'liquidLine';
    this.scene.add(this.parts.liquidLine);

    this.parts.suctionLine = this._makeTube([
      new THREE.Vector3(-2.2, 1, 0.4),
      new THREE.Vector3(-2.2, 0.3, 1.2),
      new THREE.Vector3(-1.8, 0.4, 0.8),
    ], 0.07, COLORS.suctionCold);
    this.parts.suctionLine.name = 'suctionLine';
    this.scene.add(this.parts.suctionLine);

    // Panel/conexiones eléctricas (3 hilos de colores + caja de contactor)
    const elecGroup = new THREE.Group();
    const contactorBox = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.25), new THREE.MeshStandardMaterial({ color: 0x1e293b }));
    contactorBox.position.set(-1.8, 2.0, -1.4);
    elecGroup.add(contactorBox);
    const phaseColors = [0xef4444, 0xfacc15, 0x38bdf8];
    phaseColors.forEach((color, i) => {
      const wire = this._makeTube(
        [new THREE.Vector3(-2.6, 2.4, -1.6 + i * 0.15), new THREE.Vector3(-1.8, 2.0, -1.4)],
        0.025,
        color
      );
      elecGroup.add(wire);
    });
    elecGroup.name = 'electrical';
    this.scene.add(elecGroup);
    this.parts.electrical = elecGroup;

    this.selectable = [
      this.parts.compressor,
      this.parts.condenser,
      this.parts.condenserFan,
      this.parts.evaporator,
      this.parts.evapFan,
      this.parts.expansionDevice,
      this.parts.dischargeLine,
      this.parts.liquidLine,
      this.parts.suctionLine,
      this.parts.electrical,
    ];
  }

  _makeTube(points, radius, color) {
    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(curve, 20, radius, 8, false);
    const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.4 });
    return new THREE.Mesh(geo, mat);
  }

  _handleClick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.selectable, true);
    if (hits.length > 0 && this.onSelect) {
      let obj = hits[0].object;
      while (obj.parent && !obj.name) obj = obj.parent;
      this.onSelect(obj.name || 'desconocido');
    }
  }

  _handleResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  setVisibility(name, visible) {
    if (this.parts[name]) this.parts[name].visible = visible;
  }

  /**
   * Actualiza la apariencia 3D a partir del snapshot real de la simulación.
   * Es el único lugar donde el estado del modelo determina la visualización.
   */
  updateFromSnapshot(snapshot) {
    const r = snapshot.refrigeration;
    const e = snapshot.electrical;

    // Compresor: color/pulso según si está energizado.
    const compMat = this.parts.compressor.material;
    compMat.color.setHex(e.compressorPowered ? COLORS.compressorOn : COLORS.compressorOff);
    compMat.emissive = compMat.emissive || new THREE.Color(0x000000);
    compMat.emissive.setHex(e.compressorPowered ? 0x330000 : 0x000000);

    // Ventiladores: rotación solo si están energizados (nada de animación decorativa).
    this._condenserFanSpinning = e.condenserFanPowered;
    this._evapFanSpinning = e.evapFanPowered;

    // Condensador: resalta en rojo si hay alarma de descarga alta.
    const condenserFault = snapshot.alarms.some((a) => a.id === 'high_discharge' || a.id === 'condenser_fan_failure');
    this.parts.condenser.children.forEach((child) => {
      if (child.material) child.material.color.setHex(condenserFault ? COLORS.fault : COLORS.condenser);
    });

    // Línea de descarga: siempre "caliente", intensidad según presión.
    const dischargeIntensity = Math.min(1, r.dischargePressurePsig / 500);
    this.parts.dischargeLine.material.color.setRGB(1, 0.35 + 0.3 * (1 - dischargeIntensity), 0.1);
    this.parts.dischargeLine.material.opacity = r.running ? 1 : 0.3;
    this.parts.dischargeLine.material.transparent = true;

    // Línea de líquido: color según subcooling (bajo = advertencia).
    if (r.subcoolingF === null) {
      this.parts.liquidLine.material.color.setHex(COLORS.liquidNormal);
    } else if (r.subcoolingF < 4) {
      this.parts.liquidLine.material.color.setHex(COLORS.liquidWarm);
    } else {
      this.parts.liquidLine.material.color.setHex(COLORS.liquidNormal);
    }

    // Línea de succión: color según superheat (alto = advertencia).
    if (r.superheatF === null) {
      this.parts.suctionLine.material.color.setHex(COLORS.suctionCold);
    } else if (r.superheatF > 25) {
      this.parts.suctionLine.material.color.setHex(COLORS.suctionWarm);
    } else {
      this.parts.suctionLine.material.color.setHex(COLORS.suctionCold);
    }

    // Sin ciclo activo: líneas "apagadas" (sin flujo) — atenuadas.
    [this.parts.liquidLine, this.parts.suctionLine].forEach((line) => {
      line.material.transparent = true;
      line.material.opacity = r.running ? 1 : 0.35;
    });

    // Eléctrico: hilos parpadean/oscurecen si hay pérdida de fase o contactor abierto.
    const elecFault = snapshot.control.phaseLossActive || !snapshot.control.contactorHardwareOk || !snapshot.control.coilOk;
    this.parts.electrical.children.forEach((child) => {
      if (child.material && child.geometry.type === 'TubeGeometry') {
        child.material.opacity = elecFault ? 0.4 : 1;
        child.material.transparent = true;
      }
    });
  }

  _animate() {
    this._rafId = requestAnimationFrame(this._animate);
    if (this._condenserFanSpinning) this.parts.condenserFan.rotation.y += 0.25;
    if (this._evapFanSpinning) this.parts.evapFan.rotation.x += 0.3;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
