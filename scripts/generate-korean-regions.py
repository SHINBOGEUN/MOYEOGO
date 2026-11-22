"""Generate the bundled region tree from a MOIS address-code ZIP.

Usage: python scripts/generate-korean-regions.py <jscodeYYYYMMDD.zip> <output.json>
The ZIP must include the KIKcd_H administrative-dong text file.
"""

import json
import sys
import zipfile
from pathlib import Path


def child(parent: dict, name: str) -> dict:
    children = parent.setdefault("children", [])
    for item in children:
        if item["name"] == name:
            return item
    item = {"name": name}
    children.append(item)
    return item


def decode_field(row: bytes, start: int, end: int) -> str:
    return row[start:end].decode("cp949").strip()


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)

    archive_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    with zipfile.ZipFile(archive_path) as archive:
        source_name = next(
            name for name in archive.namelist()
            if Path(name).name.startswith("KIKcd_H.") and not name.lower().endswith(".xlsx")
        )
        raw_lines = archive.read(source_name).splitlines()

    roots: list[dict] = []
    root_by_code: dict[bytes, dict] = {}
    for row in raw_lines[1:]:
        if len(row) < 112 or row[2:10] != b"00000000":
            continue
        name = decode_field(row, 11, 42)
        root = {"name": name}
        roots.append(root)
        root_by_code[row[:2]] = root

    for row in raw_lines[1:]:
        if len(row) < 112 or not row[:10].isdigit():
            continue
        if row[2:10] == b"00000000":
            continue
        sido_root = root_by_code.get(row[:2])
        sigungu = decode_field(row, 42, 73)
        eupmyeondong = decode_field(row, 73, 104)
        deleted_at = row[113:121].strip() if len(row) >= 121 else b""
        if not sido_root or deleted_at:
            continue

        current = sido_root
        for part in sigungu.split():
            current = child(current, part)
        if eupmyeondong:
            child(current, eupmyeondong)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(roots, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Generated {len(roots)} first-level regions from {source_name}: {output_path}")


if __name__ == "__main__":
    main()
