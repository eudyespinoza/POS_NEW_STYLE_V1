# core/scheduler.py
import os
import sys
import time
import logging
from typing import Optional, Dict, Tuple
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

from django.conf import settings

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.executors.pool import ThreadPoolExecutor as APS_ThreadPoolExecutor
from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_EXECUTED

# Actualizadores de caché (escritura de archivos Parquet)
from services.caching import (
    actualizar_cache_productos,
    actualizar_cache_clientes,
    actualizar_cache_stock,
    actualizar_cache_empleados,
    actualizar_cache_atributos,
)

# ETLs / lecturas desde Fabric
from services.fabric import (
    obtener_stock_fabric,
    obtener_atributos_fabric,
    obtener_empleados_fabric,
    obtener_datos_tiendas,
    obtener_grupos_cumplimiento_fabric,
)

from services.get_token import get_access_token_d365, TokenRetrievalError
from services.database import guardar_token_d365
from services.email_service import enviar_correo_fallo

# Rutas de archivos Parquet
from services.config import (
    CACHE_FILE_PRODUCTOS,
    CACHE_FILE_CLIENTES,
    CACHE_FILE_STOCK,
    CACHE_FILE_ATRIBUTOS,
)

import pyarrow.parquet as pq

logger = logging.getLogger(__name__)

# =============================================================================
# Marcadores de log (evitar emojis en consolas cp1252)
# =============================================================================
def _supports_emoji() -> bool:
    enc = (getattr(sys.stdout, "encoding", "") or "").lower()
    return "utf" in enc  # ej: 'utf-8'

# Usamos marcadores ASCII siempre (evita UnicodeEncodeError)
OK   = "{OK}"   if _supports_emoji() else "[OK]"
FAIL = "{FAIL}" if _supports_emoji() else "[X]"
ZAP  = "{ZAP}"  if _supports_emoji() else "[*]"

# =============================================================================
# Flag de Bootstrap (compartido con las vistas)
# =============================================================================
FLAG_FILE = os.path.join(settings.BASE_DIR, "bootstrap_done.flag")
# Alias por compatibilidad con código previo
FLAG_BOOTSTRAP = FLAG_FILE

# =============================================================================
# Scheduler config
# =============================================================================
APS_MAX_WORKERS = int(os.getenv("APS_MAX_WORKERS", "10"))

executors = {
    "default": APS_ThreadPoolExecutor(max_workers=APS_MAX_WORKERS),
}
job_defaults = {
    "coalesce": True,     # junta ejecuciones perdidas
    "max_instances": 1,   # evita superposición del mismo job
}
scheduler = BackgroundScheduler(executors=executors, job_defaults=job_defaults)


def job_listener(event):
    if event.exception:
        try:
            enviar_correo_fallo(event.job_id, str(event.exception))
        except Exception:
            logger.exception("Fallo enviando correo de error")
        logger.error(f"Error en tarea {event.job_id}: {event.exception}", exc_info=True)
    else:
        logger.info(f"Tarea {event.job_id} ejecutada correctamente")


scheduler.add_listener(job_listener, EVENT_JOB_ERROR | EVENT_JOB_EXECUTED)

# =============================================================================
# Lectura de Parquet con caché en memoria (evita recargas innecesarias)
# =============================================================================
# cache: ruta -> (mtime, pyarrow.Table)
_PARQUET_CACHE: Dict[str, Tuple[float, "pyarrow.Table"]] = {}

def _load_parquet_cached(path: str):
    """Lee un Parquet con caché en memoria según mtime. Devuelve pyarrow.Table o None."""
    try:
        if not os.path.exists(path):
            return None
        mtime = os.path.getmtime(path)
        cached = _PARQUET_CACHE.get(path)
        if cached and cached[0] == mtime:
            return cached[1]
        tbl = pq.read_table(path)
        _PARQUET_CACHE[path] = (mtime, tbl)
        return tbl
    except Exception:
        logger.exception(f"No se pudo leer Parquet: {path}")
        return None

def load_parquet_productos():
    return _load_parquet_cached(CACHE_FILE_PRODUCTOS)

def load_parquet_clientes():
    return _load_parquet_cached(CACHE_FILE_CLIENTES)

def load_parquet_stock():
    return _load_parquet_cached(CACHE_FILE_STOCK)

def load_parquet_atributos():
    return _load_parquet_cached(CACHE_FILE_ATRIBUTOS)

# Compatibilidad histórica (si alguna parte del front aún la usa)
def obtener_productos_cache():
    return load_parquet_productos()

# =============================================================================
# Helpers de ejecución con logging y correo
# =============================================================================
def _run_step(nombre: str, fn, *args, **kwargs):
    """Ejecuta una función simple con logging y aviso por correo en error."""
    t0 = time.perf_counter()
    try:
        fn(*args, **kwargs)
        logger.info(f"{OK} {nombre} OK en {time.perf_counter()-t0:0.2f}s")
    except Exception as e:
        logger.error(f"{FAIL} {nombre} falló: {e}", exc_info=True)
        try:
            enviar_correo_fallo(nombre, str(e))
        except Exception:
            logger.exception("Fallo enviando correo de error")


