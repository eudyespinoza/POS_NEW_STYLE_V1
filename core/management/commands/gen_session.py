from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from django.conf import settings
from django.contrib.sessions.backends.db import SessionStore as DBSessionStore
from importlib import import_module


class Command(BaseCommand):
    help = "Genera una sesión autenticada para un usuario y devuelve el sessionid"

    def add_arguments(self, parser):
        parser.add_argument('--username', required=True)

    def handle(self, *args, **opts):
        username = opts['username']
        User = get_user_model()
        user, _ = User.objects.get_or_create(username=username, defaults={'is_active': True})
        if not user.has_usable_password():
            user.set_password('test1234')
            user.save()

        engine = import_module(settings.SESSION_ENGINE)
        SessionStore = engine.SessionStore
        session = SessionStore()

        # Set auth keys in session
        from django.contrib.auth import SESSION_KEY, BACKEND_SESSION_KEY, HASH_SESSION_KEY
        session[SESSION_KEY] = str(user.pk)
        session[BACKEND_SESSION_KEY] = 'django.contrib.auth.backends.ModelBackend'
        session[HASH_SESSION_KEY] = user.get_session_auth_hash()
        session.save()

        self.stdout.write(session.session_key)
