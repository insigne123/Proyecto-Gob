import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as fs from 'fs';
import 'dotenv/config';

// Inicializar Supabase
// Asegúrate de correr esto con las variables de entorno cargadas
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    console.error("Faltan credenciales de Supabase (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Configuración del target
const targetUrl = 'https://www.portaljudicial1ta.cl/sgc-web/consulta-causa.html';

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrape1TA() {
    console.log('Iniciando scraper del 1er Tribunal Ambiental...');

    const browser = await chromium.launch({ headless: false }); // headless false para ver qué pasa en desarrollo
    const context = await browser.newContext({
        acceptDownloads: true,
    });
    const page = await context.newPage();

    try {
        console.log('Navegando a la consulta de causas...');

        // Log ALL requests to find the API
        page.on('request', request => {
            if (request.url().includes('api') || request.url().includes('json') || request.resourceType() === 'xhr' || request.resourceType() === 'fetch') {
                console.log('>>', request.method(), request.url());
            }
        });
        page.on('response', async response => {
            if (response.url().includes('api') || response.url().includes('json') || response.request().resourceType() === 'xhr' || response.request().resourceType() === 'fetch') {
                console.log('<<', response.status(), response.url());
            }
        });

        await page.goto(targetUrl, { waitUntil: 'networkidle' });

        // Hacer click en el botón "Buscar" (Buscador Simple) para cargar todas las causas
        console.log('Haciendo click en Buscar...');
        await page.waitForSelector('#btnBuscar', { timeout: 10000 });
        await page.click('#btnBuscar');

        // Esperar a que el div-resultados se muestre y el loader desaparezca
        console.log('Esperando resultados...');
        await page.waitForFunction(() => {
            const div = document.querySelector('#div-resultados');
            const loader = document.querySelector('.be-loading');
            return div && !div.hasAttribute('hidden') && loader && !loader.classList.contains('be-loading-active');
        }, { timeout: 30000 }).catch(() => console.log("Timeout esperando loader, intentando seguir..."));

        await delay(3000); // Pausa adicional de seguridad

        // Esperar a que la tabla tenga filas reales
        await page.waitForSelector('#tabla-consulta-causa tbody tr', { timeout: 15000 });

        // Para no iterar paginación (por ahora en la prueba), veremos si podemos extraer la página actual o seleccionar "Ver Todos"
        // Probaremos extraer las primeras causas nomás

        const rows = await page.$$eval('#tabla-consulta-causa tbody tr', trs => {
            return trs.map(tr => {
                const tds = tr.querySelectorAll('td');
                if (tds.length < 6) return null; // Fila vacía o "No data"
                return {
                    tipo: tds[0]?.textContent?.trim() || '',
                    rol: tds[1]?.textContent?.trim() || '',
                    fecha_ingreso: tds[2]?.textContent?.trim() || '',
                    caratula: tds[3]?.textContent?.trim() || '',
                    estado_subtipo: tds[4]?.textContent?.trim() || '',
                    estado: tds[5]?.textContent?.trim() || '',
                    link: tds[1]?.querySelector('a')?.href || ''
                };
            }).filter(r => r !== null);
        });
        console.log(`Se encontraron ${rows.length} causas en la página actual.`);

        // Filtrar masivamente
        const validCauses = rows.filter(r =>
            r.tipo.toLowerCase().includes('reclam') &&
            (r.caratula.toLowerCase().includes('servicio de evaluación ambiental') ||
                r.caratula.toLowerCase().includes('sea') ||
                r.caratula.toLowerCase().includes('dirección ejecutiva'))
        );

        console.log(`De ellas, ${validCauses.length} coinciden con los filtros (Reclamación + SEA).`);

        for (const cause of validCauses) {
            console.log(`\nProcesando causa relevante: ${cause.rol} - ${cause.caratula}`);

            // Guardar causa en Supabase (gob_tribunal_causes)
            const { data: causeData, error: causeError } = await supabase
                .from('gob_tribunal_causes')
                .upsert({
                    tribunal: '1TA',
                    rol: cause.rol,
                    caratula: cause.caratula,
                    fecha_ingreso: cause.fecha_ingreso ? cause.fecha_ingreso.split('/').reverse().join('-') : null, // Asumiendo DD/MM/YYYY
                    estado_subtipo: cause.estado_subtipo,
                    estado: cause.estado,
                    link_causa: cause.link,
                    last_scraped_at: new Date().toISOString()
                }, { onConflict: 'rol' })
                .select()
                .single();

            if (causeError) {
                console.error(`Error guardando causa ${cause.rol}:`, causeError);
                continue;
            }
            const causeId = causeData.id;

            // Extraer documentos vía API REST interna
            if (cause.rol) {
                console.log(`Buscando documentos por API para la causa ${cause.rol}...`);
                try {
                    // 1. Obtener idCausa
                    const resCausa = await fetch(`https://www.portaljudicial1ta.cl/sgc-ws/rest/ver-causa/carga-datos-causa?rolCausa=${cause.rol}`);
                    const jsonCausa = await resCausa.json();

                    if (jsonCausa.status === "200") {
                        const dataCausa = JSON.parse(jsonCausa.response);
                        const idCausa = dataCausa.idCausa;

                        // 2. Obtener lista de cuadernos
                        const resCuadernos = await fetch(`https://www.portaljudicial1ta.cl/sgc-ws/rest/ver-causa/lista-cuadernos-causa?idCausa=${idCausa}`);
                        const jsonCuadernos = await resCuadernos.json();

                        if (jsonCuadernos.status === "200") {
                            const cuadernos = JSON.parse(jsonCuadernos.response);

                            let docs: any[] = [];

                            // 3. Iterar cuadernos para sacar los asientos (documentos)
                            for (const cuaderno of cuadernos) {
                                const idCuaderno = cuaderno.clave;
                                const resAsientos = await fetch(`https://www.portaljudicial1ta.cl/sgc-ws/rest/ver-causa/lista-asiento-cuaderno?idCuaderno=${idCuaderno}&tipoDocumento=all&idUsuario=&rolUsuario=`);
                                const jsonAsientos = await resAsientos.json();

                                if (jsonAsientos.status === "200") {
                                    const asientos = JSON.parse(jsonAsientos.response);
                                    docs = docs.concat(asientos);
                                }
                            }

                            // Filtrar los que nos interesan
                            // Buscamos en los distintos campos de nombre/tipo
                            const relevantDocs = docs.filter(d => {
                                const texts = [d.nombreDocumento, d.tipoDocumento, d.tipoDocumento2, d.resuelveDocumento].filter(Boolean).map(t => t.toLowerCase());
                                return texts.some(t => t.includes('escrito inicial') || t.includes('evacua informe') || t.includes('sentencia'));
                            });

                            console.log(`Se encontraron ${relevantDocs.length} documentos clave para ${cause.rol}`);

                            for (const doc of relevantDocs) {
                                // 4. Obtener link de descarga del asiento
                                const codAsiento = doc.codAsiento;
                                try {
                                    const resLink = await fetch(`https://www.portaljudicial1ta.cl/sgc-ws/rest/ver-causa/lista-documento-asiento?asiento=${codAsiento}`);
                                    const jsonLink = await resLink.json();
                                    if (jsonLink.status === "200") {
                                        const docDetails = JSON.parse(jsonLink.response);
                                        if (docDetails.length > 0) {
                                            const detail = docDetails[0];
                                            const downloadUrl = detail.linkDocumentoFoleado || detail.linkDocumentoOriginal;
                                            const fullUrl = downloadUrl ? `https://www.portaljudicial1ta.cl/sgc-ws/rest/servlet/download-file?file=${downloadUrl}` : 'N/A';

                                            // Nombre para guardar
                                            const docName = [doc.resuelveDocumento, doc.tipoDocumento2, doc.tipoDocumento, doc.nombreDocumento].find(Boolean) || `doc-${codAsiento}`;
                                            console.log(`  - Doc: ${docName} (Fecha: ${doc.fechaDocumento}) => ${fullUrl}`);

                                            if (fullUrl !== 'N/A') {
                                                console.log(`    Descargando documento...`);
                                                const pdfRes = await fetch(fullUrl);
                                                if (!pdfRes.ok) {
                                                    console.error(`    Error descargando PDF: ${fullUrl}`);
                                                    continue;
                                                }
                                                const pdfBuffer = await pdfRes.arrayBuffer();

                                                // Sanitizar nombre de archivo
                                                const safeDocName = docName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                                                const storagePath = `tribunales/1TA/${cause.rol}/${safeDocName}_${codAsiento}.pdf`;

                                                // Subir a Storage
                                                console.log(`    -> Subiendo a Storage en path: ${storagePath}`);
                                                const { data: uploadData, error: uploadError } = await supabase.storage
                                                    .from('gob_sources')
                                                    .upload(storagePath, pdfBuffer, {
                                                        contentType: 'application/pdf',
                                                        upsert: true
                                                    });

                                                if (uploadError) {
                                                    console.error(`    Error subiendo a Storage:`, uploadError);
                                                    continue;
                                                }

                                                // Guardar registro en gob_tribunal_documents
                                                const { error: docError } = await supabase
                                                    .from('gob_tribunal_documents')
                                                    .insert({
                                                        cause_id: causeId, // Viene del upsert de la causa
                                                        document_type: docName,
                                                        date: doc.fechaDocumento ? doc.fechaDocumento.split('/').reverse().join('-') : null,
                                                        fojas: doc.fojasDocumento,
                                                        name: detail.nombreDocumentoDescarga || safeDocName,
                                                        storage_path: storagePath,
                                                        url: fullUrl
                                                    });

                                                if (docError) {
                                                    console.error(`    Error insertando en BD:`, docError);
                                                } else {
                                                    console.log(`    Ok - Documento guardado y vinculado a ${cause.rol}`);
                                                }
                                            }
                                        }
                                    }
                                } catch (e) {
                                    console.error(`  - Error obteniendo link para asiento ${codAsiento}:`, e);
                                }
                            }
                        }
                    } else {
                        console.log(`No se pudo cargar idCausa para ${cause.rol}`);
                    }
                } catch (e) {
                    console.error(`Error extrayendo documentos de API para ${cause.rol}:`, e);
                }
            }
        }

    } catch (error) {
        console.error('Error durante el scraping:', error);
    } finally {
        await browser.close();
        console.log('Scraper finalizado.');
    }
}

// Ejecutar
scrape1TA().catch(console.error);
console.log('Navegando a la consulta de causas...');

// Log ALL requests to find the API
page.on('request', request => {
    if (request.url().includes('api') || request.url().includes('json') || request.resourceType() === 'xhr' || request.resourceType() === 'fetch') {
        console.log('>>', request.method(), request.url());
    }
});
page.on('response', async response => {
    if (response.url().includes('api') || response.url().includes('json') || response.request().resourceType() === 'xhr' || response.request().resourceType() === 'fetch') {
        console.log('<<', response.status(), response.url());
    }
});

await page.goto(targetUrl, { waitUntil: 'networkidle' });

// Hacer click en el botón "Buscar" (Buscador Simple) para cargar todas las causas
console.log('Haciendo click en Buscar...');
await page.waitForSelector('#btnBuscar', { timeout: 10000 });
await page.click('#btnBuscar');

// Esperar a que el div-resultados se muestre y el loader desaparezca
console.log('Esperando resultados...');
await page.waitForFunction(() => {
    const div = document.querySelector('#div-resultados');
    const loader = document.querySelector('.be-loading');
    return div && !div.hasAttribute('hidden') && loader && !loader.classList.contains('be-loading-active');
}, { timeout: 30000 }).catch(() => console.log("Timeout esperando loader, intentando seguir..."));

await delay(3000); // Pausa adicional de seguridad

// Intercepting the API response to get ALL causes directly from JSON
let allCauses: any[] = [];
page.on('response', async response => {
    if (response.url().includes('get-consulta-causa') && response.request().method() === 'POST') {
        try {
            const json = await response.json();
            if (json && json.response) {
                allCauses = JSON.parse(json.response);
            }
        } catch (e) {
            console.error("Error parsing get-consulta-causa response", e);
        }
    }
});

await page.goto(targetUrl, { waitUntil: 'networkidle' });

// Hacer click en el botón "Buscar" (Buscador Simple) para cargar todas las causas
console.log('Haciendo click en Buscar...');
await page.waitForSelector('#btnBuscar', { timeout: 10000 });
await page.click('#btnBuscar');

// Esperar a que el div-resultados se muestre y el loader desaparezca
console.log('Esperando resultados de la API...');
await page.waitForFunction(() => {
    const div = document.querySelector('#div-resultados');
    const loader = document.querySelector('.be-loading');
    return div && !div.hasAttribute('hidden') && loader && !loader.classList.contains('be-loading-active');
}, { timeout: 30000 }).catch(() => console.log("Timeout esperando loader, intentando seguir..."));

await delay(5000); // Pausa para asegurar que la API termine de responder

if (!allCauses || allCauses.length === 0) {
    console.log("No se pudieron obtener causas desde la API. Terminando...");
    return;
}

console.log(`Se encontraron ${allCauses.length} causas en total desde la API interna.`);

// Filtrar masivamente
const validCauses = allCauses.filter(r => {
    const tipo = normalizeForSearch(r.tipoCausa);
    const caratula = r.caratula || r.caratulaCausa;
    return tipo.includes('reclam') && isSeaDefendantCaratula(caratula);
});

console.log(`De ellas, ${validCauses.length} coinciden con los filtros (Reclamación + SEA).`);

for (const rawCause of validCauses) {
    // Mapeamos los campos del JSON de la API a nuestro formato
    const rol = pickFirstString(rawCause.numeroRol, rawCause.rolCausa);
    const cause = {
        rol,
        caratula: pickFirstString(rawCause.caratula, rawCause.caratulaCausa),
        fecha_ingreso: toIsoDate(rawCause.fechaIngreso ?? rawCause.fechaCausa ?? rawCause.fechaIngresoCausa),
        estado_subtipo: pickFirstString(rawCause.subEstadoCausa, rawCause.subTipoCausa),
        estado: pickFirstString(rawCause.estadoCausa, rawCause.estado),
        link: rol
            ? `https://www.portaljudicial1ta.cl/sgc-web/ver-causa.html?rol=${encodeURIComponent(rol)}`
            : null,
    };

    if (!cause.rol) {
        console.log('Causa omitida por no tener ROL:', rawCause);
        continue;
    }

    console.log(`\nProcesando causa relevante: ${cause.rol} - ${cause.caratula}`);

    // Guardar causa en Supabase (gob_tribunal_causes)
    const { data: causeData, error: causeError } = await supabase
        .from('gob_tribunal_causes')
        .upsert({
            tribunal: '1TA',
            rol: cause.rol,
            caratula: cause.caratula,
            fecha_ingreso: cause.fecha_ingreso,
            estado_subtipo: cause.estado_subtipo,
            estado: cause.estado,
            link_causa: cause.link,
            last_scraped_at: new Date().toISOString()
        }, { onConflict: 'rol' })
        .select()
        .single();

    if (causeError) {
        console.error(`Error guardando causa ${cause.rol}:`, causeError);
        continue;
    }
    const causeId = causeData.id;

    // Extraer documentos vía API REST interna
    if (cause.rol) {
        console.log(`Buscando documentos por API para la causa ${cause.rol}...`);
        try {
            // 1. Obtener idCausa
            const resCausa = await fetch(`https://www.portaljudicial1ta.cl/sgc-ws/rest/ver-causa/carga-datos-causa?rolCausa=${cause.rol}`);
            const jsonCausa = await resCausa.json();

            if (jsonCausa.status === "200") {
                const dataCausa = JSON.parse(jsonCausa.response);
                const idCausa = dataCausa.idCausa;

                // 2. Obtener lista de cuadernos
                const resCuadernos = await fetch(`https://www.portaljudicial1ta.cl/sgc-ws/rest/ver-causa/lista-cuadernos-causa?idCausa=${idCausa}`);
                const jsonCuadernos = await resCuadernos.json();

                if (jsonCuadernos.status === "200") {
                    const cuadernos = JSON.parse(jsonCuadernos.response);

                    let docs: any[] = [];

                    // 3. Iterar cuadernos para sacar los asientos (documentos)
                    for (const cuaderno of cuadernos) {
                        const idCuaderno = cuaderno.clave;
                        const resAsientos = await fetch(`https://www.portaljudicial1ta.cl/sgc-ws/rest/ver-causa/lista-asiento-cuaderno?idCuaderno=${idCuaderno}&tipoDocumento=all&idUsuario=&rolUsuario=`);
                        const jsonAsientos = await resAsientos.json();

                        if (jsonAsientos.status === "200") {
                            const asientos = JSON.parse(jsonAsientos.response);
                            docs = docs.concat(asientos);
                        }
                    }

                    const selectedDocs = pickKeyDocuments(docs);
                    console.log(`Se seleccionaron ${selectedDocs.length} documentos clave para ${cause.rol} (de un total de ${docs.length} asientos).`);

                    const { data: existingDocs, error: existingDocsError } = await supabase
                        .from('gob_tribunal_documents')
                        .select('name,date,url')
                        .eq('cause_id', causeId);

                    if (existingDocsError) {
                        console.error(`Error consultando documentos existentes de ${cause.rol}:`, existingDocsError);
                    }

                    const existingDocKeys = new Set(
                        (existingDocs || []).map((existing: any) => `${existing.name ?? ''}|${existing.date ?? ''}|${existing.url ?? ''}`)
                    );

                    for (const item of selectedDocs) {
                        const doc = item.doc;
                        // 4. Obtener link de descarga del asiento
                        const codAsiento = doc.codAsiento;
                        try {
                            const resLink = await fetch(`https://www.portaljudicial1ta.cl/sgc-ws/rest/ver-causa/lista-documento-asiento?token=&asiento=${codAsiento}`);
                            const jsonLink = await resLink.json();
                            if (jsonLink.status === "200") {
                                const docDetails = JSON.parse(jsonLink.response);
                                const detail = pickBestDocumentDetail(docDetails);
                                if (detail) {
                                    const downloadPath = pickFirstString(detail.linkFoleado, detail.linkOriginal, detail.linkFirmando);
                                    const fullUrl = downloadPath
                                        ? `https://www.portaljudicial1ta.cl/sgc-ws/rest/servlet/viewer-file?file=${encodeURIComponent(downloadPath)}&embedded=true`
                                        : null;

                                    // Nombre para guardar
                                    const docName = pickFirstString(doc.resuelveDocumento, doc.tipoDocumento2, doc.tipoDocumento, doc.nombreDocumento) || `doc-${codAsiento}`;
                                    const dbDate = toIsoDate(doc.fechaDocumento);
                                    const dbName = pickFirstString(detail.nombreDocumento, doc.nombreDocumento, docName) || `doc-${codAsiento}`;
                                    const duplicateKey = `${dbName}|${dbDate ?? ''}|${fullUrl ?? ''}`;

                                    if (existingDocKeys.has(duplicateKey)) {
                                        console.log(`  - Documento ya existente, se omite: ${dbName}`);
                                        continue;
                                    }

                                    console.log(`  - Doc: ${docName} (Fecha: ${doc.fechaDocumento}) => ${fullUrl ?? 'sin URL de descarga'}`);

                                    let storagePath: string | null = null;

                                    if (fullUrl) {
                                        try {
                                            console.log('    Descargando documento...');
                                            const pdfRes = await fetch(fullUrl);
                                            if (!pdfRes.ok) {
                                                console.error(`    Error descargando PDF: ${fullUrl}`);
                                            } else {
                                                const pdfBuffer = await pdfRes.arrayBuffer();

                                                // Sanitizar nombre de archivo
                                                const safeDocName = docName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                                                storagePath = `tribunales/1TA/${cause.rol}/${safeDocName}_${codAsiento}.pdf`;

                                                // Subir a Storage
                                                console.log(`    -> Subiendo a Storage en path: ${storagePath}`);
                                                const { error: uploadError } = await supabase.storage
                                                    .from('gob_sources')
                                                    .upload(storagePath, pdfBuffer, {
                                                        contentType: 'application/pdf',
                                                        upsert: true
                                                    });

                                                if (uploadError) {
                                                    console.error('    Error subiendo a Storage:', uploadError);
                                                    storagePath = null;
                                                }
                                            }
                                        } catch (downloadError) {
                                            console.error(`    Error descargando/subiendo documento ${docName}:`, downloadError);
                                            storagePath = null;
                                        }
                                    }

                                    // Guardar registro en gob_tribunal_documents (aunque no se haya podido subir archivo)
                                    const { error: docError } = await supabase
                                        .from('gob_tribunal_documents')
                                        .insert({
                                            cause_id: causeId,
                                            document_type: canonicalDocumentType(item.kind),
                                            date: dbDate,
                                            fojas: pickFirstString(doc.fojasDocumento),
                                            name: dbName,
                                            storage_path: storagePath,
                                            url: fullUrl
                                        });

                                    if (docError) {
                                        console.error('    Error insertando en BD:', docError);
                                    } else {
                                        existingDocKeys.add(duplicateKey);
                                        console.log(`    Ok - Documento guardado y vinculado a ${cause.rol}`);
                                    }
                                }
                            }
                        } catch (e) {
                            console.error(`  - Error obteniendo link para asiento ${codAsiento}:`, e);
                        }
                    }
                }
            } else {
                console.log(`No se pudo cargar idCausa para ${cause.rol}`);
            }
        } catch (e) {
            console.error(`Error extrayendo documentos de API para ${cause.rol}:`, e);
        }
    }
}
    } catch (error) {
        console.error('Error durante el scraping:', error);
    } finally {
        await browser.close();
        console.log('Scraper finalizado.');
    }
}

// Ejecutar
scrape1TA().catch(console.error);
