# HVAC Digital Twin

Simulador interactivo de diagnóstico HVAC para una unidad tipo **Rooftop /
Package de ~30 TR**. Incluye un modelo de refrigeración y un modelo eléctrico
trifásico simplificados pero internamente coherentes, 16 fallas simulables
que se propagan de verdad por el modelo (no solo texto), un motor de
diagnóstico basado en evidencia, visualización 3D esquemática, gráficas en
tiempo real y exportación de reportes. **100% del lado del cliente**, sin
backend, sin API keys, desplegable directamente en GitHub Pages.

> Proyecto educativo/técnico. El modelo termodinámico y eléctrico es una
> **simplificación deliberada y documentada** (ver más abajo). No representa
> un refrigerante ni un equipo real específico, y no debe usarse como única
> base para decisiones de campo reales.

## Características

- Modelo de refrigeración simplificado (compresor, condensador, evaporador,
  dispositivo de expansión, tubería, flujo de aire y de refrigerante).
- Modelo eléctrico trifásico simplificado (L1/L2/L3, contactor, protecciones,
  desbalance de voltaje/corriente, factor de potencia).
- 16 fallas simulables, activables individualmente o combinadas, que
  modifican variables físicas reales (ver tabla abajo).
- Motor de diagnóstico basado en evidencia con 4 clasificaciones:
  `DEMOSTRADO`, `COMPATIBLE`, `NO_DETERMINADO`, `CONTRADICTORIO`.
- Casos adversariales deliberados: síntomas que se parecen entre sí (p. ej.
  baja carga vs. bajo flujo de aire vs. restricción de línea de líquido)
  pero que el motor distingue mediante mediciones discriminantes.
- Modo técnico con mediciones tipo "panel real" + dos pruebas de inspección
  manual (caída de presión de filtro, firma de restricción en línea de
  líquido).
- Visualización 3D esquemática (Three.js) con cámara orbital, selección de
  componentes, ocultar/mostrar partes, y apariencia atada al estado real de
  la simulación (nada de animación decorativa desconectada de los cálculos).
- Gráficas en tiempo real (presión, superheat/subcooling, temperaturas de
  aire, corriente por fase, potencia, capacidad).
- Simulación determinista y reproducible (semilla fija para el ruido
  eléctrico).
- Sistema de escenarios predefinidos (NORMAL, LOW_CHARGE, OVERCHARGE,
  LOW_AIRFLOW, DIRTY_CONDENSER, PHASE_LOSS, CONTACTOR_FAILURE,
  COMPRESSOR_LOCKED, LIQUID_RESTRICTION, EXPANSION_PROBLEM).
- Exportación de reportes de diagnóstico en JSON y CSV.
- 83 pruebas automatizadas (`node --test`), incluyendo 10 pruebas de
  regresión derivadas de un ejercicio RED TEAM de 242 escenarios (ver
  `RED_TEAM.md`).

## Arquitectura

**Decisión de arquitectura: JavaScript vanilla, ES modules nativos, sin
bundler ni framework.** Justificación (balance funcionalidad /
compatibilidad / mantenibilidad / rendimiento / facilidad de despliegue en
GitHub Pages):

- **Sin bundler (Vite/Webpack/etc.):** GitHub Pages sirve archivos estáticos
  tal cual. Un proyecto sin paso de build elimina una fuente entera de
  errores de despliegue (rutas base mal configuradas, assets no copiados,
  etc.) y hace que "lo que ves en tu carpeta es lo que se despliega".
  El costo (sin tree-shaking, sin minificación) es aceptable para un
  proyecto de este tamaño.
- **Sin framework (React/Vue/etc.):** el estado de la aplicación es
  relativamente simple (un snapshot por tick) y el DOM a actualizar es
  acotado. Vanilla JS con funciones de renderizado puras (`hmi.js`) es
  suficiente y evita una dependencia y su curva de carga.
- **Three.js vía CDN (import map)**: es la única dependencia externa real.
  Se carga desde `cdn.jsdelivr.net` con versión fijada (`0.160.0`) para
  reproducibilidad. Si el usuario despliega sin conexión a internet, todo
  el proyecto funciona **excepto la pestaña 3D**, que se degrada con un
  mensaje de error visible en vez de romper la aplicación.
- **Pruebas con el test runner nativo de Node (`node --test`)**: evita
  añadir Jest/Vitest y su cadena de dependencias solo para pruebas,
  manteniendo `npm install` innecesario para desarrollar o probar este
  proyecto (no hay `node_modules` que instalar).

