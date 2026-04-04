# E2E Sistema de Proyectos - Caso Reclamacion 1TA

- Fecha prueba: 2026-03-05T18:42:49.262Z
- App URL: http://localhost:9002
- Archivo base: C:\Users\nicog\OneDrive\Escritorio\Proyecto-Gob-Ambiental\Proyecto-Gob\0e562d7a-2802-44f8-be46-dcbdc4b260a0_foleado.pdf
- Caso: R-151-2026 (1TA)

## 1) Preparacion y plan
- Objetivo: validar flujo completo crear proyecto -> onboarding -> upload PDF -> recomendacion RAG -> cierre onboarding.
- Caso: R-151-2026 - Agricola Tarapaca S.A. con Superintendencia del Medio Ambiente.
- Usuario E2E: e2e.proyectos@local.test (actualizado)

## 2) Ejecucion UI automatizada
- Workspace creado: 47b48e10-88ce-46c0-88d4-b2b801f85f0c
- Request recommend status: 200
- UI muestra panel de resultados: OK
- Boton continuar habilitado: OK
- Redireccion final al notebook: OK
- Screenshot: C:\Users\nicog\OneDrive\Escritorio\Proyecto-Gob-Ambiental\Proyecto-Gob\reports\e2e_onboarding_47b48e10-88ce-46c0-88d4-b2b801f85f0c.png

## 3) Verificacion backend
- Workspace existe: OK
- Onboarding metadata: {"hitl":{"latest_run_id":"fdf0fed9-8d78-45ea-b219-170c7bb40db4"},"version":1,"required":true,"completed":false,"started_at":"2026-03-05T18:44:22.916Z","last_run_at":"2026-03-05T18:48:08.021Z","last_run_id":"fdf0fed9-8d78-45ea-b219-170c7bb40db4","analysis_runs":{"fdf0fed9-8d78-45ea-b219-170c7bb40db4":{"hitl":{"cause_reviews":{},"finding_feedback":{},"frozen_precedents":null},"kpis":{"used_causes_ratio":0,"perceived_precision":null,"time_to_first_use_minutes":null},"matrix":[{"rol":"R-113-2024","s...
- Sources en workspace: 1
- Snapshots en workspace: 1
- Chunks asociados: 163
- Notes generadas: 1
- Retrieval traces: 1
- Source onboarding-claim detectada: OK
- Snapshot onboarding status: ready
- Recommend recomendaciones: 8
- Duplicate detection: {"exactHashMatches":0,"nearDuplicateMatches":0,"excludedSources":0,"excludedDocuments":0}
- Warnings recommend: ["Sync corpus warning: TypeError: fetch failed","Pool defensivo activo: 240 causas SEA elegibles."]

## 4) Conclusiones y mejoras
- El flujo principal funciona end-to-end para este caso: creacion, upload, ingesta y recomendacion.
- Mejorar observabilidad: loggear en UI el detalle de schema errors de /onboarding/recommend cuando retorna 400.
- Evitar duplicados de upload onboarding: si ya hay snapshot del mismo hash en el workspace, reutilizarlo.
- Agregar semaforo de readiness del corpus (porcentaje snapshots ready) antes de correr ranking final.
- Forzar en UI filtros sugeridos por defecto segun metadatos del rol/caratula para acortar tiempo de analisis.
- Agregar test automatico nocturno de este flujo para detectar regresiones tempranas.
- Requests recommend detectadas: 1