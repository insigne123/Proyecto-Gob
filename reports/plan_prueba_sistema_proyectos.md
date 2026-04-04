# Plan Completo de Prueba - Sistema de Proyectos (Caso R-151-2026)

## Objetivo
Validar de punta a punta el flujo de creacion de proyecto, onboarding, carga de reclamacion, generacion de marco teorico con RAG, persistencia de resultados y trazabilidad de auditoria para el escrito inicial `0e562d7a-2802-44f8-be46-dcbdc4b260a0_foleado.pdf`.

## Alcance
- Tribunal: 1TA.
- Caso base: R-151-2026 (Agricola Tarapaca S.A. con SMA).
- Flujo UI + backend + worker.
- Excluye: 2TA/3TA y conectores externos no configurados.

## Precondiciones
1. App web levantada en `http://localhost:9002`.
2. Worker corriendo: `npm run worker:dev`.
3. Variables Supabase y OpenAI configuradas.
4. PDF disponible en ruta local.

## Fases de prueba
### Fase 1 - Inicializacion
- Login exitoso.
- Creacion de proyecto con metadatos prellenados (rol/caratula/tribunal).
- Verificar `gob_workspaces`, `gob_workspace_members`, `gob_workspace_profiles` (`onboarding.required=true`).

### Fase 2 - Onboarding
- Subir PDF en onboarding.
- Verificar `gob_sources` (`source_origin=onboarding-claim`) y `gob_source_snapshots` en `pending` -> `ready`.
- Confirmar encolamiento y procesamiento del job `source_ingest`.

### Fase 3 - Marco teorico
- Ejecutar recomendacion (`/onboarding/recommend`).
- Validar status 200 y estructura de respuesta.
- Confirmar lista de causas sugeridas + resumen + deduplicacion.
- Verificar trazas en `gob_rag_retrieval_traces`.

### Fase 4 - Cierre
- Completar onboarding.
- Verificar `onboarding.completed=true`.
- Confirmar nota "Marco teorico inicial" en `gob_notes`.
- Confirmar redireccion al notebook del proyecto.

### Fase 5 - No funcionales
- Latencia onboarding (objetivo operativo local: < 180s).
- Robustez frente a PDF de varias paginas.
- Mensajes de error utiles en UI.

## Criterios de exito
- No hay errores bloqueantes en flujo principal.
- Se generan recomendaciones (>= 3) y resumen con evidencia.
- Se persiste estado final del onboarding y artefactos de salida.

## Criterios de falla
- 4xx/5xx en `onboarding/recommend` sin feedback accionable.
- Snapshot no llega a `ready`.
- Onboarding no marca `completed`.

## Automatizacion recomendada
- Caso individual: `npm run e2e:proyectos -- --pdf "<ruta_pdf>" --rol R-151-2026 --tribunal 1TA --caratula "..."`
- Batch: `npm run qa:proyectos -- qa/proyectos-cases.json`

## Evidencia
- Reporte markdown por caso.
- Resultado JSON por caso.
- Screenshot de onboarding.
