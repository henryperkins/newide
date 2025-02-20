# logging_config.py
import logging
from logging.handlers import RotatingFileHandler
import os

if not os.path.exists("logs"):
    os.makedirs("logs")

input_logger = logging.getLogger("input_logger")
input_logger.setLevel(logging.INFO)
input_handler = RotatingFileHandler("logs/input.log", maxBytes=5_000_000, backupCount=3)
input_handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))
input_logger.addHandler(input_handler)
input_logger.propagate = False

response_logger = logging.getLogger("response_logger")
response_logger.setLevel(logging.INFO)
response_handler = RotatingFileHandler("logs/response.log", maxBytes=5_000_000, backupCount=3)
response_handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))
response_logger.addHandler(response_handler)
response_logger.propagate = False

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)