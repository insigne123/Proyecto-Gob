$(document).ready(function() {
    //Cargar token desde cookie
    var token = Cookies.get('token');

    // Parámetros en la URL
    var urlParams = new URLSearchParams(location.search);
    const rol = urlParams.get('rol');
    let validacionExitosa = true;

// Validar rol
    if (urlParams.has('rol')) {
        if (/[O|DE|S|C|R]{1,2}[-|‐]{1}[0-9]+[-|‐]{1}[0-9]{4}$/.test(rol)) {
            $("#p_rolCausa").val(rol);
        } else {
            validacionExitosa = false;
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hay un error en el número de ROL.',
                confirmButtonText: 'Entiendo'
            }).then((result) => {
                if (result.isConfirmed) {
                    document.location.href = 'inicio.html';
                }
            });
        }
    } else {
        validacionExitosa = false;
        Swal.fire({
            icon: 'error',
            title: '¡Lo sentimos!',
            text: 'Hay un error en el número de ROL.',
            confirmButtonText: 'Entiendo'
        }).then((result) => {
            if (result.isConfirmed) {
                document.location.href = 'inicio.html';
            }
        });
    }

// Validar doc de entrada
    if (urlParams.has('doc')) {
        const docEntrada = urlParams.get('doc');
        if (/[0-9]+$/.test(docEntrada)) {
            $("#p_docEntrada").val(docEntrada);

        } else {
            $("#p_docEntrada").val("null");
        }
    } else {
        $("#p_docEntrada").val("null");
    }

// Validar idAdjunto
    if (urlParams.has('idAdjunto')) {
        const idAdjunto = urlParams.get('idAdjunto');
        if (/[0-9]+$/.test(idAdjunto)) {
            $("#p_adjuntoEntrada").val(idAdjunto);
            $("#p_tipoDocumento").val("N/A");
        } else {
            $("#p_adjuntoEntrada").val("null");
        }
    } else {
        $("#p_adjuntoEntrada").val("null");
    }

// Ejecutar cargaDatosCausa solo si la validación fue exitosa
    if (validacionExitosa) {
        cargaDatosCausa(rol);
    }

    //Date Picker init
    $(".datetimepicker").datetimepicker({
        language: 'es',
        autoclose: true,
        viewMode: 'years',
        componentIcon: '.mdi.mdi-calendar',
        navIcons: {
            rightIcon: 'mdi mdi-chevron-right',
            leftIcon: 'mdi mdi-chevron-left'
        }
    });

    $(".datepicker").datepicker({
        language: 'es',
        autoclose: true,
        componentIcon: '.mdi.mdi-calendar',
        navIcons: {
            rightIcon: 'mdi mdi-chevron-right',
            leftIcon: 'mdi mdi-chevron-left'
        },
        orientation: 'bottom'
    });

    //Carga pestaña administración
    cargaAdministracionRelatores();
    cargaAdministracionRedactores();
    //cargaAdministracionMinistros();
    cargaAdministracionAsesoresCientificos();
    cargaTablaAudiencias(rol);
    cargaModalAudiencias(rol);
    cargaEstadoFinalCausa(rol);

    $("#p_rut").inputmask({
        mask: '9{1,2}.9{3}.9{3}-K|k|9',
        casing: 'upper',
        clearIncomplete: false,
        numericInput: true,
        positionCaretOnClick: 'none'
    });

    cargaRolProcesal(0, 'Oficial');

    //Buscar Litigante por rut
    $("#btn-buscar-Litigante").click(function() {
        var txtRut = $("#p_rut").val().startsWith("0") ?
            $("#p_rut").val().replace(/\./g, "").slice(1) :
            $("#p_rut").val().replace(/\./g, "");
        if (txtRut !== "") {
            if (!Fn.validaRut(txtRut)) {
                $("#p_rut").focus();
                Swal.fire({
                    icon: "error",
                    title: "",
                    text: "El RUT ingresado no es válido.",
                    confirmButtonText: "Entiendo",
                });
            } else {
                //voy a buscar el Litigante

                let rut = txtRut.split("-");

                var existe = existeLitigante(rut[0]);

                if (existe === "OK") {
                    //se cargan los datos
                    cargaDatosLitigante(rut[0]);
                } else {
                    $("#alertaLitigante").removeClass("hide");
                    $("#rutHTML").html(
                        `El rut ${txtRut} no figura en nuestros registros, a través del siguiente formulario lo puedes agregar como Litigante.`
                    );

                    $("#p_nombre").prop("disabled", false);
                    $("#p_apellido").prop("disabled", false);
                    $("#p_tipoPersona").prop("disabled", false);
                    $("#p_rut").prop("disabled", false);
                    $("#p_emailLitigante").prop("disabled", false);
                }

                //$('#div-rut-litigante').removeClass('be-loading-active');
            }
        } else {
            $("#p_rut").focus();
            Swal.fire({
                icon: "error",
                title: "",
                text: "Debe ingresar un RUT para la busqueda del Litigante.",
                confirmButtonText: "Entiendo",
            });
        }
    });
});

function mostrarPestañasPerfiles(rol) {
    switch (rol) {
        case 'Amicus Curie':
        case 'Habilitado en Derecho':
        case 'Abogado Externo':
            /* Menu superior */
            $('#menu_accesibilidad').show();
            $('#menu_notificaciones').show();
            $('#menu_salir').show();
            /* Opciones de pestañas */
            $('#btn_sheet_record').show(); //Siempre on
            $('#btn_sheet_litigant').show(); //Siempre on
            $('#btn_sheet_admin').hide();
            /* Opciones sobre expediente */
            $('#btn_agregar_cuaderno').hide();
            $('#btn_agregar_documento').hide();
            $('#btn_copiar_link_documento').hide();
            $('#btn_descargar_asiento').hide();
            $('#acciones_asiento').hide();
            $('#panel_relacionados').hide(); //Siempre off
            $('#panel_custodias').hide(); //Siempre off
            $('#panel_notificaciones').show();
            $('#panel_patrocinadores').show();
            $('#hacerseParte_ingresarEscrito_ingresarCertificacion').show();
            //$('#btn-hacerse-parte').show(); //Se configura en funcion cargarHacerseParte
            //$('#btn-ingresar-escrito').hide(); //Se configura en funcion cargarHacerseParte
            $('#btn-ingresar-certificacion').hide();
            /* Opciones del administrador */
            $('#administracion_general').hide();
            $('#administracion_antecedentes_adicionales').hide();
            $('#administracion_accion_cierre').hide();
            //Ocultar boton descargar expediente unificado
            $("#btn-descargar-expediente-unificado").attr("hidden", true);
            break;
        case 'Relator':
        case 'Ministro':
        case 'Secretario':
            /* Menu superior */
            $('#menu_accesibilidad').show();
            $('#menu_notificaciones').show();
            $('#menu_salir').show();
            /* Opciones de pestañas */
            $('#btn_sheet_record').show(); //Siempre on
            $('#btn_sheet_litigant').show(); //Siempre on
            $('#btn_sheet_admin').hide();
            /* Opciones sobre expediente */
            $('#btn_agregar_cuaderno').hide();
            $('#btn_agregar_documento').hide();
            $('#btn_copiar_link_documento').show();
            $('#btn_descargar_asiento').show();
            $('#acciones_asiento').hide();
            $('#panel_relacionados').hide(); //Siempre off
            $('#panel_custodias').hide(); //Siempre off
            $('#panel_notificaciones').show();
            $('#panel_patrocinadores').show();

            $('#hacerseParte_ingresarEscrito_ingresarCertificacion').show();
            //$('#btn-hacerse-parte').show(); //Se configura en funcion cargarHacerseParte
            //$('#btn-ingresar-escrito').hide(); //Se configura en funcion cargarHacerseParte
            $('#btn-ingresar-certificacion').hide();
            /* Opciones del administrador */
            $('#administracion_general').hide();
            $('#administracion_antecedentes_adicionales').hide();
            $('#administracion_accion_cierre').hide();
            $("#btn-descargar-expediente-unificado").attr("hidden", true);
            break;
        case 'Asesor Científico':
        case 'Asesor de Estudio':
            /* Menu superior */
            $('#menu_accesibilidad').show();
            $('#menu_notificaciones').show();
            $('#menu_salir').show();
            /* Opciones de pestañas */
            $('#btn_sheet_record').show(); //Siempre on
            $('#btn_sheet_litigant').show(); //Siempre on
            $('#btn_sheet_admin').show();
            /* Opciones sobre expediente */
            $('#btn_agregar_cuaderno').hide();
            $('#btn_agregar_documento').hide();
            $('#btn_copiar_link_documento').show();
            $('#btn_descargar_asiento').show();
            $('#acciones_asiento').hide();
            $('#panel_relacionados').hide(); //Siempre off
            $('#panel_custodias').hide(); //Siempre off
            $('#panel_notificaciones').show();
            $('#panel_patrocinadores').show();
            $('#hacerseParte_ingresarEscrito_ingresarCertificacion').hide();
            //$('#btn-hacerse-parte').show(); //Se configura en funcion cargarHacerseParte
            //$('#btn-ingresar-escrito').hide(); //Se configura en funcion cargarHacerseParte
            //$('#btn-ingresar-certificacion').hide();
            /* Opciones del administrador */
            $('#administracion_general').hide();
            $('#administracion_antecedentes_adicionales').show();
            $('#administracion_accion_cierre').hide();
            $("#btn-descargar-expediente-unificado").attr("hidden", true);
            break;
        case 'Receptor':
            /* Menu superior */
            $('#menu_accesibilidad').show();
            $('#menu_notificaciones').show();
            $('#menu_salir').show();
            /* Opciones de pestañas */
            $('#btn_sheet_record').show(); //Siempre on
            $('#btn_sheet_litigant').show(); //Siempre on
            $('#btn_sheet_admin').hide();
            /* Opciones sobre expediente */
            $('#btn_agregar_cuaderno').hide();
            $('#btn_agregar_documento').hide();
            $('#btn_copiar_link_documento').hide();
            $('#btn_descargar_asiento').hide();
            $('#acciones_asiento').hide();
            $('#panel_relacionados').hide(); //Siempre off
            $('#panel_custodias').hide(); //Siempre off
            $('#panel_notificaciones').show();
            $('#panel_patrocinadores').show();
            $('#hacerseParte_ingresarEscrito_ingresarCertificacion').show();
            //$('#btn-hacerse-parte').show(); //Se configura en funcion cargarHacerseParte
            //$('#btn-ingresar-escrito').hide(); //Se configura en funcion cargarHacerseParte
            $('#btn-ingresar-certificacion').show();
            /* Opciones del administrador */
            $('#administracion_general').hide();
            $('#administracion_antecedentes_adicionales').hide();
            $('#administracion_accion_cierre').hide();
            $("#btn-descargar-expediente-unificado").attr("hidden", true);
            break;
        case 'Oficial':
        case 'Administrador':
            /* Menu superior */
            $('#menu_accesibilidad').show();
            $('#menu_notificaciones').show();
            $('#menu_salir').show();
            /* Opciones de pestañas */
            $('#btn_sheet_record').show(); //Siempre on
            $('#btn_sheet_litigant').show(); //Siempre on
            $('#btn_sheet_admin').show();
            /* Opciones sobre expediente */
            $('#btn_agregar_cuaderno').show();
            $('#btn_agregar_documento').show();
            $('#btn_copiar_link_documento').show();
            $('#btn_descargar_asiento').show();
            $('#acciones_asiento').show();
            $('#panel_relacionados').hide(); //Siempre off
            $('#panel_custodias').hide(); //Siempre off
            $('#panel_notificaciones').show();
            $('#panel_patrocinadores').show();
            $('#hacerseParte_ingresarEscrito_ingresarCertificacion').show();
            //$('#btn-hacerse-parte').show(); //Se configura en funcion cargarHacerseParte
            //$('#btn-ingresar-escrito').hide(); //Se configura en funcion cargarHacerseParte
            $('#btn-ingresar-certificacion').show();
            /* Opciones del administrador */
            $('#administracion_general').show();
            $('#administracion_antecedentes_adicionales').hide();
            $('#administracion_accion_cierre').show();
            //Ocultar boton descargar expediente unificado
            $("#btn-descargar-expediente-unificado").removeAttr('hidden');
            break;
        case 'Pasante judicial':
            /* Menu superior */
            $('#menu_accesibilidad').show();
            $('#menu_notificaciones').show();
            $('#menu_salir').show();
            /* Opciones de pestañas */
            $('#btn_sheet_record').show(); //Siempre on
            $('#btn_sheet_litigant').show(); //Siempre on
            $('#btn_sheet_admin').show();
            /* Opciones sobre expediente */
            $('#btn_agregar_cuaderno').hide();
            $('#btn_agregar_documento').hide();
            $('#btn_copiar_link_documento').show();
            $('#btn_descargar_asiento').show();
            $('#acciones_asiento').hide();
            $('#panel_relacionados').hide(); //Siempre off
            $('#panel_custodias').hide(); //Siempre off
            $('#panel_notificaciones').show();
            $('#panel_patrocinadores').show();
            $('#hacerseParte_ingresarEscrito_ingresarCertificacion').show();
            //$('#btn-hacerse-parte').show(); //Se configura en funcion cargarHacerseParte
            //$('#btn-ingresar-escrito').hide(); //Se configura en funcion cargarHacerseParte
            $('#btn-ingresar-certificacion').show();
            /* Opciones del administrador */
            $('#administracion_general').show();
            $('#administracion_antecedentes_adicionales').hide();
            $('#administracion_accion_cierre').show();
            //Ocultar boton descargar expediente unificado
            $("#btn-descargar-expediente-unificado").removeAttr('hidden');;
            break;
        case 'No Autenticado':
            /* Menu superior */
            $('#menu_accesibilidad').hide();
            $('#menu_notificaciones').hide();
            $('#menu_salir').hide();
            /* Opciones de pestañas */
            $('#btn_sheet_record').show(); //Siempre on
            $('#btn_sheet_litigant').show(); //Siempre on
            $('#btn_sheet_admin').hide();
            /* Opciones sobre expediente */
            $('#btn_agregar_cuaderno').hide();
            $('#btn_agregar_documento').hide();
            $('#btn_copiar_link_documento').hide();
            $('#btn_descargar_asiento').hide();
            $('#acciones_asiento').hide();
            $('#panel_relacionados').hide(); //Siempre off
            $('#panel_custodias').hide(); //Siempre off
            $('#panel_notificaciones').show();
            $('#panel_patrocinadores').show();
            $('#hacerseParte_ingresarEscrito_ingresarCertificacion').hide();
            //$('#btn-hacerse-parte').show(); //Se configura en funcion cargarHacerseParte
            //$('#btn-ingresar-escrito').hide(); //Se configura en funcion cargarHacerseParte
            //$('#btn-ingresar-certificacion').hide();
            /* Opciones del administrador */
            $('#administracion_general').hide();
            $('#administracion_antecedentes_adicionales').hide();
            $('#administracion_accion_cierre').hide();
            $("#btn-descargar-expediente-unificado").attr("hidden", true);
            break;
        default:
            /* Menu superior */
            $('#menu_accesibilidad').hide();
            $('#menu_notificaciones').hide();
            $('#menu_salir').hide();
            /* Opciones de pestañas */
            $('#btn_sheet_record').show(); //Siempre on
            $('#btn_sheet_litigant').show(); //Siempre on
            $('#btn_sheet_admin').hide();
            /* Opciones sobre expediente */
            $('#btn_agregar_cuaderno').hide();
            $('#btn_agregar_documento').hide();
            $('#btn_copiar_link_documento').hide();
            $('#btn_descargar_asiento').hide();
            $('#acciones_asiento').hide();
            $('#panel_relacionados').hide(); //Siempre off
            $('#panel_custodias').hide(); //Siempre off
            $('#panel_notificaciones').show();
            $('#panel_patrocinadores').show();
            $('#hacerseParte_ingresarEscrito_ingresarCertificacion').hide();
            //$('#btn-hacerse-parte').show(); //Se configura en funcion cargarHacerseParte
            //$('#btn-ingresar-escrito').hide(); //Se configura en funcion cargarHacerseParte
            //$('#btn-ingresar-certificacion').hide();
            /* Opciones del administrador */
            $('#administracion_general').hide();
            $('#administracion_antecedentes_adicionales').hide();
            $('#administracion_accion_cierre').hide();
    }
}

function cargarArchivos(obj) {
    var tipoDocumento = $(obj).attr('tipo');

    var form = new FormData();
    form.append("tipo", tipoDocumento);
    for (let x = 0; x < $(obj)[0].files.length; x++) {

        let size = $(obj)[0].files[x].size;
        if(size > (1000 * 1024 * 1024)) {
            Swal.fire({
                icon: 'error',
                title: 'El tamaño de archivo no debe superar los 1000MB',
                text: '',
                confirmButtonText: 'OK'
            });
            return;
        }

        form.append("file", $(obj)[0].files[x]);
    }

    fetch(thisWS + "/servlet/upload-multi-file", {
            method: 'POST',
            body: form
        })
        .then((response) => response.text())
        .then(function(text) {
            var data = $.parseJSON(text)
            if (data.status === "200") {
                var response = $.parseJSON(data.response);
                $.each(response, function(index, element) {
                    //Agregar uuid a formulario
                    $('#box-archivos').append('<input type="hidden" name="listaArchivos" value="' + element.uuid + '">');
                });

                //Mensaje éxito
                Swal.fire({
                    icon: 'success',
                    title: 'Archivo cargado correctamente',
                    confirmButtonText: 'OK',
                }).then((result) => {
                    if (result.isConfirmed) {
                        $(this).prop('disabled', true);
                        //document.location.reload();
                    }
                })
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema inesperado en la respuesta del servlet. Reintente más tarde.',
                    confirmButtonText: 'Entiendo'
                });
            }
        })
        .catch(function(err) {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servlet. Reintente más tarde.',
                confirmButtonText: 'Entiendo'
            });
        });
}

//Agregar cuaderno
function guardarNuevoCuaderno() {
    var rol = $("#p_rolCausa").val();
    var tipoCuaderno = $("#p-tipo-cuaderno option:selected").val();
    var nombreCuaderno = $("#p-nombre-cuaderno").val();

    if(rol.length == 0 || nombreCuaderno.length == 0 || tipoCuaderno.length == 0){
        Swal.fire({
            icon: 'error',
            title: '¡Lo sentimos!',
            text: 'Debe ingresar la información del cuaderno. (DTC-A01)',
            confirmButtonText: 'Entiendo'
        });
    }else{
        $.ajax({
            type: "GET",
            url: thisWS + "/ver-causa/carga-cuaderno?rol=" + rol + "&nombre=" + nombreCuaderno + "&tipo=" + tipoCuaderno,
            contentType: "application/json; charset=ISO-8859-1",
            dataType: "json",
            beforeSend: function() {
                //Ocultar modal
                $("#modal-addCuaderno").toggleClass("active");
                $("body").toggleClass("blocked");

                //Activa loader
                $('#body').addClass('be-loading-active');
            },
            success: function(data) {
                if (data.status === "200") {
                    //var response = $.parseJSON(data.response);
                    //Mostrar resultado
                    Swal.fire({
                        icon: 'success',
                        title: 'Datos guardados exitosamente',
                        confirmButtonText: 'OK',
                    }).then((result) => {
                        if (result.isConfirmed) {
                            //Recargar pagina
                            document.location.reload();
                        }
                    })
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: '¡Lo sentimos!',
                        text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B01)',
                        confirmButtonText: 'Entiendo'
                    });
                }
            },
            error: function() {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-C01)',
                    confirmButtonText: 'Entiendo'
                });
            },
            complete: function() {
                //Desactiva loader
                $('#body').removeClass('be-loading-active');
            }
        });
    }
}

//Seleccionar cuaderno
function cargarSeleccionCuaderno() {
    var idCausa = $("#p_idCausa").val();
    var codTipoCausa = $("#p_codTipoCausa").val();
    var idCuaderno = $("#p_listaCuadernos option:selected").val();

    //Cargar cuaderno activo
    $("#p_idCuaderno").val(idCuaderno);

    //Cargar asientos del cuaderno
    cargaAsientoCuaderno(idCuaderno, 'all');

    //Carga tren de estados
    cargaEstadosCausa(idCausa, codTipoCausa, idCuaderno);
}

//Agregar subtipo de documento
function cargarSubtipoDocumento() {
    var tipoDocumento = $("#p_tipoDocumentoLv2 option:selected").val();
    cargaSubtipoDocumentos(tipoDocumento);
}

