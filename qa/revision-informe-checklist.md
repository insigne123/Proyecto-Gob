# QA manual: revision de informe

## Preparacion

- Tener un workspace con al menos un documento listo.
- Tener un DOCX de prueba y, opcionalmente, un PDF de prueba.

## Flujo principal (DOCX)

1. Ir a `Revision de informe`.
2. Subir un DOCX y esperar estado `Listo`.
3. Ejecutar `Analizar`.
4. Verificar que aparecen:
   - dictamen general,
   - sugerencias por parrafo,
   - panel de evidencia.
5. Aplicar una sugerencia y confirmar cambio en el parrafo.
6. Descartar una sugerencia y confirmar estado `discarded`.
7. Ejecutar `Deshacer` por sugerencia y `Deshacer ultima` global.
8. Revisar `Historial de versiones` y `Diff vs version anterior`.

## Integracion revision -> chat

1. En un parrafo, hacer click en `Preguntar`.
2. Confirmar que se abre `Asistente experto`.
3. Confirmar envio automatico del mensaje.
4. Confirmar aviso visual: consulta recibida desde revision de informe.

## Evidencia y trazabilidad

1. En sugerencias y paneles de estrategia/riesgo/casos, revisar citas.
2. Confirmar presencia de tags cuando existan:
   - Tribunal
   - Rol
   - Fecha
   - Materia
   - Region
3. Validar links:
   - `Abrir fuente` (si hay URL)
   - `Abrir snapshot` (si hay snapshotId)

## Export

1. Exportar en modo `DOCX limpio`.
2. Exportar en modo `DOCX con cambios`.
3. Confirmar que `con cambios` incluye bloques `Antes` y `Propuesta` para parrafos modificados.

## Regresion de chat

1. En `Asistente experto`, consultar `hola` y `ola`.
2. Confirmar respuesta rapida (sin error de evidencia).
3. Consultar sobre una afirmacion sin respaldo y validar respuesta hibrida marcada como no respaldada.
