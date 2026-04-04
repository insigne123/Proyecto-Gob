# E2E Sistema de Proyectos - Caso Reclamacion 1TA

- Fecha prueba: 2026-03-09T13:47:18.898Z
- App URL: http://localhost:9010
- Archivo base: C:\Users\nicog\OneDrive\Escritorio\Proyecto-Gob-Ambiental\Proyecto-Gob\0e562d7a-2802-44f8-be46-dcbdc4b260a0_foleado.pdf
- Caso: R-151-2026 (1TA)

## 1) Preparacion y plan
- Objetivo: validar flujo completo crear proyecto -> onboarding -> upload PDF -> recomendacion RAG -> cierre onboarding.
- Caso: R-151-2026 - Agricola Tarapaca S.A. con Superintendencia del Medio Ambiente.
- Usuario E2E: e2e.proyectos@local.test (actualizado)

## 2) Ejecucion UI automatizada
- Error en ejecucion UI: page.waitForResponse: Timeout 420000ms exceeded while waiting for event "response"

## 3) Verificacion backend
- Workspace existe: OK
- Onboarding metadata: {"version":1,"required":true,"completed":false,"started_at":"2026-03-09T13:47:29.092Z"}
- Sources en workspace: 1
- Snapshots en workspace: 1
- Chunks asociados: 163
- Notes generadas: 0
- Retrieval traces: 0
- Source onboarding-claim detectada: OK
- Snapshot onboarding status: ready

## 4) Conclusiones y mejoras
- El flujo no quedo 100% exitoso en recomendacion (status=N/A, recs=0).
- Mejorar observabilidad: loggear en UI el detalle de schema errors de /onboarding/recommend cuando retorna 400.
- Evitar duplicados de upload onboarding: si ya hay snapshot del mismo hash en el workspace, reutilizarlo.
- Agregar semaforo de readiness del corpus (porcentaje snapshots ready) antes de correr ranking final.
- Forzar en UI filtros sugeridos por defecto segun metadatos del rol/caratula para acortar tiempo de analisis.
- Agregar test automatico nocturno de este flujo para detectar regresiones tempranas.