"""pptxgenjs 출력 후처리.
- 차트 글자에 한글 글꼴(ea)을 지정한다. 없으면 PowerPoint가 한글을 테마 기본(맑은 고딕)으로 그린다.
- 차트 데이터 레이블이 줄바꿈되지 않게 wrap="none"을 준다.
- 테마의 한글(Hang)·동아시아 글꼴을 Pretendard로 바꾼다.
- 폴더 항목을 빼고 다시 압축한다.
"""
import re, sys, zipfile, shutil, os

src = sys.argv[1]
tmp = src + ".tmp"
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    for info in zin.infolist():
        if info.filename.endswith("/"):
            continue
        data = zin.read(info.filename)
        name = info.filename
        if re.match(r"ppt/charts/chart\d+\.xml$", name):
            x = data.decode("utf-8")
            x = re.sub(r'<a:latin typeface="([^"]+)"\s*/>', r'<a:latin typeface="\1"/><a:ea typeface="\1"/>', x)
            x = re.sub(r"(<c:dLbls>\s*(?:<c:numFmt[^>]*/>\s*)?<c:txPr>\s*)<a:bodyPr/>", r'\1<a:bodyPr wrap="none"/>', x)
            data = x.encode("utf-8")
        elif re.match(r"ppt/theme/theme\d+\.xml$", name):
            x = data.decode("utf-8")
            x = x.replace('<a:ea typeface=""/>', '<a:ea typeface="Pretendard"/>')
            x = re.sub(r'<a:font script="Hang" typeface="[^"]*"/>', '<a:font script="Hang" typeface="Pretendard"/>', x)
            data = x.encode("utf-8")
        zout.writestr(info, data)
shutil.move(tmp, src)
print("fixed", src)
