from django.core.management.base import BaseCommand
from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import Client


class Command(BaseCommand):
    help = "Prueba rápida que /pos-retail/ carga y contiene el modal del simulador"

    def handle(self, *args, **options):
        User = get_user_model()
        username = "tester"
        password = "test1234"

        # Crear usuario si no existe
        user, created = User.objects.get_or_create(username=username, defaults={"is_staff": True, "is_superuser": True})
        if created:
            user.set_password(password)
            user.save()

        # Permitir host testserver del Client
        try:
            if 'testserver' not in settings.ALLOWED_HOSTS:
                settings.ALLOWED_HOSTS.append('testserver')
        except Exception:
            pass

        c = Client()
        logged = c.login(username=username, password=password)
        if not logged:
            self.stderr.write("No se pudo iniciar sesión con el usuario de prueba")
            self.exitcode = 1
            return

        resp = c.get("/pos-retail/")
        if resp.status_code != 200:
            self.stderr.write(f"Respuesta inesperada: {resp.status_code}")
            self.exitcode = 1
            return

        html = resp.content.decode("utf-8", errors="ignore")
        checks = {
            "modal container": 'id="modalSimV5"' in html,
            "iframe": 'id="simV5Frame"' in html,
            "onclick button": 'onclick="openExternalSimulator()"' in html,
            "modal descuentos": 'id="modalDescuentos"' in html,
            "modal logistica": 'id="modalLogistica"' in html,
            "modal cantidad": 'id="quantityModalRetail"' in html,
        }
        ok = all(checks.values())
        for k, v in checks.items():
            self.stdout.write(f"[{ 'OK' if v else 'FAIL' }] {k}")
        if not ok:
            self.stderr.write("Faltan elementos del simulador en el HTML")
            self.exitcode = 1
            return

        self.stdout.write(self.style.SUCCESS("/pos-retail/ renderizado con el modal del simulador presente"))
