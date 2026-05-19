from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader


PDF_DIR = Path("wyniki lata przeszle")


def read_pdf_text(path: Path) -> str:
    reader = PdfReader(str(path))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def normalized_lines(text: str) -> list[str]:
    lines: list[str] = []
    for line in text.splitlines():
        clean = re.sub(r"\s+", " ", line).strip()
        if clean:
            lines.append(clean)
    return lines


def search_terms(terms: list[str]) -> dict[str, list[dict[str, str]]]:
    results: dict[str, list[dict[str, str]]] = {}
    for pdf in sorted(PDF_DIR.glob("*.pdf")):
        lines = normalized_lines(read_pdf_text(pdf))
        year_match = re.search(r"20\d{2}", pdf.name)
        year = year_match.group(0) if year_match else pdf.stem
        for term in terms:
            needle = term.lower()
            matches = [
                {"year": year, "file": pdf.name, "line": line}
                for line in lines
                if needle in line.lower()
            ]
            if matches:
                results.setdefault(term, []).extend(matches)
    return results


def main() -> None:
    terms = sys.argv[1:] or [
        "Mechatronic",
        "Wiśni",
        "Kieśl",
        "Skłod",
        "Reytan",
        "Lisa",
        "Sienkiew",
        "Władysł",
        "Władysława IV",
        "Ząbki",
        "Wołomin",
        "Zielonka",
        "Targówek",
        "Praga",
        "Ostródzka",
        "Radzymińska",
    ]
    print(json.dumps(search_terms(terms), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
