# E2E Sistema de Proyectos - Caso Reclamacion 1TA

- Fecha prueba: 2026-03-05T15:22:23.236Z
- App URL: http://localhost:9002
- Archivo base: C:\Users\nicog\OneDrive\Escritorio\Proyecto-Gob-Ambiental\Proyecto-Gob\0e562d7a-2802-44f8-be46-dcbdc4b260a0_foleado.pdf
- Caso: R-151-2026 (1TA)

## 1) Preparacion y plan
- Objetivo: validar flujo completo crear proyecto -> onboarding -> upload PDF -> recomendacion RAG -> cierre onboarding.
- Caso: R-151-2026 - Agricola Tarapaca S.A. con Superintendencia del Medio Ambiente.
- Usuario E2E: e2e.proyectos@local.test (actualizado)

## 2) Ejecucion UI automatizada
- Error en ejecucion UI: Creacion workspace fallo (status=401) | API: Unauthorized

## 3) Verificacion backend
- No se pudo verificar backend por falta de workspaceId.

## 4) Conclusiones y mejoras
- El flujo no quedo 100% exitoso en recomendacion (status=N/A, recs=0).
- Mejorar observabilidad: loggear en UI el detalle de schema errors de /onboarding/recommend cuando retorna 400.
- Evitar duplicados de upload onboarding: si ya hay snapshot del mismo hash en el workspace, reutilizarlo.
- Agregar semaforo de readiness del corpus (porcentaje snapshots ready) antes de correr ranking final.
- Forzar en UI filtros sugeridos por defecto segun metadatos del rol/caratula para acortar tiempo de analisis.
- Agregar test automatico nocturno de este flujo para detectar regresiones tempranas.