from django.conf import settings
from .models import ModoEntrega

def modos_entrega(request):
    """Provide delivery modes and external simulator base URL for templates."""
    return {
        'modos_entrega': ModoEntrega.objects.all(),
        'simulator_v5_external_base_url': getattr(
            settings, 'SIMULATOR_V5_EXTERNAL_BASE_URL', 'http://localhost:8001/maestros/simulador/'
        ),
    }
