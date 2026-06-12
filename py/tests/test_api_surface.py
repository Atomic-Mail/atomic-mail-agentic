from __future__ import annotations

import atomicmail


def test_public_api_exports_help_and_jmap_request() -> None:
    assert callable(atomicmail.help)
    assert callable(atomicmail.jmap_request)
    assert callable(atomicmail.run_jmap_request)
    assert hasattr(atomicmail, "JmapRequestResult")
