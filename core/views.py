# core/views.py
import os
import json
import datetime
from datetime import timezone, timedelta

from django.conf import settings
from django.shortcuts import render, redirect, get_object_or_404
from django.http import JsonResponse, HttpResponse
from django.views.decorators.http import require_GET, require_POST
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.decorators import login_required, permission_required
from django.urls import reverse
from django import forms
from django.contrib.auth.decorators import login_required
 
from django.urls import reverse
from .models import TipoContribuyente
from .forms import TipoContribuyenteForm
from django.contrib.auth.decorators import login_required, permission_required
from django.urls import reverse
from django import forms

from .models import ModoEntrega


import pyarrow.compute as pc

# Servicios
from services.database import (
    obtener_atributos,
    obtener_stores_from_parquet,
    obtener_grupos_cumplimiento,
    obtener_datos_tienda_por_id,
    obtener_empleados_by_email,
    actualizar_last_store,
    save_cart,
    get_cart,
    obtener_token_d365,
)
from services.d365_interface import (
    run_crear_presupuesto_batch,
    run_obtener_presupuesto_d365,
    run_actualizar_presupuesto_d365,
    run_validar_cliente_existente,
    run_alta_cliente_d365,
)
from services.fabric import run_obtener_datos_codigo_postal
from services.email_service import enviar_correo_fallo
from services.config import (
    CACHE_FILE_PRODUCTOS,
    CACHE_FILE_STOCK,
    CACHE_FILE_CLIENTES,
    CACHE_FILE_ATRIBUTOS,
)
from services.modulo_facturacion_arca import generar_factura
from services.logging_utils import get_module_logger

# Importa utilidades del scheduler (NO de services.caching)
from .scheduler import (
    FLAG_FILE,
    load_parquet_productos,
    load_parquet_clientes,
    load_parquet_stock,
    load_parquet_atributos,
    load_parquet_codigos_postales,
)

from .models import SecuenciaNumerica
from django.db import transaction
from .utils.responses import json_ok, json_error

logger = get_module_logger(__name__)


def _resumen_pagos(pagos: list | None, max_len: int = 240) -> str:
    """Genera un resumen compacto de pagos para incluir en observaciones.

    Formato ejemplo: "Pagos: efectivo $10.000; crédito Visa 3 cuotas int 5% $25.000 (Ref: 1234) | Total c/int.: $35.000".
    Se trunca a `max_len` caracteres para evitar exceder límites de campos.
    """
    try:
        pagos = pagos or []
        if not isinstance(pagos, list) or not pagos:
            return ""
        partes = []
        total_con_int = 0.0
        for p in pagos:
            if not isinstance(p, dict):
                continue
            medio = str(p.get("tipo") or "")
            tarjeta = str(p.get("tarjeta") or "").strip()
            cuotas = p.get("cuotas")
            interes = p.get("interes")
            ref = str(p.get("referencia") or "").strip()
            monto = float(p.get("monto") or 0)
            monto_final = monto * (1 + float(interes or 0) / 100.0)
            total_con_int += monto_final
            desc = medio
            if tarjeta:
                desc += f" {tarjeta}"
            if cuotas:
                desc += f" {int(cuotas)} cuotas"
            if interes:
                try:
                    if float(interes) != 0:
                        desc += f" int {float(interes):g}%"
                except Exception:
                    pass
            desc += f" ${monto_final:,.2f}"
            if ref:
                desc += f" (Ref: {ref})"
            # normaliza separadores decimales a coma
            desc = desc.replace(",", ".").replace(".", ",", 1)
            partes.append(desc)
        resumen = f"Pagos: {'; '.join(partes)} | Total c/int.: ${total_con_int:,.2f}"
        if len(resumen) > max_len:
            resumen = resumen[: max(0, max_len - 3)] + "..."
        return resumen
    except Exception:
        return ""


class SecuenciaNumericaForm(forms.ModelForm):
    class Meta:
        model = SecuenciaNumerica
        fields = ["nombre", "prefijo", "valor_actual", "incremento"]
        widgets = {
            "nombre": forms.TextInput(attrs={"class": "form-control", "placeholder": "presupuesto"}),
            "prefijo": forms.TextInput(attrs={"class": "form-control", "placeholder": "P-"}),
            "valor_actual": forms.NumberInput(attrs={"class": "form-control", "min": 0}),
            "incremento": forms.NumberInput(attrs={"class": "form-control", "min": 1}),
        }


def next_sequence_code(nombre: str, default_prefix: str = "P-", pad: int = 9) -> str:
    """Obtiene el siguiente valor de la secuencia + prefijo, con padding.

    - Usa la tabla Django `SecuenciaNumerica` con `select_for_update` para evitar condiciones de carrera.
    - Si la secuencia no existe, la crea con valores por defecto.
    """
    with transaction.atomic():
        seq, _created = (
            SecuenciaNumerica.objects.select_for_update().get_or_create(
                nombre=nombre,
                defaults={"prefijo": default_prefix, "valor_actual": 0, "incremento": 1},
            )
        )
        seq.valor_actual = (seq.valor_actual or 0) + (seq.incremento or 1)
        seq.save(update_fields=["valor_actual"])
        numero = str(seq.valor_actual).zfill(max(1, int(pad or 1)))
        codigo = f"{seq.prefijo or ''}{numero}"
        return codigo
# ======== Config: Tipos de contribuyente ========
from .decorators import staff_only_notice

@staff_only_notice
def tipos_contribuyente_list(request):
    tipos = TipoContribuyente.objects.all()
    return render(request, 'config/tipos_contribuyente/list.html', {'tipos': tipos})


@staff_only_notice
def tipos_contribuyente_create(request):
    if request.method == 'POST':
        form = TipoContribuyenteForm(request.POST)
        if form.is_valid():
            form.save()
            return redirect('core:tipos_contribuyente_list')
    else:
        form = TipoContribuyenteForm()
    return render(request, 'config/tipos_contribuyente/form.html', {'form': form})


@staff_only_notice
def tipos_contribuyente_update(request, pk):
    tipo = get_object_or_404(TipoContribuyente, pk=pk)
    if request.method == 'POST':
        form = TipoContribuyenteForm(request.POST, instance=tipo)
        if form.is_valid():
            form.save()
            return redirect('core:tipos_contribuyente_list')
    else:
        form = TipoContribuyenteForm(instance=tipo)
    return render(request, 'config/tipos_contribuyente/form.html', {'form': form, 'tipo': tipo})


@staff_only_notice
def tipos_contribuyente_delete(request, pk):
    tipo = get_object_or_404(TipoContribuyente, pk=pk)
    if request.method == 'POST':
        tipo.delete()
        return redirect('core:tipos_contribuyente_list')
    return render(request, 'config/tipos_contribuyente/confirm_delete.html', {'tipo': tipo})


class ModoEntregaForm(forms.ModelForm):
    class Meta:
        model = ModoEntrega
        fields = ["nombre"]
        widgets = {
            "nombre": forms.TextInput(attrs={"class": "form-control"})
        }


# ======== Raíz ========
@login_required
def root(request):
    # Mostrar “inicializando” hasta que el bootstrap cree el FLAG
    if not os.path.exists(FLAG_FILE):
        return HttpResponse("La aplicación se está inicializando, por favor espera y recarga.", status=200)

    request.session.set_expiry(60 * 60 * 4)  # 4 horas
    last_store = request.session.get('last_store')
    if last_store:
        return redirect('core:pos_retail')
    return redirect('core:pos_retail')

# ======== Página principal (index) ========
@login_required
def productos(request):
    stores = obtener_stores_from_parquet() or []
    last_store = request.session.get('last_store', 'BA001GC')
    return render(request, 'index.html', {
        'stores': stores,
        'last_store': last_store,
    })

