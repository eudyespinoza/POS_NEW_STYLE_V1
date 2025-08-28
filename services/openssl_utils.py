import os
import subprocess
from typing import List
from services.logging_utils import get_module_logger

OPENSSL_BIN = os.environ.get("OPENSSL_BIN", "openssl")
logger = get_module_logger(__name__)

def run_openssl(args: List[str]) -> str:
    """Run an OpenSSL command and return its standard output.

    All log messages explicitly mention the path used to invoke OpenSSL.

    Parameters
    ----------
    args:
        Additional command-line arguments passed to OpenSSL.
    Returns
    -------
    str
        The standard output produced by OpenSSL.
    Raises
    ------
    RuntimeError
        If OpenSSL fails to execute. The error message includes the
        path to the binary used.
    """
    cmd = [OPENSSL_BIN, *args]
    logger.info("Ejecutando OpenSSL en '%s' con argumentos: %s", OPENSSL_BIN, args)
    try:
        completed = subprocess.run(
            cmd, check=True, text=True, capture_output=True
        )
        logger.info("OpenSSL ejecutado correctamente en '%s'", OPENSSL_BIN)
        return completed.stdout
    except (FileNotFoundError, subprocess.CalledProcessError) as e:
        logger.error(
            "Fallo al ejecutar OpenSSL en '%s': %s", OPENSSL_BIN, getattr(e, 'stderr', e)
        )
        raise RuntimeError(f"Error al ejecutar '{OPENSSL_BIN}': {e}") from e