function accionesAsiento() {
    var accion = $("#acciones_asiento option:selected").val();

    //Accion foliar (Se suma a la accion de publicar)
    if (accion == 'foliar') {
        Swal.fire({
            icon: 'question',
            title: 'Foliar Asiento',
            text: '¿Esta seguro que desea foliar el asiento seleccionado?',
            confirmButtonText: 'Foliar',
            showDenyButton: true,
            denyButtonText: 'Cancelar'
        }).then((result) => {
            if (result.isConfirmed) {
                var codAsiento = $("#p_idAsiento").val();
                folearAsiento(codAsiento);
            } else if (result.isDenied) {
                /*Swal.fire({
                    icon: 'info',
                    title: '',
                    text: 'No se folia el documento',
                    confirmButtonText: 'OK'
                });*/
            }
        });
    }
    //Accion refoliar
    if (accion == 'refoliar') {
        Swal.fire({
            icon: 'question',
            title: 'Foliar Documento',
            text: '¿Esta seguro que desea foliar el documento seleccionado?',
            confirmButtonText: 'Foliar',
            showDenyButton: true,
            denyButtonText: 'Cancelar'
        }).then((result) => {
            if (result.isConfirmed) {
                var codAsiento = $("#p_idAsiento").val();
                refolearDocumento(codAsiento);
            } else if (result.isDenied) {
                /*Swal.fire({
                    icon: 'info',
                    title: '',
                    text: 'No se folia el documento',
                    confirmButtonText: 'OK'
                });*/
            }
        });
    }
    //Accion requerir firma
    if (accion == 'firmar') {
        var habilitado = $("#p_documentoHabilitadoFirma").val();
        if(habilitado == 'false'){
            Swal.fire({
                icon: 'info',
                title: 'No se puede firmar',
                text: 'El documento debe estar foliado',
                confirmButtonText: 'Entiendo'
            });
            return;
        }

        Swal.fire({
            icon: 'question',
            title: 'Firmar Documento',
            text: '¿Esta seguro que desea solicitar la firma del documento seleccionado?',
            confirmButtonText: 'Requerir Firma',
            showDenyButton: true,
            denyButtonText: 'Cancelar'
        }).then((result) => {
            if (result.isConfirmed) {
                var idAsiento = $("#p_idAsiento").val();
                $.ajax({
                    type: "GET",
                    url: thisWS + "/ver-causa/consulta-firma-asiento?idAsiento=" + idAsiento,
                    contentType: "application/json; charset=ISO-8859-1",
                    dataType: "json",
                    success: function(data) {
                        if (data.status === "200") {
                            var response = $.parseJSON(data.response);
                            if(response.firmaAsiento.valor == "false"){
                                //Limpiar box y modal
                                $("#box-firmantes").empty();
                                $("#table_modal_firmantes tbody").empty();

                                $('#paginas-doc-firma').val(response.pagesAsiento.valor);

                                //Cargar Select
                                listaFirmantes();
                                //Mostrar modal
                                $("#modal-requerirFirma").toggleClass("active");
                            }else{
                                Swal.fire({
                                    icon: 'error',
                                    title: '',
                                    text: 'El documento (' + response.clave + ') seleccionado ya tiene una solicitud de firma en curso',
                                    confirmButtonText: 'OK'
                                });
                            }
                        } else {
                            Swal.fire({
                                icon: 'error',
                                title: '',
                                text: 'Ocurrio un error validando las firmas del documento. Intente mas tarde',
                                confirmButtonText: 'OK'
                            });
                        }
                    },
                    error: function() {
                        Swal.fire({
                            icon: 'error',
                            title: '',
                            text: 'Ocurrio un error inesperado validando las firmas del documento. Intente mas tarde',
                            confirmButtonText: 'OK'
                        });
                    }
                });
            } else if (result.isDenied) {
                /*Swal.fire({
                    icon: 'info',
                    title: '',
                    text: 'No se folia el documento',
                    confirmButtonText: 'OK'
                });*/
            }
        });
    }
    //Accion publicar y notificar
    if (accion == 'publicarConNotificar') {
        Swal.fire({
            icon: 'question',
            title: 'Publicar Asiento',
            text: '¿Esta seguro que desea publicar el asiento seleccionado?',
            confirmButtonText: 'Publicar',
            showDenyButton: true,
            denyButtonText: 'Cancelar'
        }).then((result) => {
            if (result.isConfirmed) {
                var codAsiento = $("#p_idAsiento").val();
                var publicacion = $("#p_documentoPublicado").val();
                publicaDespublicaDocumento(codAsiento, publicacion, true);
            } else if (result.isDenied) {
                /*Swal.fire({
                    icon: 'info',
                    title: '',
                    text: 'No se publica el documento',
                    confirmButtonText: 'OK'
                });*/
            }
        });
    }
    //Accion publicar sin notificar
    if (accion == 'publicarSinNotificar') {
        Swal.fire({
            icon: 'question',
            title: 'Publicar Asiento',
            text: '¿Esta seguro que desea publicar el asiento seleccionado?',
            confirmButtonText: 'Publicar',
            showDenyButton: true,
            denyButtonText: 'Cancelar'
        }).then((result) => {
            if (result.isConfirmed) {
                var codAsiento = $("#p_idAsiento").val();
                var publicacion = $("#p_documentoPublicado").val();
                publicaDespublicaDocumento(codAsiento, publicacion, false);
            } else if (result.isDenied) {
                /*Swal.fire({
                    icon: 'info',
                    title: '',
                    text: 'No se publica el documento',
                    confirmButtonText: 'OK'
                });*/
            }
        });
    }
    //Accion despublicar
    if (accion == 'despublicar') {
        Swal.fire({
            icon: 'question',
            title: 'Publicar Documento',
            text: '¿Esta seguro que desea despublicar el asiento seleccionado?',
            confirmButtonText: 'Despublicar',
            showDenyButton: true,
            denyButtonText: 'Cancelar'
        }).then((result) => {
            if (result.isConfirmed) {
                var codDocumento = $("#p_idAsiento").val();
                var publicacion = $("#p_documentoPublicado").val();
                publicaDespublicaDocumento(codDocumento, publicacion, false);
            } else if (result.isDenied) {
                /*Swal.fire({
                    icon: 'info',
                    title: '',
                    text: 'No se despublica el documento',
                    confirmButtonText: 'OK'
                });*/
            }
        });
    }
    //Accion descarga_foliado
    if (accion == 'descarga_foliado') {
        Swal.fire({
            icon: 'question',
            title: 'Descargar Documento Foliado',
            text: '¿Esta seguro que desea descargar el asiento seleccionado?',
            confirmButtonText: 'Descargar',
            showDenyButton: true,
            denyButtonText: 'Cancelar'
        }).then((result) => {
            if (result.isConfirmed) {
                var filename = $("#p_linkDocumentoFoleado").val();
                var element = document.createElement('a');
                element.setAttribute('href', 'data:application/pdf;charset=utf-8');
                element.setAttribute('download', filename);
                document.body.appendChild(element);
                element.click();
            } else if (result.isDenied) {
                /*Swal.fire({
                    icon: 'info',
                    title: '',
                    text: 'No se descarga el documento',
                    confirmButtonText: 'OK'
                });*/
            }
        });
    }
    //Accion descarga_original
    if (accion == 'descarga_original') {
        Swal.fire({
            icon: 'question',
            title: 'Descargar Documento Original',
            text: '¿Esta seguro que desea descargar el asiento seleccionado?',
            confirmButtonText: 'Descargar',
            showDenyButton: true,
            denyButtonText: 'Cancelar'
        }).then((result) => {
            if (result.isConfirmed) {
                var filename = $("#p_linkDocumentoOriginal").val();
                var element = document.createElement('a');
                element.setAttribute('href', 'data:application/pdf;charset=utf-8');
                element.setAttribute('download', filename);
                document.body.appendChild(element);
                element.click();
            } else if (result.isDenied) {
                /*Swal.fire({
                    icon: 'info',
                    title: '',
                    text: 'No se descarga el documento',
                    confirmButtonText: 'OK'
                });*/
            }
        });
    }
}

function cargaDatosCausa(rolCausa) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/carga-datos-causa?rolCausa=" + rolCausa,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);
                $("#p_idCausa").val(response.idCausa);
                $("#p_tipoCausa").val(response.tipoCausa);
                $("#p_codTipoCausa").val(response.codTipoCausa);

                //Define titulos a litigantes
                if (response.tipoCausa == 'Reclamación') {
                    $("#p_litigantes_titulo1").html('Reclamante');
                    $("#p_litigantes_subtitulo1").html('Abogado Reclamante:');
                    $("#p_litigantes_titulo2").html('Reclamado');
                    $("#p_litigantes_subtitulo2").html('Abogado Reclamado:');
                } else if (response.tipoCausa == 'Demanda' || response.tipoCausa == 'Demanda Ejecutiva') {
                    $("#p_litigantes_titulo1").html('Demandante');
                    $("#p_litigantes_subtitulo1").html('Abogado Demandante:');
                    $("#p_litigantes_titulo2").html('Demandado');
                    $("#p_litigantes_subtitulo2").html('Abogado Demandado:');
                } else if (response.tipoCausa == 'Solicitud') {
                    $("#p_litigantes_titulo1").html('Solicitante');
                    $("#p_litigantes_subtitulo1").html('Abogado Solicitante:');
                    $("#p_litigantes_titulo2").html('Solicitado');
                    $("#p_litigantes_subtitulo2").html('Abogado Solicitado:');
                } else {
                    $("#p_litigantes_titulo1").html('Otros');
                    $("#p_litigantes_subtitulo1").html('Otros');
                    $("#p_litigantes_titulo2").html('Otros');
                    $("#p_litigantes_subtitulo2").html('Otros');
                }

                //Estado de cierre solo para demanda ejecutiva
                if(response.tipoCausa == 'Demanda Ejecutiva'){
                    $("#boxDemandaEjecutiva").show();
                }

                //Información de causa
                $("#lbl-caratulaCausa").html(response.caratulaCausa);
                $("#lbl-tipoCausa").html("Tipo: " + response.tipoCausa);
                $("#lbl-rolCausa").html("Rol: " + response.rolCausa);

                //Edición de caratula
                $("#p_caratulaCausa").val(response.caratulaCausa);

                //Carga todo el formulario
                //cargaRelatorCausa(response.idCausa);
                cargaMinistroCausa(response.idCausa);
                cargaEstadosCausa(response.idCausa, response.codTipoCausa, null); //Carga por defecto el cuaderno principal
                cargaCuadernosCausa(response.idCausa);
                cargaDocumentosSalidasCausa(response.idCausa);
                cargaDocumentosAudiencias(response.idCausa);
                cargaSalidasCausa(response.idCausa)
                cargaTipoDocumento();
                cargaInputAntecedentesAdicionales(response.codTipoCausa, response.idCausa);
                //Administracion
                obtenerListaCausasPadre(response.rolCausa);
                obtenerListaCausasAcumuladas(response.idCausa);
                cargaListaCausasPadre(response.idCausa);
                listaParticipantes(response.idCausa);

                if (response.fechaEmplazamiento) {
                    $('#tabla-emplazamiento tbody').append(
                        '<tr role="row">' +
                        '<td><span class="dark">' + response.fechaEmplazamiento + '</span></td>' +
                        //'<td><a href="javascript:void(0)"  onclick="quitarEmplazamiento(this)">Eliminar</a></td>' +
                        '<td></td>' +
                        '</tr>'
                    )
                    $('#div-agregar-emplazamiento').hide();
                }
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B03)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A03)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function cargaRelatorCausa(idCausa) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-relatores-causa?idCausa=" + idCausa,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);
                $.each(response, function(index, element) {
                    if (index == 0) {
                        $("#lbl-relator").html("Relator: " + element.valor);
                    } else {
                        $("#lbl-relator").html(", " + element.valor);
                    }
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B04)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A04)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function cargaMinistroCausa(idCausa) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-ministros-causa?idCausa=" + idCausa,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);

                $('#box-ministros').empty();
                $('#lbl-ministro').html('Ministros: ');
                $.each(response, function(index, element) {
                    if (index == 0) {
                        $('#lbl-ministro').append(
                            "<span>" + element.valor + "</span>"
                        );
                    } else {
                        $('#lbl-ministro').append(
                            ",<span>" + element.valor + "</span>"
                        );
                    }
                    $('#box-ministros').append('<input type="hidden" name="listaMinistros" value="' + element.clave + '">');
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B05)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A05)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            cargaAdministracionMinistros(idCausa);
            $('#body').removeClass('be-loading-active');
        }
    });
}

//El tren de estados
function cargaEstadosCausa(idCausa, codTipoCausa, idCuaderno) {
    //alert(thisWS + "/ver-causa/lista-estados-causa?idCausa=" + idCausa + "&idCuaderno=" + idCuaderno)
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-estados-causa?idCausa=" + idCausa + "&idCuaderno=" + idCuaderno,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                if(data.message.includes('false')){ //false: causa no migrada
                    var response = $.parseJSON(data.response);

                    //Limpiar tren de estados
                    $('#box-estados').empty();

                    //Setear maximo de estados por tipo de causa
                    switch (codTipoCausa) {
                        case '1': /*Demanda*/
                            var maxEstados = 6;
                            break;
                        case '2': /*Reclamación*/
                            var maxEstados = 6;
                            break;
                        case '3': /*Solicitud*/
                            var maxEstados = 5;
                            break;
                        case '4': /*Consulta*/
                            var maxEstados = 5;
                            break;
                        case '5': /*Otros*/
                            var maxEstados = 10;
                            break;
                        case '6': /*Exhorto*/
                            var maxEstados = 5;
                            break;
                        case '7': /*Demanda Ejecutiva*/
                            var maxEstados = 5;
                            break;
                        default:
                            //Tipo de causa no reconocido
                    }

                    //Mostrar estados de la causa no finales
                    var nroEstados = 0;
                    $.each(response, function(index, element) {
                        if(element.tipoEstadoCausa != 'Terminada' && element.tipoEstadoCausa != 'Archivada' && element.tipoEstadoCausa != 'Suspendida' && element.tipoEstadoCausa != 'En conciliación'){
                            var datos = '';
                            if (element.documentoEstadoCausa != undefined) {
                                var listaDocumentosEnTramitacion = element.documentoEstadoCausa.split('&');

                                $.each(listaDocumentosEnTramitacion, function(index, element) {
                                    datos = datos + '<div class="suceso-doc">' +
                                                        '<div class="suceso-tooltip">' +
                                                            '<img src="assets/img/icon-doc-subway.svg">' +
                                                            '<span class="tooltiptext">' + element + '</span>' +
                                                        '</div>' +
                                                    '</div>';
                                });
                            }
                            $('#box-estados').append(
                                '<li class="active">' +
                                '<span class="suceso activo">' + datos + '</span>' +
                                '<span class="step hide-desktop">Paso<p>' + index + ' de ' + maxEstados + '</p></span>' +
                                '<span class="state">' + element.tipoEstadoCausa + '</span>' +
                                '<span class="date">' + element.fechaEstado + '</span>' +
                                '<span class="days">' + '</span>' +
                                '</li>'
                            );
                            nroEstados = index + 1;
                        }
                    });

                    //Mostrar estados futuros
                    if (nroEstados < maxEstados) {
                        for (indice = nroEstados + 1 ; indice <= maxEstados ; indice++) {
                            $('#box-estados').append(
                                '<li class="none">' +
                                '<span class="suceso">' + '</span>' +
                                '<span class="step hide-desktop">Paso<p>' + indice + ' de ' + maxEstados + '</p></span>' +
                                //'<span class="state">Ingreso</span>' +
                                '<span class="state">' + '</span>' +
                                '<span class="date">' + '</span>' +
                                '<span class="days">' + '</span>' +
                                '</li>');
                        }
                    }

                    //Mostrar estados de la causa finales
                    $.each(response, function(index, element) {
                        if(element.tipoEstadoCausa == 'Terminada' || element.tipoEstadoCausa == 'Archivada' || element.tipoEstadoCausa == 'Suspendida' || element.tipoEstadoCausa == 'En conciliación'){
                            var datos = '';
                            if (element.documentoEstadoCausa != undefined) {
                                var listaDocumentosEnTramitacion = element.documentoEstadoCausa.split('&');

                                $.each(listaDocumentosEnTramitacion, function(index, element) {
                                    datos = datos + '<div class="suceso-doc">' +
                                                        '<div class="suceso-tooltip">' +
                                                            '<img src="assets/img/icon-doc-subway.svg">' +
                                                            '<span class="tooltiptext">' + element + '</span>' +
                                                        '</div>' +
                                                    '</div>';
                                });
                            }
                            
                            switch (element.tipoEstadoCausa) {
                                case 'Terminada':
                                    var classTermino = 'finished';
                                    break;
                                case 'Archivada':
                                    var classTermino = 'archived';
                                    break;
                                case 'Suspendida':
                                    var classTermino = 'suspended';
                                    break;
                                case 'En conciliación':
                                    var classTermino = 'conciliation';
                                    break;
                                default:
                            }

                            $('#box-estados').append(
                                '<li class="' + classTermino + '">' +
                                '<span class="suceso activo">' + datos + '</span>' +
                                '<span class="step hide-desktop">Paso<p>' + index + ' de ' + maxEstados + '</p></span>' +
                                '<span class="state">' + element.tipoEstadoCausa + '</span>' +
                                '<span class="date">' + element.fechaEstado + '</span>' +
                                '<span class="days">' + '</span>' +
                                '</li>'
                            );
                        }
                    });
                }
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B06)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A06)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

