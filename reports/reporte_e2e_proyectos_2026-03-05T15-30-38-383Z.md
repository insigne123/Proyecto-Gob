# E2E Sistema de Proyectos - Caso Reclamacion 1TA

- Fecha prueba: 2026-03-05T15:28:45.401Z
- App URL: http://localhost:9002
- Archivo base: C:\Users\nicog\OneDrive\Escritorio\Proyecto-Gob-Ambiental\Proyecto-Gob\0e562d7a-2802-44f8-be46-dcbdc4b260a0_foleado.pdf
- Caso: R-151-2026 (1TA)

## 1) Preparacion y plan
- Objetivo: validar flujo completo crear proyecto -> onboarding -> upload PDF -> recomendacion RAG -> cierre onboarding.
- Caso: R-151-2026 - Agricola Tarapaca S.A. con Superintendencia del Medio Ambiente.
- Usuario E2E: e2e.proyectos@local.test (actualizado)

## 2) Ejecucion UI automatizada
- Error en ejecucion UI: locator.click: Timeout 30000ms exceeded. Call log: [2m - waiting for locator('button:has-text("Generar marco teorico")')[22m [2m - locator resolved to <button disabled class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 gap-2">…</button>[22m [2m - attempting click action[22m [2m 2 × waiting for element to be visible, enabled an...

## 3) Verificacion backend
- Workspace existe: OK
- Onboarding metadata: {"version":1,"required":true,"completed":false,"started_at":"2026-03-05T15:30:03.813Z"}
- Sources en workspace: 0
- Snapshots en workspace: 0
- Chunks asociados: 0
- Notes generadas: 0
- Retrieval traces: 0
- Source onboarding-claim detectada: FAIL
- Snapshot onboarding status: N/A

## 4) Conclusiones y mejoras
- El flujo no quedo 100% exitoso en recomendacion (status=N/A, recs=0).
- Mejorar observabilidad: loggear en UI el detalle de schema errors de /onboarding/recommend cuando retorna 400.
- Evitar duplicados de upload onboarding: si ya hay snapshot del mismo hash en el workspace, reutilizarlo.
- Agregar semaforo de readiness del corpus (porcentaje snapshots ready) antes de correr ranking final.
- Forzar en UI filtros sugeridos por defecto segun metadatos del rol/caratula para acortar tiempo de analisis.
- Agregar test automatico nocturno de este flujo para detectar regresiones tempranas.