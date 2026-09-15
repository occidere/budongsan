import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_web_data", ROOT / "scripts/build_web_data.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class WebDataTest(unittest.TestCase):
    def test_lossless_shards_and_manifest(self):
        data = {"3354": {"key": {"representative": {"complex_name": "테스트단지", "address": {"sector": "구로동"}},
                                "is_deleted": True, "all_articles": [{"image_url": "https://example.com/photo.jpg"}]}}, "912": {}}
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.json"
            source.write_text(json.dumps(data), encoding="utf-8")
            output = Path(directory) / "web"
            manifest = builder.build(source, output)
            for key, records in data.items():
                entry = manifest["complexes"][key]
                shard = output / entry["file"]
                self.assertEqual(json.loads(shard.read_bytes()), records)
                self.assertEqual(len(shard.read_bytes()), entry["bytes"])
            self.assertEqual(manifest["complexes"]["3354"]["name"], "테스트단지")
            self.assertEqual(builder.build(source, output), manifest)
            data["3354"]["key"]["is_deleted"] = False
            source.write_text(json.dumps(data), encoding="utf-8")
            updated = builder.build(source, output)
            self.assertNotEqual(updated["complexes"]["3354"]["file"], manifest["complexes"]["3354"]["file"])
            self.assertEqual(updated["complexes"]["912"]["file"], manifest["complexes"]["912"]["file"])

    def test_invalid_input_fails_build(self):
        for data in ([], {"../bad": {}}, {"912": []}, {"912": {"bad": None}}):
            with self.subTest(data=data), tempfile.TemporaryDirectory() as directory:
                source = Path(directory) / "source.json"
                source.write_text(json.dumps(data), encoding="utf-8")
                with self.assertRaises(ValueError):
                    builder.build(source, Path(directory) / "web")


if __name__ == "__main__":
    unittest.main()