async function cargaCuadernosCausa(idCausa) {
    let docEntrada = $("#p_docEntrada").val();
    let idCuaderno = "null";

    // Intentar obtener el idCuaderno si docEntrada no es "null"
    if (docEntrada !== "null") {
        try {
            idCuaderno = await getIdCuadernoDoc(docEntrada);
        } catch (error) {
            console.error(error);
            return; // Detiene la ejecución si falla la llamada
        }
    }
    // Ejecutar la solicitud AJAX para cargar la lista de cuadernos
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-cuadernos-causa?idCausa=" + idCausa,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function () {
            // Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function (data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);
                $.each(response, function (index, element) {
                    $('#p_listaCuadernos').append(
                        $('<option>', {value: element.clave, text: element.valor})
                    );

                    // Determinar el cuaderno seleccionado
                    if ((idCuaderno !== "null" && idCuaderno == element.clave) || (idCuaderno === "null" && index == 0)) {
                        // Agregar cuaderno seleccionado
                        $("#p_listaCuadernos option[value=" + element.clave + "]").attr("selected", true);
                        // Guardar cuaderno activo
                        $('#p_idCuaderno').val(element.clave);
                        // Cargar lista de asientos
                        cargaAsientoCuaderno(element.clave, 'all');
                    }
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B07)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function () {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A07)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function () {
            // Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function cargaTipoDocumento() {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-tipo-documento",
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);
                $("#p_listaDocumentos").empty().append(
                    $('<option>', { value: "null", text: "Todos" })
                );
                $('#p_listaDocumentos').append(
                    $('<option>', { value: "all", text: "Todos" })
                );
                $.each(response, function(index, element) {
                    $('#p_listaDocumentos').append(
                        $('<option>', { value: element.clave, text: element.valor })
                    );
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B08)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A08)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

//Carga Asientos
function cargaAsientoCuaderno(idCuaderno, tipoDocumento) {
    //var token = Cookies.get('token');
    var idUsuario = $('#p_idUsuario').val();
    var rolUsuario = $('#p_rolUsuario').val();
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-asiento-cuaderno?idCuaderno=" + idCuaderno + "&tipoDocumento=" + tipoDocumento + "&idUsuario=" + idUsuario + "&rolUsuario=" + rolUsuario,
        //headers: { token: token },
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                //Limpiar box
                $('#box-asiento').empty();
                $('#box-documentos').empty();

                //Listar asientos
                var response = $.parseJSON(data.response);
                $.each(response, function(index, element) {
                    //Iconos de asientos
                    if (element.codTipoDocumento == 1 && element.publicacionDocumento == true) { //1 Escritos
                        var icono = "icon-doc-Everde.svg";
                    } else if (element.codTipoDocumento == 1 && element.publicacionDocumento == false) {
                        var icono = "icon-doc-Egris.svg";
                    } else if (element.codTipoDocumento == 2 && element.publicacionDocumento == true) { //2 Certificaciones
                        var icono = "icon-doc-Ccian.svg";
                    } else if (element.codTipoDocumento == 2 && element.publicacionDocumento == false) {
                        var icono = "icon-doc-Cgris.svg";
                    } else if (element.codTipoDocumento == 3 && element.publicacionDocumento == true) { //3 Resoluciones
                        var icono = "icon-doc-Rvioleta.svg";
                    } else if (element.codTipoDocumento == 3 && element.publicacionDocumento == false) {
                        var icono = "icon-doc-Rgris.svg";
                    } else if (element.codTipoDocumento == 4 && element.publicacionDocumento == true) { //4 Actuaciones
                        var icono = "icon-doc-Aamarillo.svg";
                    } else if (element.codTipoDocumento == 4 && element.publicacionDocumento == false) {
                        var icono = "icon-doc-Agris.svg";
                    } else if (element.codTipoDocumento == 5 && element.publicacionDocumento == true) { //5 Sentencias
                        var icono = "icon-doc-Sazul.svg";
                    } else if (element.codTipoDocumento == 5 && element.publicacionDocumento == false) {
                        var icono = "icon-doc-Sgris.svg";
                    } else if (element.codTipoDocumento == 6 && element.publicacionDocumento == true) { //6 Notificaciones
                        var icono = "icon-doc-Nverde.svg";
                    } else if (element.codTipoDocumento == 6 && element.publicacionDocumento == false) {
                        var icono = "icon-doc-Ngris.svg";
                    } else if (element.codTipoDocumento == 7 && element.publicacionDocumento == true) { //7 Conciliaciones
                        var icono = "icon-doc-CCrojo.svg";
                    } else if (element.codTipoDocumento == 7 && element.publicacionDocumento == false) {
                        var icono = "icon-doc-CCgris.svg";
                    } else {
                        var icono = "icon-doc.svg";
                    }

                    var docEntrada = $("#p_docEntrada").val();
                    var adjuntoEntrada = $("#p_adjuntoEntrada").val();
                    if (docEntrada == 'null') {
                        //Generar objeto asiento por defecto
                        $('#box-asiento').append(
                            $("<div>", {
                                'name': 'asientos-causa',
                                'id': 'asiento' + (index + 1),
                                'class': 'doc ' + (index == 0 ? 'active' : ''),
                                'codigoAsiento': element.codAsiento,
                                'codigoDocumento': element.codDocumento,
                                'onclick': 'seleccionAsiento(this)'
                            }).append(
                                '<img src="assets/img/' + icono + '">' +
                                '<div class="doc-content">' +
                                '<div class="title">' +
                                '<h6>' + element.tipoDocumento2 + '</h6>' +
                                '<a><img src="assets/img/icon-options-white.svg"></a>' +
                                '</div>' +

                                (element.tipoDocumento == 'Escritos' ? '<p><span class="tipo-doc">Ingresada por: ' + (element.rolCreadorDocumento == undefined ? '' : element.rolCreadorDocumento) + '</span><span class="date">' + element.fechaDocumento + '</span></p>' : '<p><span class="date">' + element.fechaDocumento + '</span></p>') +

                                //'<p><span class="tipo-doc">Ingresada por' + 'Rol Judicial' + '</span><span class="date">' + element.fechaDocumento + '</span></p>' +
                                //'<p><span class="date">' + element.fechaDocumento + '</span></p>' +
                                //'<p><span class="tipo-doc">' + element.tipoDocumento + '</span><span class="date">' + element.fechaDocumento + ' ' + element.horaDocumento + '</span></p>' +
                                
                                '<p>' +

                                //(element.resuelveDocumento == undefined ? '<span class="glosa">&nbsp</span>' : '<span class="glosa">Resuelve a: ' + element.resuelveDocumento + '</span>') +

                                //'<span class="glosa">Resuelve a: ' + (element.resuelveDocumento == undefined ? '' : element.resuelveDocumento) + '</span>' +
                                
                                '<span class="fojas-num">Fojas: <span class="inicio">' + (element.fojasDocumento == undefined ? '' : element.fojasDocumento) + '</span>' +
                                '</p>' +
                                //'<p><span class="glosa">Resuelve a: '+element.resuelveAsiento+'</span><span class="fojas-num">Fojas: <span class="inicio">'+element.fojasAsiento+'</span>...<span class="fin">'+element.fojasAsiento+'</span></span></p>' + 
                                '</div>'
                            )
                        );
                        //Cargar documentos por defecto
                        if (index == 0) {
                            //Guarga cuaderno activo
                            $('#p_idAsiento').val(element.codAsiento);
                            //Cargar Documentos del asiento
                            cargaDocumentosAsiento(element.codAsiento);

                            //Carga listas de documentos relacionados, custodiados y notificados
                            listaDocumentosResueltos(element.codDocumento);
                            //listaDocumentosCustodiados(element.codDocumento);
                            listaNotificacionesAsiento(element.codAsiento);
                            listaPatrocinadoresAsiento(element.codAsiento);
                        }
                    } else {
                        //Generar objeto asiento por documento
                        $('#box-asiento').append(
                            $("<div>", {
                                'name': 'asientos-causa',
                                'id': 'asiento' + (index + 1),
                                'class': 'doc ' + (element.codDocumento == docEntrada? 'active' : ''),
                                'codigoAsiento': element.codAsiento,
                                'codigoDocumento': element.codDocumento,
                                'onclick': 'seleccionAsiento(this)'
                            }).append(
                                '<img src="assets/img/' + icono + '">' +
                                '<div class="doc-content">' +
                                '<div class="title">' +
                                '<h6>' + element.tipoDocumento2 + '</h6>' +
                                '<a><img src="assets/img/icon-options-white.svg"></a>' +
                                '</div>' +
                                '<p><span class="tipo-doc">' + element.tipoDocumento + '</span><span class="date">' + element.fechaDocumento + '</span></p>' +
                                '<p><span class="glosa"></span><span class="fojas-num">Fojas: <span class="inicio">' + (element.fojasDocumento == undefined ? '' : element.fojasDocumento) + '</span></span></p>' +
                                //'<p><span class="glosa">Resuelve a: '+element.resuelveAsiento+'</span><span class="fojas-num">Fojas: <span class="inicio">'+element.fojasAsiento+'</span>...<span class="fin">'+element.fojasAsiento+'</span></span></p>' + 
                                '</div>'
                            )
                        );
                        //Cargar documentos por documento
                        if (element.codDocumento === docEntrada) {
                            listaDocumentosResueltos(element.codDocumento);
                            //listaDocumentosCustodiados(element.codDocumento);
                            listaPatrocinadoresAsiento(element.codAsiento);
                            listaNotificacionesAsiento(element.codAsiento);
                            //Cargar Documentos del asiento
                            cargaDocumentosAsiento(element.codAsiento, adjuntoEntrada);
                        }
                    }
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B09)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A09)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function filtraAsientoCuaderno() {
    var idCuaderno = $('#p_listaCuadernos').val();
    var tipoDocumento = $('#p_listaDocumentos').val();
    cargaAsientoCuaderno(idCuaderno, tipoDocumento);
}

function cargaDocumentosAsiento(asiento, adjuntoEntrada) {

    let token = Cookies.get('token');
    if(typeof token === "undefined"){
        token = "";
    }
    if(adjuntoEntrada !== undefined && adjuntoEntrada !== 'null') {
        $('#p_idAdjunto').val(adjuntoEntrada);
    }
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-documento-asiento?token="+token+"&asiento=" + asiento,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                //Limpiar box y visualizador de archivos
                $('#box-documentos').empty();
                showPDF('');


                //Listar asientos
                var response = $.parseJSON(data.response);
                $.each(response, function(index, element) {
                    let extension = element.linkOriginal.split('.').pop();
                    let fojaInicial = (element.fojaInicial == undefined ? '' : element.fojaInicial);
                    let imgStyle ='width: 25px; height: 25px';
                    var icon = (element.tipoArchivo == 'documento' ? 'assets/img/icon-doc.svg' : element.estadoCustodia == '0' ? 'assets/img/icon-doc-attached.svg' : element.estadoCustodia == '1' ? 'assets/img/icon-doc-attached-amarillo.svg' : element.estadoCustodia == '2' ? 'assets/img/icon-doc-attached-rojo.svg' : 'assets/img/icon-doc-attached-verde.svg');
                    if(extension !== 'pdf' && extension !== 'PDF') {
                        if(extension == 'mp4')
                            icon = 'assets/img/icon-youtube-white.svg';
                        else if(extension == 'kmz' || extension == 'kml')
                            icon = 'assets/img/icon-map-white.svg';
                        else
                            icon = 'assets/img/file-box.svg';
                        fojaInicial = extension.toUpperCase();
                        imgStyle ='width: 17px; height: 17px;margin-left: 5px;';
                    }

                    $('#box-documentos').append(
                        $("<div>", {
                            'name': 'documentos-causa',
                            'id': 'documento' + (index + 1),
                            'class': 'doc-foja ' + (index == 0 ? 'main-doc' : ''),
                            'title': element.nombreDocumento,
                            //Datos del documento
                            'codDocumento': element.codDocumento,
                            'tipoDocumento': element.tipoDocumento,
                            'nombreDocumento': element.nombreDocumento,
                            'linkOriginal': element.linkOriginal,
                            'linkFoleado': element.linkFoleado,
                            'linkFirmando': element.linkFirmando,
                            'fechaDocumento': element.fechaDocumento,
                            'horaDocumento': element.horaDocumento,
                            'fojaInicial': element.fojaInicial,
                            'fojaFinal': element.fojaFinal,
                            'publicado': element.publicado,
                            'firmado': element.firmado,
                            'onclick': 'accionesDocumentos(this)'
                        }).append(
                            '<div class="doc-view ' + ((adjuntoEntrada && adjuntoEntrada !== "null" && adjuntoEntrada === element.codDocumento) || ((adjuntoEntrada === "null" || !adjuntoEntrada) && index == 0) ? 'selected' : '') +'">' +
                            '<img src="' + icon + '" style="' + imgStyle +'"> ' +
                            '<span>' + fojaInicial + '</span>' +
                            '</div>',
                            ((
                                    $("#p_rolUsuario").val() == 'Administrador'
                                    || $("#p_rolUsuario").val() == 'Oficial'
                                    || $("#p_rolUsuario").val() == 'Pasante judicial'
                                )
                                && element.tipoArchivo == 'adjunto') ?
                            '<div>' +
                                
                                '<div class="dropdown">' +
                                '<a onclick="" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false"><img src="assets/img/icon-options.svg" style="padding-bottom:5px;"></a>' +
                                '<div class="dropdown-menu" aria-labelledby="dropdownMenuButton">' +
                                (element.estadoCustodia != '0' ? '<a class="dropdown-item" href="javascript:void(0);" idAdjunto="' + element.codDocumento + '" onclick="event.preventDefault();cambiaEstadoAdjunto(this)">Reserva</a>' : '') +
                                '<a class="dropdown-item" href="javascript:void(0);" idAdjunto="' + element.codDocumento + '" estadoCustodia="' + element.estadoCustodia + '" onclick="event.preventDefault();reservaInterna(this)">' + (element.estadoCustodia == '4' ? 'Quitar reserva interna' : 'Reserva interna') + '</a>' +
                                '</div>' +
                                '</div>' +
                            '</div>' : ''
                        )
                    );

                    if ((adjuntoEntrada !== undefined && adjuntoEntrada !== "null" && adjuntoEntrada === element.codDocumento) ||
                        ((adjuntoEntrada === undefined || adjuntoEntrada === "null") && index === 0)) {
                        if (element.linkFirmando != undefined) {
                            showPDF(element.linkFirmando);
                            $("#p_documentoHabilitadoFirma").val("true");
                        } else if (element.linkFoleado != undefined) {
                            showPDF(element.linkFoleado);
                            $("#p_documentoHabilitadoFirma").val("true");
                        } else if (element.linkOriginal != undefined) {
                            showPDF( element.linkOriginal);
                            $("#p_documentoHabilitadoFirma").val("false");
                        } else {
                            $("#p_documentoHabilitadoFirma").val("false");
                        }

                        //Guardamos datos del documento en vista
                        $("#p_idDocumento").val(element.codDocumento);
                        $("#p_linkDocumentoOriginal").val(element.linkOriginal);
                        $("#p_linkDocumentoFoleado").val(element.linkFoleado);
                        $("#p_linkDocumentoFirmado").val(element.linkFirmando);
                        $("#p_documentoPublicado").val(element.publicado);
                        $("#p_documentoFirmado").val(element.firmado);

                        //Activar Publica/Despublica
                        if (element.publicado == true) {
                            $("#acciones-asiento option[value=publicarConNotificar]").hide();
                            $("#acciones-asiento option[value=publicarSinNotificar]").hide();
                            $("#acciones-asiento option[value=despublicar]").show();
                        } else {
                            $("#acciones-asiento option[value=publicarConNotificar]").show();
                            $("#acciones-asiento option[value=publicarSinNotificar]").show();
                            $("#acciones-asiento option[value=despublicar]").hide();
                        }
                    }
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B10)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A10)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });

}
function fetchSignedUrl(filePath) {


    let prefixToRemove = "/data/";
    let result = filePath.replace(prefixToRemove, "");
    return $.getJSON(`${thisWS}/servlet/generate-signed-url?file=${result}`);
}

function showPDF(link) {
    let isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if(link !== '') {
       // if (link.toLowerCase().endsWith('.pdf')) {
            if(isMobile) {
                // Configurar el worker de PDF.js
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.9.359/pdf.worker.min.js';

                // URL del PDF
                let pdfUrl = thisViewerFileWS + link + "&embedded=true";

                // Cargar el PDF usando PDF.js
                pdfjsLib.getDocument(pdfUrl).promise.then(function (pdf) {
                    // Ocultar otros visores
                    $("#obj-visor-pdf").hide();
                    $("#obj-visor-pdf-iframe").hide();

                    // Mostrar el nuevo visor
                    $("#pdf-container").show();
                    $("#pdf-controls").show();

                    let currentPage = 1;
                    let numPages = pdf.numPages;

                    function renderPage(pageNum) {
                        pdf.getPage(pageNum).then(function (page) {
                            let viewport = page.getViewport({scale: 1});
                            let canvas = document.createElement('canvas');
                            let context = canvas.getContext('2d');

                            // Ajustar el ancho del canvas al ancho del contenedor
                            let containerWidth = $("#pdf-container").width();
                            let scale = containerWidth / viewport.width;

                            // Factor de oversampling para mejorar la calidad
                            let oversampleScale = 2;  // Puedes ajustar este valor según necesites

                            viewport = page.getViewport({scale: scale * oversampleScale});

                            canvas.width = viewport.width;
                            canvas.height = viewport.height;

                            // Establecer el tamaño de visualización del canvas
                            canvas.style.width = containerWidth + "px";
                            canvas.style.height = (viewport.height / oversampleScale) + "px";

                            let renderContext = {
                                canvasContext: context,
                                viewport: viewport
                            };

                            let renderTask = page.render(renderContext);

                            renderTask.promise.then(function () {
                                $("#pdf-viewer").empty().append(canvas);
                                $("#page-num").text(currentPage);
                                $("#page-count").text(numPages);
                            });
                        });
                    }

                    renderPage(currentPage);

                    $("#prev-page").click(function() {
                        if (currentPage > 1) {
                            currentPage--;
                            renderPage(currentPage);
                        }
                    });

                    $("#next-page").click(function() {
                        if (currentPage < numPages) {
                            currentPage++;
                            renderPage(currentPage);
                        }
                    });
                }).catch(function (error) {
                    console.error('Error al cargar el PDF:', error);
                    // Fallback a la visualización anterior si hay un error
                    $("#obj-visor-pdf").attr("data", "");
                    $("#obj-visor-pdf").hide();
                    $("#obj-visor-pdf-iframe").show();
                    $("#obj-visor-pdf-iframe").attr({
                        "src": pdfUrl,
                        "allowfullscreen": "true",
                        "webkitallowfullscreen": "true",
                        "mozallowfullscreen": "true"
                    });
                });
            } else {
                // Lógica existente para dispositivos no móviles
                $("#obj-visor-pdf-iframe").attr("src", "");
                $("#obj-visor-pdf-iframe").hide();
                $("#obj-visor-pdf").attr("data",  thisViewerFileWS + link + "&embedded=true");
                $("#a-visor-pdf").attr("href",  thisViewerFileWS + link + "&embedded=true");
                $("#obj-visor-pdf").show();
            }
      /*  } else {
            // Lógica existente para archivos que no son PDF
            fetchSignedUrl(link).done(function (data) {
                const extension = link.split('.').pop().toLowerCase();

                if (extension === 'zip') {
                    const signedUrl = data.url;
                    window.open(signedUrl, '_blank');
                }else {
                    const signedUrl = data.url;
                    $("#obj-visor-pdf-iframe").attr("src", "");
                    $("#obj-visor-pdf-iframe").hide();
                    $("#obj-visor-pdf").attr("data", signedUrl);
                    $("#a-visor-pdf").attr("href", signedUrl);
                    $("#obj-visor-pdf").show();
                }

            }).fail(function () {
                alert("Error al obtener la URL firmada.");
            });
        }*/
    }
}

function cambiaEstadoAdjunto(elemento) {
    var idAdjunto = $(elemento).attr("idAdjunto");
    Swal.fire({
        icon: 'question',
        title: 'Reserva',
        text: '¿Cambiar estado a la reserva?',
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: 'Aprobar',
        denyButtonText: `Rechazar`,
        cancelButtonText: `Cancelar`,
    }).then((result) => {
        let url = '';
        if (result.isConfirmed) {
            url = thisWS + "/ver-causa/cambia-estado-adjunto?idAdjunto=" + idAdjunto + "&tipoEstado=" + 2;
        } else if (result.isDenied) {
            url = thisWS + "/ver-causa/cambia-estado-adjunto?idAdjunto=" + idAdjunto + "&tipoEstado=" + 3;
        }
        if(url != '') {
            $.ajax({
                type: "GET",
                url: url,
                contentType: "application/json; charset=ISO-8859-1",
                dataType: "json",
                beforeSend: function () {
                    //Activa loader
                    $('#body').addClass('be-loading-active');
                },
                success: function (data) {
                    if (data.status === "200") {
                        Swal.fire({
                            icon: 'success',
                            title: 'Adjunto actualizado exitosamente',
                            confirmButtonText: 'OK',
                        }).then((result) => {
                            if (result.isConfirmed) {
                                //Cerrar alert
                            }
                        });
                    } else {
                        Swal.fire({
                            icon: 'error',
                            title: '¡Lo sentimos!',
                            text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B11)',
                            confirmButtonText: 'Entiendo'
                        });
                    }
                },
                error: function () {
                    Swal.fire({
                        icon: 'error',
                        title: '¡Lo sentimos!',
                        text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A11)',
                        confirmButtonText: 'Entiendo'
                    });
                },
                complete: function () {
                    //Desactiva loader
                    $('#body').removeClass('be-loading-active');
                }
            });
        }
    });
}


function reservaInterna(elemento) {
    var idAdjunto = $(elemento).attr("idAdjunto");
    var estadoCustodia = $(elemento).attr("estadoCustodia");
    var esReservaInterna = estadoCustodia == '4';
    
    Swal.fire({
        icon: 'question',
        title: esReservaInterna ? 'Quitar reserva interna' : 'Reserva Interna',
        text: esReservaInterna ? '¿Quieres que este adjunto no tenga reserva interna?' : '¿Quieres que este adjunto tenga reserva interna?',
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: 'Si',
        denyButtonText: `No`,
        cancelButtonText: `Cancelar`,
    }).then((result) => {
        let url = '';
        if (result.isConfirmed) {
            url = thisWS + "/ver-causa/cambia-estado-adjunto?idAdjunto=" + idAdjunto + "&tipoEstado=" + (esReservaInterna ? 0 : 4);
        } else if (result.isDenied) {
            url = thisWS + "/ver-causa/cambia-estado-adjunto?idAdjunto=" + idAdjunto + "&tipoEstado=" + (esReservaInterna ? 4 : 0);
        }
        if(url != '') {
            $.ajax({
                type: "GET",
                url: url,
                contentType: "application/json; charset=ISO-8859-1",
                dataType: "json",
                beforeSend: function () {
                    //Activa loader
                    $('#body').addClass('be-loading-active');
                },
                success: function (data) {
                    if (data.status === "200") {
                        Swal.fire({
                            icon: 'success',
                            title: 'Adjunto actualizado exitosamente',
                            confirmButtonText: 'OK',
                        }).then((result) => {
                            if (result.isConfirmed) {
                                //Cerrar alert
                            }
                        });
                    } else {
                        Swal.fire({
                            icon: 'error',
                            title: '¡Lo sentimos!',
                            text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B11)',
                            confirmButtonText: 'Entiendo'
                        });
                    }
                },
                error: function () {
                    Swal.fire({
                        icon: 'error',
                        title: '¡Lo sentimos!',
                        text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A11)',
                        confirmButtonText: 'Entiendo'
                    });
                },
                complete: function () {
                    //Desactiva loader
                    $('#body').removeClass('be-loading-active');
                }
            });
        }
    });
}

function cargaModalAgregarDocumentos(tipoDocumento) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-tipo-documento-lv2?tipoDocumento=" + tipoDocumento,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                //Listar asientos
                var response = $.parseJSON(data.response);
                $("#p_tipoDocumentoLv2").empty().append(
                    $('<option>', { value: "null", text: "" })
                );
                $.each(response, function(index, element) {
                    $('#p_tipoDocumentoLv2').append(
                        $('<option>', { value: element.clave, text: element.valor })
                    );
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B12)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A12)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function cargaSubtipoDocumentos(tipoDocumentoLv2) {
    ////////////////////////////////////////////////////////////////////////////////////////
    /*Crear lista de Escritos*/
    var rolCausa = $("#p_rolCausa").val();
    var tipoDocumentoLv1 = $('#p_listaDocumentos option:selected').val().trim();
    // Limpiar el select antes de evaluar la condición
    $("#p_escritoResuelve").empty().append(
        $('<option>', { value: "null", text: "" })
    );
    if (tipoDocumentoLv1 === "2" || tipoDocumentoLv1 === "3") {
        $.ajax({
            type: "GET",
            url: thisWS + "/ver-causa/lista-escritos-resolucion?rolCausa=" + rolCausa,
            contentType: "application/json; charset=ISO-8859-1",
            dataType: "json",
            beforeSend: function() {
                //Activa loader
                //$('#body').addClass('be-loading-active');
            },
            success: function(data) {
                if (data.status === "200") {
                    var response = $.parseJSON(data.response);
                    //Ver si hay datos
                    if (response.length > 0) {
                        $("#box-escritoResuelve").show();
                    }

                    //Listar escritos
                    $("#p_escritoResuelve").empty().append(
                        $('<option>', { value: "null", text: "" })
                    );
                    $.each(response, function(index, element) {
                        $('#p_escritoResuelve').append(
                            '<option value="' + element.codDocumento + '" fecha="' + element.fechaDocumento + '">' + element.nombreDocumento + (element.fojas != undefined ? " " + element.fojas : "") + '</option>'
                        );
                    });
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: '¡Lo sentimos!',
                        text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B13)',
                        confirmButtonText: 'Entiendo'
                    });
                }
            },
            error: function() {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A13)',
                    confirmButtonText: 'Entiendo'
                });
            },
            complete: function() {
                //Desactiva loader
                //$('#body').removeClass('be-loading-active');
            }
        });
    }
    ////////////////////////////////////////////////////////////////////////////////////////
    /*Rellenar lista tipo documento LV3*/
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-tipo-documento-lv3?tipoDocumento=" + tipoDocumentoLv2,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);
                //Ver si har datos
                if (response.length > 0) {
                    $("#box-subTipoDocumento").show();
                }

                //Listar asientos
                $("#p_tipoDocumentoLv3").empty().append(
                    $('<option>', { value: "null", text: "" })
                );
                $.each(response, function(index, element) {
                    $('#p_tipoDocumentoLv3').append(
                        $('<option>', { value: element.clave, text: element.valor })
                    );
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B14)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A14)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
    ////////////////////////////////////////////////////////////////////////////////////////
}

function agregarEscritoResolucion() {
    var escritoSeleccionado = $('#p_escritoResuelve option:selected');
    if (typeof  escritoSeleccionado.val() === 'undefined' || escritoSeleccionado.val() === 'null') {
        Swal.fire({
            icon: 'info',
            title: '¡Ups!',
            text: 'Debes seleccionar el escrito.',
            confirmButtonText: 'Entiendo'
        });
    } else {
        var codigoEscrito = escritoSeleccionado.val();
        var nombreEscrito = escritoSeleccionado.text();
        var fechaEscrito = escritoSeleccionado.attr('fecha');

        var htmlRow = '<tr>' +
            '<td class="cell-detail"><span class="cell-detail-description">' + codigoEscrito + '</span></td>' +
            '<td class="cell-detail"><span class="cell-detail-description">' + nombreEscrito + '</span></td>' +
            '<td class="cell-detail"><span class="cell-detail-description">' + fechaEscrito + '</span></td>' +
            '<td class="cell-detail"><a href="javascript:void(0)" data-codigo="' + codigoEscrito + '" onclick="quitarEscrito(this)">Eliminar</a></td>' +
            '</tr>';
        $('#tabla_escritosResolucion tbody').append(htmlRow);

        $('#box-escritos').append('<input type="hidden" name="listaEscritos" value="' + codigoEscrito + '">');
    }
}

function cargaModalCertificaciones() {
    cargaDocumentoCertificaciones();
    //cargaLitiganteCertificaciones();
}

function quitarEscrito(objeto) {
    let idCodigo = $(objeto).attr('data-codigo');
    $('input[name=listaEscritos][value='+ idCodigo+']').remove();
    $(objeto).parent().parent().remove();
}

function guardarModalCertificaciones() {
    var rolCausa = $("#p_rolCausa").val();
    var idCuaderno = $("#p_listaCuadernos option:selected").val();
    var creadorDocumento = $("#p_idUsuario").val();
    var tipoDocumentoLv2 = $('#p_lista-documento-certificacion option:selected').val();
    var nombreDocumento = $('#p_lista-documento-certificacion option:selected').text();
    //var idLitiganteCertificacion = $('#p_lista-litigantes-certificacion').val();
    var listaArchivo = $("input[name=listaArchivos]");
    var informacionRelevante = $('#p_informacionRelevante').val();

    if (tipoDocumentoLv2 == 'null') {
        Swal.fire({
            icon: 'error',
            title: '¡Lo sentimos!',
            text: 'Debe ingresar el tipo de documento.',
            confirmButtonText: 'Entiendo'
        });
        return
    } else if (listaArchivo.length == 0) {
        Swal.fire({
            icon: 'error',
            title: '¡Lo sentimos!',
            text: 'Debe cargar el archivo.',
            confirmButtonText: 'Entiendo'
        });
        return
    }

    //Mensaje confirmacion
    Swal.fire({
        icon: 'info',
        title: 'El documento será revisado por el Tribunal, para su posterior publicación',
        confirmButtonText: 'Entiendo',
    }).then((result) => {
        if (result.isConfirmed) {
            //Cargar documento
            var uuidDocumento = new Array();
            listaArchivo.each(function(index, element) {
                uuidDocumento.push($(element).val());
            });

            var form = new FormData();
            form.append("rolCausa", rolCausa);
            form.append("idCuaderno", idCuaderno);
            form.append("creadorDocumento", creadorDocumento);
            form.append("tipoDocumentoLv2", tipoDocumentoLv2);
            form.append("nombreDocumento", nombreDocumento);
            form.append("uuidDocumento", uuidDocumento);
            form.append("informacionRelevante", informacionRelevante);


            $.ajax({
                type: "POST",
                //headers: { token: token },
                enctype: 'multipart/form-data',
                url: thisWS + "/ver-causa/carga-certificacion",
                data: form,
                processData: false,
                contentType: false,
                beforeSend: function(data) {
                    //Activa loader
                    //$('#body').addClass('be-loading-active');
                },
                success: function(data) {
                    if (data.status === "200") {
                        //var response = $.parseJSON(data.response);

                        //Ocultar modal
                        $("#modal-ingresoCertificacion").toggleClass("active");
                        $("body").toggleClass("blocked");

                        //Limpiar lista de archivos
                        $("#box-archivos").html("");

                        //Mensaje exito
                        Swal.fire({
                            icon: 'success',
                            title: 'Documento guardado exitosamente',
                            confirmButtonText: 'OK',
                        }).then((result) => {
                            if (result.isConfirmed) {
                                var cuaderno = $("#p_listaCuadernos option:selected").val();
                                var tipoDocumento = $("#p_listaDocumentos option:selected").val();
                                cargaAsientoCuaderno(cuaderno, tipoDocumento);
                            }
                        });
                    } else {
                        Swal.fire({
                            icon: 'error',
                            title: '¡Lo sentimos!',
                            text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B15)',
                            confirmButtonText: 'Entiendo'
                        });
                    }
                },
                error: function() {
                    Swal.fire({
                        icon: 'error',
                        title: '¡Lo sentimos!',
                        text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A15)',
                        confirmButtonText: 'Entiendo'
                    });
                },
                complete: function() {
                    //Desactiva loader
                    //$('#body').removeClass('be-loading-active');
                }
            });
        }
    });
}

function cargaDocumentoCertificaciones() {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-documento-certificaciones",
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);

                //Listar documentos certificaciones
                $("#p_lista-documento-certificacion").empty().append(
                    $('<option>', { value: "null", text: "" })
                );
                $.each(response, function(index, element) {
                    $('#p_lista-documento-certificacion').append(
                        $('<option>', { value: element.clave, text: element.valor })
                    );
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B16)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A16)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
        }
    });
}

function cargaLitiganteCertificaciones() {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-litigante-certificaciones",
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);

                //Listar documentos certificaciones
                $("#p_lista-litigantes-certificacion").empty().append(
                    $('<option>', { value: "null", text: "" })
                );
                $.each(response, function(index, element) {
                    $('#p_lista-litigantes-certificacion').append(
                        $('<option>', { value: element.clave, text: element.valor })
                    );
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B17)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A17)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
        }
    });
}

