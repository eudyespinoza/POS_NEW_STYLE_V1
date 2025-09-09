from typing import Any, Dict, Optional

from django.http import JsonResponse


def json_ok(
    data: Optional[Any] = None,
    message: str = "OK",
    status: int = 200,
    **extra: Any,
) -> JsonResponse:
    payload: Dict[str, Any] = {"ok": True, "message": message}
    if data is not None:
        payload["data"] = data
    if extra:
        payload.update(extra)
    return JsonResponse(payload, status=status)


def json_error(
    message: str,
    *,
    code: Optional[str] = None,
    status: int = 400,
    data: Optional[Any] = None,
    **extra: Any,
) -> JsonResponse:
    """
    Error JSON normalizado. Incluye clave `error` por compatibilidad con front existente.
    """
    payload: Dict[str, Any] = {
        "ok": False,
        "message": message,
        "error": message,  # compat con front que espera `error`
    }
    if code is not None:
        payload["code"] = code
    if data is not None:
        payload["data"] = data
    if extra:
        payload.update(extra)
    return JsonResponse(payload, status=status)

