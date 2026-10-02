"""Makes a test copy of Counterlock-web.zip whose counter profile has builds
per damage type, for the hero page type box check in layout-check.yml.
Usage: python builds-zip.py <Counterlock-web.zip> <test zip>

It reads and writes the profile with the release's own Python (core.zip), and
gives Abrams a spirit build: one extra item first in each phase, so the check
can tell the builds apart. Nothing else changes. A release from before 0.43
can't hold builds per type: then it writes nothing and says so, and the check
is skipped until such a release is out.
"""

import io
import sys
import tempfile
import zipfile

source, target = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(source) as zf:
    files = {info.filename: zf.read(info) for info in zf.infolist()}
core = files["core.zip"]

# The release's own Python, from core.zip.
core_path = f"{tempfile.mkdtemp()}/core.zip"
with open(core_path, "wb") as handle:
    handle.write(core)
sys.path.insert(0, core_path)

from counterlock import model  # noqa: E402
from counterlock.profile_io import load_profile_text, profile_to_bytes  # noqa: E402
from counterlock.profile_updates import BUNDLED_PROFILE_NAME  # noqa: E402

if not hasattr(model, "Build"):
    from counterlock import __version__
    print(f"::notice::The latest release ({__version__}) predates builds per type (0.43), "
          "so the hero page type box isn't checked yet.")
    sys.exit(0)

name = f"profiles/{BUNDLED_PROFILE_NAME}"
profile = load_profile_text(files[name], name)
abrams = profile.enemies["abrams"]
extra = lambda phase: model.CounterItem(f"Spirit test item ({phase})", "only in the spirit build.")
abrams.builds["spirit"] = model.Build(lane=[extra("lane")] + list(abrams.lane),
                                      mid=[extra("mid")] + list(abrams.mid),
                                      late=[extra("late")] + list(abrams.late))
data = profile_to_bytes(profile)
files[name] = data

with zipfile.ZipFile(io.BytesIO(core)) as zf:
    inner = {info.filename: zf.read(info) for info in zf.infolist()}
if name in inner:
    inner[name] = data
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
    for path, content in inner.items():
        zf.writestr(path, content)
files["core.zip"] = buffer.getvalue()

with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as zf:
    for path, content in files.items():
        zf.writestr(path, content)
print(f"{target}: Abrams has a spirit build.")
