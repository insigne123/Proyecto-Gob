# QA Batch - Sistema de Proyectos

- Config: C:\Users\nicog\OneDrive\Escritorio\Proyecto-Gob-Ambiental\Proyecto-Gob\qa\proyectos-cases.json
- App URL: http://localhost:9002
- Inicio: 2026-02-22T22:07:17.593Z

## Caso 1: R-151-2026 escrito inicial
- Rol: R-151-2026
- PDF: 0e562d7a-2802-44f8-be46-dcbdc4b260a0_foleado.pdf
- Resultado: FAIL
- Workspace: N/A
- Recommend status: N/A
- Recomendaciones: 0
- Onboarding completado: no
- Duracion: 4.3s
- Reporte caso: C:\Users\nicog\OneDrive\Escritorio\Proyecto-Gob-Ambiental\Proyecto-Gob\reports\qa_proyectos\reporte_e2e_proyectos_2026-02-22T22-07-24-220Z.md

## Resumen Ejecutivo
- Casos ejecutados: 1
- Exitosos: 0
- Fallidos: 1
- Duracion promedio: 4.3s
- Recomendaciones totales: 0

## Mejoras sugeridas
- Endurecer pre-check de login/sesion antes de navegar a /projects/new en pruebas automáticas.
- Guardar evidencia de error de endpoint (status + body) para cada caso fallido.
- Incorporar este batch en CI nocturno con alerta si la tasa de exito baja de 90%.
- Agregar matriz de casos por tema (agua, ruido, consulta indigena) para medir calidad de marco teorico.
- Agregar validacion post-onboarding: calidad minima del resumen (longitud + citas + top causas).