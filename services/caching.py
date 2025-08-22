# services/caching.py
"""
Módulo de caché separado de la carpeta de datos 'services/cache/' para evitar
choques en los imports. Aquí viven las funciones de actualización de caché
usadas por el scheduler.
"""
import os
import datetime
import logging
from functools import lru_cache

import requests
import pyarrow as pa
import pyarrow.parquet as pq

from services.email_service import enviar_correo_fallo
from services.database import (
    obtener_stock,
    obtener_empleados,
    obtener_todos_atributos,
)

logger = logging.getLogger(__name__)

# ----------------------------------------------------------------------
# Rutas de archivos de caché
# ----------------------------------------------------------------------
try:
    # Si tienes estos paths en config.py, los usamos
    from config import (
        CACHE_FILE_PRODUCTOS,
        CACHE_FILE_STOCK,
        CACHE_FILE_CLIENTES,
        CACHE_FILE_EMPLEADOS,
        CACHE_FILE_ATRIBUTOS,
    )
except Exception:
    # Fallback seguro
    BASE_DIR = os.path.dirname(os.path.dirname(__file__))  # raíz del repo
    CACHE_DIR = os.path.join(BASE_DIR, "services", "cache")
    os.makedirs(CACHE_DIR, exist_ok=True)
    CACHE_FILE_PRODUCTOS = os.path.join(CACHE_DIR, "productos_cache.parquet")
    CACHE_FILE_CLIENTES  = os.path.join(CACHE_DIR, "clientes_cache.parquet")
    CACHE_FILE_STOCK     = os.path.join(CACHE_DIR, "stock_cache.parquet")
    CACHE_FILE_EMPLEADOS = os.path.join(CACHE_DIR, "empleados_cache.parquet")
    CACHE_FILE_ATRIBUTOS = os.path.join(CACHE_DIR, "atributos_cache.parquet")

# ----------------------------------------------------------------------
# URLs (muévelas a config.ini si prefieres)
# ----------------------------------------------------------------------
# Si ya las cargas de otro lado, puedes borrar estas constantes.
PRODUCTOS_PARQUET_URL = "https://fabricstorageeastus.blob.core.windows.net/fabric/Buscador/Productos_Buscador.parquet?sp=re&st=2025-04-09T18:46:04Z&se=2030-04-10T02:46:04Z&spr=https&sv=2024-11-04&sr=b&sig=4keHTQiesvWQlHhHfEi7mftZHq7yTJvsLdkdZ9oGWK8%3D"  # noqa: E501
CLIENTES_PARQUET_URL  = "https://fabricstorageeastus.blob.core.windows.net/fabric/Buscador/Clientes_Base_Buscador.parquet?sp=re&st=2025-04-10T12:52:43Z&se=2030-04-10T20:52:43Z&spr=https&sv=2024-11-04&sr=b&sig=ELgolJCh%2BqJVNigrcw5hPpgDQblWuTQ378gIBUaW9Fo%3D"  # noqa: E501

# ----------------------------------------------------------------------
# Descargas
# ----------------------------------------------------------------------
def _descargar(url: str, destino: str, nombre: str):
    try:
        logger.info(f"Descargando {nombre} desde URL...")
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
        with open(destino, "wb") as f:
            f.write(resp.content)
        logger.info(f"{nombre} descargado en {destino}")
    except Exception as e:
        logger.error(f"Error al descargar {nombre}: {e}", exc_info=True)
        try:
            enviar_correo_fallo(f"descargar_{nombre}", str(e))
        except Exception:
            logger.exception("Fallo enviando correo de error")
        raise

def _hoy(dt_path: str) -> bool:
    """¿El archivo fue modificado hoy?"""
    try:
        mod_time = datetime.date.fromtimestamp(os.path.getmtime(dt_path))
        return mod_time == datetime.date.today()
    except Exception:
        return False

# ----------------------------------------------------------------------
# Cargas en memoria (invalidables)
# ----------------------------------------------------------------------
@lru_cache(maxsize=1)
def load_products_to_memory():
    return pq.read_table(CACHE_FILE_PRODUCTOS)

