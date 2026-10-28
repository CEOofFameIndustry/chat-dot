"""Local screenshot/overlay helpers. No API client or API credentials."""
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import time
BASE = Path(__file__).resolve().parent
RUNTIME = Path(os.environ.get("XDG_RUNTIME_DIR", f"/tmp/gemini-dot-{os.getuid()}")) / "gemini-dot-web"

def run(args, **kwargs):
    try:
        return subprocess.run(args, check=True, capture_output=True, timeout=15, **kwargs)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"Команда {Path(args[0]).name} не відповіла за 15 секунд.") from None
    except subprocess.CalledProcessError as error:
        raise RuntimeError(f"Команда {Path(args[0]).name} завершилася з кодом {error.returncode}.") from None

def notify(message):
    print(message, file=sys.stderr, flush=True)
    try:
        subprocess.run(["notify-send", "-a", "Gemini Dot", "-h",
            "string:x-canonical-private-synchronous:gemini-dot", "Gemini Dot", message],
            capture_output=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        pass

def runtime():
    RUNTIME.mkdir(mode=0o700, parents=True, exist_ok=True)
    if RUNTIME.is_symlink() or RUNTIME.stat().st_uid != os.getuid():
        raise RuntimeError("Небезпечний каталог тимчасових файлів.")
    RUNTIME.chmod(0o700)

def capture(screen):
    from PIL import Image
    raw = run(["grim", "-o", screen, "-t", "png", "-"]).stdout
    with Image.open(io.BytesIO(raw)) as image:
        image = image.convert("RGB")
        image.thumbnail((2560, 2560))
        buf = io.BytesIO()
        image.save(buf, "PNG")
        return buf.getvalue(), image.copy()

def hide():
    runtime()
    (RUNTIME / "cancel").write_text(str(time.time_ns()))
    subprocess.run(["qs", "ipc", "-p", str(BASE / "overlay.qml"), "call", "dot", "hide"],
        capture_output=True, timeout=5)

def overlay(screen, answer):
    env = os.environ.copy()
    # Do not pass credentials to the renderer.
    env.pop("GEMINI_API_KEY", None)
    points = [{"x": point["x"], "y": point["y"]} for point in answer["answers"]]
    env.update(GEMINI_DOT_SCREEN=screen, GEMINI_DOT_POINTS=json.dumps(points),
               GEMINI_DOT_TEXT=answer.get("text", ""),
               GEMINI_DOT_DURATION="45000" if answer.get("text") else ("12000" if len(points) > 1 else "8000"))
    result = subprocess.run(["qs", "-p", str(BASE / "overlay.qml")], env=env,
        capture_output=True, timeout=50)
    if result.returncode:
        raise RuntimeError("Не вдалося показати точку через Quickshell.")

def screen_changed(before, after, answer):
    from PIL import ImageChops, ImageStat
    if before.size != after.size:
        return True
    width, height = before.size
    for point in answer["answers"]:
        y = point["y"] * height / 1000
        box = (0, max(0, int(y - 50)), width, min(height, int(y + 50)))
        diff = ImageChops.difference(before.crop(box), after.crop(box))
        if sum(ImageStat.Stat(diff).mean) / 3 > 8:
            return True
    return False