# ======== API: productos (listado) ========
@require_GET
@login_required
def api_productos(request):
    try:
        import pandas as pd
        store = (request.GET.get('store') or 'BA001GC').strip()
        page = int(request.GET.get('page', 1))
        items = int(request.GET.get('items_per_page', 200000))
        offset = (page - 1) * items

        if not os.path.exists(CACHE_FILE_PRODUCTOS):
            return JsonResponse({"error": f"Archivo de caché no encontrado: {CACHE_FILE_PRODUCTOS}"}, status=500)

        # Carga desde parquet (Arrow Table)
        table = load_parquet_productos()
        if table is None:
            return JsonResponse({"error": "No se pudo cargar los productos desde Parquet"}, status=500)

        # Renombrar columnas según tu esquema
        mapping = {
            'Número de Producto': 'numero_producto',
            'Nombre de Categoría de Producto': 'categoria_producto',
            'Nombre del Producto': 'nombre_producto',
            'Grupo de Cobertura': 'grupo_cobertura',
            'Unidad de Medida': 'unidad_medida',
            'PrecioFinalConIVA': 'precio_final_con_iva',
            'PrecioFinalConDescE': 'precio_final_con_descuento',
            'StoreNumber': 'store_number',
            'TotalDisponibleVenta': 'total_disponible_venta',
            'Signo': 'signo',
            'Multiplo': 'multiplo',
        }
        table = table.rename_columns([mapping.get(c, c) for c in table.column_names])

        filtered = table.filter(pc.match_substring(pc.field('store_number'), store))
        df = filtered.to_pandas()

        # formateo monetario a string con coma decimal
        for col in ('precio_final_con_iva', 'precio_final_con_descuento', 'total_disponible_venta'):
            if col in df.columns:
                df[col] = df[col].apply(lambda x: f"{x:,.2f}".replace(".", "X").replace(",", ".").replace("X", ","))

        data = df.iloc[offset:offset+items].to_dict('records')
        return JsonResponse(data, safe=False)
    except Exception as e:
        logger.exception("api_productos error")
        return JsonResponse({"error": str(e)}, status=500)

# ======== API: check update productos ========
@require_GET
@login_required
def api_check_products_update(request):
    try:
        if os.path.exists(CACHE_FILE_PRODUCTOS):
            last_modified = os.path.getmtime(CACHE_FILE_PRODUCTOS)
            return JsonResponse({"last_modified": last_modified})
        return JsonResponse({"last_modified": 0})
    except Exception as e:
        logger.exception("api_check_products_update error")
        enviar_correo_fallo("check_products_update", str(e))
        return JsonResponse({"error": str(e)}, status=500)

# ======== API: producto por código (exacto) ========
@require_GET
@login_required
def api_productos_by_code(request):
    try:
        import pandas as pd
        code = (request.GET.get('code') or '').strip()
        store = (request.GET.get('store') or '').strip()
        if not code:
            return JsonResponse({"error": "Código es requerido"}, status=400)

        if not os.path.exists(CACHE_FILE_PRODUCTOS):
            return JsonResponse({"error": f"Archivo de caché no encontrado: {CACHE_FILE_PRODUCTOS}"}, status=500)

        table = load_parquet_productos()
        mapping = {
            'Número de Producto': 'numero_producto',
            'Nombre de Categoría de Producto': 'categoria_producto',
            'Nombre del Producto': 'nombre_producto',
            'Grupo de Cobertura': 'grupo_cobertura',
            'Unidad de Medida': 'unidad_medida',
            'PrecioFinalConIVA': 'precio_final_con_iva',
            'PrecioFinalConDescE': 'precio_final_con_descuento',
            'StoreNumber': 'store_number',
            'TotalDisponibleVenta': 'total_disponible_venta',
            'Signo': 'signo',
            'Multiplo': 'multiplo',
        }
        table = table.rename_columns([mapping.get(c, c) for c in table.column_names])

        filt = table.filter(pc.equal(pc.field('numero_producto'), code))
        if store:
            filt = filt.filter(pc.equal(pc.field('store_number'), store))
        df = filt.to_pandas()
        for col in ('precio_final_con_iva', 'precio_final_con_descuento', 'total_disponible_venta'):
            if col in df.columns:
                df[col] = df[col].apply(lambda x: f"{x:,.2f}".replace(".", "X").replace(",", ".").replace("X", ","))

        products = df.to_dict('records')
        if not products:
            msg = f"No se encontró producto con código {code}" + (f" en store {store}" if store else "")
            return JsonResponse({"message": msg}, status=404)
        return JsonResponse(products, safe=False)
    except Exception as e:
        logger.exception("api_productos_by_code")
        return JsonResponse({"error": str(e)}, status=500)

# ======== API: atributos de producto ========
@require_GET
@login_required
def producto_atributos(request, product_id: int):
    try:
        # Si el bootstrap dejó el FLAG, usar parquet; si no, DB
        if os.path.exists(FLAG_FILE):
            table = load_parquet_atributos()
            table = table.filter(pc.equal(pc.field('ProductNumber'), str(product_id)))
            atributos = table.to_pandas().to_dict('records') if table.num_rows > 0 else []
        else:
            atributos = obtener_atributos(product_id) or []

        if atributos:
            product_name = atributos[0].get("ProductName") if isinstance(atributos[0], dict) else atributos[0][1]
        else:
            product_name = "Producto"

        return JsonResponse({
            "product_name": product_name,
            "product_number": str(product_id),
            "attributes": atributos
        })
    except Exception as e:
        logger.exception("producto_atributos")
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return JsonResponse({'error': f'Error al cargar atributos: {str(e)}'}, status=500)
        raise

# ======== API: stock por código y store ========
@require_GET
@login_required
def api_stock(request, codigo: str, store: str):
    try:
        if not codigo or not store:
            return JsonResponse({"mensaje": "Código y tienda requeridos."}, status=400)

        if not os.path.exists(CACHE_FILE_STOCK):
            return JsonResponse({"error": f"Archivo de caché no encontrado: {CACHE_FILE_STOCK}"}, status=500)

        almacenes_asignados = obtener_grupos_cumplimiento(store) or []
        almacenes_asignados = [a.strip().upper() for a in almacenes_asignados]
        if not almacenes_asignados:
            return JsonResponse({"mensaje": f"No hay almacenes asignados a la tienda {store}."}, status=404)

        codigo_norm = str(codigo).strip().upper()
        table = load_parquet_stock()
        f1 = pc.match_substring(pc.field('codigo'), codigo_norm)
        f2 = pc.field('almacen_365').isin(almacenes_asignados)
        filtered = table.filter(pc.and_kleene(f1, f2))
        df = filtered.to_pandas()
        stock = df.to_dict('records')

        presentes = {s["almacen_365"].strip().upper() for s in stock}
        for alm in almacenes_asignados:
            if alm not in presentes:
                stock.append({
                    "codigo": codigo_norm,
                    "almacen_365": alm,
                    "stock_fisico": 0.00,
                    "disponible_venta": 0.00,
                    "disponible_entrega": 0.00,
                    "comprometido": 0.00
                })
        return JsonResponse(stock, safe=False)
    except Exception as e:
        logger.exception("api_stock")
        return JsonResponse({"error": f"Error interno: {str(e)}"}, status=500)

# ======== API: actualizar last_store ========
@csrf_exempt
@require_POST
@login_required
def api_update_last_store(request):
    try:
        body = json.loads(request.body.decode('utf-8'))
        store_id = body.get('store_id')
        if not store_id:
            return JsonResponse({"error": "store_id es requerido"}, status=400)

        email = request.session.get('email')
        if not email:
            return JsonResponse({"error": "No se encontró email en la sesión"}, status=401)

        actualizar_last_store(email, store_id)
        request.session['last_store'] = store_id
        return JsonResponse({"ok": True})
    except Exception as e:
        logger.exception("api_update_last_store")
        enviar_correo_fallo("update_last_store", str(e))
        return JsonResponse({"error": str(e)}, status=500)