### Módulos (`src/js/`)

| Módulo | Responsabilidad |
|---|---|
| `physics-utils.js` | Matemáticas puras: relación presión/temperatura simplificada, PRNG determinista, utilidades numéricas |
| `refrigeration.js` | Modelo termodinámico simplificado del ciclo de refrigeración |
| `electrical.js` | Modelo eléctrico trifásico simplificado |
| `faults.js` | Catálogo de las 16 fallas y su propagación hacia las entradas de los modelos |
| `alarms.js` | Deriva alarmas/advertencias/protecciones de un snapshot |
| `sanity.js` | Comprobaciones automáticas de sanidad física (NaN, Infinity, rangos imposibles) |
| `state.js` | `SimulationEngine`: motor con estado (acumulador térmico, tick, semilla) que orquesta los módulos puros de arriba |
| `scenarios.js` | Escenarios predefinidos deterministas |
| `diagnostics.js` | Motor de diagnóstico basado en evidencia |
| `report.js` | Construcción y exportación de reportes (JSON/CSV) |
| `charts.js` | Graficador de líneas sobre `<canvas>` nativo (sin librería externa) |
| `hmi.js` | Funciones de renderizado del DOM (HMI, modo técnico, panel de fallas, tabla de diagnóstico) |
| `viz3d.js` | Escena 3D con Three.js, atada al estado real |
| `main.js` | Orquestador: tabs, loop de simulación, wiring de eventos |

Cada módulo de dominio (todos excepto `hmi.js`, `viz3d.js` y `main.js`, que
son de UI) es una función pura o una clase con estado explícito, sin acceso
al DOM, por lo que se prueba de forma aislada con `node --test` sin
necesidad de un navegador ni de mocks de DOM.

## Modelo HVAC (refrigeración)

El modelo **no** usa tablas termodinámicas reales de un refrigerante
específico. Usa una aproximación polinómica de la curva de saturación
presión/temperatura (ver `physics-utils.js`), calibrada para pasar por dos
puntos ancla razonables (40°F → ~118 psig, 120°F → ~350 psig) y mantener una
pendiente creciente coherente. A partir de ahí:

- **Condensación**: la temperatura de saturación de condensación sube con la
  temperatura ambiente y con la reducción de flujo de aire/ensuciamiento del
  condensador (aproximación inversamente proporcional al flujo de aire).
- **Evaporación**: la temperatura de saturación de evaporación baja con la
  reducción de flujo de aire, con la baja carga y con la restricción de
  línea de líquido (evaporador "hambriento").
- **Superheat/subcooling**: derivados de la carga de refrigerante, el flujo
  de aire, la restricción de línea de líquido y el estado del dispositivo de
  expansión, con relaciones monótonas y documentadas en el código
  (`refrigeration.js`).
- **Capacidad de enfriamiento**: producto de factores de degradación por
  carga, condensación elevada, restricción y flujo de aire.
- **Señales discriminantes** (`filterDeltaPressureInWc`,
  `restrictionSignatureDetected`): variables sintéticas pero físicamente
  justificadas, pensadas específicamente para que el motor de diagnóstico
  pueda **distinguir** causas con síntomas superpuestos.

## Modelo eléctrico

Trifásico, 460V nominal (supuesto de diseño documentado, no una
recomendación para un equipo real). Calcula voltajes línea-línea, corrientes
por fase, desbalance de voltaje/corriente, factor de potencia y potencia
(kW), con ruido determinista (semilla fija) para variación realista sin
sacrificar reproducibilidad. Modela pérdida de fase (single-phasing, con el
aumento de corriente característico en las fases restantes), rotor
bloqueado (corriente de rotor bloqueado, PF bajo), y protecciones
(contactor, bobina, térmica) con una **memoria térmica acumulativa**
(`SimulationEngine`) que puede disparar la protección automáticamente tras
sobrecorriente sostenida, además de poder forzarse como falla manual.

## Motor de diagnóstico

No usa reglas "síntoma = falla". Cada hipótesis se evalúa contra señales
independientes que pueden **apoyar**, **contradecir**, o quedar **sin
evaluar** (medición no tomada). Clasificación:

- **CONTRADICTORIO**: alguna medición contradice la hipótesis (prevalece
  sobre cualquier apoyo).
- **DEMOSTRADO**: sin contradicciones, con evidencia fuerte e independiente
  suficiente, y sin mediciones críticas faltantes.
- **COMPATIBLE**: sin contradicciones, con algo de evidencia, pero
  insuficiente para demostrar.