function cargaLitigantesCausa(rolCausa, rolUsuario) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-litigantes-causa?rolCausa=" + rolCausa,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);

                //Limpiar listas
                $('#box-litigantes-amicus-curie').empty();
                $('#box-litigantes-demandantes').empty();
                $('#box-litigantes-demandados').empty();
                $('#box-litigantes-demandantes-abogados').empty();
                $('#box-litigantes-demandados-abogados').empty();
                $('#box-litigantes-tercero').empty();
                $('#box-litigantes-tercero-coadyuvante').empty();
                $('#box-litigantes-tercero-independiente').empty();
                $('#box-litigantes-tercero-excluyente').empty();

                if (rolUsuario == 'Administrador'
                    || rolUsuario == 'Oficial'
                    || rolUsuario == 'Pasante judicial'
                ) {
                    $('#dropdown_demandado').show();
                } else {
                    $('#dropdown_demandado').hide();
                }

                //Listar litigantes
                $.each(response, function(index, element) {
                    //Demandante (codigo 1, 5, 14)
                    if (element.codRolJudicial == 1 || element.codRolJudicial == 5 || element.codRolJudicial == 14) {
                        var dropdown = '';
                        if (rolUsuario == 'Administrador'
                            || rolUsuario == 'Oficial'
                            || rolUsuario == 'Pasante judicial'
                        ) {
                            dropdown = '<div class="dropdown">' +
                                '<a onclick="" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false"><img src="assets/img/icon-options.svg" style="padding-bottom:10px;"></a>' +
                                '<div class="dropdown-menu" aria-labelledby="dropdownMenuButton">' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="inicioMoverLitigante(' + element.idCausaLitigante + ',' + element.txtRut + ',' + element.txtRutDv + ',' + element.codRolJudicial + ')">Mover Reclamante</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="eliminarLitigante(' + element.idCausaLitigante + ')">Eliminar</a>' +
                                '</div>' +
                                '</div>';
                        }

                        $('#box-litigantes-demandantes').removeAttr('hidden');
                        $('#box-litigantes-demandantes').append(
                            '<div class="person">' +
                            '<div class="title">' +
                            '<h6>' + element.txtNombre + ' ' + element.txtApellido + '</h6>' +
                            dropdown +
                            '</div>' +
                            '</div>'
                        );
                    }

                    //Abogado Demandante (codigo 2, 6, 16)
                    if (element.codRolJudicial == 2 || element.codRolJudicial == 6 || element.codRolJudicial == 16) {
                        var dropdown = '';
                        if (rolUsuario == 'Administrador'
                            || rolUsuario == 'Oficial'
                            || rolUsuario == 'Pasante judicial'
                        ) {
                            dropdown = '<div class="dropdown">' +
                                '<a onclick="" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false"><img src="assets/img/icon-options.svg" style="padding-bottom:10px;"></a>' +
                                '<div class="dropdown-menu" aria-labelledby="dropdownMenuButton">' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="inicioMoverLitigante(' + element.idCausaLitigante + ',' + element.txtRut + ',' + element.txtRutDv + ',' + element.codRolJudicial + ')">Mover Abogado</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="eliminarLitigante(' + element.idCausaLitigante + ')">Eliminar</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(1,' + element.idCausaLitigante + ',' +
                                (element.emails && element.emails.length > 0
                                    ? element.emails[0].id + ',\'' + element.emails[0].email + '\''
                                    : '\'\' ,\'\'') + ')">Correo 1</a>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(2,' + element.idCausaLitigante + ',' +
                                (element.emails && element.emails.length > 1
                                    ? element.emails[1].id + ',\'' + element.emails[1].email + '\''
                                    : '\'\' ,\'\'') + ')">Correo 2</a>' +
                                '</div>' +
                                '</div>';
                        }

                        $('#box-litigantes-demandantes-abogados').removeAttr('hidden');
                        $('#p_litigantes_subtitulo1').removeAttr('hidden');
                        $('#box-litigantes-demandantes-abogados').append(
                            '<div class="person">' +
                            '<div class="title">' +
                            '<h6>' + element.txtNombre + ' ' + element.txtApellido + '</h6>' +
                            dropdown +
                            '</div>' +
                            '<p>' +
                            '<span class="rut">' + element.txtRut + '-' + element.txtRutDv + '</span>' +
                            '<span class="email">' + (element.txtEmail ? element.txtEmail : '') + '</span>' +
                            (element.emails && element.emails.length > 0 ? '<span class="email">' + element.emails[0].email + '</span>' : '') +
                            (element.emails && element.emails.length > 1 ? '<span class="email">' + element.emails[1].email + '</span>' : '') +
                            '</p>' +
                            '</div>'
                        );
                    }

                    //Demandado (codigo 3, 7, 15)
                    if (element.codRolJudicial == 3 || element.codRolJudicial == 7 || element.codRolJudicial == 15) {
                        var dropdown = '';
                        if (
                            rolUsuario == 'Administrador'
                            || rolUsuario == 'Oficial'
                            || rolUsuario == 'Pasante judicial'
                        ) {
                            dropdown = '<div class="dropdown">' +
                                '<a onclick="" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false"><img src="assets/img/icon-options.svg" style="padding-bottom:10px;"></a>' +
                                '<div class="dropdown-menu" aria-labelledby="dropdownMenuButton">' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="inicioMoverLitigante(' + element.idCausaLitigante + ',' + element.txtRut + ',' + element.txtRutDv + ',' + element.codRolJudicial + ')">Mover Demandado</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="eliminarLitigante(' + element.idCausaLitigante + ')">Eliminar</a>' +
                                '</div>' +
                                '</div>';
                        }

                        $('#box-litigantes-demandados').removeAttr('hidden');

                        console.log(element);
                        // Definir el nombre completo según la condición
                        const nombreCompleto = element.codRolJudicial === "15"
                            ? `${element.nombreVisible} ${element.apellidoVisible !== 'null' ? element.apellidoVisible : ''}`
                            : `${element.txtNombre} ${element.txtApellido}`;

                        const litiganteHTML = `
                                                <div class="person">
                                                    <div class="title">
                                                        <h6>${nombreCompleto}</h6>
                                                        ${dropdown}
                                                    </div>
                                                </div>
                                            `;

                        $('#box-litigantes-demandados').append(litiganteHTML);
                    }

                    //Abogado Demandado (codigo 4, 8)
                    if (element.codRolJudicial == 4 || element.codRolJudicial == 8) {
                        var dropdown = '';
                        if (rolUsuario == 'Administrador'
                            || rolUsuario == 'Oficial'
                            || rolUsuario == 'Pasante judicial'
                        ) {
                            dropdown = '<div class="dropdown">' +
                                '<a onclick="" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false"><img src="assets/img/icon-options.svg" style="padding-bottom:10px;"></a>' +
                                '<div class="dropdown-menu" aria-labelledby="dropdownMenuButton">' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="inicioMoverLitigante(' + element.idCausaLitigante + ',' + element.txtRut + ',' + element.txtRutDv + ',' + element.codRolJudicial + ')">Mover Abogado</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="eliminarLitigante(' + element.idCausaLitigante + ')">Eliminar</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(1,' + element.idCausaLitigante + ','+ (element.emails && element.emails.length > 0 ? element.emails[0].id + ',\'' + element.emails[0].email + '\'' : '\'\',\'\'') +')">Correo 1</a>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(2,' + element.idCausaLitigante + ','+ (element.emails && element.emails.length > 1 ? element.emails[1].id + ',\'' + element.emails[1].email + '\'' : '\'\',\'\'') +')">Correo 2</a>' +
                                '</div>' +
                                '</div>';
                        }

                        $('#p_litigantes_subtitulo2').removeAttr('hidden');
                        $('#box-litigantes-demandados-abogados').removeAttr('hidden');
                        $('#box-litigantes-demandados-abogados').append(
                            '<div class="person">' +
                            '<div class="title">' +
                            '<h6>' + element.txtNombre + ' ' + element.txtApellido + '</h6>' +
                            dropdown +
                            '</div>' +
                            '<p>' +
                                '<span class="rut">' + element.txtRut + '-' + element.txtRutDv + '</span>' +
                                '<span class="email">' + (element.txtEmail ? element.txtEmail : '') + '</span>' +
                                (element.emails && element.emails.length > 0 ? '<span class="email">' + element.emails[0].email + '</span>' : '') +
                                (element.emails && element.emails.length > 1 ? '<span class="email">' + element.emails[1].email + '</span>' : '') +
                            '</p>' +
                            '</div>'
                        );
                    }

                    //Amicus Curie (codigo 9)
                    if (element.codRolJudicial == 9) {

                        var dropdown = '';
                        if (rolUsuario == 'Administrador'
                            || rolUsuario == 'Oficial'
                            || rolUsuario == 'Pasante judicial'
                        ) {
                            dropdown = '<div class="dropdown">' +
                                '<a onclick="" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false"><img src="assets/img/icon-options.svg" style="padding-bottom:10px;"></a>' +
                                '<div class="dropdown-menu" aria-labelledby="dropdownMenuButton">' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="inicioMoverLitigante(' + element.idCausaLitigante + ',' + element.txtRut + ',' + element.txtRutDv + ',' + element.codRolJudicial + ')">Mover Abogado</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="eliminarLitigante(' + element.idCausaLitigante + ')">Eliminar</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(1,' + element.idCausaLitigante + ','+ (element.emails && element.emails.length > 0 ? element.emails[0].id + ',\'' + element.emails[0].email + '\'' : '\'\',\'\'') +')">Correo 1</a>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(2,' + element.idCausaLitigante + ','+ (element.emails && element.emails.length > 1 ? element.emails[1].id + ',\'' + element.emails[1].email + '\'' : '\'\',\'\'') +')">Correo 2</a>' +
                                '</div>' +
                                '</div>';
                        }

                        $('#div-box-litigantes-amicus-curie').removeAttr('hidden');
                        $('#box-litigantes-amicus-curie').removeAttr('hidden');
                        $('#box-litigantes-amicus-curie').append(
                            '<div class="person">' +
                            '<div class="title">' +
                            '<h6>' + element.txtNombre + ' ' + element.txtApellido + '</h6>' +
                            dropdown +
                            '</div>' +
                            '<p>' +
                            '<span class="rut">' + element.txtRut + '-' + element.txtRutDv + '</span>' +
                            '<span class="email">' + (element.txtEmail ? element.txtEmail : '') + '</span>' +
                            (element.emails && element.emails.length > 0 ? '<span class="email">' + element.emails[0].email + '</span>' : '') +
                            (element.emails && element.emails.length > 1 ? '<span class="email">' + element.emails[1].email + '</span>' : '') +
                            '</p>' +
                            '</div>'
                        );
                    }

                    //Abogado Amicus Curie (codigo 21)
                    if (element.codRolJudicial == 21) {
                        $('#div-box-litigantes-amicus-curie').removeAttr('hidden');
                        $('#box-litigantes-amicus-curie').removeAttr('hidden');
                        $('#box-litigantes-amicus-curie').append(
                            '<div class="person">' +
                            '<div class="title">' +
                            '<h6>' + element.txtNombre + ' ' + element.txtApellido + '</h6>' +
                            '</div>' +
                            '<p><span class="rut">' + element.txtRut + '-' + element.txtRutDv + '</span><span class="email">' + (element.txtEmail ? element.txtEmail : '') + '</span></p>' +
                            '</div>'
                        );
                    }

                    //Tercero (codigo 10)
                    if (element.codRolJudicial == 10) {
                        var dropdown = '';
                        if (rolUsuario == 'Administrador'
                            || rolUsuario == 'Oficial'
                            || rolUsuario == 'Pasante judicial'
                        ) {
                            dropdown = '<div class="dropdown">' +
                                '<a onclick="" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false"><img src="assets/img/icon-options.svg" style="padding-bottom:10px;"></a>' +
                                '<div class="dropdown-menu" aria-labelledby="dropdownMenuButton">' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',17)">Abogado Tercero</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',11)">Tercero Coadyuvante</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',18)">Abogado Tercero Coadyuvante</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',12)">Tercero Independiente</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',19)">Abogado Tercero Independiente</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',13)">Tercero Excluyente</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',20)">Abogado Tercero Excluyente</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(1,' + element.idCausaLitigante + ','+ (element.emails && element.emails.length > 0 ? element.emails[0].id + ',\'' + element.emails[0].email + '\'' : '\'\',\'\'') +')">Correo 1</a>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(2,' + element.idCausaLitigante + ','+ (element.emails && element.emails.length > 1 ? element.emails[1].id + ',\'' + element.emails[1].email + '\'' : '\'\',\'\'') +')">Correo 2</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="eliminarLitigante(' + element.idCausaLitigante + ')">Eliminar</a>' +
                                '</div>' +
                                '</div>';
                        }

                        $('#div-terceros').removeAttr('hidden');
                        $('#tit-box-litigantes-tercero').removeAttr('hidden');
                        $('#box-litigantes-tercero').removeAttr('hidden');
                        $('#box-litigantes-tercero').append(
                            '<div class="person">' +
                            '<div class="title">' +
                            '<h6>' + element.txtNombre + ' ' + element.txtApellido + '</h6>' +
                            dropdown +
                            '</div>' +
                            '<p>' +
                            '<span class="rut">' + element.txtRut + '-' + element.txtRutDv + '</span>' +
                            '<span class="email">' + (element.txtEmail ? element.txtEmail : '') + '</span>' +
                            (element.emails && element.emails.length > 0 ? '<span class="email">' + element.emails[0].email + '</span>' : '') +
                            (element.emails && element.emails.length > 1 ? '<span class="email">' + element.emails[1].email + '</span>' : '') +
                            '</p>' +
                            '</div>'
                        );
                    }

                    //Abogado Tercero (codigo 17)
                    if (element.codRolJudicial == 17) {
                        var dropdown = '';
                        if (rolUsuario == 'Administrador'
                            || rolUsuario == 'Oficial'
                            || rolUsuario == 'Pasante judicial'
                        ) {
                            dropdown = '<div class="dropdown">' +
                                '<a onclick="" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false"><img src="assets/img/icon-options.svg" style="padding-bottom:10px;"></a>' +
                                '<div class="dropdown-menu" aria-labelledby="dropdownMenuButton">' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',10)">Tercero</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',11)">Tercero Coadyuvante</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',18)">Abogado Tercero Coadyuvante</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',12)">Tercero Independiente</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',19)">Abogado Tercero Independiente</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',13)">Tercero Excluyente</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',20)">Abogado Tercero Excluyente</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(1,' + element.idCausaLitigante + ','+ (element.emails && element.emails.length > 0 ? element.emails[0].id + ',\'' + element.emails[0].email + '\'' : '\'\',\'\'') +')">Correo 1</a>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(2,' + element.idCausaLitigante + ','+ (element.emails && element.emails.length > 1 ? element.emails[1].id + ',\'' + element.emails[1].email + '\'' : '\'\',\'\'') +')">Correo 2</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="eliminarLitigante(' + element.idCausaLitigante + ')">Eliminar</a>' +
                                '</div>' +
                                '</div>';
                        }

                        $('#div-terceros').removeAttr('hidden');
                        $('#tit-box-litigantes-tercero').removeAttr('hidden');
                        $('#box-litigantes-tercero').removeAttr('hidden');
                        $('#box-litigantes-tercero').append(
                            '<div class="person">' +
                            '<div class="title">' +
                            '<h6>' + element.txtNombre + ' ' + element.txtApellido + '</h6>' +
                            dropdown +
                            '</div>' +
                            '<p>' +
                            '<span class="rut">' + element.txtRut + '-' + element.txtRutDv + '</span>' +
                            '<span class="email">' + (element.txtEmail ? element.txtEmail : '') + '</span>' +
                            (element.emails && element.emails.length > 0 ? '<span class="email">' + element.emails[0].email + '</span>' : '') +
                            (element.emails && element.emails.length > 1 ? '<span class="email">' + element.emails[1].email + '</span>' : '') +
                            '</p>' +
                            '</div>'
                        );
                    }

                    //Tercero Coadyuvante (codigo 11)
                    if (element.codRolJudicial == 11) {
                        var dropdown = '';
                        if (rolUsuario == 'Administrador' || rolUsuario == 'Oficial' || rolUsuario == 'Pasante judicial') {
                            dropdown = '<div class="dropdown">' +
                                '<a onclick="" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false"><img src="assets/img/icon-options.svg" style="padding-bottom:10px;"></a>' +
                                '<div class="dropdown-menu" aria-labelledby="dropdownMenuButton">' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',10)">Tercero</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',17)">Abogado Tercero</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',18)">Abogado Tercero Coadyuvante</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',12)">Tercero Independiente</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',19)">Abogado Tercero Independiente</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',13)">Tercero Excluyente</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',20)">Abogado Tercero Excluyente</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(1,' + element.idCausaLitigante + ','+ (element.emails && element.emails.length > 0 ? element.emails[0].id + ',\'' + element.emails[0].email + '\'' : '\'\',\'\'') +')">Correo 1</a>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(2,' + element.idCausaLitigante + ','+ (element.emails && element.emails.length > 1 ? element.emails[1].id + ',\'' + element.emails[1].email + '\'' : '\'\',\'\'') +')">Correo 2</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="eliminarLitigante(' + element.idCausaLitigante + ')">Eliminar</a>' +
                                '</div>' +
                                '</div>';
                        }

                        $('#div-terceros').removeAttr('hidden');
                        $('#tit-box-litigantes-tercero-coadyuvante').removeAttr('hidden');
                        $('#box-litigantes-tercero-coadyuvante').removeAttr('hidden');
                        $('#box-litigantes-tercero-coadyuvante').append(
                            '<div class="person">' +
                            '<div class="title">' +
                            '<h6>' + element.txtNombre + ' ' + element.txtApellido + ' (' + element.txtRolJudicial +')</h6>' +
                            dropdown +
                            '</div>' +
                            '<p>' +
                            '<span class="rut">' + element.txtRut + '-' + element.txtRutDv + '</span>' +
                            '<span class="email">' + (element.txtEmail ? element.txtEmail : '') + '</span>' +
                            (element.emails && element.emails.length > 0 ? '<span class="email">' + element.emails[0].email + '</span>' : '') +
                            (element.emails && element.emails.length > 1 ? '<span class="email">' + element.emails[1].email + '</span>' : '') +
                            '</p>' +
                            '</div>'
                        );
                    }

                    //Abogado Tercero Coadyuvante (codigo 18)
                    if (element.codRolJudicial == 18) {
                        var dropdown = '';
                        if (rolUsuario == 'Administrador' || rolUsuario == 'Oficial' || rolUsuario == 'Pasante judicial') {
                            dropdown = '<div class="dropdown">' +
                                '<a onclick="" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false"><img src="assets/img/icon-options.svg" style="padding-bottom:10px;"></a>' +
                                '<div class="dropdown-menu" aria-labelledby="dropdownMenuButton">' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',10)">Tercero</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',17)">Abogado Tercero</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',11)">Tercero Coadyuvante</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',18)">Abogado Tercero Coadyuvante</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',12)">Tercero Independiente</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',19)">Abogado Tercero Independiente</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',13)">Tercero Excluyente</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',20)">Abogado Tercero Excluyente</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(1,' + element.idCausaLitigante + ','+ (element.emails && element.emails.length > 0 ? element.emails[0].id + ',\'' + element.emails[0].email + '\'' : '\'\',\'\'') +')">Correo 1</a>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(2,' + element.idCausaLitigante + ','+ (element.emails && element.emails.length > 1 ? element.emails[1].id + ',\'' + element.emails[1].email + '\'' : '\'\',\'\'') +')">Correo 2</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="eliminarLitigante(' + element.idCausaLitigante + ')">Eliminar</a>' +
                                '</div>' +
                                '</div>';
                        }

                        $('#div-terceros').removeAttr('hidden');
                        $('#tit-box-litigantes-tercero-coadyuvante').removeAttr('hidden');
                        $('#box-litigantes-tercero-coadyuvante').removeAttr('hidden');
                        $('#box-litigantes-tercero-coadyuvante').append(
                            '<div class="person">' +
                            '<div class="title">' +
                            '<h6>' + element.txtNombre + ' ' + element.txtApellido + ' (' + element.txtRolJudicial +')</h6>' +
                            dropdown +
                            '</div>' +
                            '<p>' +
                            '<span class="rut">' + element.txtRut + '-' + element.txtRutDv + '</span>' +
                            '<span class="email">' + (element.txtEmail ? element.txtEmail : '') + '</span>' +
                            (element.emails && element.emails.length > 0 ? '<span class="email">' + element.emails[0].email + '</span>' : '') +
                            (element.emails && element.emails.length > 1 ? '<span class="email">' + element.emails[1].email + '</span>' : '') +
                            '</p>' +
                            '</div>'
                        );
                    }

                    //Tercero Independiente (codigo 12)
                    if (element.codRolJudicial == 12) {
                        var dropdown = '';
                        if (rolUsuario == 'Administrador' || rolUsuario == 'Oficial' || rolUsuario == 'Pasante judicial') {
                            dropdown = '<div class="dropdown">' +
                                '<a onclick="" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false"><img src="assets/img/icon-options.svg" style="padding-bottom:10px;"></a>' +
                                '<div class="dropdown-menu" aria-labelledby="dropdownMenuButton">' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',10)">Tercero</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',17)">Abogado Tercero</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',11)">Tercero Coadyuvante</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',18)">Abogado Tercero Coadyuvante</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',19)">Abogado Tercero Independiente</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',13)">Tercero Excluyente</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',20)">Abogado Tercero Excluyente</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(1,' + element.idCausaLitigante + ','+ (element.emails && element.emails.length > 0 ? element.emails[0].id + ',\'' + element.emails[0].email + '\'' : '\'\',\'\'') +')">Correo 1</a>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(2,' + element.idCausaLitigante + ','+ (element.emails && element.emails.length > 1 ? element.emails[1].id + ',\'' + element.emails[1].email + '\'' : '\'\',\'\'') +')">Correo 2</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="eliminarLitigante(' + element.idCausaLitigante + ')">Eliminar</a>' +
                                '</div>' +
                                '</div>';
                        }

                        $('#div-terceros').removeAttr('hidden');
                        $('#tit-box-litigantes-tercero-independiente').removeAttr('hidden');
                        $('#box-litigantes-tercero-independiente').removeAttr('hidden');
                        $('#box-litigantes-tercero-independiente').append(
                            '<div class="person">' +
                            '<div class="title">' +
                            '<h6>' + element.txtNombre + ' ' + element.txtApellido + ' (' + element.txtRolJudicial +')</h6>' +
                            dropdown +
                            '</div>' +
                            '<p>' +
                            '<span class="rut">' + element.txtRut + '-' + element.txtRutDv + '</span>' +
                            '<span class="email">' + (element.txtEmail ? element.txtEmail : '') + '</span>' +
                            (element.emails && element.emails.length > 0 ? '<span class="email">' + element.emails[0].email + '</span>' : '') +
                            (element.emails && element.emails.length > 1 ? '<span class="email">' + element.emails[1].email + '</span>' : '') +
                            '</p>' +
                            '</div>'
                        );
                    }

                    //ABogado Tercero Independiente (codigo 19)
                    if (element.codRolJudicial == 19) {
                        var dropdown = '';
                        if (rolUsuario == 'Administrador' || rolUsuario == 'Oficial' || rolUsuario == 'Pasante judicial') {
                            dropdown = '<div class="dropdown">' +
                                '<a onclick="" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false"><img src="assets/img/icon-options.svg" style="padding-bottom:10px;"></a>' +
                                '<div class="dropdown-menu" aria-labelledby="dropdownMenuButton">' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',10)">Tercero</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',17)">Abogado Tercero</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',11)">Tercero Coadyuvante</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',18)">Abogado Tercero Coadyuvante</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',12)">Tercero Independiente</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',13)">Tercero Excluyente</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',20)">Abogado Tercero Excluyente</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(1,' + element.idCausaLitigante + ','+ (element.emails && element.emails.length > 0 ? element.emails[0].id + ',\'' + element.emails[0].email + '\'' : '\'\',\'\'') +')">Correo 1</a>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(2,' + element.idCausaLitigante + ','+ (element.emails && element.emails.length > 1 ? element.emails[1].id + ',\'' + element.emails[1].email + '\'' : '\'\',\'\'') +')">Correo 2</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="eliminarLitigante(' + element.idCausaLitigante + ')">Eliminar</a>' +
                                '</div>' +
                                '</div>';
                        }

                        $('#div-terceros').removeAttr('hidden');
                        $('#tit-box-litigantes-tercero-independiente').removeAttr('hidden');
                        $('#box-litigantes-tercero-independiente').removeAttr('hidden');
                        $('#box-litigantes-tercero-independiente').append(
                            '<div class="person">' +
                            '<div class="title">' +
                            '<h6>' + element.txtNombre + ' ' + element.txtApellido + ' (' + element.txtRolJudicial +')</h6>' +
                            dropdown +
                            '</div>' +
                            '<p>' +
                            '<span class="rut">' + element.txtRut + '-' + element.txtRutDv + '</span>' +
                            '<span class="email">' + (element.txtEmail ? element.txtEmail : '') + '</span>' +
                            (element.emails && element.emails.length > 0 ? '<span class="email">' + element.emails[0].email + '</span>' : '') +
                            (element.emails && element.emails.length > 1 ? '<span class="email">' + element.emails[1].email + '</span>' : '') +
                            '</p>' +
                            '</div>'
                        );
                    }

                    //Tercero Excluyente (codigo 13)
                    if (element.codRolJudicial == 13) {
                        var dropdown = '';
                        if (rolUsuario == 'Administrador' || rolUsuario == 'Oficial' || rolUsuario == 'Pasante judicial') {
                            dropdown = '<div class="dropdown">' +
                                '<a onclick="" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false"><img src="assets/img/icon-options.svg" style="padding-bottom:10px;"></a>' +
                                '<div class="dropdown-menu" aria-labelledby="dropdownMenuButton">' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',10)">Tercero</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',17)">Abogado Tercero</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',11)">Tercero Coadyuvante</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',18)">Abogado Tercero Coadyuvante</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',12)">Tercero Independiente</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',19)">Abogado Tercero Independiente</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',20)">Abogado Tercero Excluyente</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(1,' + element.idCausaLitigante + ','+ (element.emails && element.emails.length > 0 ? element.emails[0].id + ',\'' + element.emails[0].email + '\'' : '\'\',\'\'') +')">Correo 1</a>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(2,' + element.idCausaLitigante + ','+ (element.emails && element.emails.length > 1 ? element.emails[1].id + ',\'' + element.emails[1].email + '\'' : '\'\',\'\'') +')">Correo 2</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="eliminarLitigante(' + element.idCausaLitigante + ')">Eliminar</a>' +
                                '</div>' +
                                '</div>';
                        }

                        $('#div-terceros').removeAttr('hidden');
                        $('#tit-box-litigantes-tercero-excluyente').removeAttr('hidden');
                        $('#box-litigantes-tercero-excluyente').removeAttr('hidden');
                        $('#box-litigantes-tercero-excluyente').append(
                            '<div class="person">' +
                            '<div class="title">' +
                            '<h6>' + element.txtNombre + ' ' + element.txtApellido + ' (' + element.txtRolJudicial +')</h6>' +
                            dropdown +
                            '</div>' +
                            '<p>' +
                            '<span class="rut">' + element.txtRut + '-' + element.txtRutDv + '</span>' +
                            '<span class="email">' + (element.txtEmail ? element.txtEmail : '') + '</span>' +
                            (element.emails && element.emails.length > 0 ? '<span class="email">' + element.emails[0].email + '</span>' : '') +
                            (element.emails && element.emails.length > 1 ? '<span class="email">' + element.emails[1].email + '</span>' : '') +
                            '</p>' +
                            '</div>'
                        );
                    }

                    //Abogado Tercero Excluyente (codigo 20)
                    if (element.codRolJudicial == 20) {
                        var dropdown = '';
                        if (rolUsuario == 'Administrador' || rolUsuario == 'Oficial' || rolUsuario == 'Pasante judicial') {
                            dropdown = '<div class="dropdown">' +
                                '<a onclick="" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false"><img src="assets/img/icon-options.svg" style="padding-bottom:10px;"></a>' +
                                '<div class="dropdown-menu" aria-labelledby="dropdownMenuButton">' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',10)">Tercero</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',17)">Abogado Tercero</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',11)">Tercero Coadyuvante</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',18)">Abogado Tercero Coadyuvante</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',12)">Tercero Independiente</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',19)">Abogado Tercero Independiente</a>' +
                                '<a class="dropdown-item" href="javascript:void(0)" onclick="cambarTipoDeTercero(' + element.idCausaLitigante + ',13)">Tercero Excluyente</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(1,' + element.idCausaLitigante + ','+ (element.emails && element.emails.length > 0 ? element.emails[0].id + ',\'' + element.emails[0].email + '\'' : '\'\',\'\'') +')">Correo 1</a>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="ingresoCorreo(2,' + element.idCausaLitigante + ','+ (element.emails && element.emails.length > 1 ? element.emails[1].id + ',\'' + element.emails[1].email + '\'' : '\'\',\'\'') +')">Correo 2</a>' +
                                '<div class="dropdown-divider"></div>' +
                                '<a class="dropdown-item" href="javascript:void(0);" onclick="eliminarLitigante(' + element.idCausaLitigante + ')">Eliminar</a>' +
                                '</div>' +
                                '</div>';
                        }

                        $('#div-terceros').removeAttr('hidden');
                        $('#tit-box-litigantes-tercero-excluyente').removeAttr('hidden');
                        $('#box-litigantes-tercero-excluyente').removeAttr('hidden');
                        $('#box-litigantes-tercero-excluyente').append(
                            '<div class="person">' +
                            '<div class="title">' +
                            '<h6>' + element.txtNombre + ' ' + element.txtApellido + ' (' + element.txtRolJudicial +')</h6>' +
                            dropdown +
                            '</div>' +
                            '<p>' +
                            '<span class="rut">' + element.txtRut + '-' + element.txtRutDv + '</span>' +
                            '<span class="email">' + (element.txtEmail ? element.txtEmail : '') + '</span>' +
                            (element.emails && element.emails.length > 0 ? '<span class="email">' + element.emails[0].email + '</span>' : '') +
                            (element.emails && element.emails.length > 1 ? '<span class="email">' + element.emails[1].email + '</span>' : '') +
                            '</p>' +
                            '</div>'
                        );
                    }
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B18)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A18)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}