# ======== API: datos tienda ========
@require_GET
@login_required
def api_datos_tienda(request, store_id: str):
    try:
        tienda = obtener_datos_tienda_por_id(store_id)
        if not tienda:
            return JsonResponse({"error": "Tienda no encontrada"}, status=404)
        return JsonResponse(tienda)
    except Exception as e:
        logger.exception("api_datos_tienda")
        return JsonResponse({"error": str(e)}, status=500)

# ======== API: user info ========
@require_GET
@login_required
def api_user_info(request):
    try:
        email = request.session.get('email')
        if not email:
            return JsonResponse({"error": "Usuario no autenticado"}, status=401)
        empleado = obtener_empleados_by_email(email)
        return JsonResponse({
            "nombre_completo": (empleado or {}).get('nombre_completo', 'Usuario desconocido'),
            "email": email
        })
    except Exception as e:
        logger.exception("api_user_info")
        return JsonResponse({"error": str(e)}, status=500)

# ======== API: generar ID de presupuesto local ========
@require_GET
@login_required
def api_generate_pdf_quotation_id(request):
    try:
        # Secuencia dedicada a presupuestos usando el módulo de secuencias numéricas
        qid = next_sequence_code(nombre="presupuesto", default_prefix="P-", pad=9)
        return JsonResponse({"quotation_id": qid})
    except Exception as e:
        logger.exception("api_generate_pdf_quotation_id")
        enviar_correo_fallo("generate_pdf_quotation_id", str(e))
        return JsonResponse({"error": str(e)}, status=500)


# ======== API: facturar carrito ========
@csrf_exempt
@require_POST
@login_required
def api_facturar(request):
    """Genera una factura electrónica a partir del contenido del carrito."""
    try:
        data = json.loads(request.body.decode("utf-8"))
        items = data.get("items") or []
        if not items:
            return JsonResponse({"error": "El carrito está vacío"}, status=400)
        total = float(data.get("total") or 0)
        cliente = data.get("client")
        pagos = data.get("pagos") or []
        factura = generar_factura(cliente, items, total, pagos)
        return JsonResponse({"factura": factura})
    except Exception as e:
        logger.exception("api_facturar")
        enviar_correo_fallo("facturar", str(e))
        return JsonResponse({"error": str(e)}, status=500)

# ======== API: crear cliente en D365 ========
@csrf_exempt
@require_POST
@login_required
def api_clientes_create(request):
    try:
        data = json.loads(request.body.decode('utf-8'))
        req = ['nombre','apellido','dni','email','telefono','codigo_postal','ciudad','estado','condado','calle','altura']
        for f in req:
            if not data.get(f):
                return JsonResponse({"error": f"El campo {f} es requerido"}, status=400)

        token = obtener_token_d365()
        if not token:
            return JsonResponse({"error": "No se pudo obtener token D365"}, status=500)

        customer_id, error = run_alta_cliente_d365(data, token)
        if error:
            return JsonResponse({"error": error}, status=500)

        # refrescar cache clientes
        from .scheduler import actualizar_cache_clientes
        actualizar_cache_clientes()
        return JsonResponse({"customer_id": customer_id, "message": "Cliente creado exitosamente"}, status=201)
    except Exception as e:
        logger.exception("api_clientes_create")
        return JsonResponse({"error": str(e)}, status=500)

# ======== API: buscar clientes ========
@require_GET
@login_required
def api_clientes_search(request):
    try:
        import pandas as pd
        query = (request.GET.get('query') or '').strip().lower()
        if not query:
            return JsonResponse([], safe=False)

        if not os.path.exists(CACHE_FILE_CLIENTES):
            return JsonResponse({"error": f"Archivo de caché no encontrado: {CACHE_FILE_CLIENTES}"}, status=500)

        table = load_parquet_clientes()
        nif_filter = pc.match_substring(pc.field('nif'), query)
        numero_cliente_filter = pc.match_substring(pc.field('numero_cliente'), query)
        combined = pc.or_kleene(nif_filter, numero_cliente_filter)
        filtered = table.filter(combined)
        df = filtered.to_pandas()
        return JsonResponse(df.head(10).to_dict('records'), safe=False)
    except Exception as e:
        logger.exception("api_clientes_search")
        return JsonResponse({"error": str(e)}, status=500)

# ======== API: validar cliente por DNI en D365 ========
@csrf_exempt
@require_POST
@login_required
def api_clientes_validate(request):
    try:
        body = json.loads(request.body.decode('utf-8'))
        dni = body.get('dni')
        if not dni:
            return JsonResponse({"error": "DNI es requerido"}, status=400)

        token = obtener_token_d365()
        if not token:
            return JsonResponse({"error": "No se pudo obtener token D365"}, status=500)

        existe, resultado = run_validar_cliente_existente(dni, token)
        if existe is None:
            return JsonResponse({"error": resultado}, status=500)
        if existe:
            return JsonResponse({"exists": True, "client": resultado})
        return JsonResponse({"exists": False})
    except Exception as e:
        logger.exception("api_clientes_validate")
        return JsonResponse({"error": str(e)}, status=500)

# ======== API: datos por código postal ========
@csrf_exempt
@require_POST
@login_required
def api_direcciones_codigo_postal(request):
    try:
        data = json.loads(request.body.decode('utf-8'))
        cp = data.get('codigo_postal')
        if not cp:
            return JsonResponse({"error": "Código postal es requerido"}, status=400)
        # Intentar responder desde el padrón local (Parquet)
        try:
            table = load_parquet_codigos_postales()
        except Exception:
            table = None
        if table is not None:
            try:
                filtered = table.filter(pc.equal(pc.field('AddressZipCode'), str(cp)))
                df = filtered.to_pandas()
                registros = df.to_dict('records')
                if registros:
                    return JsonResponse(registros, safe=False)
            except Exception:
                pass
        # Fallback en vivo a Fabric
        datos, error = run_obtener_datos_codigo_postal(cp)
        if error:
            return JsonResponse({"error": error}, status=500)
        return JsonResponse(datos, safe=False)
    except Exception as e:
        logger.exception("api_direcciones_codigo_postal")
        return JsonResponse({"error": str(e)}, status=500)

# ======== API: crear presupuesto D365 ========
@csrf_exempt
@require_POST
@login_required
def api_create_quotation(request):
    try:
        body = json.loads(request.body.decode('utf-8'))
        cart = body.get('cart', {})
        store_id = body.get('store_id', '')
        tipo_presupuesto = body.get('tipo_presupuesto', 'Caja')
        observaciones = cart.get('observations', '')
        # Anexar resumen de pagos si existe
        try:
            pagos = cart.get('pagos') or []
            resumen = _resumen_pagos(pagos)
            if resumen:
                observaciones = (observaciones + (" | " if observaciones else "") + resumen)[:240]
        except Exception:
            pass

        if not request.session.get('empleado_d365'):
            return JsonResponse({"error": "Inicia sesión nuevamente (ID empleado faltante)"}, status=401)

        if not cart.get('client') or not cart['client'].get('numero_cliente'):
            return JsonResponse({"error": "Debe seleccionar un cliente"}, status=400)

        items = [i for i in cart.get('items', []) if i.get('productId')]
        if not items:
            return JsonResponse({"error": "El carrito está vacío"}, status=400)

        token = obtener_token_d365()
        if not token:
            enviar_correo_fallo("create_quotation", "No se pudo obtener token D365")
            return JsonResponse({"error": "No se pudo obtener token"}, status=500)

        tienda = obtener_datos_tienda_por_id(store_id)
        if not tienda:
            return JsonResponse({"error": f"Tienda {store_id} no encontrada"}, status=404)

        datos_cabecera = {
            "tipo_presupuesto": tipo_presupuesto,
            "sitio": tienda.get('sitio_almacen_retiro', ''),
            "almacen_retiro": tienda.get('almacen_retiro', ''),
            "id_cliente": cart['client']['numero_cliente'],
            "id_empleado": request.session.get('empleado_d365', ''),
            "store_id": store_id,
            "id_direccion": tienda.get('direccion_unidad_operativa', ''),
            "observaciones": observaciones
        }

        lineas = []
        for it in items:
            precio_iva = float(it['precioLista'])
            precio_desc = float(it['price'])
            cantidad = float(it['quantity'])
            desc = ((precio_iva - precio_desc) / precio_iva) * 100 if precio_iva else 0
            linea = {
                "articulo": it['productId'],
                "cantidad": int(cantidad) if cantidad.is_integer() else round(cantidad, 2),
                "precio": round(precio_desc / 1.21, 2),
                "descuento": round(abs(desc), 2),
                "unidad_medida": it.get('unidadMedida', 'Un'),
                "sitio": tienda.get('sitio_almacen_retiro', ''),
                "almacen_entrega": tienda.get('almacen_retiro', '')
            }
            lineas.append(linea)

        quotation_number, error = run_crear_presupuesto_batch(datos_cabecera, lineas, token)
        if not quotation_number:
            return JsonResponse({"error": error}, status=500)
        return JsonResponse({"quotation_number": quotation_number}, status=201)
    except Exception as e:
        logger.exception("api_create_quotation")
        enviar_correo_fallo("create_quotation", str(e))
        return JsonResponse({"error": str(e)}, status=500)