def _run_step_chain(nombre: str, *fn_chain):
    """
    Ejecuta en orden, en el mismo hilo, una cadena de funciones con dependencia entre sí.
    Ej.: (_obtener, _cachear)
    """
    t0 = time.perf_counter()
    try:
        for fn in fn_chain:
            fn()
        logger.info(f"{OK} {nombre} OK en {time.perf_counter()-t0:0.2f}s")
    except Exception as e:
        logger.error(f"{FAIL} {nombre} falló: {e}", exc_info=True)
        try:
            enviar_correo_fallo(nombre, str(e))
        except Exception:
            logger.exception("Fallo enviando correo de error")


def actualizar_token_d365():
    """Obtiene y persiste el token D365."""
    try:
        token = get_access_token_d365()
    except TokenRetrievalError as exc:
        logger.error(f"{FAIL} get_access_token_d365 falló: {exc}")
        return
    if not token:
        logger.error(f"{FAIL} No se pudo obtener token D365")
        return
    guardar_token_d365(token)
    logger.info("Token D365 actualizado por bootstrap/cron.")

# =============================================================================
# Bootstrap paralelo (primera vez)
# =============================================================================
def bootstrap_parallel(max_workers: Optional[int] = None):
    """
    Ejecuta la carga inicial en paralelo respetando dependencias.
    Lánzalo en un thread (no bloquea Django). Idempotente con FLAG_FILE.
    """
    if os.path.exists(FLAG_FILE):
        logger.info("Bootstrap ya realizado anteriormente.")
        return

    logger.info(f"{ZAP} Iniciando bootstrap paralelo...")
    MAX = max_workers or int(os.getenv("INITIAL_LOAD_MAX_WORKERS", "6"))

    # Trabajos independientes + cadenas con dependencias
    jobs = [
        ("parquet_productos",           _run_step,        actualizar_cache_productos),
        ("parquet_clientes",            _run_step,        actualizar_cache_clientes),
        ("datos_tiendas",               _run_step,        obtener_datos_tiendas),
        ("grupos_cumplimiento",         _run_step,        obtener_grupos_cumplimiento_fabric),
        ("token_d365",                  _run_step,        actualizar_token_d365),

        ("stock + cache_stock",         _run_step_chain,  obtener_stock_fabric,       actualizar_cache_stock),
        ("atributos + cache_atributos", _run_step_chain,  obtener_atributos_fabric,   actualizar_cache_atributos),
        ("empleados + cache_empleados", _run_step_chain,  obtener_empleados_fabric,   actualizar_cache_empleados),
    ]

    # Ejecutar en paralelo
    with ThreadPoolExecutor(max_workers=MAX) as ex:
        futures = [ex.submit(j[1], j[0], *j[2:]) for j in jobs]
        for f in as_completed(futures):
            try:
                f.result()  # los helpers ya loguean/avisan mails
            except Exception:
                # ya está registrado por los helpers
                pass

    # Grabar flag (marca de finalización)
    try:
        with open(FLAG_FILE, "w", encoding="utf-8") as fh:
            fh.write(datetime.now().isoformat())
    except Exception:
        logger.exception("No se pudo grabar FLAG_FILE (continuará sin flag)")

    logger.info(f"{OK} Bootstrap paralelo finalizado.")

# =============================================================================
# Registro de cron jobs
# =============================================================================
def start_scheduler_and_jobs():
    """Registra tareas periódicas y arranca el scheduler (idempotente)."""
    logger.info("Iniciando scheduler/background jobs...")

    # Keep-alive
    scheduler.add_job(lambda: logger.info("Scheduler vivo"),
                      CronTrigger(minute="*/5"), id="alive")

    # Token
    scheduler.add_job(actualizar_token_d365,
                      CronTrigger(minute="*/10"), id="token_d365")

    # Cachés “simples”
    scheduler.add_job(actualizar_cache_clientes,
                      CronTrigger(minute="*/14"), id="clientes")
    scheduler.add_job(actualizar_cache_productos,
                      CronTrigger(minute="*/20"), id="productos")

    # Con dependencias (cadenas)
    scheduler.add_job(lambda: _run_step_chain("stock_fabric",
                                              obtener_stock_fabric, actualizar_cache_stock),
                      CronTrigger(minute="*/20"), id="stock_fabric")

    scheduler.add_job(lambda: _run_step_chain("atributos_fabric",
                                              obtener_atributos_fabric, actualizar_cache_atributos),
                      CronTrigger(minute="*/30"), id="atributos_fabric")

    # Diaria (empleados)
    scheduler.add_job(lambda: _run_step_chain("empleados_fabric",
                                              obtener_empleados_fabric, actualizar_cache_empleados),
                      CronTrigger(hour=7), id="empleados_fabric")

    # Semanales
    scheduler.add_job(obtener_grupos_cumplimiento_fabric,
                      CronTrigger(day_of_week="sat", hour=22, minute=0),
                      id="grupos_cumplimiento")
    scheduler.add_job(obtener_datos_tiendas,
                      CronTrigger(day_of_week="sat", hour=22, minute=30),
                      id="datos_tiendas")

    # Arrancar si no está ya corriendo
    if not scheduler.running:
        scheduler.start()

    for job in scheduler.get_jobs():
        logger.info(f"Job: {job.id} | Next: {job.next_run_time} | Trigger: {job.trigger}")
