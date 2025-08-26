# core/views.py
import os
import json
import logging
import datetime
from datetime import timezone, timedelta
from typing import List, Dict

from django.conf import settings
from django.shortcuts import render, redirect, get_object_or_404
from django.http import JsonResponse, HttpResponse
from django.views.decorators.http import require_GET, require_POST
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.decorators import login_required, permission_required
from django.urls import reverse
from django import forms

import pyarrow.compute as pc

# Servicios
from services.database import (
    obtener_atributos,
    obtener_stores_from_parquet,
    obtener_grupos_cumplimiento,
    obtener_datos_tienda_por_id,
    obtener_empleados_by_email,
    actualizar_last_store,
    obtener_contador_pdf,
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

# Importa utilidades del scheduler (NO de services.caching)
from .scheduler import (
    FLAG_FILE,
    load_parquet_productos,
    load_parquet_clientes,
    load_parquet_stock,
    load_parquet_atributos,
)

from .models import SecuenciaNumerica

logger = logging.getLogger(__name__)


class SecuenciaNumericaForm(forms.ModelForm):
    class Meta:
        model = SecuenciaNumerica
        fields = ["nombre", "prefijo", "valor_actual", "incremento"]

# ======== Raíz ========
@login_required
def root(request):
    # Mostrar “inicializando” hasta que el bootstrap cree el FLAG
    if not os.path.exists(FLAG_FILE):
        return HttpResponse("La aplicación se está inicializando, por favor espera y recarga.", status=200)

    request.session.set_expiry(60 * 60 * 4)  # 4 horas
    last_store = request.session.get('last_store')
    if last_store:
        return redirect(reverse('core:productos') + f'?store={last_store}')
    return redirect('core:productos')

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
        contador = obtener_contador_pdf()
        qid = f"P-{str(contador).zfill(9)}"
        return JsonResponse({"quotation_id": qid})
    except Exception as e:
        logger.exception("api_generate_pdf_quotation_id")
        enviar_correo_fallo("generate_pdf_quotation_id", str(e))
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
        datos, error = run_obtener_datos_codigo_postal(cp)
        if error:
            return JsonResponse({"error": error}, status=500)
        return JsonResponse(datos)
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


# ======== Simulador de Pagos ========
REGLAS = {
    "impuestos": {"iva": 0.21, "iibb": 0.035},
    "metodos": {
        "efectivo": {"descuento": 0.10, "interes": 0.00},
        "debito": {"descuento": 0.05, "interes": 0.00},
        "credito": {"descuento": 0.00, "interes": 0.04},
        "transferencia": {"descuento": 0.06, "interes": 0.00},
    },
    "promociones": {
        "PROMO_BERCO10": {
            "tipo": "porcentaje",
            "valor": 0.10,
            "aplica": ["efectivo", "debito", "transferencia"],
        },
        "BNCO_3CUOTAS": {
            "tipo": "interes_subsidiado",
            "valor": -0.02,
            "aplica": ["credito"],
        },
        "SIN_PROMO": {
            "tipo": "ninguna",
            "valor": 0.00,
            "aplica": ["efectivo", "debito", "credito", "transferencia"],
        },
    },
}

SUCURSALES = ["Posadas", "Oberá", "Iguazú", "Resistencia"]

METODOS_LABELS = {
    "efectivo": "Efectivo",
    "debito": "Débito",
    "credito": "Crédito",
    "transferencia": "Transferencia",
}

TECLADO_ROWS = [["7", "8", "9"], ["4", "5", "6"], ["1", "2", "3"], ["00", "0", "⌫"]]


def calcular_linea(importe: float, metodo: str, cuotas: int, promo_id: str) -> dict:
    base = max(0.0, float(importe or 0.0))

    regla_metodo = REGLAS["metodos"].get(metodo, {"descuento": 0.0, "interes": 0.0})
    desc_metodo = base * regla_metodo["descuento"]

    promo = REGLAS["promociones"].get(promo_id)
    promo_aplica = bool(promo and metodo in promo.get("aplica", []))
    desc_promo = 0.0
    if promo_aplica and promo.get("tipo") == "porcentaje":
        desc_promo = (base - desc_metodo) * promo.get("valor", 0.0)

    subtotal_desc = base - desc_metodo - desc_promo

    interes = 0.0
    if metodo == "credito":
        tramos3 = max(0, (cuotas - 1 + 2) // 3)
        interes_base = regla_metodo.get("interes", 0.0) * tramos3
        ajuste_promo = (
            promo.get("valor", 0.0)
            if (promo_aplica and promo.get("tipo") == "interes_subsidiado")
            else 0.0
        )
        tasa = max(0.0, interes_base + ajuste_promo)
        interes = subtotal_desc * tasa

    neto_antes_imp = subtotal_desc + interes

    iva = neto_antes_imp * REGLAS["impuestos"]["iva"]
    iibb = neto_antes_imp * REGLAS["impuestos"]["iibb"]
    impuestos = iva + iibb

    total = neto_antes_imp + impuestos
    valor_cuota = total / max(1, cuotas)

    return {
        "importe_original": base,
        "desc_metodo": desc_metodo,
        "desc_promo": desc_promo,
        "subtotal_desc": subtotal_desc,
        "interes": interes,
        "iva": iva,
        "iibb": iibb,
        "impuestos": impuestos,
        "total": total,
        "valor_cuota": valor_cuota,
    }


@login_required
def simulador_pagos(request):
    user_id = request.session.get("email")
    total_carrito = 0.0

    # Intenta obtener el total del carrito guardado para el usuario
    try:
        if user_id:
            cart_data = get_cart(user_id)
            items = cart_data.get("cart", {}).get("items", [])
            total_carrito = round(
                sum(
                    float(i.get("price", 0)) * float(i.get("quantity", 0))
                    for i in items
                    if i.get("productId")
                ),
                2,
            )
    except Exception:
        total_carrito = 0.0

    sucursal = SUCURSALES[0]

    importes: List[float] = []
    metodos: List[str] = []
    cuotas: List[int] = []
    promos: List[str] = []

    if request.method == "POST":
        try:
            total_carrito = round(
                float(request.POST.get("total_carrito", total_carrito)), 2
            )
        except Exception:
            pass
        sucursal = request.POST.get("sucursal", sucursal)

        importes = [float(x) if x else 0 for x in request.POST.getlist("importe_pago[]")] or importes
        metodos = request.POST.getlist("metodo_pago[]") or metodos
        cuotas = [int(x) if x else 1 for x in request.POST.getlist("cuotas[]")] or cuotas
        promos = request.POST.getlist("promocion[]") or promos
    else:
        # Permite inicializar con total del carrito via querystring
        try:
            total_carrito = round(
                float(request.GET.get("total", total_carrito)), 2
            )
        except Exception:
            pass

    lineas = []
    total_pagado = 0.0
    for imp, met, c, pr in zip(importes, metodos, cuotas, promos):
        c = c if met == "credito" else 1
        r = calcular_linea(imp, met, c, pr)
        lineas.append(
            {
                "importe": imp,
                "metodo": met,
                "cuotas": c,
                "promo": pr,
                "cuotas_opts": [1] if met != "credito" else [1, 3, 6, 12],
                "resultado": r,
            }
        )
        total_pagado += r["total"]

    total_pagado = round(total_pagado, 2)

    saldo_restante = round(max(0.0, total_carrito - total_pagado), 2)
    cambio = round(max(0.0, total_pagado - total_carrito), 2)

    progress_pct = 0.0
    if total_carrito > 0:
        progress_pct = (
            (total_pagado if total_pagado < total_carrito else total_carrito)
            / total_carrito
            * 100.0
        )

    return render(
        request,
        "simulador_pagos.html",
        {
            "sucursales": SUCURSALES,
            "sucursal": sucursal,
            "promociones": REGLAS["promociones"],
            "total_carrito": total_carrito,
            "lineas": lineas,
            "metodos_labels": METODOS_LABELS,
            "total_pagado": total_pagado,
            "saldo_restante": saldo_restante,
            "cambio": cambio,
            "progress_pct": progress_pct,
            "ahora": datetime.datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
            "teclado_rows": TECLADO_ROWS,
        },
    )


@login_required
@permission_required("core.view_secuencianumerica", raise_exception=True)
def secuencias_list(request):
    secuencias = SecuenciaNumerica.objects.all()
    return render(
        request,
        "config/secuencias/list.html",
        {"secuencias": secuencias},
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