# ======== API: actualizar presupuesto D365 ========
@csrf_exempt
def api_update_quotation(request, quotation_id: str):
    if request.method != 'PUT':
        return JsonResponse({"error": "Método no permitido"}, status=405)
    try:
        body = json.loads(request.body.decode('utf-8'))
        if not quotation_id.startswith('VENT1-'):
            return JsonResponse({"error": "ID de presupuesto D365 inválido"}, status=400)

        cart = body.get('cart', {})
        store_id = body.get('store_id', '')
        tipo_presupuesto = body.get('tipo_presupuesto', 'Caja')
        observaciones = cart.get('observations', '')
        try:
            pagos = cart.get('pagos') or []
            resumen = _resumen_pagos(pagos)
            if resumen:
                observaciones = (observaciones + (" | " if observaciones else "") + resumen)[:240]
        except Exception:
            pass

        if not request.session.get('empleado_d365'):
            return JsonResponse({"error": "Inicia sesión nuevamente (ID empleado faltante)"}, status=401)

        if not cart.get('client') or not cart['client'].get('numero_cliente'):
            return JsonResponse({"error": "Debe seleccionar un cliente"}, status=400)

        items = [i for i in cart.get('items', []) if i.get('productId')]
        if not items:
            return JsonResponse({"error": "El carrito está vacío"}, status=400)

        token = obtener_token_d365()
        if not token:
            enviar_correo_fallo("update_quotation", "No se pudo obtener token D365")
            return JsonResponse({"error": "No se pudo obtener token"}, status=500)

        presupuesto_data, error = run_obtener_presupuesto_d365(quotation_id, token)
        if error:
            status = 404 if "no encontrado" in error.lower() else 500
            return JsonResponse({"error": error}, status=status)

        lineas_existentes = presupuesto_data.get("lines", [])

        tienda = obtener_datos_tienda_por_id(store_id)
        if not tienda:
            return JsonResponse({"error": f"Tienda {store_id} no encontrada"}, status=404)

        fecha_actual = datetime.datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        fecha_exp = (datetime.datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        datos_cabecera = {
            "tipo_presupuesto": tipo_presupuesto,
            "sitio": tienda.get('sitio_almacen_retiro', ''),
            "almacen_retiro": tienda.get('almacen_retiro', ''),
            "id_cliente": cart['client']['numero_cliente'],
            "id_empleado": request.session.get('empleado_d365', ''),
            "store_id": store_id,
            "id_direccion": tienda.get('direccion_unidad_operativa', ''),
            "observaciones": observaciones,
            "ReceiptDateRequested": fecha_actual,
            "RequestedShippingDate": fecha_actual,
            "SalesQuotationExpiryDate": fecha_exp
        }

        lineas_nuevas = []
        for it in items:
            precio_iva = float(it['precioLista'])
            precio_desc = float(it['price'])
            cantidad = float(it['quantity'])
            desc = ((precio_iva - precio_desc) / precio_iva) * 100 if precio_iva else 0
            lineas_nuevas.append({
                "articulo": it['productId'],
                "cantidad": int(cantidad) if cantidad.is_integer() else round(cantidad, 2),
                "precio": round(precio_desc / 1.21, 2),
                "descuento": round(abs(desc), 2),
                "unidad_medida": it.get('unidadMedida', 'Un'),
                "sitio": tienda.get('sitio_almacen_retiro', ''),
                "almacen_entrega": tienda.get('almacen_retiro', '')
            })

        quotation_number, error = run_actualizar_presupuesto_d365(
            quotation_id, datos_cabecera, lineas_nuevas, lineas_existentes, token
        )
        if not quotation_number:
            return JsonResponse({"error": error}, status=500)
        return JsonResponse({"quotation_number": quotation_number})
    except Exception as e:
        logger.exception("api_update_quotation")
        enviar_correo_fallo("update_quotation", str(e))
        return JsonResponse({"error": str(e)}, status=500)

# ======== API: guardar presupuesto local (JSON) ========
@csrf_exempt
@require_POST
@login_required
def api_save_local_quotation(request):
    try:
        data = json.loads(request.body.decode('utf-8'))
        quotation_id = data.get('quotation_id')
        if not quotation_id or not quotation_id.startswith('P-'):
            return JsonResponse({"error": "ID de presupuesto local inválido"}, status=400)

        if 'items' not in data or not isinstance(data['items'], list):
            data['items'] = []

        data.setdefault('timestamp', datetime.datetime.now(timezone.utc).isoformat())
        data.setdefault('type', 'local')
        data.setdefault('store_id', request.session.get('last_store', 'BA001GC'))
        data.setdefault('client', None)
        data.setdefault('observations', '')

        quotations_dir = os.path.join(settings.BASE_DIR, 'quotations', 'local')
        os.makedirs(quotations_dir, exist_ok=True)
        path = os.path.join(quotations_dir, f"{quotation_id}.json")
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        return JsonResponse({"message": f"Presupuesto {quotation_id} guardado correctamente"})
    except Exception as e:
        logger.exception("api_save_local_quotation")
        return JsonResponse({"error": str(e)}, status=500)

# ======== API: listar presupuestos locales ========
@require_GET
@login_required
def api_local_quotations(request):
    try:
        dirp = os.path.join(settings.BASE_DIR, 'quotations', 'local')
        if not os.path.exists(dirp):
            return JsonResponse([], safe=False)

        out = []
        for fname in os.listdir(dirp):
            if fname.endswith('.json'):
                with open(os.path.join(dirp, fname), 'r', encoding='utf-8') as f:
                    q = json.load(f)
                out.append({
                    "quotation_id": q.get("quotation_id"),
                    "timestamp": q.get("timestamp"),
                    "client_name": (q.get("client") or {}).get("nombre_cliente", "Sin cliente"),
                })
        return JsonResponse(out, safe=False)
    except Exception as e:
        logger.exception("api_local_quotations")
        return JsonResponse({"error": str(e)}, status=500)

# ======== API: obtener presupuesto local por id ========
@require_GET
@login_required
def api_local_quotation(request, quotation_id: str):
    try:
        path = os.path.join(settings.BASE_DIR, 'quotations', 'local', f"{quotation_id}.json")
        if not os.path.exists(path):
            return JsonResponse({"error": f"Presupuesto {quotation_id} no encontrado"}, status=404)
        with open(path, 'r', encoding='utf-8') as f:
            q = json.load(f)
        return JsonResponse(q)
    except Exception as e:
        logger.exception("api_local_quotation")
        return JsonResponse({"error": str(e)}, status=500)

# ======== API: obtener presupuesto D365 y enriquecer con cache ========
@require_GET
@login_required
def api_d365_quotation(request, quotation_id: str):
    try:
        import pandas as pd
        if not quotation_id.startswith('VENT1-'):
            return JsonResponse({"error": "ID de presupuesto D365 inválido"}, status=400)

        token = obtener_token_d365()
        if not token:
            return JsonResponse({"error": "No se pudo obtener token D365"}, status=500)

        presupuesto_data, error = run_obtener_presupuesto_d365(quotation_id, token)
        if error:
            status = 404 if "no encontrado" in error.lower() else 500
            return JsonResponse({"error": error}, status=status)

        header = presupuesto_data.get("header", {})
        lines = presupuesto_data.get("lines", [])

        numero_cliente = header.get("InvoiceCustomerAccountNumber", "N/A")
        client_info = None
        if os.path.exists(CACHE_FILE_CLIENTES):
            t = load_parquet_clientes()
            mapping = {
                'Bloqueado': 'bloqueado',
                'Tipo_Contribuyente': 'tipo_contribuyente',
                'Numero_Cliente': 'numero_cliente',
                'Nombre_Cliente': 'nombre_cliente',
                'Limite_Credito': 'limite_credito',
                'Grupo_Impuestos': 'grupo_impuestos',
                'NIF': 'nif',
                'TIF': 'tif',
                'Direccion_Completa': 'direccion_completa',
                'Fecha_Modificacion': 'fecha_modificacion',
                'Fecha_Creacion': 'fecha_creacion',
                'EmailContacto': 'email_contacto',
                'TelefonoContacto': 'telefono_contacto'
            }
            t = t.rename_columns([mapping.get(c, c) for c in t.column_names])
            t = t.filter(pc.equal(pc.field('numero_cliente'), numero_cliente))
            dfc = t.to_pandas()
            client_info = dfc.to_dict('records')[0] if not dfc.empty else None

        sales_origin = header.get("SalesOrderOriginCode")
        selected_store = request.GET.get('store') or (sales_origin if sales_origin else "BA001GC")

        quotation_data = {
            "quotation_id": quotation_id,
            "type": "d365",
            "store_id": selected_store,
            "client": {
                "numero_cliente": numero_cliente,
                "nombre_cliente": (client_info or {}).get("nombre_cliente", "Cliente D365"),
                "nif": (client_info or {}).get("nif", "N/A"),
                "direccion_completa": (client_info or {}).get("direccion_completa", "N/A"),
                "bloqueado": (client_info or {}).get("bloqueado", "N/A"),
                "tipo_contribuyente": (client_info or {}).get("tipo_contribuyente", "N/A"),
                "limite_credito": (client_info or {}).get("limite_credito"),
                "grupo_impuestos": (client_info or {}).get("grupo_impuestos", "N/A"),
                "tif": (client_info or {}).get("tif", "N/A"),
                "email_contacto": (client_info or {}).get("email_contacto", "N/A"),
                "telefono_contacto": (client_info or {}).get("telefono_contacto", "N/A"),
                "fecha_creacion": (client_info or {}).get("fecha_creacion", "N/A"),
                "fecha_modificacion": (client_info or {}).get("fecha_modificacion", "N/A"),
            },
            "items": [],
            "observations": header.get("CustomersReference", ""),
            "timestamp": header.get("ReceiptDateRequested", datetime.datetime.now(timezone.utc).isoformat()),
            "has_flete": False,
            "header": {
                "SalesQuotationStatus": header.get("SalesQuotationStatus", ""),
                "GeneratedSalesOrderNumber": header.get("GeneratedSalesOrderNumber", "")
            }
        }

        has_flete = False
        unique = {}

        prod_table = None
        if os.path.exists(CACHE_FILE_PRODUCTOS):
            prod_table = load_parquet_productos()
            mapping = {
                'Número de Producto': 'numero_producto',
                'Nombre de Categoría de Producto': 'categoria_producto',
                'Nombre del Producto': 'nombre_producto',
                'Grupo de Cobertura': 'grupo_cobertura',
                'Unidad de Medida': 'unidad_medida',
                'PrecioFinalConIVA': 'precio_final_con_iva',
                'PrecioFinalConDescE': 'precio_final_con_descuento',
                'StoreNumber': 'store_number',
                'TotalDisponibleVenta': 'total_disponible_venta',
                'Signo': 'signo',
                'Multiplo': 'multiplo',
            }
            prod_table = prod_table.rename_columns([mapping.get(c, c) for c in prod_table.column_names])

        for line in lines:
            product = None
            if prod_table is not None:
                f1 = pc.equal(pc.field('numero_producto'), line["ItemNumber"])
                f2 = pc.equal(pc.field('store_number'), selected_store)
                dfp = prod_table.filter(pc.and_kleene(f1, f2)).to_pandas()
                product = dfp.to_dict('records')[0] if not dfp.empty else None

            if product:
                price = float(product["precio_final_con_descuento"])
                precio_lista = float(product["precio_final_con_iva"])
                unidad = product.get("unidad_medida", "Un")
                multiplo = float(product.get("multiplo", 1))
                nombre = product.get("nombre_producto", line["ItemNumber"])
            else:
                price = float(line.get("SalesPrice", 0))
                precio_lista = price
                unidad = line.get("SalesUnitSymbol", "Un")
                multiplo = 1.0
                nombre = line["ItemNumber"]

            item = {
                "productId": line["ItemNumber"],
                "productName": nombre,
                "price": f"{price:,.2f}".replace(".", "X").replace(",", ".").replace("X", ","),
                "precioLista": f"{precio_lista:,.2f}".replace(".", "X").replace(",", ".").replace("X", ","),
                "quantity": float(line.get("RequestedSalesQuantity", 0)),
                "multiplo": multiplo,
                "unidadMedida": unidad,
            }

            pname = item["productName"].lower()
            pid = item["productId"]
            if "flete" in pname or pid == "350320":
                has_flete = True
                continue

            if pid in unique:
                unique[pid]["quantity"] += item["quantity"]
            else:
                unique[pid] = item

        quotation_data["items"] = list(unique.values())
        quotation_data["has_flete"] = has_flete
        return JsonResponse(quotation_data)
    except Exception as e:
        logger.exception("api_d365_quotation")
        return JsonResponse({"error": str(e)}, status=500)

# ======== API: guardar carrito por usuario ========
@csrf_exempt
@require_POST
@login_required
def api_save_user_cart(request):
    try:
        body = json.loads(request.body.decode('utf-8'))
        user_id = body.get('userId')
        cart = body.get('cart')
        timestamp = body.get('timestamp')

        if not user_id or not cart or not timestamp:
            return JsonResponse({"error": "userId, cart, y timestamp son requeridos"}, status=400)
        if user_id != request.session.get('email'):
            return JsonResponse({"error": "No autorizado: userId no coincide con la sesión"}, status=403)
        if not isinstance(cart, dict):
            return JsonResponse({"error": "El carrito debe ser un objeto"}, status=400)
        cart.setdefault('items', [])

        if save_cart(user_id, cart, timestamp):
            return JsonResponse({"message": f"Carrito guardado correctamente para {user_id}", "timestamp": timestamp})
        return JsonResponse({"error": "Error al guardar el carrito en DB"}, status=500)
    except Exception as e:
        logger.exception("api_save_user_cart")
        return JsonResponse({"error": f"Error interno: {str(e)}"}, status=500)

# ======== API: recuperar carrito por usuario ========
@require_GET
@login_required
def api_get_user_cart(request):
    try:
        user_id = request.session.get('email')
        cart_data = get_cart(user_id)
        return JsonResponse(cart_data, safe=False)
    except Exception as e:
        logger.exception("api_get_user_cart")
        return JsonResponse({"error": str(e)}, status=500)


@login_required
def simulador_pagos(request):
    """Redirect legacy simulator URL to the new payment simulator page.

    The application previously served a custom simulator interface at
    ``/simulador/``.  The new implementation lives under
    ``/payments/simulator/``.  To avoid users seeing the deprecated
    interface, we redirect any requests hitting the old endpoint to the
    current one while preserving the original query string (e.g. the cart
    total).
    """

    target = reverse("core:payment_simulator")
    if request.META.get("QUERY_STRING"):
        target = f"{target}?{request.META['QUERY_STRING']}"
    return redirect(target)


@login_required
@permission_required("core.view_secuencianumerica", raise_exception=True)
def secuencias_list(request):
    secuencias = SecuenciaNumerica.objects.all()
    return render(
        request,
        "config/secuencias/list.html",
        {"secuencias": secuencias},
    )
# ======== CRUD Modos de Entrega ========


@login_required
@permission_required("core.view_modoentrega", raise_exception=True)
def modo_entrega_list(request):
    modos = ModoEntrega.objects.all()
    return render(
        request,
        "config/modos_entrega/list.html",
        {"modos": modos},
    )


@login_required
@permission_required("core.add_secuencianumerica", raise_exception=True)
def secuencias_create(request):
    if request.method == "POST":
        form = SecuenciaNumericaForm(request.POST)
        if form.is_valid():
            form.save()
            return redirect("core:secuencias_list")
    else:
        form = SecuenciaNumericaForm()
    return render(
        request,
        "config/secuencias/form.html",
        {"form": form, "title": "Crear secuencia"},
    )

@permission_required("core.add_modoentrega", raise_exception=True)
def modo_entrega_create(request):
    if request.method == "POST":
        form = ModoEntregaForm(request.POST)
        if form.is_valid():
            form.save()
            return redirect("core:modo_entrega_list")
    else:
        form = ModoEntregaForm()
    return render(
        request,
        "config/modos_entrega/form.html",
        {"form": form, "titulo": "Nuevo modo de entrega"},
    )


@login_required
@permission_required("core.change_secuencianumerica", raise_exception=True)
def secuencias_update(request, pk):
    secuencia = get_object_or_404(SecuenciaNumerica, pk=pk)
    if request.method == "POST":
        form = SecuenciaNumericaForm(request.POST, instance=secuencia)
        if form.is_valid():
            form.save()
            return redirect("core:secuencias_list")
    else:
        form = SecuenciaNumericaForm(instance=secuencia)
    return render(
        request,
        "config/secuencias/form.html",
        {"form": form, "title": "Editar secuencia"},
    )
@permission_required("core.change_modoentrega", raise_exception=True)
def modo_entrega_update(request, pk):
    modo = get_object_or_404(ModoEntrega, pk=pk)
    if request.method == "POST":
        form = ModoEntregaForm(request.POST, instance=modo)
        if form.is_valid():
            form.save()
            return redirect("core:modo_entrega_list")
    else:
        form = ModoEntregaForm(instance=modo)
    return render(
        request,
        "config/modos_entrega/form.html",
        {"form": form, "titulo": "Editar modo de entrega"},
    )


@login_required
@permission_required("core.delete_secuencianumerica", raise_exception=True)
def secuencias_delete(request, pk):
    secuencia = get_object_or_404(SecuenciaNumerica, pk=pk)
    if request.method == "POST":
        secuencia.delete()
        return redirect("core:secuencias_list")
    return render(
        request,
        "config/secuencias/confirm_delete.html",
        {"secuencia": secuencia},
    )

@permission_required("core.delete_modoentrega", raise_exception=True)
def modo_entrega_delete(request, pk):
    modo = get_object_or_404(ModoEntrega, pk=pk)
    if request.method == "POST":
        modo.delete()
        return redirect("core:modo_entrega_list")
    return render(
        request,
        "config/modos_entrega/confirm_delete.html",
        {"modo": modo},
    )
@login_required
def pos_retail(request):
    """Interfaz POS (nuevo estilo) usando APIs reales + funciones equivalentes."""
    try:
        stores = obtener_stores_from_parquet() or []
    except Exception:
        stores = []
    last_store = request.session.get('last_store', 'BA001GC')
    return render(request, 'pos_retail.html', {"stores": stores, "last_store": last_store})
# ======== API Simulador pagos (V5-like) ========
@require_GET
@login_required
def api_sim_masters(request):
    try:
        from . import simulador as sim
        return JsonResponse(sim.masters(), safe=False)
    except Exception as e:
        logger.exception("api_sim_masters")
        return JsonResponse({"error": str(e)}, status=500)


@require_GET
@login_required
def api_sim_plans(request):
    try:
        from . import simulador as sim
        method = request.GET.get('method')
        brand = request.GET.get('brand')
        bank = request.GET.get('bank')
        acq = request.GET.get('acquirer')
        tasa1 = request.GET.get('tasa1') in {'1','true','True'}
        data = sim.plans(method, brand, bank, acq, tasa1)
        return JsonResponse(data, safe=False)
    except Exception as e:
        logger.exception("api_sim_plans")
        return JsonResponse({"error": str(e)}, status=500)


@require_GET
@login_required
def api_sim_discounts(request):
    try:
        from . import simulador as sim
        method = request.GET.get('method')
        brand = request.GET.get('brand')
        bank = request.GET.get('bank')
        data = sim.discounts(method, brand, bank)
        return JsonResponse(data, safe=False)
    except Exception as e:
        logger.exception("api_sim_discounts")
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@require_POST
@login_required
def api_simulate(request):
    try:
        from . import simulador as sim
        payload = json.loads(request.body.decode('utf-8'))
        cart_amount = float(payload.get('cart_amount') or 0)
        lines = payload.get('lines') or []
        tasa1 = bool(payload.get('tasa1') or False)
        data = sim.simulate(cart_amount, lines, tasa1=tasa1)
        return JsonResponse(data, safe=False)
    except Exception as e:
        logger.exception("api_simulate")
        return JsonResponse({"error": str(e)}, status=500)
# ======== UI: Simulador V5 (embed) ========
@require_GET
@login_required
def simulador_v5_ui(request):
    try:
        return render(request, 'maestros_pagos/simulator/index_embed.html')
    except Exception as e:
        logger.exception("simulador_v5_ui")
        return JsonResponse({"error": str(e)}, status=500)


# ======== Configuración: Bancos (minimal CRUD) ========
@require_GET
@login_required
def config_bancos_list(request):
    try:
        from . import simulador as sim
        bancos = sim.bancos_list()
        return render(request, 'config/pagos/bancos_list.html', { 'bancos': bancos })
    except Exception as e:
        logger.exception("config_bancos_list")
        return JsonResponse({"error": str(e)}, status=500)


@require_GET
@login_required
def config_bancos_export(request):
    from . import simulador as sim
    bancos = sim.bancos_list()
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["id","code","name","commercial","enabled"])
    for b in bancos:
        writer.writerow([b.get('id'), b.get('code'), b.get('name'), b.get('commercial'), int(bool(b.get('enabled')))])
    resp = HttpResponse(output.getvalue(), content_type='text/csv')
    resp['Content-Disposition'] = 'attachment; filename=bancos.csv'
    return resp


