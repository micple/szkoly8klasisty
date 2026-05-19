"""
Buduje self-contained folder docs/ gotowy do deploy na GitHub Pages.
Idempotentny — usuwa stare docs/ i tworzy fresh.

Robi:
  1. Kopiuje site-v2/* do docs/
  2. Kopiuje site/data.js do docs/data.js (bundling)
  3. Podmienia w docs/index.html: <script src="../site/data.js"> → <script src="data.js">

Uruchomienie:  python scripts/build-deploy.py
"""

from __future__ import annotations
import io
import shutil
import sys
from pathlib import Path

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "site-v2"
DATA_SRC = ROOT / "site" / "data.js"
DST = ROOT / "docs"


def main() -> int:
    if not SRC.exists():
        sys.exit(f"Brak {SRC}")
    if not DATA_SRC.exists():
        sys.exit(f"Brak {DATA_SRC}")

    # 1. Wyczyść docs/
    if DST.exists():
        shutil.rmtree(DST)
        print(f"⊘ Usunięto stare {DST}")
    DST.mkdir(parents=True)

    # 2. Kopiuj site-v2/*
    for item in SRC.iterdir():
        target = DST / item.name
        if item.is_dir():
            shutil.copytree(item, target)
        else:
            shutil.copy2(item, target)
    n = len(list(DST.iterdir()))
    print(f"✓ Skopiowano {n} elementów z {SRC.name}/ do {DST.name}/")

    # 3. Bundle data.js (jeden source of truth → wbudowany w deploy)
    shutil.copy2(DATA_SRC, DST / "data.js")
    print(f"✓ Bundled site/data.js → docs/data.js")

    # 4. Podmień w index.html ścieżkę do data.js
    idx = DST / "index.html"
    txt = idx.read_text(encoding="utf-8")
    old = '<script src="../site/data.js"></script>'
    new = '<script src="data.js"></script>'
    if old not in txt:
        print(f"⚠ Nie znalazłem '{old}' w docs/index.html — sprawdź index.html ręcznie")
    else:
        txt = txt.replace(old, new)
        idx.write_text(txt, encoding="utf-8")
        print(f"✓ Naprawiono ścieżkę data.js w docs/index.html")

    # 5. Usuń niepotrzebne dla produkcji
    for unwanted in ("geocode.html", "SETUP.md", "config.example.js"):
        f = DST / unwanted
        if f.exists():
            f.unlink()
            print(f"  ⊘ Usunięto z deploy: {unwanted}")

    print(f"\nGotowe. docs/ ma {sum(1 for _ in DST.rglob('*') if _.is_file())} plików.")
    print("Dalej: git add docs/ && git commit && git push  →  GitHub Pages podchwyci.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
