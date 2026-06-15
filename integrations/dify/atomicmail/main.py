import os
import sys
from pathlib import Path


def _bootstrap_vendor_runtime() -> None:
    plugin_root = Path(__file__).resolve().parent
    vendor_dir = plugin_root / "vendor"
    shared_dir = vendor_dir / "shared"

    # Ensure `import atomicmail` resolves against vendored Python SDK.
    sys.path.insert(0, str(vendor_dir))
    os.environ.setdefault("ATOMIC_MAIL_SHARED_DIR", str(shared_dir))


_bootstrap_vendor_runtime()

from dify_plugin import DifyPluginEnv, Plugin

plugin = Plugin(DifyPluginEnv(MAX_REQUEST_TIMEOUT=120))

if __name__ == '__main__':
    plugin.run()
