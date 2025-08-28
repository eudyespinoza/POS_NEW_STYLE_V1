# core/apps.py
import os
from django.apps import AppConfig
from django.conf import settings
from services.logging_utils import get_module_logger

logger = get_module_logger(__name__)

# Evita doble ejecución en runserver (autoreloader)
def _is_main_process() -> bool:
    # En runserver de Django, RUN_MAIN == 'true' en el proceso hijo (el bueno)
    return os.environ.get("RUN_MAIN") == "true" or not settings.DEBUG

class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core'
    verbose_name = "Core"

    def ready(self):
        # 1) Reconfigurar stdout/stderr en Windows para evitar UnicodeEncodeError
        try:
            import sys
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass  # en algunos entornos no aplica

        if not _is_main_process():
            return

        # 2) Inicializa tus SQLite (crea tablas si no existen) ANTES del scheduler
        try:
            from services.database import init_db
            init_db()
            logger.info("init_db() ejecutado OK antes de scheduler.")
        except Exception as e:
            logger.exception("Fallo init_db() en AppConfig.ready(): %s", e)

        # 3) Arranca scheduler y bootstrap paralelo (idempotentes)
        try:
            from .scheduler import start_scheduler_and_jobs, bootstrap_parallel
            start_scheduler_and_jobs()   # cron jobs
            bootstrap_parallel()         # primera carga paralela
        except Exception as e:
            logger.exception("Fallo arrancando scheduler/bootstrap: %s", e)
