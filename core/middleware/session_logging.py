# core/middleware/session_logging.py
import logging
from django.db.utils import OperationalError

logger = logging.getLogger(__name__)

class SessionSaveLoggingMiddleware:
    """Log context on OperationalError during session save."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            return self.get_response(request)
        except OperationalError as exc:
            user = getattr(request, 'user', None)
            username = (
                user.username if getattr(user, 'is_authenticated', False) else 'Anonymous'
            )
            logger.error(
                'Session save failed on %s for user %s: %s',
                request.path,
                username,
                exc,
            )
            raise
