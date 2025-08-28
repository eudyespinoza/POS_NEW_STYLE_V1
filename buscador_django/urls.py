# buscador_django/urls.py
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('', include('core.urls', namespace='core')),
    path('auth/', include(('auth_app.urls', 'auth_app'), namespace='auth_app')),
    path('api/payments/', include(('payments.urls', 'payments'), namespace='payments')),
    path('admin/', admin.site.urls),
]

# En dev, servir estáticos
if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
