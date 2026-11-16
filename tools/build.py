"""app.html と core/auction.js から、公開用の index.html を作る。使い方: python3 tools/build.py"""
from pathlib import Path
R = Path(__file__).resolve().parent.parent
app = (R / "app.html").read_text(encoding="utf-8")
eng = (R / "core/auction.js").read_text(encoding="utf-8")
body = app.replace("/*__AUCTION__*/", eng)
head, rest = body.split("<style>", 1)
style, main = rest.split("</style>", 1)
(R / "index.html").write_text('<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    '<meta name="description" content="資産を預からず、注文の条件だけに署名し、全員同じ値段でまとめて約定する取引の試験所（テスト用）">\n'
    + head + "<style>" + style + "</style>\n</head>\n<body>" + main + "</body>\n</html>\n", encoding="utf-8")
import os
art = os.environ.get("ARTIFACT_OUT")
if art: Path(art).write_text(body, encoding="utf-8")
print("built index.html")
