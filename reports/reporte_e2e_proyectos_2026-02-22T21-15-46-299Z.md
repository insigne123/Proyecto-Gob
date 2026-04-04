# E2E Sistema de Proyectos - Caso Reclamacion 1TA

- Fecha prueba: 2026-02-22T21:14:36.567Z
- App URL: http://localhost:9002
- Archivo base: C:\Users\nicog\OneDrive\Escritorio\Proyecto-Gob-Ambiental\Proyecto-Gob\0e562d7a-2802-44f8-be46-dcbdc4b260a0_foleado.pdf

## 1) Preparacion y plan
- Objetivo: validar flujo completo crear proyecto -> onboarding -> upload PDF -> recomendacion RAG -> cierre onboarding.
- Caso: escrito inicial R-151-2026 (Agricola Tarapaca).
- Usuario E2E: e2e.proyectos@local.test (actualizado)

## 2) Ejecucion UI automatizada
- Workspace creado: 5fa4231f-47d1-42de-99ac-c57bbad697fd
- Request recommend status: 200
- UI muestra panel de resultados: OK
- Boton continuar habilitado: OK
- Redireccion final al notebook: OK
- Screenshot: C:\Users\nicog\OneDrive\Escritorio\Proyecto-Gob-Ambiental\Proyecto-Gob\reports\e2e_onboarding_5fa4231f-47d1-42de-99ac-c57bbad697fd.png

## 3) Verificacion backend
- Workspace existe: OK
- Onboarding metadata: {"version":1,"required":true,"completed":true,"started_at":"2026-02-22T21:14:46.581Z","completed_at":"2026-02-22T21:15:40.909Z","claim_snapshot_id":"9f09a51a-2a8c-4a75-abee-becd5a518a15","recommendations_count":8}
- Sources en workspace: 1
- Snapshots en workspace: 1
- Chunks asociados: 163
- Notes generadas: 1
- Retrieval traces: 1
- Source onboarding-claim detectada: OK
- Snapshot onboarding status: ready
- Recommend recomendaciones: 8
- Duplicate detection: {"exactHashMatches":0,"nearDuplicateMatches":0,"excludedSources":0,"excludedDocuments":0}
- Warnings recommend: []

## 4) Conclusiones y mejoras
- El flujo principal funciona end-to-end para este caso: creacion, upload, ingesta y recomendacion.
- Mejorar observabilidad: loggear en UI el detalle de schema errors de /onboarding/recommend cuando retorna 400.
- Evitar duplicados de upload onboarding: si ya hay snapshot del mismo hash en el workspace, reutilizarlo.
- Agregar semaforo de readiness del corpus (porcentaje snapshots ready) antes de correr ranking final.
- Forzar en UI filtros sugeridos por defecto segun metadatos del rol/caratula para acortar tiempo de analisis.
- Agregar test automatico nocturno de este flujo para detectar regresiones tempranas.