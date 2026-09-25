"""Run the durable translation worker: python -m app.worker."""

from __future__ import annotations

import argparse
import logging
import time

from app.database import register_activity_listener
from app.services.jobs import process_job

logger = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(description="Process queued translation jobs")
    parser.add_argument("--once", action="store_true", help="Process one job and exit")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    register_activity_listener()
    while True:
        try:
            worked = process_job()
        except Exception:
            logger.exception("Translation job failed")
            worked = False
        if args.once:
            return
        if not worked:
            time.sleep(1)


if __name__ == "__main__":
    main()
