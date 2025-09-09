import os
import shutil
import subprocess
from datetime import datetime
from services.logging_utils import get_module_logger

logger = get_module_logger(__name__)

OPENSSL_BIN = "C:\\Program Files\\OpenSSL-Win64\\bin"
if not OPENSSL_BIN:
    raise RuntimeError(
        "No se encontró el ejecutable de OpenSSL. Configure OPENSSL_PATH o añádalo al PATH."
    )

def ejecutar_openssl(*args: str) -> subprocess.CompletedProcess:
    """Ejecuta OpenSSL con los argumentos proporcionados."""
    cmd = [OPENSSL_BIN, *args]
    return subprocess.run(cmd, capture_output=True, text=True, check=True)


def generar_factura(cliente: dict | None, items: list[dict], total: float, pagos: list[dict] | None = None) -> dict:
    """Genera una factura electrónica usando el módulo ARCA.

    Esta implementación es un *stub* que simula la integración con el
    servicio real de AFIP/ARCA. Devuelve un número de factura ficticio y
    datos mínimos necesarios para continuar el flujo de venta.

    Args:
        cliente: Datos del cliente o ``None`` para consumidor final.
        items: Lista de ítems del carrito.
        total: Importe total de la factura.

    Returns:
        dict: Información básica de la factura generada.
    """

    numero = datetime.now().strftime("A-%Y%m%d%H%M%S")
    logger.info(
        "Factura %s generada para cliente %s por un total de %.2f",
        numero,
        (cliente or {}).get("numero_cliente", "consumidor final"),
        total,
    )

    # Log de pagos (si llegan)
    try:
        if pagos:
            logger.info("Detalle de pagos: %s", pagos)
    except Exception:
        pass

    return {
        "numero": numero,
        "cae": "00000000000000",
        "vencimiento": datetime.now().strftime("%Y-%m-%d"),
        "pagos": pagos or [],
    }