function cargaAdministracionRelatores() {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-relatores",
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);

                //Listar relatores
                $("#lista-administracion-relatores").empty().append(
                    $('<option>', { value: "null", text: "Sin relator" })
                );
                $("#lista-administracion-relatores").append(
                    $('<option>', { value: "null", text: "Sin relator" })
                );
                $.each(response, function(index, element) {
                    $('#lista-administracion-relatores').append(
                        $('<option>', { value: element.clave, text: element.valor })
                    );
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B19)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A19)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}

function cargaAdministracionRedactores() {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-redactores",
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);
                //Listar relatores
                $("#lista-administracion-redactores").empty().append(
                    $('<option>', { value: "null", text: "Sin redactor" })
                );
                $("#lista-administracion-redactores").append(
                    $('<option>', { value: "null", text: "Sin redactor" })
                );
                $.each(response, function(index, element) {
                    $('#lista-administracion-redactores').append(
                        $('<option>', { value: element.clave, text: element.valor })
                    );
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B20)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A20)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}

function cargaAdministracionAsesoresCientificos() {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-asesores-cientificos",
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);
                //Listar relatores
                $("#lista-administracion-asesoresCientificos").empty().append(
                    $('<option>', { value: "null", text: "Sin asesor cientifico" })
                );
                $("#lista-administracion-asesoresCientificos").append(
                    $('<option>', { value: "null", text: "Sin asesor cientifico" })
                );
                $.each(response, function(index, element) {
                    $('#lista-administracion-asesoresCientificos').append(
                        $('<option>', { value: element.clave, text: element.valor })
                    );
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B21)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A21)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}

function cargaAdministracionMinistros(idCausa) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-ministros-con-inactivos?idCausa=" + idCausa,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);
                //Limpiar listas
                $('#box-administracion-ministros').empty();
                //Lista Ministros asignados
                var listaMinistros = $("input[name='listaMinistros']");

                if (listaMinistros.length > 0) {
                    $.each(response, function(index, element) {
                        $('#box-administracion-ministros').append(
                            '<div class="person">' +
                            '<input id="' + element.clave + '" type="checkbox" value="' + element.clave + '" onchange="seleccionaMinistro(this)">' +
                            '<span>' + element.valor + '</span>' +
                            '</div>'
                        );

                        listaMinistros.each(function(index, objeto) {
                            if ($(objeto).val() == element.clave) {
                                $(`#${element.clave}`).prop('checked', true)
                            }
                        });
                    });

                    // checked


                } else {
                    $.each(response, function(index, element) {

                        $('#box-administracion-ministros').append(
                            '<div class="person">' +
                            '<input type="checkbox" value="' + element.clave + '" onchange="seleccionaMinistro(this)">' +
                            '<span>' + element.valor + '</span>' +
                            '</div>'
                        );
                    });
                }
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B22)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A22)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}

function cargaListaCausasPadre(idCausa) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/mostar-causas-padre?idCausa=" + idCausa,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);

                if (response.clave != undefined || response.valor != undefined) {
                    //Agregar elemento a la causa
                    $('#tabla-lista-causa-acumulada').append(
                        '<div class="row">' +
                        '<span class="col-3 col-md-2 dark">' + response.clave + '</span>' +
                        '<span class="col-9 col-md-10 dark">' + response.valor + '</span>' +
                        '</div>'
                    );
                    $('#btn-agregar-causa-acumuladora').hide();
                }
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B23)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A23)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}

function obtenerListaCausasAcumuladas(idCausa) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-causas-acumuladas?idCausa=" + idCausa,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);

                //Carga datos de causas acumuladas
                $.each(response, function(index, element) {
                    if (index == 0) {
                        $('#box-titulo-acumuladas').html(element.labels);
                        $('#box-detalle-acumuladas').append(
                            '<span class="ministros"><a href="' + detalleCausa + element.rolCausa + '" target="_blank" class="link wrapword">(' + element.rolCausa + ') - ' + element.caratulaCausa + '</a></span> '
                        );
                    } else {
                        $('#box-detalle-acumuladas').append(
                            '<span class="ministros"> | <a href="' + detalleCausa + element.rolCausa + '" target="_blank" class="link wrapword">(' + element.rolCausa + ') - ' + element.caratulaCausa + '</a></span> '
                        );
                    }
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B24)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A24)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}

function obtenerListaCausasPadre(rolCausa) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-causas-padre?rolCausa=" + rolCausa,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);

                //Listar causas
                $("#lista-administracion-causasPadre").empty().append(
                    $('<option>', { value: "null", text: "" })
                );
                $.each(response, function(index, element) {
                    $('#lista-administracion-causasPadre').append(
                        $('<option>', { value: element.idCausa + ';' + element.rolCausa + ';' + element.caratulaCausa, text: '(' + element.rolCausa + ') - ' + element.caratulaCausa })
                    );
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B25)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A25)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}

function guardaCausaPadre() {
    if ($("#lista-administracion-causasPadre option:selected").val() == 'null') {
        Swal.fire({
            icon: 'error',
            title: '¡Error!',
            text: 'Debes seleccionar una causa para acumular.',
            confirmButtonText: 'Entiendo'
        });
    } else {
        var idCausa = $("#p_idCausa").val();
        var idCausaPadre = $("#lista-administracion-causasPadre option:selected").val().substring(0, $("#lista-administracion-causasPadre option:selected").val().indexOf(';'));
        var rolCausaPadre = $("#lista-administracion-causasPadre option:selected").val().substring($("#lista-administracion-causasPadre option:selected").val().indexOf(';') + 1, $("#lista-administracion-causasPadre option:selected").val().lastIndexOf(';'));
        var caratulaCausaPadre = $("#lista-administracion-causasPadre option:selected").val().substring($("#lista-administracion-causasPadre option:selected").val().lastIndexOf(';') + 1);

        $.ajax({
            type: "GET",
            url: thisWS + "/ver-causa/cargar-causas-padre?idCausa=" + idCausa + "&idCausaPadre=" + idCausaPadre,
            contentType: "application/json; charset=ISO-8859-1",
            dataType: "json",
            beforeSend: function() {
                //Activa loader
                //$('#body').addClass('be-loading-active');
            },
            success: function(data) {
                if (data.status === "200") {
                    //var response = $.parseJSON(data.response);
                    if (data.response == 'true') {
                        //Agregar elemento a la causa
                        $('#tabla-lista-causa-acumulada').append(
                            '<div class="row">' +
                            '<span class="col-3 col-md-2 dark">' + rolCausaPadre + '</span>' +
                            '<span class="col-9 col-md-10 dark">' + caratulaCausaPadre + '</span>' +
                            '</div>'
                        );
                        $('#btn-agregar-causa-acumuladora').hide();

                        //Ocultar Modal
                        $("#modal-acumularCausa").toggleClass("active");
                        $("body").toggleClass("blocked");

                        //Mensaje de exito
                        Swal.fire({
                            icon: 'success',
                            title: 'Datos actualizados exitosamente',
                            confirmButtonText: 'OK',
                        }).then((result) => {
                            if (result.isConfirmed) {
                                //Cerrar alert
                            }
                        });
                    } else {
                        Swal.fire({
                            icon: 'error',
                            title: '¡Lo sentimos!',
                            text: 'Hubo un problema en el registro de la causa padre. Reintente más tarde.',
                            confirmButtonText: 'Entiendo'
                        });
                    }
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: '¡Lo sentimos!',
                        text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B26)',
                        confirmButtonText: 'Entiendo'
                    });
                }
            },
            error: function() {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A26)',
                    confirmButtonText: 'Entiendo'
                });
            },
            complete: function() {
                //Desactiva loader
                //$('#body').removeClass('be-loading-active');
            }
        });
    }
}

function seleccionaMinistro(objeto) {


    let token = Cookies.get('token');
    var seleccion = $(objeto).is(':checked');
    var idCausa = $("#p_idCausa").val();
    var idUsuario = $(objeto).val();

    if (seleccion) {
        var accion = "agrega";
    } else {
        var accion = "quita";
    }

    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/actualizar-usuario-causa?accion=" + accion + "&idCausa=" + idCausa + "&idUsuario=" + idUsuario,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        headers: { token: token },
        beforeSend: function() {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                //var response = $.parseJSON(data.response);
                Swal.fire({
                    icon: 'success',
                    title: 'Datos actualizados exitosamente',
                    confirmButtonText: 'OK',
                }).then((result) => {
                    if (result.isConfirmed) {
                        //Cerrar alert
                    }
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B27)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A27)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
            cargaMinistroCausa(idCausa);
        }
    });
}

function cargaTablaAudiencias(rolCausa) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-audiencias-causa?rolCausa=" + rolCausa,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);
                //Limpiar listas
                $('#tabla-audiencias tbody').empty();

                //Listar ministros
                $.each(response, function(index, element) {
                    $('#tabla-audiencias').append(
                        '<tr role="row">' +
                        '    <td><span class="dark">' + element.fecha + '</span></td>' +
                        '    <td><span class="dark">' + element.hora + '</span></td>' +
                        '    <td><span class="dark">' + element.tipoDoc + '</span></td>' +
                        '    <td><span class="dark">' + element.modalidad + '</span></td>' +
                        '    <td><span class="dark">' + element.urlVideo + '</span></td>' +
                        '    <td data-id="' + element.id + '" data-fecha="' + element.fecha + '" data-hora="' + element.hora + '" data-tipoDoc="' + element.tipoDoc + '" data-modalidad="' + element.modalidad + '" data-urlvideo="' + element.urlVideo + '" data-iddoc="' + element.idDocumento + '"><a href="javascript:void(0)" id="btn_actualizar_audiencia" onclick="cargarAudiencia(this)">Actualizar</a></td>' +

                        '</tr>'
                    )
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B28)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A28)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}

function cargaModalAudiencias(rolCausa) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-audiencias-causa?rolCausa=" + rolCausa,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);

                //Si no hay audiencias se desactiva el modal
                if (response.length > 0) {
                    //Combo audiencias
                    $.each(response, function(index, element) {
                        $('#lista-modal-audiencias').append(
                            $('<option>', { value: element.urlVideo, text: "Audiencia del " + element.fecha })
                        );
                        if (index == 0) {
                            $("#player-modal-audiencias").attr("src", element.urlVideo);
                        }
                    });
                } else {
                    $("#btn-visualizar-audiencia").attr("disabled", true);
                }
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B29)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A29)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}

function cambioModalAudiencias() {
    var pathVideo = $('#lista-modal-audiencias option:selected').val();
    $("#player-modal-audiencias").attr("src", pathVideo);
}

function publicaDespublicaDocumento(codAsiento, publicacion, notificar) {
    var idUsuario = $("#p_idUsuario").val();
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/publica-despublica?idUsuario=" + idUsuario + "&codAsiento=" + codAsiento + "&publicacion=" + publicacion + "&notificar=" + notificar,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                //var response = $.parseJSON(data.response);
                Swal.fire({
                    icon: 'success',
                    title: 'Publicación actualizada correctamente',
                    text: '',
                    confirmButtonText: 'Ok' //Texto de boton
                }).then((result) => {
                    if (result.isConfirmed) {
                        location.reload();
                    }
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B30)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A30)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}

//Folear Documento
function folearAsiento(codAsiento) {

    var idCausa = $("#p_idCausa").val();
    let token = Cookies.get('token');
    if(typeof token === "undefined"){
        token = "";
    }

    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/foliar-asiento?token="+token+"&idAsiento=" + codAsiento+"&idCausa=" + idCausa,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                Swal.fire({
                    icon: 'success',
                    title: '',
                    text: 'Documento foliado correctamente',
                    confirmButtonText: 'Ok' //Texto de boton
                }).then((result) => {
                    if (result.isConfirmed) {
                        location.reload();
                    }
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B31)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A31)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

//Folear Documento
function refolearDocumento(codAsiento) {
    let token = Cookies.get('token');
    if(typeof token === "undefined"){
        token = "";
    }

    var idCausa = $("#p_idCausa").val();
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/refoliar-asiento?token="+token+"&idAsiento=" + codAsiento + "&idCausa=" + idCausa ,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                Swal.fire({
                    icon: 'success',
                    title: '',
                    text: 'Documento foleado correctamente',
                    confirmButtonText: 'Ok' //Texto de boton
                }).then((result) => {
                    if (result.isConfirmed) {
                        location.reload();
                    }
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B32)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A32)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function cargaEstadoFinalCausa(rolCausa) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-estado-final-causa?rol=" + rolCausa,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);
                //Setear valores de estado por tipo causa
                if (response.clave == 1) { //Demanda
                    $("#check-causa-terminada").attr("idEstado", "4");
                    $("#check-causa-archivada").attr("idEstado", "8");
                    $("#check-causa-suspendida").attr("idEstado", "9");
                    $("#check-causa-conciliacion").attr("idEstado", "52");
                }
                if (response.clave == 2) { //Reclamacion
                    $("#check-causa-terminada").attr("idEstado", "12");
                    $("#check-causa-archivada").attr("idEstado", "16");
                    $("#check-causa-suspendida").attr("idEstado", "17");
                    $("#check-causa-conciliacion").attr("idEstado", "54");
                }
                if (response.clave == 3) { //Solicitud
                    $("#check-causa-terminada").attr("idEstado", "51");
                    $("#check-causa-archivada").attr("idEstado", "31");
                    $("#check-causa-suspendida").attr("idEstado", "32");
                    //$("#check-causa-conciliacion").attr("idEstado", ""); //CONSULTAR
                }
                if (response.clave == 4) { //Consulta
                    $("#check-causa-terminada").attr("idEstado", "36");
                    $("#check-causa-archivada").attr("idEstado", "37");
                    $("#check-causa-suspendida").attr("idEstado", "38");
                    //$("#check-causa-conciliacion").attr("idEstado", ""); //CONSULTAR
                }
                if (response.clave == 5) { //Otros
                    $("#check-causa-terminada").attr("idEstado", "42");
                    $("#check-causa-archivada").attr("idEstado", "46");
                    $("#check-causa-suspendida").attr("idEstado", "47");
                    //$("#check-causa-conciliacion").attr("idEstado", ""); //CONSULTAR
                }
                if (response.clave == 6) { //Exhorto
                    $("#check-causa-terminada").attr("idEstado", "50");
                    $("#check-causa-archivada").attr("idEstado", "56");
                    $("#check-causa-suspendida").attr("idEstado", "57");
                    //$("#check-causa-conciliacion").attr("idEstado", ""); //CONSULTAR
                }
                if (response.clave == 7) { //Demanda Ejecutiva
                    $("#check-causa-terminada").attr("idEstado", "22");
                    $("#check-causa-archivada").attr("idEstado", "26");
                    $("#check-causa-suspendida").attr("idEstado", "27");
                    $("#check-causa-conciliacion").attr("idEstado", "58");
                    $("#check-causa-ejecucion").attr("idEstado", "24");
                }

                //Habilitar/Deshabilitar checks por estado de cierre
                if (response.valor == undefined) {
                    //Marca estado no terminado
                    $("#p_causaTerminada").val("false");
                } else {
                    //Marca estado terminado
                    $("#p_causaTerminada").val("true");
                    //Identifica tipo de estado por tipo de causa
                    if (response.clave == 1) { //Demanda
                        if (response.valor == 4) {
                            $("#check-causa-terminada").prop("checked", true);
                            $("#check-causa-archivada").attr("disabled", true);
                            $("#check-causa-suspendida").attr("disabled", true);
                            $("#check-causa-conciliacion").attr("disabled", true);
                        } else if (response.valor == 8) {
                            $("#check-causa-terminada").attr("disabled", true);
                            $("#check-causa-archivada").prop("checked", true);
                            $("#check-causa-suspendida").attr("disabled", true);
                            $("#check-causa-conciliacion").attr("disabled", true);
                        } else if (response.valor == 9) {
                            $("#check-causa-terminada").attr("disabled", true);
                            $("#check-causa-archivada").attr("disabled", true);
                            $("#check-causa-suspendida").prop("checked", true);
                            $("#check-causa-conciliacion").attr("disabled", true);
                        } else if (response.valor == 52) {
                            $("#check-causa-terminada").attr("disabled", true);
                            $("#check-causa-archivada").attr("disabled", true);
                            $("#check-causa-suspendida").prop("disabled", true);
                            $("#check-causa-conciliacion").attr("checked", true);
                        }
                    }
                    if (response.clave == 2) { //Reclamacion
                        if (response.valor == 12) {
                            $("#check-causa-terminada").prop("checked", true);
                            $("#check-causa-archivada").attr("disabled", true);
                            $("#check-causa-suspendida").attr("disabled", true);
                            $("#check-causa-conciliacion").attr("disabled", true);
                        } else if (response.valor == 16) {
                            $("#check-causa-archivada").prop("checked", true);
                            $("#check-causa-terminada").attr("disabled", true);
                            $("#check-causa-suspendida").attr("disabled", true);
                            $("#check-causa-conciliacion").attr("disabled", true);
                        } else if (response.valor == 17) {
                            $("#check-causa-suspendida").prop("checked", true);
                            $("#check-causa-terminada").attr("disabled", true);
                            $("#check-causa-archivada").attr("disabled", true);
                            $("#check-causa-conciliacion").attr("disabled", true);
                        } else if (response.valor == 58) {
                            $("#check-causa-terminada").attr("disabled", true);
                            $("#check-causa-archivada").attr("disabled", true);
                            $("#check-causa-suspendida").prop("disabled", true);
                            $("#check-causa-conciliacion").attr("checked", true);
                        }
                    }
                    if (response.clave == 3) { //Solicitud
                        if (response.valor == 51) {
                            $("#check-causa-terminada").prop("checked", true);
                            $("#check-causa-archivada").attr("disabled", true);
                            $("#check-causa-suspendida").attr("disabled", true);
                            $("#check-causa-conciliacion").attr("disabled", true);
                        } else if (response.valor == 31) {
                            $("#check-causa-archivada").prop("checked", true);
                            $("#check-causa-terminada").attr("disabled", true);
                            $("#check-causa-suspendida").attr("disabled", true);
                            $("#check-causa-conciliacion").attr("disabled", true);
                        } else if (response.valor == 32) {
                            $("#check-causa-suspendida").prop("checked", true);
                            $("#check-causa-terminada").attr("disabled", true);
                            $("#check-causa-archivada").attr("disabled", true);
                            $("#check-causa-conciliacion").attr("disabled", true);
                        } else if (response.valor == NULL) { //por confirmar
                            $("#check-causa-terminada").attr("disabled", true);
                            $("#check-causa-archivada").attr("disabled", true);
                            $("#check-causa-suspendida").prop("disabled", true);
                            $("#check-causa-conciliacion").attr("checked", true);
                        }
                    }
                    if (response.clave == 4) { //Consulta
                        if (response.valor == 36) {
                            $("#check-causa-terminada").prop("checked", true);
                            $("#check-causa-archivada").attr("disabled", true);
                            $("#check-causa-suspendida").attr("disabled", true);
                            $("#check-causa-conciliacion").attr("disabled", true);
                        } else if (response.valor == 37) {
                            $("#check-causa-archivada").prop("checked", true);
                            $("#check-causa-terminada").attr("disabled", true);
                            $("#check-causa-suspendida").attr("disabled", true);
                            $("#check-causa-conciliacion").attr("disabled", true);
                        } else if (response.valor == 38) {
                            $("#check-causa-suspendida").prop("checked", true);
                            $("#check-causa-terminada").attr("disabled", true);
                            $("#check-causa-archivada").attr("disabled", true);
                            $("#check-causa-conciliacion").attr("disabled", true);
                        } else if (response.valor == NULL) { //por confirmar
                            $("#check-causa-terminada").attr("disabled", true);
                            $("#check-causa-archivada").attr("disabled", true);
                            $("#check-causa-suspendida").prop("disabled", true);
                            $("#check-causa-conciliacion").attr("checked", true);
                        }
                    }
                    if (response.clave == 5) { //Otros
                        if (response.valor == 42) {
                            $("#check-causa-terminada").prop("checked", true);
                            $("#check-causa-archivada").attr("disabled", true);
                            $("#check-causa-suspendida").attr("disabled", true);
                            $("#check-causa-conciliacion").attr("disabled", true);
                        } else if (response.valor == 46) {
                            $("#check-causa-archivada").prop("checked", true);
                            $("#check-causa-terminada").attr("disabled", true);
                            $("#check-causa-suspendida").attr("disabled", true);
                            $("#check-causa-conciliacion").attr("disabled", true);
                        } else if (response.valor == 47) {
                            $("#check-causa-suspendida").prop("checked", true);
                            $("#check-causa-terminada").attr("disabled", true);
                            $("#check-causa-archivada").attr("disabled", true);
                            $("#check-causa-conciliacion").attr("disabled", true);
                        } else if (response.valor == NULL) { //por confirmar
                            $("#check-causa-terminada").attr("disabled", true);
                            $("#check-causa-archivada").attr("disabled", true);
                            $("#check-causa-suspendida").prop("disabled", true);
                            $("#check-causa-conciliacion").attr("checked", true);
                        }
                    }
                    if (response.clave == 6) { //Exhorto
                        if (response.valor == 50) {
                            $("#check-causa-terminada").prop("checked", true);
                            $("#check-causa-archivada").hide();
                            $("#check-causa-suspendida").hide();
                            $("#check-causa-conciliacion").attr("disabled", true);
                        } else if (response.valor == NULL) { //por confirmar
                            $("#check-causa-terminada").attr("disabled", true);
                            $("#check-causa-archivada").attr("disabled", true);
                            $("#check-causa-suspendida").prop("disabled", true);
                            $("#check-causa-conciliacion").attr("checked", true);
                        }
                    }
                    if (response.clave == 7) { //Demanda Ejecutiva
                        if (response.valor == 22) {
                            $("#check-causa-terminada").prop("checked", true);
                            $("#check-causa-archivada").attr("disabled", true);
                            $("#check-causa-suspendida").attr("disabled", true);
                            $("#check-causa-conciliacion").attr("disabled", true);
                            $("#check-causa-ejecucion").attr("disabled", true);
                        } else if (response.valor == 26) {
                            $("#check-causa-archivada").prop("checked", true);
                            $("#check-causa-terminada").attr("disabled", true);
                            $("#check-causa-suspendida").attr("disabled", true);
                            $("#check-causa-conciliacion").attr("disabled", true);
                            $("#check-causa-ejecucion").attr("disabled", true);
                        } else if (response.valor == 27) {
                            $("#check-causa-suspendida").prop("checked", true);
                            $("#check-causa-terminada").attr("disabled", true);
                            $("#check-causa-archivada").attr("disabled", true);
                            $("#check-causa-conciliacion").attr("disabled", true);
                            $("#check-causa-ejecucion").attr("disabled", true);
                        } else if (response.valor == 58) {
                            $("#check-causa-terminada").attr("disabled", true);
                            $("#check-causa-archivada").attr("disabled", true);
                            $("#check-causa-suspendida").prop("disabled", true);
                            $("#check-causa-conciliacion").attr("checked", true);
                            $("#check-causa-ejecucion").attr("disabled", true);
                        } else if (response.valor == 24) {
                            $("#check-causa-terminada").attr("disabled", true);
                            $("#check-causa-archivada").attr("disabled", true);
                            $("#check-causa-suspendida").prop("disabled", true);
                            $("#check-causa-conciliacion").attr("disabled", true);
                            $("#check-causa-ejecucion").attr("checked", true);
                        }
                    }
                }
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B33)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A33)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}