@login_required
def config_bancos_import(request):
    from . import simulador as sim
    if request.method == 'POST' and request.FILES.get('file'):
        f = request.FILES['file']
        data = f.read().decode('utf-8', errors='ignore')
        reader = csv.DictReader(StringIO(data))
        for row in reader:
            code = row.get('code','')
            name = row.get('name','')
            commercial = row.get('commercial','')
            enabled = str(row.get('enabled','1')) in {'1','true','True','TRUE'}
            # Si id presente, actualiza; si no, crea
            pk = row.get('id')
            try:
                if pk:
                    sim.banco_update(pk, code, name, commercial, enabled)
                else:
                    sim.banco_create(code, name, commercial, enabled)
            except Exception:
                logger.exception('config_bancos_import row failed')
        return redirect('core:config_bancos_list')
    return render(request, 'config/pagos/import_form.html', { 'title': 'Importar Bancos', 'action': reverse('core:config_bancos_import') })


@login_required
def config_banco_form(request, pk=None):
    from . import simulador as sim
    if request.method == 'POST':
        code = request.POST.get('code') or ''
        name = request.POST.get('name') or ''
        commercial = request.POST.get('commercial') or ''
        enabled = (request.POST.get('enabled') == 'on')
        try:
            if pk:
                sim.banco_update(pk, code, name, commercial, enabled)
            else:
                sim.banco_create(code, name, commercial, enabled)
            return redirect('core:config_bancos_list')
        except Exception as e:
            logger.exception("config_banco_form")
            return render(request, 'config/pagos/banco_form.html', { 'error': str(e), 'banco': { 'id': pk, 'code': code, 'name': name, 'commercial': commercial, 'enabled': enabled } })
    else:
        banco = None
        if pk:
            banco = sim.banco_get(pk)
        return render(request, 'config/pagos/banco_form.html', { 'banco': banco })


