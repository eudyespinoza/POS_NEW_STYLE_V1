from pathlib import Path
from django.conf import settings
import os, time
import pyarrow.parquet as pq
import pyarrow.compute as pc

# Usamos tu config.py existente para ruta de productos
try:
    from services.config import CACHE_FILE_PRODUCTOS
except Exception:
    CACHE_FILE_PRODUCTOS = str(Path(settings.CACHE_DIR) / 'productos_cache.parquet')

def parquet_path():
    return CACHE_FILE_PRODUCTOS

def productos_listar(store: str|None=None, page:int=1, items_per_page:int=20000):
    """Lee el parquet y devuelve una lista de dicts compatible con tu front."""
    path = parquet_path()
    if not os.path.exists(path):
        return []

    table = pq.read_table(path)

    # Filtro por tienda si viene
    if store:
        table = table.filter(pc.equal(pc.field('store_number'), store))

    # Campos mínimos esperados por tu scripts.js
    cols = [
        'numero_producto','categoria_producto','nombre_producto','grupo_cobertura',
        'unidad_medida','precio_final_con_descuento','precio_final_con_iva',
        'store_number','multiplo','signo'
    ]
    cols_presentes = [c for c in cols if c in table.column_names]
    table = table.select(cols_presentes)

    # Paginación en parquet (sencilla)
    total = table.num_rows
    start = max((page-1)*items_per_page, 0)
    end = min(start+items_per_page, total)
    if start >= total:
        return []
    sliced = table.slice(start, end-start)

    return [dict(zip(sliced.column_names, row)) for row in zip(*[sliced.column(i).to_pylist() for i in range(len(sliced.column_names))])]

def productos_last_modified():
    path = parquet_path()
    if not os.path.exists(path):
        return 0
    return int(os.path.getmtime(path))

def stock_por_codigo_y_grupo(codigo: str, store: str):
    """Usa tu DB local de stock + grupos de cumplimiento para filtrar por almacenes."""
    from services.database import obtener_grupos_cumplimiento, obtener_stock
    almacenes_permitidos = set(obtener_grupos_cumplimiento(store))
    data = obtener_stock()
    # Filtramos por código + almacenes del grupo
    result = [s for s in data if s.get('codigo') == str(codigo) and s.get('almacen_365') in almacenes_permitidos]
    # Si no hay nada, devolvemos 404 desde la view
    return result
