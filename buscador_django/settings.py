from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent

# Seguridad / básicos (ajusta SECRET_KEY en producción)
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'cambia-esta-clave-en-produccion')
DEBUG = os.environ.get('DJANGO_DEBUG', '1') == '1'

ALLOWED_HOSTS = os.environ.get('DJANGO_ALLOWED_HOSTS', '').split() if not DEBUG else []

# Controla si el sitio puede ser embebido en iframes
X_FRAME_OPTIONS = 'SAMEORIGIN'

# Apps
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # Apps del proyecto
    'auth_app',
    'core.apps.CoreConfig',  # usa solo el AppConfig (no dupliques 'core')
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'core.middleware.session_logging.SessionSaveLoggingMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    # 'django.middleware.locale.LocaleMiddleware',  # si necesitas i18n por sitios, actívalo
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'buscador_django.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [
            BASE_DIR / 'core' / 'templates',
        ],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'buscador_django.wsgi.application'
ASGI_APPLICATION = 'buscador_django.asgi.application'

# Base de datos (Django). Tu app usa SQLite propia en services/database.py,
# esto es solo para el core de Django (auth, sessions, etc.)
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME'  : BASE_DIR / 'db.sqlite3',
    }
}

# Idioma / Zona horaria
LANGUAGE_CODE = 'es-ar'
TIME_ZONE = 'America/Argentina/Cordoba'
USE_I18N = True
USE_TZ = True  # recomendado

# Archivos estáticos
STATIC_URL = '/static/'
STATICFILES_DIRS = [
    BASE_DIR / 'core' / 'static',
]
STATIC_ROOT = BASE_DIR / 'staticfiles'  # para collectstatic en deploy

# Login (usa namespaces definidos en urls)
LOGIN_URL = 'auth_app:login'
LOGIN_REDIRECT_URL = 'core:home'
LOGOUT_REDIRECT_URL = 'auth_app:login'

# Logs básicos de Django (además de los que ya usas en services/)
LOG_DIR = BASE_DIR / 'logs'
LOG_DIR.mkdir(exist_ok=True)
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'file': {
            'level': 'INFO',
            'class': 'logging.FileHandler',
            'filename': LOG_DIR / 'django.log',
        },
        'console': {
            'level': 'INFO',
            'class': 'logging.StreamHandler',
        },
    },
    'root': {
        'handlers': ['file', 'console'],
        'level': 'INFO',
    },
}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

from django.contrib.messages import constants as messages
MESSAGE_TAGS = {
    messages.ERROR: 'danger',
}

# Sesión
SESSION_COOKIE_AGE = 60 * 60 * 4  # 4 horas
SESSION_SAVE_EVERY_REQUEST = True