@login_required
def config_banco_toggle(request, pk):
    from . import simulador as sim
    try:
        sim.banco_toggle(pk)
    except Exception:
        logger.exception("config_banco_toggle")
    return redirect('core:config_bancos_list')


@login_required
def config_banco_delete(request, pk):
    from . import simulador as sim
    try:
        if request.method == 'POST':
            sim.banco_delete(pk)
            return redirect('core:config_bancos_list')
        banco = sim.banco_get(pk)
        return render(request, 'config/pagos/banco_delete.html', { 'banco': banco })
    except Exception as e:
        logger.exception("config_banco_delete")
        return JsonResponse({"error": str(e)}, status=500)


# Métodos de pago
@require_GET
@login_required
def config_metodos_list(request):
    try:
        from . import simulador as sim
        metodos = sim.methods_list()
        return render(request, 'config/pagos/metodos_list.html', { 'metodos': metodos })
    except Exception as e:
        logger.exception("config_metodos_list")
        return JsonResponse({"error": str(e)}, status=500)


@require_GET
@login_required
def config_metodos_export(request):
    from . import simulador as sim
    items = sim.methods_list()
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["id","code","name","function","enabled"])
    for m in items:
        writer.writerow([m.get('id'), m.get('code'), m.get('name'), m.get('function'), int(bool(m.get('enabled')))])
    resp = HttpResponse(output.getvalue(), content_type='text/csv')
    resp['Content-Disposition'] = 'attachment; filename=metodos.csv'
    return resp


