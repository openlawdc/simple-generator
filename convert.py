#!/usr/bin/env python

import xmltodict, os, json
import sys

if len(sys.argv) > 1:
  code_dir = sys.argv[1]
else:
  code_dir = "dc-code-prototype"

for folder, subs, files in os.walk(code_dir):
    for f in files:
        path = os.path.join(folder, f)
        (root, ext) = os.path.splitext(path)
        if ext == '.xml':
            jsonpath = path.replace(ext, '.json')
            d = xmltodict.parse(open(path))
            json.dump(d, open(jsonpath, 'w'))
