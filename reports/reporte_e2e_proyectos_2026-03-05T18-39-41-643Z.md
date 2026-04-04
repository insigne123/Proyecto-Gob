# E2E Sistema de Proyectos - Caso Reclamacion 1TA

- Fecha prueba: 2026-03-05T18:33:35.783Z
- App URL: http://localhost:9002
- Archivo base: C:\Users\nicog\OneDrive\Escritorio\Proyecto-Gob-Ambiental\Proyecto-Gob\0._Reclamacion_Huawei_2TA_-_Firmada.pdf
- Caso: R-202-2026 (2TA)

## 1) Preparacion y plan
- Objetivo: validar flujo completo crear proyecto -> onboarding -> upload PDF -> recomendacion RAG -> cierre onboarding.
- Caso: R-202-2026 - Huawei Technologies Chile S.A. con Superintendencia del Medio Ambiente.
- Usuario E2E: e2e.proyectos@local.test (actualizado)

## 2) Ejecucion UI automatizada
- Workspace creado: a7cfff8e-32ce-4acd-a8c9-fb42e5051130
- Request recommend status: 200
- UI muestra panel de resultados: OK
- Boton continuar habilitado: OK
- Redireccion final al notebook: OK
- Screenshot: C:\Users\nicog\OneDrive\Escritorio\Proyecto-Gob-Ambiental\Proyecto-Gob\reports\e2e_onboarding_a7cfff8e-32ce-4acd-a8c9-fb42e5051130.png

## 3) Verificacion backend
- Workspace existe: OK
- Onboarding metadata: {"hitl":{"latest_run_id":"5cf519db-e7b7-4d9f-8237-cd3aedf24ddf"},"version":1,"required":true,"completed":false,"started_at":"2026-03-05T18:35:11.577Z","last_run_at":"2026-03-05T18:38:45.570Z","last_run_id":"5cf519db-e7b7-4d9f-8237-cd3aedf24ddf","analysis_runs":{"5cf519db-e7b7-4d9f-8237-cd3aedf24ddf":{"hitl":{"cause_reviews":{},"finding_feedback":{},"frozen_precedents":null},"kpis":{"used_causes_ratio":0,"perceived_precision":null,"time_to_first_use_minutes":null},"matrix":[{"rol":"R-44-2021","sc...
- Sources en workspace: 1
- Snapshots en workspace: 1
- Chunks asociados: 180
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