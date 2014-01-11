# /simple 2013

A rough cut of [Josh Tauberer](http://razor.occams.info/)'s [dc-code-prototype](https://github.com/JoshData/dc-code-prototype)
as HTML.

## usage

You'll need to git clone in a copy of dc-code-prototype like

    git clone https://github.com/JoshData/dc-code-prototype.git code

Requires Python 3

Convert XML source to JSON

```
easy_install xmltodict
python3 convert.py
```

Convert JSON sources to HTML

```
node index.js code
```

[Then set up a testing server](https://gist.github.com/tmcw/4989751) like
`serve` or `python -m SimpleHTTPServer 8000` to preview the site.