@lru_cache(maxsize=1)
def load_parquet_to_memory():
    return pq.read_table(CACHE_FILE_CLIENTES)

@lru_cache(maxsize=1)
def load_stock_to_memory():
    return pq.read_table(CACHE_FILE_STOCK)

@lru_cache(maxsize=1)
def load_atributos_to_memory():
    return pq.read_table(CACHE_FILE_ATRIBUTOS)

# ----------------------------------------------------------------------
# API pública usada por el scheduler
# ----------------------------------------------------------------------
def actualizar_cache_productos():
    """Actualiza productos_cache.parquet descargándolo directamente."""
    try:
        _descargar(PRODUCTOS_PARQUET_URL, CACHE_FILE_PRODUCTOS, "productos.parquet")
        load_products_to_memory.cache_clear()
        logger.info("Caché productos actualizada y memoria invalidada.")
    except Exception as e:
        logger.error(f"Error actualizar_cache_productos: {e}", exc_info=True)
        raise

def actualizar_cache_clientes():
    """Actualiza clientes_cache.parquet descargándolo directamente."""
    try:
        _descargar(CLIENTES_PARQUET_URL, CACHE_FILE_CLIENTES, "clientes.parquet")
        load_parquet_to_memory.cache_clear()
        logger.info("Caché clientes actualizada y memoria invalidada.")
    except Exception as e:
        logger.error(f"Error actualizar_cache_clientes: {e}", exc_info=True)
        raise

def actualizar_cache_stock():
    try:
        logger.info("Obteniendo stock (services.database.obtener_stock) para cache...")
        stock_data = obtener_stock(formateado=False)  # <<< NUMÉRICO
        if not stock_data:
            logger.warning("No se encontraron datos de stock para cache.")
            return
        keys = stock_data[0].keys()
        data = {k: [row.get(k) for row in stock_data] for k in keys}
        table = pa.Table.from_pydict(data)
        pq.write_table(table, CACHE_FILE_STOCK)
        load_stock_to_memory.cache_clear()
        logger.info("Caché stock actualizada.")
    except Exception as e:
        logger.error(f"Error actualizar_cache_stock: {e}", exc_info=True)
        try:
            enviar_correo_fallo("actualizar_cache_stock", str(e))
        except Exception:
            logger.exception("Fallo enviando correo de error")
        raise

def actualizar_cache_empleados():
    """Construye el parquet de empleados desde la DB local."""
    try:
        logger.info("Obteniendo empleados (services.database.obtener_empleados) para cache...")
        empleados = obtener_empleados()
        if not empleados:
            logger.warning("No se encontraron empleados para cache.")
            return
        keys = empleados[0].keys()
        data = {k: [row.get(k) for row in empleados] for k in keys}
        table = pa.Table.from_pydict(data)
        pq.write_table(table, CACHE_FILE_EMPLEADOS)
        logger.info("Caché empleados actualizada.")
    except Exception as e:
        logger.error(f"Error actualizar_cache_empleados: {e}", exc_info=True)
        try:
            enviar_correo_fallo("actualizar_cache_empleados", str(e))
        except Exception:
            logger.exception("Fallo enviando correo de error")
        raise

def actualizar_cache_atributos():
    """Construye el parquet de atributos desde la DB local."""
    try:
        logger.info("Obteniendo atributos (services.database.obtener_todos_atributos) para cache...")
        atributos = obtener_todos_atributos()
        if not atributos:
            logger.warning("No se encontraron atributos para cache.")
            return
        keys = atributos[0].keys()
        data = {k: [row.get(k) for row in atributos] for k in keys}
        table = pa.Table.from_pydict(data)
        pq.write_table(table, CACHE_FILE_ATRIBUTOS)
        load_atributos_to_memory.cache_clear()
        logger.info("Caché atributos actualizada.")
    except Exception as e:
        logger.error(f"Error actualizar_cache_atributos: {e}", exc_info=True)
        try:
            enviar_correo_fallo("actualizar_cache_atributos", str(e))
        except Exception:
            logger.exception("Fallo enviando correo de error")
        raise
