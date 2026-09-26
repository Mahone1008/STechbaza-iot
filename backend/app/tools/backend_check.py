"""Повне приймання regression suite: будь-який skipped test є невдачею."""

import os
from pathlib import Path
import sys
import unittest


def main():
    if any(os.getenv(name) != "1" for name in ("TECHBAZA_RUN_DB_TESTS", "TECHBAZA_RUN_MQTT_TESTS")):
        raise RuntimeError("Full checks require TECHBAZA_RUN_DB_TESTS=1 and TECHBAZA_RUN_MQTT_TESTS=1")
    tests = Path(__file__).resolve().parents[2] / "tests"
    suite = unittest.defaultTestLoader.discover(str(tests))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful() or result.skipped or result.testsRun == 0:
        print("FAIL: full backend checks require successful tests with zero skips", flush=True)
        sys.exit(1)
    print(f"PASS: {result.testsRun} backend tests, zero skips", flush=True)


if __name__ == "__main__":
    main()
