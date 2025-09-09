from functools import wraps

from django.conf import settings
from django.contrib.auth import REDIRECT_FIELD_NAME
from django.contrib.auth.views import redirect_to_login
from django.contrib import messages
from django.shortcuts import render


def staff_only_notice(view_func):
    """
    Requiere que el usuario esté autenticado y sea staff.
    - Si NO está autenticado: redirige al LOGIN_URL estándar con ?next=...
    - Si está autenticado pero NO es staff: muestra una página de aviso (403).
    """

    @wraps(view_func)
    def _wrapped(request, *args, **kwargs):
        user = getattr(request, "user", None)
        if not (user and user.is_authenticated):
            return redirect_to_login(
                request.get_full_path(), settings.LOGIN_URL, REDIRECT_FIELD_NAME
            )
        if not (user.is_active and user.is_staff):
            messages.warning(request, "No tenés permisos de staff para acceder a esta sección.")
            return render(request, "errors/staff_only.html", status=403)
        return view_func(request, *args, **kwargs)

    return _wrapped