- **NO_DETERMINADO**: sin evidencia a favor ni en contra.

El motor evalúa **todas** las hipótesis del catálogo en cada corrida (no se
detiene en la primera que "encaja"), y cada umbral usa una **banda neutral**
entre "claramente normal" y "claramente anormal" para no sobre-interpretar
lecturas limítrofes (ver `RED_TEAM.md`, hallazgo #5).

### Caso adversarial central

Baja carga de refrigerante, bajo flujo de aire y restricción de línea de
líquido pueden producir un superheat elevado muy similar. El discriminador
es el **subcooling**: baja claramente con baja carga real, se mantiene
normal/alto con restricción (el líquido se "represa" en el condensador), y
no se ve afectado por el flujo de aire. La caída de presión de filtro
(`filter_dp`) discrimina además bajo flujo de aire de las otras dos.

## Fallas disponibles

| Falla | Efecto principal modelado |
|---|---|
| Baja carga de refrigerante | ↓ subcooling, ↑ superheat, ↓ capacidad |
| Sobrecarga de refrigerante | ↑ subcooling, ↓ superheat, riesgo de retorno de líquido |
| Filtro de aire obstruido | ↑ caída de presión de filtro, ↑ superheat |
| Bajo flujo de aire (evaporador) | ↓ temp. evaporación, ↑ superheat |
| Condensador sucio | ↑ presión/temperatura de descarga |
| Temperatura ambiente elevada | ↑ temperatura de condensación |
| Pérdida de fase | Corriente ~0 en una fase, corrientes elevadas en las otras dos |
| Bajo voltaje / sobrevoltaje | Voltaje promedio fuera de rango |
| Contactor defectuoso | Compresor sin energía |
| Bobina de contactor abierta | Compresor sin energía |
| Compresor bloqueado | Corriente de rotor bloqueado, riesgo de disparo térmico |
| Protector térmico abierto | Compresor detenido (manual o automático por sobrecorriente sostenida) |
| Ventilador de condensador fallando | ↑ presión/temperatura de descarga |
| Restricción en línea de líquido | ↑ superheat SIN bajar el subcooling (caso adversarial) |
| Problema en dispositivo de expansión | Subalimentación (↑↑ superheat) o sobrealimentación (↓↓ superheat), según variante |

## Instalación

No requiere `npm install`: no hay dependencias externas declaradas (Three.js
se carga vía CDN en tiempo de ejecución, no como paquete npm).

```bash
git clone https://github.com/USUARIO/hvac-digital-twin.git
cd hvac-digital-twin
```

## Ejecución local

Los módulos ES (`<script type="module">`) requieren servirse por HTTP —
abrir `index.html` con doble clic (protocolo `file://`) no funciona por
restricciones CORS del navegador sobre módulos. Cualquier servidor estático
sirve:

```bash
npm start
# equivalente a: python3 -m http.server 8080
```

Luego abrir `http://localhost:8080` en el navegador.

## Pruebas

```bash
npm test
# equivalente a: node --test tests/
```

83 pruebas cubren: utilidades físicas, modelo de refrigeración, modelo
eléctrico, las 16 fallas (al menos una prueba cada una), el motor de
diagnóstico (caso normal, caso con falla, caso ambiguo, caso contradictorio),
comprobaciones de sanidad física, y 10 escenarios de regresión RED TEAM.

## Build

No hay paso de build: los archivos en `index.html` y `src/` se sirven tal
cual. "Construir" el proyecto es, literalmente, no hacer nada adicional.

## GitHub

```bash
git init
git add .
git commit -m "HVAC Digital Twin: versión inicial"
git branch -M main
git remote add origin https://github.com/USUARIO/hvac-digital-twin.git
git push -u origin main
```

## 🚀 GitHub Pages Deployment

1. En GitHub, ir a **Settings → Pages**.
2. En "Build and deployment" → **Source**, seleccionar **GitHub Actions**
   (no "Deploy from a branch").
3. Hacer push a la rama `main` (o ejecutar manualmente el workflow desde la
   pestaña **Actions → Test & Deploy to GitHub Pages → Run workflow**).
4. El workflow (`.github/workflows/deploy.yml`) primero corre `npm test`; si
   las pruebas fallan, **no se despliega**. Si pasan, publica `index.html` +
   `src/` (excluyendo `tests/`, `package.json` y `.github/`, que no hacen
   falta para servir el sitio).
5. La URL quedará como `https://USUARIO.github.io/hvac-digital-twin/`.

El proyecto no usa rutas absolutas en ningún import ni asset — todo es
relativo a `index.html` — por lo que funciona igual en la raíz de un dominio
o bajo un subpath de `github.io`.

## Compatibilidad

Probado conceptualmente contra las APIs estándar de Chrome/Edge/Firefox de
escritorio y Chrome Android (ES modules, `<canvas>`, WebGL). La interfaz es
responsiva (ver `src/css/style.css`, media query bajo 640px). Si WebGL no
está disponible, la pestaña 3D muestra un mensaje de error en vez de romper
el resto de la aplicación (ver `try/catch` en `main.js` →
`initViz3dIfNeeded`).

## Limitaciones conocidas

- **El modelo termodinámico es una aproximación simplificada**, no tablas de
  un refrigerante real. Los valores de presión/temperatura son
  "físicamente plausibles y consistentes entre sí", no datos de ingeniería
  certificados.
- **El modelo eléctrico asume una topología fija** (ventilador de
  condensador en el mismo contactor que el compresor, soplador de
  evaporador en circuito independiente y continuo). Otras topologías reales
  existen y no están modeladas.
- **El motor de diagnóstico trabaja sobre un snapshot instantáneo** más una
  única variable de memoria (el acumulador térmico). No mantiene un
  historial completo de tendencias; un técnico real también usaría el
  comportamiento a lo largo del tiempo, no solo el instante actual.
- **Dos "pruebas de inspección"** (caída de presión de filtro, firma de
  restricción) son variables sintéticas del modelo, pensadas para dar al
  motor de diagnóstico una forma de discriminar causas parecidas — no
  existen sensores de este tipo en un equipo real típico sin instrumentación
  adicional.
- **La visualización 3D es esquemática**, no un CAD de una unidad real; su
  propósito es comunicar relaciones, no servir como referencia de
  fabricante.
- **La pestaña 3D depende de una CDN externa** (`cdn.jsdelivr.net`) para
  cargar Three.js; sin conexión a internet, esa pestaña no funciona (el
  resto de la aplicación sí, ya que no depende de ninguna red externa).
- Los escenarios de falla con severidad muy baja (10-30%) producen
  síntomas realmente indistinguibles de la operación normal — esto es
  intencional (ver `RED_TEAM.md`, hallazgo #4), no un defecto.

## Estructura del proyecto

```
hvac-digital-twin/
├── index.html
├── package.json
├── README.md
├── RED_TEAM.md
├── .gitignore
├── .github/
│   └── workflows/
│       └── deploy.yml
├── src/
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── physics-utils.js
│       ├── refrigeration.js
│       ├── electrical.js
│       ├── faults.js
│       ├── alarms.js
│       ├── sanity.js
│       ├── state.js
│       ├── scenarios.js
│       ├── diagnostics.js
│       ├── report.js
│       ├── charts.js
│       ├── hmi.js
│       ├── viz3d.js
│       └── main.js
└── tests/
    ├── physics-utils.test.js
    ├── refrigeration.test.js
    ├── electrical.test.js
    ├── faults.test.js
    ├── diagnostics.test.js
    ├── sanity.test.js
    └── redteam.test.js
```

## Pruebas realizadas (auditoría)

Ver `RED_TEAM.md` para el detalle del ejercicio adversarial completo
(242 escenarios de fuzzing, 4 defectos reales encontrados y corregidos).
Adicionalmente se verificó manualmente, antes de la entrega:

- `npm test` → 83/83 pruebas pasando.
- Revisión de que ningún módulo de dominio (`refrigeration.js`,
  `electrical.js`, `faults.js`, `alarms.js`, `sanity.js`, `state.js`,
  `scenarios.js`, `diagnostics.js`, `report.js`) importa nada del DOM ni de
  `main.js`/`hmi.js`/`viz3d.js` — separación estricta de dominio y UI.
- Revisión de que todos los `import`/`export` usan rutas relativas con
  extensión `.js` explícita (requisito de ES modules nativos en navegador).
- Revisión de que `index.html` no referencia ninguna ruta absoluta de
  sistema de archivos ni ningún host más que `cdn.jsdelivr.net` (para
  Three.js) y los orígenes propios del sitio.
- Verificación de que no hay claves de API, contraseñas ni credenciales en
  ningún archivo del repositorio.
- Verificación de que `.gitignore` excluye artefactos locales
  (`node_modules/`, `_site/`, logs).

No se afirma cobertura exhaustiva de todos los navegadores/dispositivos
posibles; lo anterior es lo que efectivamente se verificó.
