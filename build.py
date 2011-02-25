import os, sys, re
from glob import glob
from io import BytesIO
from zipfile import ZipFile, ZIP_STORED, ZIP_DEFLATED

chrome = [
    "*.xul",
    "*.js",
    "*.css",
    "arrows.png",
    "locale/*/*"
    ]
resources = [
    "*.jsm",
    "icon*.png",
    "install.rdf"
    ]

destination = "fastprevnext.xpi"

def get_files(resources):
    for r in resources:
        if os.path.isfile(r):
            yield r
        else:
            for g in glob(r):
                yield g

def jarify(f):
    with open(f, "rb") as fp:
        return "".join(map(
            lambda x: re.sub(
                r"^((?:content|skin|locale).*?)([\S]+)$",
                r"\1jar:chrome.jar!/\2",
                x
                ),
            fp.readlines()
            ))

def zip_files(files, zp):
    for f in sorted(files, key=str.lower):
        if f.endswith('.png'):
            zp.write(f, compress_type=ZIP_STORED)
        else:
            zp.write(f)


if os.path.exists(destination):
    print >>sys.stderr, destination, "is in the way"
    sys.exit(1)

class ZipOutFile(ZipFile):
    def __init__(self, zfile, zstore=ZIP_DEFLATED):
        ZipFile.__init__(self, zfile, "w", zstore)
    def __enter__(self):
        return self
    def __exit__(self, type, value, traceback):
        self.close()

with ZipOutFile(destination) as zp:
    with BytesIO() as jarbuffer:
        with ZipOutFile(jarbuffer, ZIP_STORED) as jp:
            zip_files(get_files(chrome), jp)
        jarbuffer.flush()
        jarbuffer.seek(0,0)
        zp.writestr("chrome.jar", jarbuffer.read())

    zip_files(get_files(resources), zp)
    zp.writestr("chrome.manifest", jarify("chrome.manifest"))
