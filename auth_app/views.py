# auth_app/views.py
import os
import configparser
from pathlib import Path
from services.logging_utils import get_module_logger

from ldap3 import Connection
from ldap3.core.exceptions import LDAPException, LDAPBindError

from django.contrib import messages
from django.contrib.auth import get_user_model, login as dj_login, logout as dj_logout
from django.shortcuts import render, redirect
from django.urls import reverse
from django.views.decorators.http import require_http_methods

from services.database import obtener_empleados_by_email

logger = get_module_logger(__name__)


# ============ Helpers LDAP (equivalente a auth_module.py, sin Flask) ============
def _load_ldap_config():
    """
    Carga config.ini con sección [ldap]/[LDAP], case-insensitive.
    Orden de búsqueda:
    1) LDAP_CONFIG_PATH (variable de entorno)
    2) settings.BASE_DIR / 'config.ini'
    3) cwd / 'config.ini'
    4) auth_app/config.ini
    5) auth_module/config.ini
    Devuelve un dict con claves en minúsculas.
    """
    candidates = []

    # 1) Variable de entorno explícita
    env_path = os.environ.get("LDAP_CONFIG_PATH")
    if env_path:
        candidates.append(Path(env_path))

    # 2) Raíz del proyecto (BASE_DIR)
    try:
        from django.conf import settings
        candidates.append(Path(settings.BASE_DIR) / "config.ini")
    except Exception:
        pass

    # 3) Directorio actual
    candidates.append(Path.cwd() / "config.ini")

    # 4) auth_app/config.ini
    candidates.append(Path(__file__).resolve().parent / "config.ini")

    # 5) auth_module/config.ini (compat)
    candidates.append(Path(__file__).resolve().parents[1] / "auth_module" / "config.ini")

    config_path = next((p for p in candidates if p and p.exists()), None)
    if not config_path:
        logger.error("No se encontró config.ini. Probadas: %s", [str(p) for p in candidates])
        return None

    parser = configparser.ConfigParser()
    # keys de opciones serán lower() por defecto (bien)
    parser.read(config_path, encoding="utf-8")

    # localizar sección 'ldap' de forma case-insensitive
    ldap_section = next((s for s in parser.sections() if s.lower() == "ldap"), None)
    if not ldap_section:
        logger.error("config.ini leído en %s pero falta sección [ldap]", config_path)
        return None

    cfg = {k.lower(): v for k, v in parser.items(ldap_section)}
    logger.info("LDAP config cargada desde %s (claves: %s)", config_path, list(cfg.keys()))
    return cfg


def _ldap_authenticate(username: str, password: str):
    """
    Intenta bind contra 2 dominios como en tu Flask:
    devuelve (True, None, email) o (False, 'mensaje de error', None)
    """
    ldap_cfg = _load_ldap_config()
    if not ldap_cfg:
        return False, "No se encontró configuración LDAP (config.ini).", None

    server = ldap_cfg.get("ldap_server")
    familia = ldap_cfg.get("ldap_domain")
    todogriferia = ldap_cfg.get("ldap_domain_tg")

    for domain in (familia, todogriferia):
        if not domain:
            continue
        try:
            logger.info(f"Intentando autenticación en {domain} para {username}")
            # bind directo
            Connection(server, user=f"{username}@{domain}", password=password, auto_bind=True)
            return True, None, f"{username}@{domain}"
        except LDAPBindError:
            logger.warning(f"Credenciales inválidas en {domain} para {username}")
            continue
        except LDAPException as e:
            logger.error(f"Error de LDAP contra {domain}: {e}")
            return False, str(e), None

    return False, "Credenciales inválidas", None


# ========================== Vistas Django ==========================
@require_http_methods(["GET", "POST"])
def login_view(request):
    """
    - POST: valida por LDAP, trae empleado desde DB y guarda en sesión:
      usuario, id_puesto, empleado_d365, numero_sap, email, last_store
      Además autentica un User de Django (creándolo si no existe).
    - GET: muestra login.html
    """
    if request.method == "POST":
        try:
            username = (request.POST.get("username") or "").strip().lower()
            password = request.POST.get("password") or ""

            if not username or not password:
                messages.error(request, "Debes ingresar usuario y contraseña.")
                return render(request, "login.html")

            ok, err, mail = _ldap_authenticate(username, password)
            if not ok:
                messages.error(request, f"Credenciales incorrectas: {err}")
                return render(request, "login.html")

            datos = obtener_empleados_by_email(mail) or {}
            if not datos:
                messages.error(request, "No se encontraron datos del empleado en la base de datos.")
                return render(request, "login.html")

            nombre_completo = datos.get("nombre_completo") or username
            email = datos.get("email") or mail
            id_puesto = datos.get("id_puesto")
            empleado_d365 = datos.get("empleado_d365")
            numero_sap = datos.get("numero_sap")
            last_store = datos.get("last_store")

            request.session["usuario"] = nombre_completo
            request.session["id_puesto"] = id_puesto
            request.session["empleado_d365"] = empleado_d365
            request.session["numero_sap"] = numero_sap
            request.session["email"] = email
            request.session["last_store"] = last_store
            request.session.set_expiry(60 * 60 * 4)

            User = get_user_model()
            user, _ = User.objects.get_or_create(
                username=email, defaults={"email": email, "is_active": True}
            )
            if not user.email:
                user.email = email
                user.save(update_fields=["email"])
            dj_login(request, user)

            messages.success(request, "Iniciaste sesión con éxito.")
            next_url = request.GET.get("next") or reverse("core:home")
            return redirect(next_url)
        except Exception as e:
            logger.exception("Fallo inesperado en login_view: %s", e)
            messages.error(request, "Ocurrió un error inesperado. Intenta nuevamente.")
            return render(request, "login.html")

    # GET
    return render(request, "login.html")


def logout_view(request):
    """
    Limpia las claves de sesión que usa tu back y cierra sesión Django.
    """
    for k in ("usuario", "id_puesto", "empleado_d365", "numero_sap", "email", "last_store"):
        request.session.pop(k, None)
    dj_logout(request)
    messages.success(request, "Cerraste sesión con éxito.")
    return redirect("auth_app:login")
