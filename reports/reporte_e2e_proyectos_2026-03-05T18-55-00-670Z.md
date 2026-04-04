# E2E Sistema de Proyectos - Caso Reclamacion 1TA

- Fecha prueba: 2026-03-05T18:49:19.454Z
- App URL: http://localhost:9002
- Archivo base: C:\Users\nicog\OneDrive\Escritorio\Proyecto-Gob-Ambiental\Proyecto-Gob\0._Reclamacion_Huawei_2TA_-_Firmada.pdf
- Caso: R-202-2026 (2TA)

## 1) Preparacion y plan
- Objetivo: validar flujo completo crear proyecto -> onboarding -> upload PDF -> recomendacion RAG -> cierre onboarding.
- Caso: R-202-2026 - Huawei Technologies Chile S.A. con Superintendencia del Medio Ambiente.
- Usuario E2E: e2e.proyectos@local.test (actualizado)

## 2) Ejecucion UI automatizada
- Workspace creado: 52b02c8d-1e7e-4776-9b69-75d9380cbf8a
- Request recommend status: 200
- UI muestra panel de resultados: OK
- Boton continuar habilitado: OK
- Redireccion final al notebook: OK
- Screenshot: C:\Users\nicog\OneDrive\Escritorio\Proyecto-Gob-Ambiental\Proyecto-Gob\reports\e2e_onboarding_52b02c8d-1e7e-4776-9b69-75d9380cbf8a.png

## 3) Verificacion backend
- Workspace existe: OK
- Onboarding metadata: {"hitl":{"latest_run_id":"1c46323b-2505-4af6-9349-2c564ebe1124"},"version":1,"required":true,"completed":false,"started_at":"2026-03-05T18:50:50.917Z","last_run_at":"2026-03-05T18:54:07.513Z","last_run_id":"1c46323b-2505-4af6-9349-2c564ebe1124","analysis_runs":{"1c46323b-2505-4af6-9349-2c564ebe1124":{"hitl":{"cause_reviews":{},"finding_feedback":{},"frozen_precedents":null},"kpis":{"used_causes_ratio":0,"perceived_precision":null,"time_to_first_use_minutes":null},"matrix":[{"rol":"R-95-2023","sc...
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