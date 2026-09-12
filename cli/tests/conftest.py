import os
import re
import pytest

# Ensure ANSI escape sequences are disabled during test execution so
# string assertions on CLI output succeed in all environments (including CI).
os.environ["NO_COLOR"] = "1"
os.environ.pop("FORCE_COLOR", None)