function cambioEstadosFinalesCausa(objeto) {
    let token = Cookies.get('token');
    var causa = $("#p_idCausa").val();
    var estado = $(objeto).prop("checked");
    var accion = $(objeto).attr("id").substring($(objeto).attr("id").lastIndexOf("-") + 1);
    var idEstadoCausa = $(objeto).attr("idEstado");

    if (accion == 'archivada')
        var capAccion = 'archivar';
    if (accion == 'terminada')
        var capAccion = 'terminar';
    if (accion == 'suspendida')
        var capAccion = 'suspender';
    if (accion == 'conciliacion')
        var capAccion = 'conciliar';

    Swal.fire({
        icon: 'question',
        title: capitalizarTexto(capAccion) + ' Causa',
        text: '¿Esta seguro que desea ' + capAccion + ' la causa?',
        confirmButtonText: capitalizarTexto(capAccion),
        showDenyButton: true,
        denyButtonText: 'Cancelar'
    }).then((result) => {
        if (result.isConfirmed) {
            /////////////////////////////////////////////////////////////////////////////////////////////////////////////
            $.ajax({
                type: "GET",
                url: thisWS + "/ver-causa/actualiza-estado-final-causa?causa=" + causa + "&estado=" + estado + "&idEstadoCausa=" + idEstadoCausa,
                contentType: "application/json; charset=ISO-8859-1",
                dataType: "json",
                headers: { token: token },
                beforeSend: function() {
                    //Activa loader
                    //$('#body').addClass('be-loading-active');
                },
                success: function(data) {
                    if (data.status === "200") {
                        //var response = $.parseJSON(data.response);
                        Swal.fire({
                            icon: 'success',
                            title: '',
                            text: 'Estado actualizado correctamente',
                            confirmButtonText: 'Ok' //Texto de boton
                        }).then((result) => {
                            if (result.isConfirmed) {
                                //Desactiva botones
                                if (estado) {
                                    if (accion == "terminada") {
                                        $("#check-causa-archivada").attr("disabled", true);
                                        $("#check-causa-suspendida").attr("disabled", true);
                                    }
                                    if (accion == "archivada") {
                                        $("#check-causa-terminada").attr("disabled", true);
                                        $("#check-causa-suspendida").attr("disabled", true);
                                    }
                                    if (accion == "suspendida") {
                                        $("#check-causa-terminada").attr("disabled", true);
                                        $("#check-causa-archivada").attr("disabled", true);
                                    }
                                } else {
                                    $("#check-causa-archivada").attr("disabled", false);
                                    $("#check-causa-terminada").attr("disabled", false);
                                    $("#check-causa-suspendida").attr("disabled", false);
                                }
                            }
                        });
                    } else {
                        Swal.fire({
                            icon: 'error',
                            title: '¡Lo sentimos!',
                            text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B34)',
                            confirmButtonText: 'Entiendo'
                        });
                    }
                },
                error: function() {
                    Swal.fire({
                        icon: 'error',
                        title: '¡Lo sentimos!',
                        text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A34)',
                        confirmButtonText: 'Entiendo'
                    });
                },
                complete: function() {
                    //Desactiva loader
                    //$('#body').removeClass('be-loading-active');
                }
            });
            /////////////////////////////////////////////////////////////////////////////////////////////////////////////
        } else if (result.isDenied) {
            Swal.fire({
                icon: 'info',
                title: '',
                text: 'Acción cancelada',
                confirmButtonText: 'OK'
            });
            $(objeto).prop("checked", !estado);
        }
    });
}

function seleccionAsiento(objeto) {
    //Activar el asiento seleccionado
    $("div[name='asientos-causa']").removeClass('active');
    $(objeto).addClass('active');

    //Cargar elementos por asiento y documento
    var codAsiento = $(objeto).attr('codigoAsiento');
    var codDocumento = $(objeto).attr('codigoDocumento');

    //Actualizar asiento seleccionado
    $("#p_idAsiento").val(codAsiento);

    listaDocumentosResueltos(codDocumento);
    //listaDocumentosCustodiados(codDocumento);
    listaNotificacionesAsiento(codAsiento);
    listaPatrocinadoresAsiento(codAsiento);
    cargaDocumentosAsiento(codAsiento);
}

function accionesDocumentos(objeto) {

    //Activar el documento seleccionado
    var codDocumento = $(objeto).attr('codDocumento');
    var tipoDocumento = $(objeto).attr('tipoDocumento');
    var nombreDocumento = $(objeto).attr('nombreDocumento');
    var linkOriginal = $(objeto).attr('linkOriginal');
    var linkFoleado = $(objeto).attr('linkFoleado');
    var linkFirmando = $(objeto).attr('linkFirmando');
    var fechaDocumento = $(objeto).attr('fechaDocumento');
    var horaDocumento = $(objeto).attr('horaDocumento');
    var fojaInicial = $(objeto).attr('fojaInicial');
    var fojaFinal = $(objeto).attr('fojaFinal');
    var publicado = $(objeto).attr('publicado');
    var firmado = $(objeto).attr('firmado');

    $('.doc-foja ').each(function(i, obj) {
        $(obj).find('.doc-view').removeClass('selected');
    });

    $(objeto).find('.doc-view').addClass('selected');

    //Mostrar documento
    if (linkFirmando != undefined) {
        showPDF(linkFirmando);
        $("#p_documentoHabilitadoFirma").val("true");
    } else if (linkFoleado != undefined) {
        showPDF(linkFoleado);
        $("#p_documentoHabilitadoFirma").val("true");
    } else if (linkOriginal != undefined) {
        showPDF(linkOriginal);
        $("#p_documentoHabilitadoFirma").val("false");
    } else {
        $("#obj-visor-pdf").attr("src", "N/A");
        $("#p_documentoHabilitadoFirma").val("false");
    }

    //Guardamos datos del documento en vista


    $("#p_tipoDocumento").val(tipoDocumento);
    if("N/A" === tipoDocumento) {
        $("#p_idAdjunto").val(codDocumento);
    } else {
        $("#p_idAdjunto").val("");
        $("#p_idDocumento").val(codDocumento);
    }
    $("#p_linkDocumentoOriginal").val(linkOriginal);
    $("#p_linkDocumentoFoleado").val(linkFoleado);
    $("#p_linkDocumentoFirmado").val(linkFirmando);
    $("#p_documentoPublicado").val(publicado);
    $("#p_documentoFirmado").val(firmado);

    //Activar Publica/Despublica
    //if (element.publicado == true) {
    if (publicado == true) {
        $("#acciones-asiento option[value=publicarConNotificar]").hide();
        $("#acciones-asiento option[value=publicarSinNotificar]").hide();
        $("#acciones-asiento option[value=despublicar]").show();
    } else {
        $("#acciones-asiento option[value=publicarConNotificar]").show();
        $("#acciones-asiento option[value=publicarSinNotificar]").show();
        $("#acciones-asiento option[value=despublicar]").hide();
    }
}

function descargarExpedienteUnificado() {
    var causa = $("#p_idCausa").val();
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/generar-documento-unificado?idCausa=" + causa,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                //var response = $.parseJSON(data.response);
                $('#body').removeClass('be-loading-active');

                ////////////DESCARGA ARCHIVO////////////
                var filename = data.response;
                var element = document.createElement('a');
                element.setAttribute('href', thisDownloaderFileWS + filename );
                element.setAttribute('download', 'data:application/pdf;charset=utf-8');
                document.body.appendChild(element);
                element.click();
                ////////////DESCARGA ARCHIVO////////////
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B35)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A35)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function cargarHacerseParte(rolCausa, rolUsuario, token) {
    if (token != 'unknown') {
        $.ajax({
            type: "GET",
            url: thisWS + "/ver-causa/obtener-hacerse-parte?rolCausa=" + rolCausa + "&token=" + token,
            contentType: "application/json; charset=ISO-8859-1",
            dataType: "json",
            beforeSend: function() {
                //Activa loader
                //$('#body').addClass('be-loading-active');
            },
            success: function(data) {
                if (data.status === "200") {
                    //var response = $.parseJSON(data.response);
                    if (rolUsuario == 'Amicus Curie'
                        || rolUsuario == 'Habilitado en Derecho'
                        || rolUsuario == 'Abogado Externo'
                        || rolUsuario == 'Oficial'
                        || rolUsuario == 'Administrador'
                        || rolUsuario == 'Pasante judicial'
                    ) {
                        if (data.response == 'false') {
                            $("#btn-hacerse-parte").hide();
                            $("#btn-ingresar-escrito").show();
                        } else {
                            $("#btn-hacerse-parte").show();
                            $("#btn-ingresar-escrito").hide();
                        }
                    } else {
                        $("#btn-hacerse-parte").hide();
                        $("#btn-ingresar-escrito").hide();
                    }
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: '¡Lo sentimos!',
                        text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B36)',
                        confirmButtonText: 'Entiendo'
                    });
                }
            },
            error: function() {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A36)',
                    confirmButtonText: 'Entiendo'
                });
            },
            complete: function() {
                //Desactiva loader
                //$('#body').removeClass('be-loading-active');
            }
        });
    }
}

function guardarHacerseParte() {
    var idCausa = $("#p_idCausa").val();
    var idUsuario = $("#p_idUsuario").val();
    var rolJudicial = $("#lista-modal-hacerseParte-roles option:selected").val();

    if (rolJudicial == 'null') {
        //Ocultar modal
        $("#modal-hacerseParte").toggleClass("active");
        $("body").toggleClass("blocked");

        //Mostrar mensaje de error
        Swal.fire({
            icon: 'error',
            title: '¡Falta Información!',
            text: 'Debe seleccionar el rol para hacerse parte.',
            confirmButtonText: 'Entiendo' //Texto de boton
        }).then((result) => {
            if (result.isConfirmed) {
                //Mostrar modal
                $("#modal-hacerseParte").toggleClass("active");
                $("body").toggleClass("blocked");
            }
        });
        return;
    } else if (idCausa.length == 0) {
        //Ocultar modal
        $("#modal-hacerseParte").toggleClass("active");
        $("body").toggleClass("blocked");

        //Mostrar mensaje de error
        Swal.fire({
            icon: 'error',
            title: '¡Error de sesión!',
            text: 'No se puede obtener el identificador de causa, vuelva a ingresar.',
            confirmButtonText: 'Entiendo' //Texto de boton
        }).then((result) => {
            if (result.isConfirmed) {
                window.location.replace("menu-publico.html");
            }
        });
    } else if (idUsuario.length == 0) {
        //Ocultar modal
        $("#modal-hacerseParte").toggleClass("active");
        $("body").toggleClass("blocked");

        //Mostrar mensaje de error
        Swal.fire({
            icon: 'error',
            title: '¡Error de sesión!',
            text: 'No se puede obtener el identificador de usuario, vuelva a ingresar',
            confirmButtonText: 'Entiendo' //Texto de boton
        }).then((result) => {
            if (result.isConfirmed) {
                window.location.replace("menu-publico.html");
            }
        });
    } else {
        $.ajax({
            type: "GET",
            url: thisWS + "/ver-causa/guardar-hacerse-parte?idCausa=" + idCausa + "&idUsuario=" + idUsuario + "&rolJudicial=" + rolJudicial,
            contentType: "application/json; charset=ISO-8859-1",
            dataType: "json",
            beforeSend: function() {
                //Activa loader
                //$('#body').addClass('be-loading-active');
            },
            success: function(data) {
                if (data.status === "200") {
                    //Ocultar modal
                    $("#modal-hacerseParte").toggleClass("active");
                    $("body").toggleClass("blocked");

                    //Mostrar mensaje de éxito
                    Swal.fire({
                        icon: 'success',
                        title: 'Datos guardados exitosamente',
                        text: '',
                        confirmButtonText: 'OK'
                    }).then((result) => {
                        location.reload();
                    });
                } else {
                    //Ocultar modal
                    $("#modal-hacerseParte").toggleClass("active");
                    $("body").toggleClass("blocked");

                    Swal.fire({
                        icon: 'error',
                        title: '¡Lo sentimos!',
                        text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B37)',
                        confirmButtonText: 'Entiendo'
                    });
                }
            },
            error: function() {
                //Ocultar modal
                $("#modal-hacerseParte").toggleClass("active");
                $("body").toggleClass("blocked");

                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A37)',
                    confirmButtonText: 'Entiendo'
                });
            },
            complete: function() {
                //Desactiva loader
                //$('#body').removeClass('be-loading-active');
            }
        });
    }
}

/*function cargarUsuarioCausa(rol, token) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/obtener-usuario-causa?rolCausa=" + rol + "&token=" + token,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function () {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function (data) {
            if (data.status === "200") {
                //var response = $.parseJSON(data.response);
                if (data.response == 'false') {
                    $("#btn-hacerse-parte").show();
                } else {
                    $("#btn-hacerse-parte").hide();
                }
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B38)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function () {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A38)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function () {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}*/

function guardarUsuarioCausa() {
    var idCausa = $("#p_idCausa").val();
    var idUsuario = $("#p_idUsuario").val();

    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/guardar-usuario-causa?idCausa=" + idCausa + "&idUsuario=" + idUsuario,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                //Mostrar mensaje de éxito
                Swal.fire({
                    icon: 'success',
                    title: '',
                    text: 'Acción terminada exitosamente',
                    confirmButtonText: 'OK'
                }).then((result) => {
                    location.reload();
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B39)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A39)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}

function agregarAudiencia() {
    let token = Cookies.get('token');
    var fechaAudiencia = $("#fechaAudiencia").val();
    var urlVideoAudiencia = $("#urlVideoAudiencia").val();
    var modalidad = $("#lista-modalidades").val();
    var nombreModalidad = $('#lista-modalidades option:selected').text();
    var idDocumento = $("#lista-documentos-audiencias").val();
    var nombreDocumento = $('#lista-documentos-audiencias option:selected').text();
    var rol = $("#p_rolCausa").val();
    var idCausa = $("#p_idCausa").val();

    if (fechaAudiencia.length == 0) {
        Swal.fire({
            icon: 'error',
            title: '¡Falta Información!',
            text: 'Debe ingresar la fecha de la audiencia.',
            confirmButtonText: 'Entiendo'
        });
        return;
    } else if (modalidad.length == 0) {
        Swal.fire({
            icon: 'error',
            title: '¡Falta Información!',
            text: 'Debe seleccionar la modalidad.',
            confirmButtonText: 'Entiendo'
        });
        return;
    } else if (!idDocumento) {
        Swal.fire({
            icon: 'error',
            title: '¡Falta Información!',
            text: 'Debe seleccionar la resolucion.',
            confirmButtonText: 'Entiendo'
        });
        return;
    }

    var form = new FormData();
    form.append("idDocumento", idDocumento);
    form.append("urlVideo", urlVideoAudiencia);
    form.append("fecha", fechaAudiencia);
    form.append("modalidad", modalidad);
    form.append("idCausa", idCausa);

    $.ajax({
        type: "POST",
        enctype: 'multipart/form-data',
        url: thisWS + "/ver-causa/agregar-audiencia",
        data: form,
        processData: false,
        contentType: false,
        headers: { token: token },
        beforeSend: function(data) {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                cargaTablaAudiencias(rol);

                $("#fechaAudiencia").val('');
                $("#urlVideoAudiencia").val('');
                $("#lista-modalidades").val('');

                cargaDocumentosAudiencias(idCausa);

                $("#modal-agregarAudicncia").toggleClass("active");
                $("body").toggleClass("blocked");
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B40)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A40)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function actualizarAudiencia() {

    let token = Cookies.get('token');

    var idCausa = $("#p_idCausa").val();
    var idAudiencia = $("#idAudiencia").val();
    var fechaAudiencia = $("#fechaAudiencia").val();
    var urlVideoAudiencia = $("#urlVideoAudiencia").val();
    var modalidad = $("#lista-modalidades").val();
    var idDocumento = $("#lista-documentos-audiencias").val();
    var rol = $("#p_rolCausa").val();


    if (fechaAudiencia.length == 0) {
        Swal.fire({
            icon: 'error',
            title: '¡Falta Información!',
            text: 'Debe ingresar la fecha de la audiencia.',
            confirmButtonText: 'Entiendo'
        });
        return;
    } else if (modalidad.length == 0) {
        Swal.fire({
            icon: 'error',
            title: '¡Falta Información!',
            text: 'Debe seleccionar la modalidad.',
            confirmButtonText: 'Entiendo'
        });
        return;
    } else if (!idDocumento) {
        Swal.fire({
            icon: 'error',
            title: '¡Falta Información!',
            text: 'Debe seleccionar la resolucion.',
            confirmButtonText: 'Entiendo'
        });
        return;
    }

    var form = new FormData();
    form.append("idAudiencia", idAudiencia);
    form.append("idDocumento", idDocumento);
    form.append("urlVideo", urlVideoAudiencia);
    form.append("fecha", fechaAudiencia);
    form.append("modalidad", modalidad);
    form.append("idCausa", idCausa);

    $.ajax({
        type: "POST",
        headers: { token: token },
        enctype: 'multipart/form-data',
        url: thisWS + "/ver-causa/actualizar-audiencia",
        data: form,
        processData: false,
        contentType: false,
        beforeSend: function(data) {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                cargaTablaAudiencias(rol);

                $("#fechaAudiencia").val('');
                $("#urlVideoAudiencia").val('');
                $("#lista-modalidades").val('');

                var idCausa = $("#p_idCausa").val();
                cargaDocumentosAudiencias(idCausa);

                $("#modal-agregarAudicncia").toggleClass("active");
                $("body").toggleClass("blocked");
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B41)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A41)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function hacerseParte() {
    var rolUsuario = $("#p_rolUsuario").val();
    if (rolUsuario == "Receptor") {
        Swal.fire({
            icon: 'question',
            title: '¿Esta seguro que desea hacerse parte?',
            confirmButtonText: 'OK',
            showDenyButton: true,
            denyButtonText: 'Cancelar'
        }).then((result) => {
            if (result.isConfirmed) {
                guardarUsuarioCausa();
            } else if (result.isDenied) {
                //Solo se cierra el alert
                /*Swal.fire({
                    icon: 'info',
                    title: '',
                    text: 'Acción cancelada',
                    confirmButtonText: 'OK'
                });*/
            }
        });
    } else {
        //Mostrar modal hacerse parte
        $("#modal-hacerseParte").toggleClass("active");
        $("body").toggleClass("blocked");
    }
}

function ingresarEscrito() {
    var estadoTerminado = $("#p_causaTerminada").val();
    var rol = $("#p_rolCausa").val();
    var cuaderno = $("#p_listaCuadernos option:selected").val();

    if (estadoTerminado === 'true') {
        Swal.fire({
            icon: 'warning',
            title: 'La Causa se encuentra es estado terminada',
            text: '',
            confirmButtonText: 'Cargar Escrito',
            showDenyButton: true,
            denyButtonText: 'Cancelar'
        }).then((result) => {
            if (result.isConfirmed) {
                window.location.replace("ingreso-escrito.html?rol=" + rol + "&cuaderno=" + cuaderno);
            }
            /*else if(result.isDenied){
                            Swal.fire({
                                icon: 'info',
                                title: '',
                                text: 'No se descarga el documento',
                                confirmButtonText: 'OK'
                            });
                        }*/
        });
    } else {
        window.location.replace("ingreso-escrito.html?rol=" + rol + "&cuaderno=" + cuaderno);
    }
}

function listaDocumentosResueltos(idDocumento) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-documentos-resueltos?idDocumento=" + idDocumento,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);
                if (response.length == 0) {
                    $('#txt-box-resueltos').addClass('no-data');
                    $('#txt-box-resueltos').removeClass('data');
                    $('#txt-box-resueltos').html('No existen documentos resueltos.');
                } else {
                    $('#txt-box-resueltos').addClass('data');
                    $('#txt-box-resueltos').removeClass('no-data');

                    $('#txt-box-resueltos').empty();
                    $.each(response, function(index, element) {
                        $('#txt-box-resueltos').append(
                            //'<div>'+element.nombreNotificado+' ('+element.emailNotificado+') - '+element.mensajeNotificado+'</div>'
                            element.nombrePadre + ' - ' + element.nombreHijo
                        );
                    });
                }
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B42)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A42)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}

/*function listaDocumentosCustodiados(idDocumento) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-documentos-custodiados?idDocumento=" + idDocumento,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function () {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function (data) {
            if (data.status === "200") {
                //var response = $.parseJSON(data.response);
                if (data.response == 'Sin custodia') {
                    $('#txt-box-custodias').addClass('no-data');
                    $('#txt-box-custodias').removeClass('data');

                    $('#txt-box-custodias').empty();
                    $('#txt-box-custodias').html('No existen solicitudes de custodias a resolver.');
                } else {
                    $('#txt-box-custodias').addClass('data');
                    $('#txt-box-custodias').removeClass('no-data');

                    $('#txt-box-custodias').empty();
                    $('#txt-box-custodias').html(data.response);
                }
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B43)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function () {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A43)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function () {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}*/

function listaNotificacionesAsiento(asiento) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-notificaciones-asiento?asiento=" + asiento,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);
                $('#box-notificaciones-divisor').hide();
                $('#box-notificaciones-internos').empty();
                $('#box-notificaciones-externos').empty();
                $.each(response, function(index, element) {
                    if(typeof element.rol != 'undefined') {
                        $('#box-notificaciones-internos').append(
                            '<div>' + element.nombreNotificado + ' (' + element.emailNotificado  + ') - Fecha Notificación: ' + element.fechaNotificacion + '</div>'
                        );
                    } else if(typeof element.perfil != 'undefined') {
                        $('#box-notificaciones-divisor').show();
                        $('#box-notificaciones-externos').append(
                            '<div>' + element.nombreNotificado + ' (' + element.emailNotificado  + ') - Fecha Notificación: ' + element.fechaNotificacion + '</div>'
                        );
                    } else {
                        $('#box-notificaciones-internos').append(
                            '<div>' + element.nombreNotificado + ' (' + element.emailNotificado  + ') - Fecha Notificación: ' + element.fechaNotificacion + '</div>'
                        );
                    }


                    $('#nro-box-notificaciones').html('(' + (index + 1) + ')');
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B44)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A44)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}

