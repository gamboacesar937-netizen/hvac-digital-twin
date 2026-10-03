# RED TEAM — Pruebas adversariales y hallazgos

Antes de considerar terminado el proyecto se construyó un script de fuzzing
(`scripts/fuzz.mjs`, no incluido en el repositorio final por ser una
herramienta de desarrollo puntual — su lógica quedó formalizada como pruebas
permanentes en `tests/redteam.test.js`) que ejecutó **242 escenarios**:

- Barrido de severidad (0.1 a 1.0) para cada una de las 16 fallas individuales.
- Todas las combinaciones de pares de fallas (16×15/2 = 120 combinaciones).
- Condiciones ambientales extremas (-20°F a 150°F ambiente, 50°F a 100°F retorno).
- Las 15 fallas activas simultáneamente (peor caso combinado, excluyendo la
  activación manual de protección térmica para poder observar el resto).

Cada ejecución se verificó contra: (a) `runSanityChecks` (sin NaN/Infinity/fuera
de rango), y (b) que la hipótesis de diagnóstico correspondiente a la falla
activa no quedara **CONTRADICTORIO** cuando la severidad era alta.

La primera corrida encontró **76 problemas**; tras las correcciones documentadas
abajo, la corrida final encontró únicamente casos esperados (fallas al 10-30%
de severidad, ver hallazgo #4, que NO son errores sino comportamiento correcto).

## Hallazgos

| # | Escenario | Problema encontrado | Causa | Corrección | Prueba realizada | Resultado |
|---|-----------|----------------------|-------|------------|-------------------|-----------|
| 1 | `contactor_fault` activo (compresor sin corriente) | `electrical.currents.imbalancePct` reportaba **200%**, un valor absurdo | Con corriente promedio ≈0 A, el ruido determinista de fracciones de amperio se amplificaba al dividir por un promedio casi nulo | En `electrical.js`, el desbalance de corriente (y de voltaje, por el mismo motivo) ahora se reporta como `0` cuando el promedio es ≤1 A/V, y además se acota (`clamp`) a `[0,100]` como salvaguarda adicional | `tests/redteam.test.js` → "RED TEAM #1"; sanity check sobre 242 escenarios del fuzzer | Corregido. 0 problemas de sanidad relacionados en la re-ejecución |
| 2 | `high_ambient` (severidad 0.8) + `contactor_fault` combinadas | `refrigeration.evapSatTempF` = 116°F, fuera del rango de sanidad configurado (máx. 100°F) | Con el compresor detenido, `evapSatTempF` se equaliza a la temperatura ambiente (comportamiento físico correcto); el límite de sanidad estaba calibrado solo para el rango de evaporación en operación activa, no para el estado equalizado bajo ambiente extremo | Se amplió el límite superior de sanidad para `evapSatTempF` a 140°F, documentando explícitamente por qué (ver comentario en `sanity.js`) | `tests/redteam.test.js` → "RED TEAM #2"; combinaciones de pares con `high_ambient` | Corregido. El valor de 116°F ahora se reconoce como físicamente válido para ese estado |
| 3 | `compressor_locked` sostenido hasta que la protección térmica dispara automáticamente | La hipótesis "Compresor con rotor bloqueado" pasaba a **CONTRADICTORIO** justo después de que la protección abría el circuito, porque la corriente vuelve a ~0 A | El motor de diagnóstico solo miraba la corriente instantánea; una vez protegido el compresor, esa lectura por sí sola es indistinguible de "nunca hubo problema" | Se agregó una señal adicional basada en el acumulador térmico (`control.thermalAccumulator`, memoria interna de `SimulationEngine`) que sigue respaldando la hipótesis aunque la corriente ya haya bajado; además, la contradicción por "corriente normal" ahora solo aplica si la protección térmica **no** está abierta (si el compresor está detenido por protección, una corriente baja es la lectura esperada, no contradictoria) | `tests/redteam.test.js` → "RED TEAM #3"; `tests/faults.test.js` → prueba de `compressor_locked` a 25 ciclos | Corregido. La hipótesis permanece diagnosticable (COMPATIBLE/DEMOSTRADO) incluso después del disparo |
| 4 | Fallas de severidad 10-30% (`dirty_filter`, `low_airflow`, `dirty_condenser`, `low_voltage`, `high_voltage`, `liquid_line_restriction`) | Sus hipótesis correspondientes quedaban en **CONTRADICTORIO** en vez de NO_DETERMINADO/COMPATIBLE | **No es un bug del motor**: con una falla apenas iniciada, las variables medidas caen dentro del rango "claramente normal" de otras hipótesis vecinas — es objetivamente correcto que el sistema no pueda demostrar (ni siquiera sospechar con fuerza) una falla que todavía no produce síntomas medibles. El problema real detectado fue de **calibración de umbrales binarios** (ver #5), no de este caso en sí | Se documenta como comportamiento esperado; se agregó `tests/redteam.test.js` → "RED TEAM #4" como prueba de regresión que confirma que una falla leve NO se sobre-diagnostica | Fuzzer con severidades 0.1-1.0 por falla | Confirmado como comportamiento correcto, no defecto. Documentado aquí para dejar constancia de que fue investigado |
| 5 | Umbrales de diagnóstico originalmente binarios (`if valor > X: apoya; else: contradice`) en `filter_dp`, `discharge_pressure`, `voltage_out_of_range`, `compressor_locked` (corriente) y ambas hipótesis de válvula de expansión | Cualquier lectura apenas por debajo del umbral de "apoyo" se marcaba automáticamente como "contradicción", sin zona neutral para lecturas limítrofes | Diseño inicial sin banda de ambigüedad entre "claramente normal" y "claramente anormal" | Se reescribieron los 6 puntos con lógica de tres bandas: apoya / neutral (sin señal) / contradice, con una brecha explícita entre ambos límites (p. ej. filtro: >1.1 apoya, <0.7 contradice, entre ambos no cuenta) | `tests/diagnostics.test.js` (casos ambiguo y adversarial); re-ejecución completa del fuzzer (242 escenarios) | Corregido. Problemas del fuzzer bajaron de 76 a 11, y los 11 restantes son todos del tipo #4 (comportamiento correcto) |
| 6 | Baja carga (`low_charge`) vs. restricción en línea de líquido (`liquid_line_restriction`), ambas severas y simultáneas por separado | Verificar que seguían siendo distinguibles entre sí (caso adversarial central del proyecto) | N/A — verificación, no bug | N/A | `tests/redteam.test.js` → "RED TEAM #6"; `tests/refrigeration.test.js` → prueba de discriminador | Sin problemas. El subcooling de baja carga se mantiene consistentemente varios grados por debajo del de restricción, tal como exige el diseño del modelo |
| 7 | `phase_loss` con mediciones eléctricas NO tomadas por el técnico | Verificar que el motor no "adivina" sin evidencia | N/A — verificación, no bug | N/A | `tests/redteam.test.js` → "RED TEAM #7" | Sin problemas. Clasifica correctamente como NO_DETERMINADO y lista las mediciones faltantes |
| 8 | RESET SYSTEM inmediatamente después de un disparo térmico por rotor bloqueado | Verificar que no queda ningún residuo de estado (acumulador térmico, latch, fallas) | N/A — verificación, no bug | N/A | `tests/redteam.test.js` → "RED TEAM #8"; `tests/faults.test.js` → prueba de reset | Sin problemas. El acumulador vuelve a 0 y la protección se libera |
| 9 | Ambiente extremo (-20°F y 150°F) sin ninguna falla activa | Verificar ausencia de NaN/Infinity/valores imposibles en los límites del rango soportado | N/A — verificación, no bug | N/A | `tests/redteam.test.js` → "RED TEAM #9" | Sin problemas |
| 10 | Activar y desactivar una falla en ciclos consecutivos rápidos | Verificar que no queda estado "pegado" (p. ej. subcooling que no se recupera) | N/A — verificación, no bug | N/A | `tests/redteam.test.js` → "RED TEAM #10" | Sin problemas. El sistema vuelve a su comportamiento normal en el siguiente tick |

## Conclusión

De 242 escenarios de fuzzing y 10 escenarios adversariales dirigidos, se
encontraron y corrigieron **4 defectos reales** (hallazgos #1-#3 y #5; el #4 se
investigó y se confirmó que no era un defecto). Los 10 escenarios quedaron
formalizados como pruebas de regresión permanentes en `tests/redteam.test.js`
para que cualquier cambio futuro al modelo los siga cumpliendo.
