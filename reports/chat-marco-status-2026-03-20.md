# Estado chat y marco teorico

- Fecha: 2026-03-20
- Objetivo: medir utilidad actual del chat para usuarios SEA y revisar si el marco teorico esta usando documentos correctos.

## 1. Marco teorico del workspace real `8d9a162f-e9d2-4246-8fbe-d0a70533931d`

### Hallazgos

- El workspace real no tenia `structured_memory` persistida en metadata de onboarding.
- Si tenia:
  - referencias tribunal (`tribunal_references`)
  - notas de marco teorico
  - borrador inicial de informe
- Se implemento un fallback para reconstruir memoria estructurada desde notas + referencias cuando la metadata falte.

### Resultado del fallback

- Recupera correctamente:
  - resumen ejecutivo
  - hipotesis de defensa
  - criterios utiles
  - riesgos por mal uso
  - hechos comparables
- Eso mejora el contexto que luego consume el chat aunque el workspace sea antiguo.
- Ademas, ya se persistio `structured_memory` en la metadata del workspace real para que el chat no dependa solo del fallback en runtime.

### Calidad documental observada

- Referencias tribunal registradas: 6
- Distribucion por rol documental:
  - `informe`: 4
  - `reclamacion`: 2
  - `sentencia`: 0

### Lectura

- El marco teorico ya esta mejor que antes porque predominan `informes`.
- Pero en este workspace real todavia no esta ideal:
  - siguen apareciendo reclamaciones entre las referencias prioritarias
  - no aparecen sentencias en las referencias guardadas
- Esto sugiere que el onboarding de este workspace fue generado antes de las ultimas mejoras de priorizacion documental.

### Conclusión sobre el marco teorico

- Estado actual: `util, pero no optimo`
- Recomendacion: rerun de onboarding/marco teorico para este workspace si queremos que herede plenamente la nueva logica `informe > sentencia > reclamacion`.
- Mejora aplicada hoy: el workspace real ya quedo con memoria estructurada persistida; eso mejora el uso del marco teorico por parte del chat incluso antes de un rerun completo.

## 2. Benchmark de chat orientado a SEA

### Metodo

- Script: `npm run eval:chat-live`
- Dataset: `eval/chat-live.sea-smoke.jsonl`
- Casos: 4
- Workspace evaluado: `1ebbe1e3-a3bb-4195-a129-9628cfcaea9c`
- Tipo de preguntas: uso real SEA
  - priorizacion de documentos
  - criterios defensivos
  - uso correcto de reclamacion
  - riesgos al usar precedentes

### Resultado agregado

- `cases`: 4
- `avgLatencyMs`: 28461
- `avgCitations`: 1.75
- `mustIncludeAllMatchedRate`: 0.25
- `supportStrengths`:
  - `weak`: 1
  - `partial`: 2
  - `unknown`: 1
- `totalTokens`: 19343

### Nota sobre el workspace real

- Intente correr este benchmark live directamente contra el workspace real `8d9a162f-e9d2-4246-8fbe-d0a70533931d`.
- No fue posible desde el usuario tecnico de pruebas (`e2e.proyectos@local.test`) porque la API de chat respondio `Forbidden` para ese workspace.
- Por eso el benchmark cuantitativo sigue siendo sobre el workspace E2E de referencia.
- Aun asi, el workspace real si fue revisado y mejorado en su memoria estructurada.

### Lectura

- El chat responde razonablemente y trae citas.
- Pero con preguntas realmente centradas en utilidad SEA, todavia no responde de forma suficientemente consistente.
- Principal problema observado:
  - el sistema aun no aterriza siempre con claridad operativa cosas como:
    - priorizar `informe + sentencia`
    - tratar la reclamacion solo como contexto
- En varias respuestas el soporte quedo `partial` o `weak`, lo que indica que el grounding actual mejora seguridad, pero aun no garantiza una respuesta verdaderamente experta en todos los casos.

## 3. Comparacion con otras pruebas ya corridas

- QA chat previa (`reports/qa_chat_session4_2026-03-09T14-59-37-659Z.md`):
  - score promedio `1.75/2`
  - citas soportadas `6/6`
- Benchmark SEA inventado para esta ronda:
  - mas exigente semantica y estrategicamente
  - muestra que la utilidad real del chat es `prometedora`, pero todavia `no completamente madura`

## 4. Juicio actual de utilidad para usuarios SEA

### Chat

- Estado: `medianamente util / prometedor`
- Sirve hoy para:
  - resumir
  - orientar
  - sugerir lineas iniciales
  - usar notas y referencias del marco teorico
- Todavia falla o queda corto en:
  - responder como experto SEA con la consistencia deseada en documentos prioritarios
  - sostener siempre una respuesta fuerte ante preguntas muy estrategicas

### Marco teorico

- Estado: `util, pero heterogeneo segun workspace`
- En workspaces nuevos con la logica reciente, deberia comportarse mejor.
- En el workspace real revisado, el marco teorico aun muestra señales de una version anterior del pipeline.

## 5. Recomendaciones inmediatas

1. Reejecutar onboarding/marco teorico en el workspace real `8d9a162f-e9d2-4246-8fbe-d0a70533931d`.
2. Correr un benchmark curado de chat con 8-12 preguntas reales del SEA.
3. Ajustar especificamente las preguntas de priorizacion documental y resultados de precedentes.
4. Fijar el routing final de modelos solo despues de ese benchmark real.

## 6. Veredicto ejecutivo

- El chat `ya ayuda`, pero todavia `no da para declararlo plenamente experto` en todos los escenarios SEA.
- El marco teorico `aporta valor`, pero en el workspace real revisado todavia requiere refresco para reflejar todas las mejoras recientes.
- La app esta en un punto bueno de base tecnica; el siguiente salto ya no depende tanto de arquitectura, sino de:
  - rerun de marcos antiguos
  - benchmark real
  - calibracion final de routing y prompts.

## 7. Estado despues de la continuacion

- `structured_memory` del workspace real: persistida.
- `chat live eval`: disponible via `npm run eval:chat-live`.
- `review live eval`: disponible via `npm run eval:review`.
- `writing live eval`: disponible via `npm run eval:writing`.