function listaPatrocinadoresAsiento(asiento) {
    $('#nro-box-patrocinadores').html('(0)');
    let token = Cookies.get('token');
    if(typeof token === "undefined"){
        token = "";
    }
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-patrocinadores-asiento?token="+token+"&asiento=" + asiento,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);

                $('#box-patrocinadores').empty();
                if (response.creador && response.creador.rol
                    && response.creador.rol !== 'Oficial'
                    && response.creador.rol !== 'Administrador'
                    && response.creador.rol !== 'Pasante judicial'
                ) {
                    $('#box-patrocinadores').append(
                        '<div>' + response.creador.nombre + ' ' + response.creador.apellido + ' (' + response.creador.email + ')' + '</div>'
                    );
                    $('#nro-box-patrocinadores').html('(' + (response.patrocinadores.length + 1) + ')');
                } else if(response.patrocinadores){
                    $('#nro-box-patrocinadores').html('(' + response.patrocinadores.length + ')');
                }
                $.each(response.patrocinadores, function(index, element) {

                    $('#box-patrocinadores').append(
                        '<div>' + element.nombre + ' ' + element.apellido + ' (' + element.email + ')' + (element.fechaFirma ? ' - Fecha Firma: ' + element.fechaFirma  : '') + '</div>'
                    );
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B44)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A44)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}

function cargarDocumento() {
    var idUsuario = $("#p_idUsuario").val();
    var rolCausa = $("#p_rolCausa").val();
    var idCuaderno = $("#p_listaCuadernos option:selected").val();
    var tipoDocumentoLv2 = $("#p_tipoDocumentoLv2 option:selected").val();
    var nombreTipoDocumentoLv2 = $('#p_tipoDocumentoLv2 option:selected').text();
    var tipoDocumentoLv3 = $("#p_tipoDocumentoLv3 option:selected").val();
    var nombreTipoDocumentoLv3 = $('#p_tipoDocumentoLv3 option:selected').text();
    var nombreDocumento = nombreTipoDocumentoLv2;
    var descripcionPendientes = $("#p_descripcionPendiente").val().trim();
    var listaArchivo = $("input[name=listaArchivos]");
    var listaEscrito = $("input[name=listaEscritos]");

    //Validacion de datos
    if (rolCausa.length == 0) {
        Swal.fire({
            icon: 'error',
            title: '¡Ups!',
            text: 'Hubo un problema en la respuesta para encontrar el rol.',
            confirmButtonText: 'Entiendo'
        });
        return;
    } else if (idCuaderno.length == 0) {
        Swal.fire({
            icon: 'error',
            title: '¡Ups!',
            text: 'Hubo un problema en la respuesta para encontrar el cuaderno.',
            confirmButtonText: 'Entiendo'
        });
        return;
    } else if (tipoDocumentoLv2 == 'null') {
        Swal.fire({
            icon: 'error',
            title: '¡Ups!',
            text: 'Debes seleccionar tipo de documento.',
            confirmButtonText: 'Entiendo'
        });
        return;
    } else if (listaArchivo.length == 0 || $('#p_uploadDocumentFile').val().length == 0) {
        Swal.fire({
            icon: 'error',
            title: '¡Ups!',
            text: 'Debes seleccionar un documento.',
            confirmButtonText: 'Entiendo'
        });
        return;
    }

    //Cargar documento
    var uuidDocumento = new Array();
    listaArchivo.each(function(index, element) {
        uuidDocumento.push($(element).val());
    });

    //Cargar escritos
    var escritoResolucion = new Array();
    listaEscrito.each(function(index, element) {
        escritoResolucion.push($(element).val());
    });

    var form = new FormData();
    form.append("idUsuario", idUsuario);
    form.append("rolCausa", rolCausa);
    form.append("idCuaderno", idCuaderno);
    form.append("tipoDocumentoLv2", tipoDocumentoLv2);
    form.append("tipoDocumentoLv3", tipoDocumentoLv3);
    form.append("nombreDocumento", nombreDocumento);
    form.append("descripcionPendientes", descripcionPendientes);
    form.append("uuidDocumento", uuidDocumento);
    form.append("escritoResolucion", escritoResolucion);

    $.ajax({
        type: "POST",
        //headers: { token: token },
        enctype: 'multipart/form-data',
        url: thisWS + "/ver-causa/carga-archivos",
        data: form,
        processData: false,
        contentType: false,
        beforeSend: function(data) {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                //var response = $.parseJSON(data.response);

                //Ocultar modal
                $("#modal-addDocument").toggleClass("active");
                $("body").toggleClass("blocked");

                //Limpiar lista de archivos
                $("#box-archivos").html("");

                //Mensaje exito
                Swal.fire({
                    icon: 'success',
                    title: 'Documento guardado exitosamente',
                    confirmButtonText: 'OK',
                }).then((result) => {
                    if (result.isConfirmed) {
                        var cuaderno = $("#p_listaCuadernos option:selected").val();
                        var tipoDocumento = $("#p_listaDocumentos option:selected").val();
                        cargaAsientoCuaderno(cuaderno, tipoDocumento);
                    }
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B45)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A45)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}

function cargaInputAntecedentesAdicionales(tipoCausa, idCausa) {
    //alert(thisWS + "/ver-causa/lista-tipo-antecedentes-complementarios?tipoCausa=" + tipoCausa + "&idCausa=" + idCausa)
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-tipo-antecedentes-complementarios?tipoCausa=" + tipoCausa + "&idCausa=" + idCausa,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);
                //$('#box-antecedentesComplementarios').empty();
                $.each(response, function(index, element) {
                    if (element.tipoAntecedenteComplementario == 'bd' || element.tipoAntecedenteComplementario == 'lista') { //listas
                        const codigos2nvls = ['9', '12', '13', '36', '39', '40', '59', '61', '79', '81'];
                        var tiene2niveles = codigos2nvls.includes(element.codAntecedenteComplementario);
                        var options = '';
                        var elementoLista = element.listaAntecedenteComplementario.split(';');
                        var seleccionado = element.valorAntecedenteComplementario;
                        elementoLista.forEach(function(valor) {
                            var elemento = valor.split('&');
                            if (tiene2niveles) {
                                if (elemento[2] == 'etiqueta') {
                                    options += '<optgroup label="' + elemento[1] + '">'
                                        //'</optgroup>'
                                }
                                if (seleccionado == elemento[1]) {
                                    options += '<option selected>' + elemento[1] + '</option>';
                                } else {
                                    options += '<option>' + elemento[1] + '</option>';
                                }
                            } else {
                                if (seleccionado == elemento[1]) {
                                    options += '<option selected>' + elemento[1] + '</option>';
                                } else {
                                    options += '<option>' + elemento[1] + '</option>';
                                }
                            }
                        });
                        var input = '<div class="question">' +
                            '<select codigo="' + element.codAntecedenteComplementario + '" tipoDato="' + element.tipoAntecedenteComplementario + '" onchange="guardarAntecedente(this)">' +
                            '<option></option>' +
                            options +
                            '</select>' +
                            '<label>' + element.txtDescripcionAntecedenteComplementario + '</label>' +
                            '</div>';
                    } else { //Otros tipos
                        var input = '<div class="question">' +
                            '<input codigo="' + element.codAntecedenteComplementario + '" tipoDato="' + element.tipoAntecedenteComplementario + '" value="' + (element.valorAntecedenteComplementario == undefined ? '' : element.valorAntecedenteComplementario) + '" type="text" onblur="guardarAntecedente(this)"/>' +
                            '<label>' + element.txtDescripcionAntecedenteComplementario + '</label>' +
                            '</div>';
                    }
                    $('#box-antecedentesComplementarios').append(input);
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B46)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A46)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function guardarAntecedente(objeto) {
    var idAntecedente = $(objeto).attr('codigo');
    var tipoDato = $(objeto).attr('tipoDato');
    var idCausa = $('#p_idCausa').val();
    var dato = (tipoDato == 'lista') ? $('option:selected', objeto).text() : $(objeto).val();

    if (dato.length > 0) {
        //validar campo por tipo de dato
        if (tipoDato == 'fecha') {
            if (!/[0-9]{2}[/|-][0-9]{2}[/|-][0-9]{4}$/.test(dato)) {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Error en el formato de la fecha, debe ser dd/mm/aaaa.',
                    confirmButtonText: 'Entiendo'
                });
                $(objeto).val('');
                return;
            }
        } else if (tipoDato == 'gms') {
            if (!/[0-9.]+[º][0-9.]+['][0-9.]+["]$/.test(dato)) {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Error en el formato de las coordenadas GMS.',
                    confirmButtonText: 'Entiendo'
                });
                $(objeto).val('');
                return;
            }
        } else if (tipoDato == 'wgs84') {
            if (!/-?[0-9]+([.]{1}[0-9]+)?$/.test(dato)) {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Error en el formato de las coordenadas WGS84 (-12345.45).',
                    confirmButtonText: 'Entiendo'
                });
                $(objeto).val('');
                return;
            }
        } else if (tipoDato == 'moneda' || tipoDato == 'numero') {
            if (!/[0-9]+$/.test(dato)) {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Error en el formato del número.',
                    confirmButtonText: 'Entiendo'
                });
                $(objeto).val('');
                return;
            }
        } else if (tipoDato == 'texto') {
            if (dato.length < 3) {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Debe ingresar un texto de al menos 3 caracteres',
                    confirmButtonText: 'Entiendo'
                });
                $(objeto).val('');
                return;
            }
        }

        //Guardar Antecedentes Complementarios
        $.ajax({
            type: "GET",
            url: thisWS + "/ver-causa/guardar-antecedentes-complementario?idCausa=" + idCausa + "&idAntecedente=" + idAntecedente + "&valorAntecedente=" + dato,
            contentType: "application/json; charset=ISO-8859-1",
            dataType: "json",
            beforeSend: function() {
                //Activa loader
                //$('#body').addClass('be-loading-active');
            },
            success: function(data) {
                if (data.status === "200") {
                    //var response = $.parseJSON(data.response);
                    Swal.fire({
                        icon: 'success',
                        title: 'Datos guardados exitosamente',
                        confirmButtonText: 'OK',
                    }).then((result) => {
                        if (result.isConfirmed) {}
                    })
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: '¡Lo sentimos!',
                        text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B47)',
                        confirmButtonText: 'Entiendo'
                    });
                }
            },
            error: function() {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A47)',
                    confirmButtonText: 'Entiendo'
                });
            },
            complete: function() {
                //Desactiva loader
                //$('#body').removeClass('be-loading-active');
            }
        });
    }
}

function cargaDocumentosSalidasCausa(causa) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-documento-salida-terreno?causa=" + causa,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                $('#lista-documentos-salida').empty();
                var response = $.parseJSON(data.response);

                $.each(response, function(index, element) {
                    $('#lista-documentos-salida').append(
                        '<option value="' + element.id + '">' + element.tipoDoc2 + '</option>'
                    );
                });

            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B48)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A48)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function cargaDocumentosAudiencias(causa) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-documento-audiencias?causa=" + causa,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                $('#lista-documentos-audiencias').empty();
                var response = $.parseJSON(data.response);
                $.each(response, function(index, element) {
                    if(element.fojaInicial && element.fojaFinal) {
                        $('#lista-documentos-audiencias').append(
                            '<option value="' + element.id + '">' + element.tipoDoc2 + ' (' + element.fojaInicial + '-' + element.fojaFinal + ')' + '</option>'
                        )
                    } else {
                        $('#lista-documentos-audiencias').append(
                            '<option value="' + element.id + '">' + element.tipoDoc2 + '</option>'
                        )
                    }

                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B49)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A49)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function agregarSalidaTerreno() {

    let token = Cookies.get('token');

    var idCausa = $("#p_idCausa").val();
    var fechaInicioSalida = $("#fechaInicioSalida").val();
    var fechaTerminoSalida = $("#fechaTerminoSalida").val();
    var motivoSalida = $("#motivo-salida").val();
    var documentoSalida = $("#lista-documentos-salida").val();
    var nombreDocumento = $('#lista-documentos-salida option:selected').text();

    if (fechaInicioSalida.length == 0) {
        Swal.fire({
            icon: 'error',
            title: '¡Falta Información!',
            text: 'Debe ingresar la fecha y hora de inicio.',
            confirmButtonText: 'Entiendo'
        });
        return;
    }

    if (fechaTerminoSalida.length == 0) {
        Swal.fire({
            icon: 'error',
            title: '¡Falta Información!',
            text: 'Debe ingresar la fecha y hora de termino.',
            confirmButtonText: 'Entiendo'
        });
        return;
    }

    if (motivoSalida.length == 0) {
        Swal.fire({
            icon: 'error',
            title: '¡Falta Información!',
            text: 'Debe ingresar el motivo de salida.',
            confirmButtonText: 'Entiendo'
        });
        return;
    }

    if (documentoSalida == null || documentoSalida.length == 0) {
        Swal.fire({
            icon: 'error',
            title: '¡Falta Información!',
            text: 'Debe seleccionar un documento.',
            confirmButtonText: 'Entiendo'
        });
        return;
    }

    var form = new FormData();
    form.append("fechaInicioSalida", fechaInicioSalida);
    form.append("fechaTerminoSalida", fechaTerminoSalida);
    form.append("documentoSalida", documentoSalida);
    form.append("motivoSalida", motivoSalida);
    form.append("idCausa", idCausa);

    $.ajax({
        type: "POST",
        //headers: { token: token },
        enctype: 'multipart/form-data',
        url: thisWS + "/ver-causa/agregar-salida-terreno",
        data: form,
        processData: false,
        contentType: false,
        headers: { token: token },
        beforeSend: function(data) {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var idCausa = $("#p_idCausa").val();
                cargaSalidasCausa(idCausa);

                $("#fechaInicioSalida").val('');
                $("#fechaTerminoSalida").val('');
                $("#motivo-salida").val('');

                var idCausa = $("#p_idCausa").val();
                cargaDocumentosSalidasCausa(idCausa);

                $("#modal-salidaTerreno").toggleClass("active");
                $("body").toggleClass("blocked");
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B50)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A50)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });

}

function quitarSalida(objeto) {


    Swal.fire({
        icon: 'question',
        title: 'Salida a terreno',
        text: '¿Esta seguro que desea elimiar la salida a terreno?',
        confirmButtonText: 'Eliminar',
        showDenyButton: true,
        denyButtonText: 'Cancelar'
    }).then((result) => {
        if (result.isConfirmed) {
            var idCausa = $("#p_idCausa").val();
            let token = Cookies.get('token');
            var idSalida = $(objeto).attr('data-salida');
            $.ajax({
                type: "DELETE",
                url: thisWS + "/ver-causa/eliminar-salida-terreno?idSalidaTerreno=" + idSalida + "&idCausa=" + idCausa,
                contentType: "application/json; charset=ISO-8859-1",
                dataType: "json",
                headers: { token: token },
                beforeSend: function(data) {
                    //Activa loader
                    $('#body').addClass('be-loading-active');
                },
                success: function(data) {
                    if (data.status === "200") {
                        if (data.response == "true") {
                            var idCausa = $("#p_idCausa").val();
                            cargaDocumentosSalidasCausa(idCausa);
                            $(objeto).parent().parent().remove();
                        } else {
                            Swal.fire('Se produjo un error al guardar los datos, si el problema persiste contactese con soporte', '', 'error')
                        }
                    } else {
                        Swal.fire({
                            icon: 'error',
                            title: '¡Lo sentimos!',
                            text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B51)',
                            confirmButtonText: 'Entiendo'
                        });
                    }
                },
                error: function() {
                    Swal.fire({
                        icon: 'error',
                        title: '¡Lo sentimos!',
                        text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A51)',
                        confirmButtonText: 'Entiendo'
                    });
                },
                complete: function() {
                    //Desactiva loader
                    $('#body').removeClass('be-loading-active');
                }
            });
        } else if (result.isDenied) {
            Swal.fire({
                icon: 'info',
                title: '',
                text: 'Acción cancelada',
                confirmButtonText: 'OK'
            });
            $(objeto).prop("checked", !estado);
        }
    });

}

function cargaSalidasCausa(causa) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/lista-salida-terreno?causa=" + causa,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);
                $('#tabla-lista-salidas').empty();
                $.each(response, function(index, element) {
                    $('#tabla-salidas-terreno').append(
                        '<tr role="row">' +
                        '<td><span class="dark">' + element.fechaInicio + '</span></td>' +
                        '<td><span class="dark">' + element.fechaTermino + '</span></td>' +
                        '<td><span class="dark">' + element.tipoDoc2 + '</span></td>' +
                        '<td><span class="dark">' + element.motivo + '</span></td>' +
                        '<td><a href="javascript:void(0)" data-salida="' + element.id + '" onclick="quitarSalida(this)">Eliminar</a></td>' +
                        '</tr>'
                    )
                });


            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B52)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A52)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}

function actualizaParticipantes(objeto) {


    var token = Cookies.get('token');
    let tipo = '';
    if ("lista-administracion-relatores" === objeto.id) {
        tipo = "relator";
    } else if ("lista-administracion-redactores" === objeto.id) {
        tipo = "redactor";
    } else if ("lista-administracion-asesoresCientificos" === objeto.id) {
        tipo = "asesor";
    }
    let rolCausa = $("#p_rolCausa").val();
    let idCausa = $("#p_idCausa").val();

    var form = new FormData();
    form.append("tipo", tipo);
    form.append("idUsuario", objeto.value);
    form.append("rolCausa", rolCausa);
    form.append("idCausa", idCausa);

    $.ajax({
        type: "POST",
        enctype: 'multipart/form-data',
        url: thisWS + "/ver-causa/actualiza-participante",
        data: form,
        processData: false,
        contentType: false,
        headers: { token: token },
        beforeSend: function(data) {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                //$("body").toggleClass("blocked");
                if ("lista-administracion-relatores" === objeto.id) {
                    $('#lbl-relator').html('Redactor: ' + $('#' + objeto.id + ' option:selected').text());
                } else if ("lista-administracion-redactores" === objeto.id) {
                    $('#lbl-redactor').html('Relator: ' + $('#' + objeto.id + ' option:selected').text());
                } else if ("lista-administracion-asesoresCientificos" === objeto.id) {
                    tipo = "asesor";
                }
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B53)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A53)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function listaParticipantes(idCausa) {
    $.ajax({
        async: true,
        type: "GET",
        url: thisWS + "/ver-causa/lista-participantes?causa=" + idCausa,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {

                var response = $.parseJSON(data.response);
                $.each(response, function(index, element) {
                    if (element.clave == 13) {
                        $('#lista-administracion-redactores').val(element.valor);
                        $('#lbl-redactor').html('Redactor: ' + $('#lista-administracion-redactores option:selected').text())
                    } else if (element.clave == 1) {
                        $('#lista-administracion-relatores').val(element.valor);
                        $('#lbl-relator').html('Relator: ' + $('#lista-administracion-relatores option:selected').text())
                    } else if (element.clave == 6) {
                        $('#lista-administracion-asesoresCientificos').val(element.valor);
                    }
                });

            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B54)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A54)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function cargarAudiencia(objeto) {
    let parent = $(objeto).parent();
    let id = parent.attr('data-id');
    let fecha = parent.attr('data-fecha');
    let hora = parent.attr('data-hora');
    let modalidad = parent.attr('data-modalidad');
    let urlVideo = parent.attr('data-urlvideo');
    let idDoc = parent.attr('data-iddoc');
    let tipoDoc = parent.attr('data-tipodoc');

    $('#idAudiencia').val(id);
    $('#fechaAudiencia').val(fecha + ' ' + hora);
    $('#lista-modalidades').val(modalidad.toLowerCase());
    $('#urlVideoAudiencia').val(urlVideo);

    $('#lista-documentos-audiencias').append(
        '<option value="' + idDoc + '">' + tipoDoc + '</option>'
    );
    $('#lista-documentos-audiencias').val(idDoc);

    $("#modal-agregarAudicncia").toggleClass("active");
    $("body").toggleClass("blocked");

    $('#btnActualizarAudiencia').show();
    $('#btnAgregarAudiencia').hide();

}

function inicioAgregarLitigante(titulo) {
    $("#p_tipoPersona").val('');
    $("#p_rut").val('');
    $("#p_rolJudicial").val('');
    $("#p_nombre").val('');
    $("#p_apellido").val('');
    $("#p_emailLitigante").val('');
    $("#p_tipoPersona").prop("disabled", false);
    $('#btnActualizarLitigante').hide();
    $('#btnAgregarLitigante').show();
    $("#modal-agregar-litigante").toggleClass("active");
    $("body").toggleClass("blocked");
}

var Fn = {
    //Valida el rut con su cadena completa "XXXXXXXX-X"
    validaRut: function(rutCompleto) {
        rutCompleto = rutCompleto.replace("‐", "-");
        if (!/^[0-9]+[-|‐]{1}[0-9kK]{1}$/.test(rutCompleto)) return false;
        var tmp = rutCompleto.split("-");
        var digv = tmp[1];
        var rut = tmp[0];
        if (digv == "K") digv = "k";

        return Fn.dv(rut) == digv;
    },
    dv: function(T) {
        var M = 0,
            S = 1;
        for (; T; T = Math.floor(T / 10)) S = (S + (T % 10) * (9 - (M++ % 6))) % 11;
        return S ? S - 1 : "k";
    },
};

function existeLitigante(rutLitigante) {
    let existe;
    $.ajax({
        async: false,
        type: "GET",
        url: thisWS + "/ingreso-causa/existe-litigante?rut=" + rutLitigante,
        dataType: "json",
        success: function(data) {
            if (data.status === "200") {
                existe = data.response;
            }
        },
    });

    return existe;
}

function cargaDatosLitigante(rut) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ingreso-causa/carga-datos-litigante?rut=" + rut,
        dataType: "json",
        beforeSend: function(data) {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);
                $("#p_nombre").val(response.txtNombre);
                $("#p_apellido").val(response.txtApellido);
                $("#p_tipoPersona").val(response.codTipoPersona);
                $("#p_tipoPersona").prop("disabled", false);
                //$('#p_rolJudicial').val(response.codRolJudicial);
                $("#p_emailLitigante").val(response.txtEmail);
            }
        },
        error: function(err) {
            console.log(err);
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function cargaRolProcesal(idTipoCausa, perfil) {
    $.ajax({
        type: "GET",
        url: thisWS + "/ingreso-causa/lista-roles-juridicos?idTipoCausa=" + idTipoCausa + "&perfil=" + perfil,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);
                $("#p_rolJudicial")
                    .empty()
                    .append($("<option>", { value: "null", text: "" }));
                $.each(response, function(index, element) {
                    $("#p_rolJudicial").append(
                        $("<option>", { value: element.clave, text: element.valor })
                    );
                });
            } else {
                //TODO
            }
        },
        error: function() {
            Swal.fire({
                icon: "error",
                title: 'Error metodo "Lista roles juridicos", no se encuentras datos...',
                text: "",
                confirmButtonText: "OK",
            });
        },
    });
}

