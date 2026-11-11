"""OriginClean Backend Package.

Developed and published by Muhammad Lutfi Muzaki.
Copyright © 2026 Muhammad Lutfi Muzaki. All rights reserved.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT_DIR / "service" / "scripts"

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

APP_METADATA = {
    "name": "OriginClean",
    "product_name": "OriginClean",
    "tagline": "Clean Your Files. Preserve Their Origin.",
    "version": "1.0.0",
    "identifier": "com.muhammadlutfimuzaki.originclean",
    "developer": "Muhammad Lutfi Muzaki",
    "creator": "Muhammad Lutfi Muzaki",
    "publisher": "Muhammad Lutfi Muzaki",
    "author": "Muhammad Lutfi Muzaki",
    "copyright": "Copyright © 2026 Muhammad Lutfi Muzaki. All rights reserved.",
    "github_owner": "MuhammadLutfiMuzakiiVY",
    "repository_name": "OriginClean",
    "repository_url": "https://github.com/MuhammadLutfiMuzakiiVY/OriginClean",
    "license": "MIT",
    "upstream_attribution": (
        "Core inspection and cleaning algorithms adapted from watermarks-remover "
        "(MIT License, Copyright (c) 2026 Guillaume Meyer and contributors)."
    ),
}

