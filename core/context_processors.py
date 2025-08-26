from .models import ModoEntrega

def modos_entrega(request):
    """Provide all delivery modes for templates."""
    return {'modos_entrega': ModoEntrega.objects.all()}
