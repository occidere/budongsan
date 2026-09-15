"""Build compact, lossless per-complex Pages assets from the collected aggregate.

Run on every Pages deployment so every data producer (scheduled or manual) uses
the same split. Keep the aggregate for compatibility, but never load it in the UI.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def build(source, output):
    data = json.loads(Path(source).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Aggregate must be an object")
    output = Path(output)
    (output / "complexes").mkdir(parents=True, exist_ok=True)
    manifest = {"schema_version": 1, "complexes": {}}
    for complex_id, records in sorted(data.items()):
        if not re.fullmatch(r"[0-9]+", complex_id) or not isinstance(records, dict):
            raise ValueError(f"Invalid complex: {complex_id}")
        if any(not isinstance(record, dict) for record in records.values()):
            raise ValueError(f"Invalid records: {complex_id}")
        payload = encode(records)
        digest = hashlib.sha256(payload).hexdigest()[:20]
        relative = f"complexes/{complex_id}.{digest}.json"
        (output / relative).write_bytes(payload)
        rep = next((r["representative"] for r in records.values() if r.get("representative")), {})
        manifest["complexes"][complex_id] = {
            "file": relative,
            "bytes": len(payload),
            "count": len(records),
            "name": rep.get("complex_name", ""),
            "sector": (rep.get("address") or {}).get("sector", ""),
        }
    (output / "manifest.json").write_bytes(encode(manifest))
    print(f"Built {len(data)} complex files; manifest: {len(encode(manifest)):,} bytes")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("output")
    args = parser.parse_args()
    build(args.source, args.output)
