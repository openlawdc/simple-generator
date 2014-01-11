import xmltodict, os, json

for folder, subs, files in os.walk('dc-code-prototype'):
    for f in files:
        path = os.path.join(folder, f)
        (root, ext) = os.path.splitext(path)
        if ext == '.xml':
            jsonpath = path.replace(ext, '.json')
            d = xmltodict.parse(open(path))
            json.dump(d, open(jsonpath, 'w'))
