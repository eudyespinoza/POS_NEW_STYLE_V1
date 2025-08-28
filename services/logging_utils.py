import logging
import os
from typing import Optional

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG_DIR = os.path.join(BASE_DIR, 'logs')
os.makedirs(LOG_DIR, exist_ok=True)


def get_module_logger(name: str, level: int = logging.INFO, filename: Optional[str] = None) -> logging.Logger:
    """Return a logger configured to write to its own log file.

    Parameters
    ----------
    name: str
        Logger name, usually ``__name__`` of the module.
    level: int, optional
        Logging level; default is ``logging.INFO``.
    filename: str, optional
        Custom filename for the log. If not provided, the filename is
        derived from ``name`` replacing dots with underscores.
    """
    logger = logging.getLogger(name)
    if not logger.handlers:
        log_file = filename or f"{name.replace('.', '_')}.log"
        file_path = os.path.join(LOG_DIR, log_file)
        handler = logging.FileHandler(file_path)
        formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        logger.setLevel(level)
        logger.propagate = False
    return logger