@login_required
def config_metodos_import(request):
    from . import simulador as sim
    if request.method == 'POST' and request.FILES.get('file'):
        f = request.FILES['file']
        data = f.read().decode('utf-8', errors='ignore')
        reader = csv.DictReader(StringIO(data))
        for row in reader:
            code = row.get('code','')
            name = row.get('name','')
            function = row.get('function','')
            enabled = str(row.get('enabled','1')) in {'1','true','True','TRUE'}
            pk = row.get('id')
            try:
                if pk:
                    sim.method_update(pk, code, name, function, enabled)
                else:
                    sim.method_create(code, name, function, enabled)
            except Exception:
                logger.exception('config_metodos_import row failed')
        return redirect('core:config_metodos_list')
    return render(request, 'config/pagos/import_form.html', { 'title': 'Importar Métodos de pago', 'action': reverse('core:config_metodos_import') })


@login_required
def config_metodo_form(request, pk=None):
    from . import simulador as sim
    if request.method == 'POST':
        code = request.POST.get('code') or ''
        name = request.POST.get('name') or ''
        function = request.POST.get('function') or ''
        enabled = (request.POST.get('enabled') == 'on')
        try:
            if pk:
                sim.method_update(pk, code, name, function, enabled)
            else:
                sim.method_create(code, name, function, enabled)
            return redirect('core:config_metodos_list')
        except Exception as e:
            logger.exception("config_metodo_form")
            return render(request, 'config/pagos/metodo_form.html', { 'error': str(e), 'metodo': { 'id': pk, 'code': code, 'name': name, 'function': function, 'enabled': enabled } })
    else:
        metodo = None
        if pk:
            metodo = sim.method_get(pk)
        return render(request, 'config/pagos/metodo_form.html', { 'metodo': metodo })


@login_required
def config_metodo_toggle(request, pk):
    from . import simulador as sim
    try:
        sim.method_toggle(pk)
    except Exception:
        logger.exception("config_metodo_toggle")
    return redirect('core:config_metodos_list')


@login_required
def config_metodo_delete(request, pk):
    from . import simulador as sim
    try:
        if request.method == 'POST':
            sim.method_delete(pk)
            return redirect('core:config_metodos_list')
        metodo = sim.method_get(pk)
        return render(request, 'config/pagos/metodo_delete.html', { 'metodo': metodo })
    except Exception as e:
        logger.exception("config_metodo_delete")
        return JsonResponse({"error": str(e)}, status=500)


# Adquirentes
@require_GET
@login_required
def config_acquirers_list(request):
    try:
        from . import simulador as sim
        acqs = sim.acquirers_list()
        return render(request, 'config/pagos/acquirers_list.html', { 'acquirers': acqs })
    except Exception as e:
        logger.exception("config_acquirers_list")
        return JsonResponse({"error": str(e)}, status=500)


# Tarjetas
@require_GET
@login_required
def config_cards_list(request):
    try:
        from . import simulador as sim
        cards = sim.cards_list()
        bancos = { b['id']: b for b in sim.bancos_list() }
        acqs = { a['id']: a for a in sim.acquirers_list() }
        # Enriquecer por si faltan nombres
        for c in cards:
            if not c.get('bank_name') and c.get('bank_id') in bancos:
                c['bank_name'] = bancos[c['bank_id']].get('name')
            if not c.get('acquirer_name') and c.get('acquirer_id') in acqs:
                c['acquirer_name'] = acqs[c['acquirer_id']].get('name')
        return render(request, 'config/pagos/tarjetas_list.html', { 'cards': cards })
    except Exception as e:
        logger.exception("config_cards_list")
        return JsonResponse({"error": str(e)}, status=500)


@login_required
def config_card_form(request, pk=None):
    from . import simulador as sim
    bancos = sim.bancos_list()
    acqs = sim.acquirers_list()
    if request.method == 'POST':
        brand = request.POST.get('brand') or ''
        code = request.POST.get('card_code') or ''
        bank_id = request.POST.get('bank_id') or None
        acquirer_id = request.POST.get('acquirer_id') or None
        enabled = (request.POST.get('enabled') == 'on')
        try:
            if pk:
                sim.card_update(pk, brand, code, bank_id, acquirer_id, enabled)
            else:
                sim.card_create(brand, code, bank_id, acquirer_id, enabled)
            return redirect('core:config_cards_list')
        except Exception as e:
            logger.exception("config_card_form")
            card = { 'id': pk, 'brand': brand, 'card_code': code, 'bank_id': bank_id, 'acquirer_id': acquirer_id, 'enabled': enabled }
            return render(request, 'config/pagos/tarjeta_form.html', { 'error': str(e), 'card': card, 'bancos': bancos, 'acqs': acqs })
    else:
        card = None
        if pk:
            card = sim.card_get(pk)
        return render(request, 'config/pagos/tarjeta_form.html', { 'card': card, 'bancos': bancos, 'acqs': acqs })


@login_required
def config_card_toggle(request, pk):
    from . import simulador as sim
    try:
        sim.card_toggle(pk)
    except Exception:
        logger.exception("config_card_toggle")
    return redirect('core:config_cards_list')


@login_required
def config_card_delete(request, pk):
    from . import simulador as sim
    try:
        if request.method == 'POST':
            sim.card_delete(pk)
            return redirect('core:config_cards_list')
        card = sim.card_get(pk)
        return render(request, 'config/pagos/tarjeta_delete.html', { 'card': card })
    except Exception as e:
        logger.exception("config_card_delete")
        return JsonResponse({"error": str(e)}, status=500)


