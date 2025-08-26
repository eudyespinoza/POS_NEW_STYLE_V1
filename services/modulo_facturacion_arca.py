import os
import shutil
import subprocess

OPENSSL_BIN = os.getenv("OPENSSL_PATH") or shutil.which("openssl")
if not OPENSSL_BIN:
    raise RuntimeError(
        "No se encontró el ejecutable de OpenSSL. Configure OPENSSL_PATH o añádalo al PATH."
    )

def ejecutar_openssl(*args: str) -> subprocess.CompletedProcess:
    """Ejecuta OpenSSL con los argumentos proporcionados."""
    cmd = [OPENSSL_BIN, *args]
    return subprocess.run(cmd, capture_output=True, text=True, check=True)
