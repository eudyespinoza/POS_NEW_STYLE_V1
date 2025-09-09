"""
Configuración de IVA y utilidades.

Estrategia propuesta:
- Centralizar la lógica de tasas en este módulo.
- Permitir sobreescritura por variable de entorno o por DB separada si existiera
  (por ejemplo, services/config_impositiva.db) y, en lo posible, por categoría
  o tipo de artículo.
"""
import os
from typing import Optional


def default_vat_rate() -> float:
    try:
        return float(os.getenv("DEFAULT_VAT_RATE", "0.21"))
    except Exception:
        return 0.21


def vat_rate_for_line(method_code: Optional[str] = None, brand: Optional[str] = None, bank_code: Optional[str] = None) -> float:
    """Devuelve la tasa de IVA para una línea del simulador.

    Notas:
    - En Argentina: 21% general, 10.5% reducido para ciertos bienes/servicios,
      0% para exentos y 27% para situaciones puntuales. Lo correcto es
      parametrizar por rubro/categoría de producto.
    - Aquí devolvemos default 21% y dejamos el hook para, en el futuro,
      identificar por categoría o un mapeo persistido.
    """
    # TODO: si se dispone de categoría del producto en la línea, resolver ahí.
    return default_vat_rate()