//Agrega Litigante
function agregarLitigante() {
    var codTipoPersona = $("#p_tipoPersona").val();
    var txtRut = $("#p_rut").val().startsWith("0") ?
        $("#p_rut").val().replace(/\./g, "").slice(1) :
        $("#p_rut").val().replace(/\./g, "");
    var codRolJudicial = $("#p_rolJudicial").val();
    var nombre = $("#p_nombre").val();
    var apellido = $("#p_apellido").val();
    var email = $("#p_emailLitigante").val();
    var idCausa = $("#p_idCausa").val();
    let rolCausa = $("#p_rolCausa").val();

    if (nombre !== "") {
        if (nombre.length < 3) {
            $("#p_nombre").focus();
            Swal.fire({
                icon: "error",
                title: "",
                text: "Debe ingresar un nombre valido.",
                confirmButtonText: "Entiendo",
            });
            return;
        }
    } else {
        $("#p_nombre").focus();
        Swal.fire({
            icon: "error",
            title: "",
            text: "Debe ingresar un nombre.",
            confirmButtonText: "Entiendo",
        });
        return;
    }

    if('J' !== codTipoPersona) {
        if (apellido !== "") {
            if (apellido.length < 3) {
                $("#p_apellido").focus();
                Swal.fire({
                    icon: "error",
                    title: "",
                    text: "Debe ingresar un apelido valido.",
                    confirmButtonText: "Entiendo",
                });
                return;
            }
        } else {
            $("#p_apellido").focus();
            Swal.fire({
                icon: "error",
                title: "",
                text: "Debe ingresar un apellido.",
                confirmButtonText: "Entiendo",
            });
            return;
        }
    }


    if (codTipoPersona == "null") {
        $("#p_tipoPersona").focus();
        Swal.fire({
            icon: "error",
            title: "",
            text: "Debe seleccionar un tipo de persona.",
            confirmButtonText: "Entiendo",
        });
        return;
    } else if (txtRut.length == 0) {
        $("#p_rut").focus();
        Swal.fire({
            icon: "error",
            title: "",
            text: "Debe ingresar el RUT.",
            confirmButtonText: "Entiendo",
        });
        return;
    } else if (!Fn.validaRut(txtRut)) {
        $("#p_rut").focus();
        Swal.fire({
            icon: "error",
            title: "",
            text: "El RUT ingresado no es válido.",
            confirmButtonText: "Entiendo",
        });
    } else if (codRolJudicial === null) {
        $("#p_rolJudicial").focus();
        Swal.fire({
            icon: "error",
            title: "",
            text: "Debe seleccionar un ROL judicial.",
            confirmButtonText: "Entiendo",
        });
        return;
    } else {

        var form = new FormData();
        form.append("idCausa", idCausa);
        form.append("rolJudicial", codRolJudicial);
        form.append("rut", txtRut);
        form.append("nombre", nombre);
        form.append("apellido", apellido);
        form.append("email", email);
        form.append("tipoPersona", codTipoPersona);


        $.ajax({
            type: "POST",
            enctype: 'multipart/form-data',
            url: thisWS + "/ver-causa/agrega-litigante",
            data: form,
            processData: false,
            contentType: false,
            beforeSend: function(data) {
                //Activa loader
                $('#body').addClass('be-loading-active');
            },
            success: function(data) {
                if (data.status === "200" && data.response == 'true') {
                    //Mensaje exito
                    Swal.fire({
                        icon: 'success',
                        title: 'Litigante agregado exitosamente',
                        confirmButtonText: 'OK',
                    }).then((result) => {
                        cargaLitigantesCausa(rolCausa,$("#p_rolUsuario").val());
                        $("#modal-agregar-litigante").toggleClass("active");
                        $("body").toggleClass("blocked");
                    });
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: '¡Lo sentimos!',
                        text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B55)',
                        confirmButtonText: 'Entiendo'
                    });
                }
            },
            error: function() {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A55)',
                    confirmButtonText: 'Entiendo'
                });
            },
            complete: function() {
                //Desactiva loader
                $('#body').removeClass('be-loading-active');
            }
        });

    }
}

function cambarTipoDeTercero(idCausaLitigante, idRolJudicial) {

    let rolCausa = $("#p_rolCausa").val();
    var form = new FormData();
    form.append("idCausaLitigante", idCausaLitigante);
    form.append("rolJudicial", idRolJudicial);

    $.ajax({
        type: "POST",
        enctype: 'multipart/form-data',
        url: thisWS + "/ver-causa/actualizar-causa-litigante",
        data: form,
        processData: false,
        contentType: false,
        beforeSend: function(data) {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200" && data.response == 'true') {
                cargaLitigantesCausa(rolCausa,$("#p_rolUsuario").val());
                //Mensaje exito
                Swal.fire({
                    icon: 'success',
                    title: 'Litigante actualizado exitosamente',
                    confirmButtonText: 'OK',
                }).then((result) => {

                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B56)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A56)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function eliminarLitigante(idCausaLitigante) {

    let rolCausa = $("#p_rolCausa").val();
    var form = new FormData();
    form.append("idCausaLitigante", idCausaLitigante);

    $.ajax({
        type: "POST",
        enctype: 'multipart/form-data',
        url: thisWS + "/ver-causa/elimina-causa-litigante",
        data: form,
        processData: false,
        contentType: false,
        beforeSend: function(data) {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200" && data.response == 'true') {
                cargaLitigantesCausa(rolCausa,$("#p_rolUsuario").val());
                //Mensaje exito
                Swal.fire({
                    icon: 'success',
                    title: 'Litigante eliminado exitosamente',
                    confirmButtonText: 'OK',
                }).then((result) => {

                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B57)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A57)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function ingresoCorreo(idx,idCausaLitigante,causaNotif,email) {


    if(causaNotif) {
        $('#idCausaNotif').val(causaNotif);
        $('#emailNotif').val(email);
        $('#btnActualizarEmailNotif').show();
        $('#btnEliminarEmailNotif').show();
        $('#btnAgregarEmailNotif').hide();
    } else {
        $('#idCausaNotif').val('');
        $('#emailNotif').val('');
        $('#btnActualizarEmailNotif').hide();
        $('#btnEliminarEmailNotif').hide();
        $('#btnAgregarEmailNotif').show();
    }

    $('#idCausaLitiganteNotif').val(idCausaLitigante);
    $('#spanActualizarNotif').html(idx);
    $("#modal-actualizar-notif").toggleClass("active");
}

function actualizarCorreoNotif() {
    let rolCausa = $("#p_rolCausa").val();
    var form = new FormData();
    form.append("idCausaNotif", $('#idCausaNotif').val());
    form.append("email", $('#emailNotif').val());


    $.ajax({
        type: "POST",
        enctype: 'multipart/form-data',
        url: thisWS + "/ver-causa/actualiza-correo-notif",
        data: form,
        processData: false,
        contentType: false,
        beforeSend: function(data) {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200" && data.response == 'true') {
                cargaLitigantesCausa(rolCausa,$("#p_rolUsuario").val());
                //Mensaje exito
                Swal.fire({
                    icon: 'success',
                    title: 'Correo actualizado correctamente',
                    confirmButtonText: 'OK',
                }).then((result) => {

                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B57)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A57)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            $("#modal-actualizar-notif").toggleClass("active");
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function eliminarCorreoNotif() {
    let rolCausa = $("#p_rolCausa").val();
    var form = new FormData();
    form.append("idCausaNotif", $('#idCausaNotif').val());

    $.ajax({
        type: "POST",
        enctype: 'multipart/form-data',
        url: thisWS + "/ver-causa/eliminar-correo-notif",
        data: form,
        processData: false,
        contentType: false,
        beforeSend: function(data) {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200" && data.response == 'true') {
                cargaLitigantesCausa(rolCausa,$("#p_rolUsuario").val());
                //Mensaje exito
                Swal.fire({
                    icon: 'success',
                    title: 'Correo eliminado correctamente',
                    confirmButtonText: 'OK',
                }).then((result) => {

                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B57)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A57)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            $("#modal-actualizar-notif").toggleClass("active");
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function agregarCorreoNotif() {

    let rolCausa = $("#p_rolCausa").val();
    var form = new FormData();
    form.append("idCausaLitigante", $('#idCausaLitiganteNotif').val());
    form.append("email", $('#emailNotif').val());


    $.ajax({
        type: "POST",
        enctype: 'multipart/form-data',
        url: thisWS + "/ver-causa/agrega-correo-notif",
        data: form,
        processData: false,
        contentType: false,
        beforeSend: function(data) {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200" && data.response == 'true') {
                cargaLitigantesCausa(rolCausa,$("#p_rolUsuario").val());
                //Mensaje exito
                Swal.fire({
                    icon: 'success',
                    title: 'Correo agregado correctamente',
                    confirmButtonText: 'OK',
                }).then((result) => {

                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B57)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A57)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            $("#modal-actualizar-notif").toggleClass("active");
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function inicioMoverLitigante(id, rut, rutDV, rolJudicial) {

    $("#p_rut").val('' + rut + rutDV);
    $("#p_tipoPersona").prop("disabled", true);
    $("#p_rolJudicial").val(rolJudicial);
    $("#idCausaLitiganteUpdate").val(id);
    $('#btn-buscar-Litigante').trigger('click');
    $('#btnActualizarLitigante').show();
    $('#btnAgregarLitigante').hide();
    $("#modal-agregar-litigante").toggleClass("active");
    $("body").toggleClass("blocked");


}

function actualizarLitigante() {
    let id = $("#idCausaLitiganteUpdate").val();
    let rolJudicial = $("#p_rolJudicial").val();
    $("#modal-agregar-litigante").toggleClass("active");
    $("body").toggleClass("blocked");
    cambarTipoDeTercero(id, rolJudicial);
}

function agregarEmplazamiento() {

    var fechaInicio = $("#fechaInicioEmplazamiento").val();
    var idCausa = $("#p_idCausa").val();

    if (fechaInicio.length == 0) {
        Swal.fire({
            icon: 'error',
            title: '¡Falta Información!',
            text: 'Debe ingresar la fecha y hora de inicio.',
            confirmButtonText: 'Entiendo'
        });
        return;
    }

    var form = new FormData();
    form.append("fechaInicio", fechaInicio);
    form.append("idCausa", idCausa);

    $.ajax({
        type: "POST",
        enctype: 'multipart/form-data',
        url: thisWS + "/ver-causa/actualiza-emplazamiento",
        data: form,
        processData: false,
        contentType: false,
        beforeSend: function(data) {
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                $('#tabla-emplazamiento tbody').append(
                    '<tr role="row">' +
                    '<td><span class="dark">' + fechaInicio + '</span></td>' +
                    //'<td><a href="javascript:void(0)"  onclick="quitarEmplazamiento(this)">Eliminar</a></td>' +
                    '<td></td>' +
                    '</tr>'
                )
                $('#div-agregar-emplazamiento').hide();
                $("#modal-emplazamiento").toggleClass("active");
                $("body").toggleClass("blocked");
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B58)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A58)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });

}

function quitarEmplazamiento() {

    Swal.fire({
        icon: 'question',
        title: 'Quitar Emplazamiento',
        text: '¿Esta seguro que desea eliminar la fecha de emplazamiento?',
        confirmButtonText: 'Eliminar',
        showDenyButton: true,
        denyButtonText: 'Cancelar'
    }).then((result) => {
        if (result.isConfirmed) {
            var idCausa = $("#p_idCausa").val();
            var form = new FormData();
            form.append("fechaInicio", "null");
            form.append("idCausa", idCausa);

            $.ajax({
                type: "POST",
                enctype: 'multipart/form-data',
                url: thisWS + "/ver-causa/actualiza-emplazamiento",
                data: form,
                processData: false,
                contentType: false,
                beforeSend: function(data) {
                    $('#body').addClass('be-loading-active');
                },
                success: function(data) {
                    if (data.status === "200") {
                        $('#tabla-emplazamiento tbody').empty();
                        $('#div-agregar-emplazamiento').show();
                    } else {
                        Swal.fire({
                            icon: 'error',
                            title: '¡Lo sentimos!',
                            text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B59)',
                            confirmButtonText: 'Entiendo'
                        });
                    }
                },
                error: function() {
                    Swal.fire({
                        icon: 'error',
                        title: '¡Lo sentimos!',
                        text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A59)',
                        confirmButtonText: 'Entiendo'
                    });
                },
                complete: function() {
                    //Desactiva loader
                    $('#body').removeClass('be-loading-active');
                }
            });
        }
    });
}

function listaFirmantes() {
    $.ajax({
        async: true,
        type: "GET",
        url: thisWS + "/signer/get-list",
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);
                $("#lista-modal-firmantes")
                    .empty()
                    .append($("<option>", { value: "null", text: "" }));
                $.each(response, function(index, element) {
                    $("#lista-modal-firmantes").append(
                        $("<option>", { value: element.rutFirmante, text: element.nombreFirmante })
                    );
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B60)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A60)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function agregarFirmanteLista() {
    var rut = $('#lista-modal-firmantes option:selected').val();
    var nombre = $('#lista-modal-firmantes option:selected').text();

    if(rut == '' || nombre == ''){
        Swal.fire({
            icon: 'error',
            title: '¡Error!',
            text: 'Debe seleccionar un firmante',
            confirmButtonText: 'Entiendo'
        });
    }else{
        var cantidad = $('#p_cantidadFirmantesSeleccionados').val();
        if(Number(cantidad) < 4){
            var paginas = $('#paginas-doc-firma').val();
            var filas = '<tr>' +
                        '<td class="cell-detail">' +
                            '<span class="cell-detail-description">' +
                                '<select name="lista-modal-posicion" rut="' + rut + '" onchange="actualizar_posicion_firmante(this)">';



                for(var x =0; x<= Number(paginas); x++) {
                    if(x=== Number(paginas))
                        filas+='<option name="posicionFirma" value="' + x + '" selected="selected">' + x + '</option>';
                    else
                        filas+='<option name="posicionFirma" value="' + x + '">' + x + '</option>';
                }

                filas += '</select>' +
                            '</span>' +
                        '</td>' +
                        '<td class="cell-detail">' +
                            '<span class="cell-detail-description">' +
                                rut + ' - ' + nombre +
                            '</span>' +
                        '</td>' +
                        '<td class="cell-detail">' +
                            '<a href="javascript:void(0);" class="eliminar-firmante" ' +
                                'rut="' + rut + '" nombre="' + nombre + '">Eliminar</a>' +
                        '</td>' +
                    '</tr>';
            $('#table_modal_firmantes tbody').append(filas);



            //Actualizar número de firmantes
            $('#p_cantidadFirmantesSeleccionados').val(Number(cantidad) + 1);

            //Agregar firmante
            $('#box-firmantes').append('<input type="hidden" name="listaFirmantes" posicion="'+ paginas +'" value="' + rut + '">');

            //Quitar elemento del select
            $('#lista-modal-firmantes option[value='+rut+']').remove();
        }else{
            Swal.fire({
                icon: 'error',
                title: '¡Error!',
                text: 'Cantidad máxima de firmantes alcanzada',
                confirmButtonText: 'Entiendo'
            });
        }
    }
}

function solicitarFirma() {

    var token = Cookies.get('token');
    var idUsuario = $("#p_idUsuario").val();
    var idCausa = $("#p_idCausa").val();
    var rolCausa = $("#p_rolCausa").val();
    var idAsiento = $("#p_idAsiento").val();
    var listaFirmantes = $("input[name=listaFirmantes]");
    var rutFirmantes = new Array();
    var posicionFirmantes = new Array();

    if(listaFirmantes.length > 0){
        listaFirmantes.each(function(index, element) {
            rutFirmantes.push(element.value);
            posicionFirmantes.push(element.getAttribute("posicion"));
        });
    }else{
        Swal.fire({
            icon: 'error',
            title: '¡Error!',
            text: 'Debe seleccionar al menos un firmante',
            confirmButtonText: 'Entiendo'
        });
        return;
    }   

    Swal.fire({
        icon: 'question',
        title: 'Firmar Documento',
        text: '¿Esta seguro que desea solicitar la firma de los firmantes seleccionados para el documento?',
        confirmButtonText: 'Requerir Firma',
        showDenyButton: true,
        denyButtonText: 'Cancelar'
    }).then((result) => {
        if (result.isConfirmed) {
            //Cargar firmantes
            var form = new FormData();
            form.append("idUsuario", idUsuario);
            form.append("idCausa", idCausa);
            form.append("rolCausa", rolCausa);
            form.append("idAsiento", idAsiento);
            form.append("rutFirmantes", rutFirmantes);
            form.append("posicionFirmantes", posicionFirmantes);

            $.ajax({
                type: "POST",
                enctype: 'multipart/form-data',
                url: thisWS + "/firma/crear-cola-firma",
                data: form,
                processData: false,
                contentType: false,
                headers: { token: token },
                beforeSend: function(data) {
                    //Activa loader
                    //$('#body').addClass('be-loading-active');
                },
                success: function(data) {
                    if (data.status === "200" && data.response == "true"){
                        //Ocultar Modal
                        $("#modal-requerirFirma").toggleClass("active");

                        //Mensaje exito
                        Swal.fire({
                            icon: 'success',
                            title: 'Firmantes agregados exitosamente',
                            confirmButtonText: 'OK',
                        }).then((result) => {
                            //Recargar pagina
                            document.location.reload();
                        });
                    } else {
                        Swal.fire({
                            icon: 'error',
                            title: '¡Lo sentimos!',
                            text: 'Hubo un problema en el registro de firmantes. Reintente más tarde. (DTC-B61)',
                            confirmButtonText: 'Entiendo'
                        });
                    }
                },
                error: function() {
                    Swal.fire({
                        icon: 'error',
                        title: '¡Lo sentimos!',
                        text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A61)',
                        confirmButtonText: 'Entiendo'
                    });
                },
                complete: function() {
                    //Desactiva loader
                    //$('#body').removeClass('be-loading-active');
                }
            });
        } else if (result.isDenied) {
            /*Swal.fire({
                icon: 'info',
                title: '',
                text: 'No se folia el documento',
                confirmButtonText: 'OK'
            });*/
        }
    });
}

function actualizar_posicion_firmante(objeto){
    var rut = objeto.getAttribute("rut");
    var posicion = objeto.options[objeto.selectedIndex].text;

    var listaFirmantes = $("input[name=listaFirmantes]");
    listaFirmantes.each(function(index, element) {
        if(element.value == rut){
            element.setAttribute("posicion", posicion);
        }
    });
}

function btn_copiar_link_documento(){

    let tipoDoc = $("#p_tipoDocumento").val();
    var link = detalleCausa + $("#p_rolCausa").val() + "&doc=" + $("#p_idDocumento").val();
    if(tipoDoc === "N/A") {
        link += "&idAdjunto=" + $("#p_idAdjunto").val();
    }

    navigator.clipboard.writeText(link)
    .then(() => {
        Swal.fire({
            icon: 'success',
            title: '¡Link copiado!',
            showConfirmButton: false,
            timer: 1000
        });
    })
    .catch(err => {
        Swal.fire({
            icon: 'error',
            title: '¡No se pudo crear el link!',
            showConfirmButton: false,
            timer: 1000
        });
    })
}

function btn_descargar_asiento(){
    var idAsiento = $("#p_idAsiento").val();
    $.ajax({
        type: "GET",
        url: thisWS + "/ver-causa/descarga-asiento?idAsiento=" + idAsiento,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        beforeSend: function() {
            //Activa loader
            $('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                //var response = $.parseJSON(data.response);
                $('#body').removeClass('be-loading-active');

                ////////////DESCARGA ARCHIVO////////////
                var filepath = data.response;
                var filename = filepath.replace(/^.*[\\/]/, '')
                var element = document.createElement('a');
                element.setAttribute('href', thisDownloaderFileWS + filepath );
                //element.setAttribute('download', filename);
                document.body.appendChild(element);
                element.click();
                ////////////DESCARGA ARCHIVO////////////
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B35)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A35)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            $('#body').removeClass('be-loading-active');
        }
    });
}

function btn_actualizar_caratula(){

    let token = Cookies.get('token');
    var idCausa = $("#p_idCausa").val();
    var nuevaCaratuta = $("#p_caratulaCausa").val().trim();
    $.ajax({
        async: true,
        type: "GET",
        url: thisWS + "/ver-causa/actualiza-caratula?idCausa="+idCausa+"&caratulaCausa="+nuevaCaratuta,
        contentType: "application/json; charset=ISO-8859-1",
        dataType: "json",
        headers: { token: token },
        beforeSend: function() {
            //Activa loader
            //$('#body').addClass('be-loading-active');
        },
        success: function(data) {
            if (data.status === "200") {
                var response = $.parseJSON(data.response);
                if(response.valor === 'true'){
                    Swal.fire({
                        icon: 'success',
                        title: '¡Éxito!',
                        text: 'La caratula se actualizó correctamente',
                        confirmButtonText: 'Entiendo'
                    });
                }else{
                    Swal.fire({
                        icon: 'error',
                        title: '¡Lo sentimos!',
                        text: 'Hubo un problema al actualizar la caratula. Reintente más tarde. (DTC-C70)',
                        confirmButtonText: 'Entiendo'
                    });
                }
            } else {
                Swal.fire({
                    icon: 'error',
                    title: '¡Lo sentimos!',
                    text: 'Hubo un problema en la respuesta del servicio. Reintente más tarde. (DTC-B70)',
                    confirmButtonText: 'Entiendo'
                });
            }
        },
        error: function() {
            Swal.fire({
                icon: 'error',
                title: '¡Lo sentimos!',
                text: 'Hubo un problema inesperado en la respuesta del servicio. Reintente más tarde. (DTC-A70)',
                confirmButtonText: 'Entiendo'
            });
        },
        complete: function() {
            //Desactiva loader
            //$('#body').removeClass('be-loading-active');
        }
    });
}

function btn_volver(){
    window.history.back();
}

$(document).on('click', '.eliminar-firmante', function() {
    let tr = $(this).closest('tr');
    let rut = $(this).attr("rut");
    let nombre = $(this).attr("nombre");

    $("#lista-modal-firmantes").append(
        $("<option>", { value: rut, text: nombre })
    );

    var inputElement = $('#box-firmantes input[name="listaFirmantes"][value="' + rut + '"]');
    inputElement.remove();
    tr.remove();

    var cantidad = $('#p_cantidadFirmantesSeleccionados').val();
    $('#p_cantidadFirmantesSeleccionados').val(cantidad - 1);

    // Selecciona el elemento <select> por su ID
    var select = $('#lista-modal-firmantes');

    // Obtiene y ordena los elementos <option> basándose en su texto, excepto el primer elemento
    var sortedOptions = select.find('option:not(:first)').sort(function(a, b) {
        var aText = $(a).text().toUpperCase();
        var bText = $(b).text().toUpperCase();
        return aText < bText ? -1 : aText > bText ? 1 : 0;
    });

    // Elimina todos los <option> actuales del <select>
    select.empty();

    // Añade primero el <option> con valor "null"
    select.append('<option value="null"></option>');

    // Añade los <option> ordenados
    select.append(sortedOptions);
});


async function getIdCuadernoDoc(idDocumento) {
    return new Promise((resolve, reject) => {
        $.ajax({
            type: "GET",
            url: thisWS + "/ver-causa/cuaderno-por-documento?documento=" + idDocumento,
            contentType: "application/json; charset=ISO-8859-1",
            dataType: "json",
            success: function(data) {
                if (data.status === "200") {
                    var response = $.parseJSON(data.response);
                    resolve(response);
                } else {
                    reject("Error: status " + data.status);
                }
            },
            error: function(error) {
                reject("Error en la petición AJAX");
            }
        });
    });
}
