"""Bouwt index.html uit src/: template + rekenkern + data in één los te openen bestand."""
from pathlib import Path

root = Path(__file__).parent
template = (root / "src" / "template.html").read_text()
data = (root / "src" / "data.json").read_text()
engine = (root / "src" / "engine.js").read_text()

assert template.count("/*__DATA__*/") == 1 and template.count("/*__ENGINE__*/") == 1
html = template.replace("/*__DATA__*/", "const APPDATA=" + data + ";").replace("/*__ENGINE__*/", engine)
(root / "index.html").write_text(html)
print(f"index.html gebouwd ({len(html) // 1024} KB)")