# Descuentos
@require_GET
@login_required
def config_discounts_list(request):
    try:
        from . import simulador as sim
        items = sim.discounts_admin_list()
        return render(request, 'config/pagos/descuentos_list.html', { 'items': items })
    except Exception as e:
        logger.exception("config_discounts_list")
        return JsonResponse({"error": str(e)}, status=500)


@login_required
def config_discount_form(request, pk=None):
    from . import simulador as sim
    metodos = sim.methods_list()
    cards = sim.cards_list()
    if request.method == 'POST':
        method_id = request.POST.get('method_id') or ''
        card_id = request.POST.get('card_id') or None
        pct = float(request.POST.get('pct') or 0)
        vf = request.POST.get('valid_from') or None
        vt = request.POST.get('valid_to') or None
        enabled = (request.POST.get('enabled') == 'on')
        try:
            if pk:
                sim.discount_update(pk, method_id, card_id, pct, vf, vt, enabled)
            else:
                sim.discount_create(method_id, card_id, pct, vf, vt, enabled)
            return redirect('core:config_discounts_list')
        except Exception as e:
            logger.exception("config_discount_form")
            item = { 'id': pk, 'method_id': method_id, 'card_id': card_id, 'pct': pct, 'valid_from': vf, 'valid_to': vt, 'enabled': enabled }
            return render(request, 'config/pagos/descuento_form.html', { 'error': str(e), 'item': item, 'metodos': metodos, 'cards': cards })
    else:
        item = None
        if pk:
            item = sim.discount_get(pk)
        return render(request, 'config/pagos/descuento_form.html', { 'item': item, 'metodos': metodos, 'cards': cards })


@login_required
def config_discount_toggle(request, pk):
    from . import simulador as sim
    try:
        sim.discount_toggle(pk)
    except Exception:
        logger.exception("config_discount_toggle")
    return redirect('core:config_discounts_list')


@login_required
def config_discount_delete(request, pk):
    from . import simulador as sim
    try:
        if request.method == 'POST':
            sim.discount_delete(pk)
            return redirect('core:config_discounts_list')
        item = sim.discount_get(pk)
        return render(request, 'config/pagos/descuento_delete.html', { 'item': item })
    except Exception as e:
        logger.exception("config_discount_delete")
        return JsonResponse({"error": str(e)}, status=500)


# Planes
@require_GET
@login_required
def config_plans_list(request):
    try:
        from . import simulador as sim
        items = sim.plans_headers_list_admin()
        return render(request, 'config/pagos/planes_list.html', { 'items': items })
    except Exception as e:
        logger.exception("config_plans_list")
        return JsonResponse({"error": str(e)}, status=500)


@login_required
def config_plan_form(request, pk=None):
    from . import simulador as sim
    metodos = sim.methods_list()
    if request.method == 'POST':
        code = request.POST.get('code') or ''
        name = request.POST.get('name') or ''
        method_id = request.POST.get('method_id') or None
        vd = request.POST.get('valid_from') or None
        vh = request.POST.get('valid_to') or None
        enabled = (request.POST.get('enabled') == 'on')
        try:
            if pk:
                sim.plan_header_update(pk, code, name, method_id, vd, vh, enabled)
            else:
                sim.plan_header_create(code, name, method_id, vd, vh, enabled)
            return redirect('core:config_plans_list')
        except Exception as e:
            logger.exception("config_plan_form")
            item = { 'id': pk, 'code': code, 'name': name, 'method_id': method_id, 'VigenciaDesde': vd, 'VigenciaHasta': vh, 'enabled': enabled }
            return render(request, 'config/pagos/plan_form.html', { 'error': str(e), 'item': item, 'metodos': metodos })
    else:
        item = None
        if pk:
            item = ''.join([]) or None
            item = sim.plan_header_get(pk)
        return render(request, 'config/pagos/plan_form.html', { 'item': item, 'metodos': metodos })


@login_required
def config_plan_toggle(request, pk):
    from . import simulador as sim
    try:
        sim.plan_header_toggle(pk)
    except Exception:
        logger.exception("config_plan_toggle")
    return redirect('core:config_plans_list')


@login_required
def config_plan_delete(request, pk):
    from . import simulador as sim
    try:
        if request.method == 'POST':
            sim.plan_header_delete(pk)
            return redirect('core:config_plans_list')
        item = sim.plan_header_get(pk)
        return render(request, 'config/pagos/plan_delete.html', { 'item': item })
    except Exception as e:
        logger.exception("config_plan_delete")
        return JsonResponse({"error": str(e)}, status=500)


@require_GET
@login_required
def config_plan_rates(request, plan_id):
    try:
        from . import simulador as sim
        header = sim.plan_header_get(plan_id)
        rates = sim.plan_rates_list(plan_id)
        return render(request, 'config/pagos/plan_rates.html', { 'header': header, 'rates': rates })
    except Exception as e:
        logger.exception("config_plan_rates")
        return JsonResponse({"error": str(e)}, status=500)


@login_required
def config_plan_rate_form(request, plan_id, rate_id=None):
    from . import simulador as sim
    if request.method == 'POST':
        fees = int(request.POST.get('fees') or 1)
        coef = float(request.POST.get('coef') or 1)
        try:
            if rate_id:
                sim.plan_rate_update(rate_id, fees, coef)
            else:
                sim.plan_rate_create(plan_id, fees, coef)
            return redirect('core:config_plan_rates', plan_id=plan_id)
        except Exception as e:
            logger.exception("config_plan_rate_form")
            item = { 'id': rate_id, 'fees': fees, 'coef': coef }
            return render(request, 'config/pagos/plan_rate_form.html', { 'error': str(e), 'item': item, 'plan_id': plan_id })
    else:
        item = None
        if rate_id:
            item = sim.plan_rate_get(rate_id)
        return render(request, 'config/pagos/plan_rate_form.html', { 'item': item, 'plan_id': plan_id })


@login_required
def config_plan_rate_delete(request, plan_id, rate_id):
    from . import simulador as sim
    try:
        if request.method == 'POST':
            sim.plan_rate_delete(rate_id)
            return redirect('core:config_plan_rates', plan_id=plan_id)
        item = sim.plan_rate_get(rate_id)
        return render(request, 'config/pagos/plan_rate_delete.html', { 'item': item, 'plan_id': plan_id })
    except Exception as e:
        logger.exception("config_plan_rate_delete")
        return JsonResponse({"error": str(e)}, status=500)


@login_required
def config_acquirer_form(request, pk=None):
    from . import simulador as sim
    if request.method == 'POST':
        code = request.POST.get('code') or ''
        name = request.POST.get('name') or ''
        enabled = (request.POST.get('enabled') == 'on')
        try:
            if pk:
                sim.acquirer_update(pk, code, name, enabled)
            else:
                sim.acquirer_create(code, name, enabled)
            return redirect('core:config_acquirers_list')
        except Exception as e:
            logger.exception("config_acquirer_form")
            return render(request, 'config/pagos/acquirer_form.html', { 'error': str(e), 'acq': { 'id': pk, 'code': code, 'name': name, 'enabled': enabled } })
    else:
        acq = None
        if pk:
            acq = sim.acquirer_get(pk)
        return render(request, 'config/pagos/acquirer_form.html', { 'acq': acq })


@login_required
def config_acquirer_toggle(request, pk):
    from . import simulador as sim
    try:
        sim.acquirer_toggle(pk)
    except Exception:
        logger.exception("config_acquirer_toggle")
    return redirect('core:config_acquirers_list')


@login_required
def config_acquirer_delete(request, pk):
    from . import simulador as sim
    try:
        if request.method == 'POST':
            sim.acquirer_delete(pk)
            return redirect('core:config_acquirers_list')
        acq = sim.acquirer_get(pk)
        return render(request, 'config/pagos/acquirer_delete.html', { 'acq': acq })
    except Exception as e:
        logger.exception("config_acquirer_delete")
        return JsonResponse({"error": str(e)}, status=500)
import csv
from io import StringIO
