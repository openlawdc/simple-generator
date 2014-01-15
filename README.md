# /simple 2013

A rough cut of [Josh Tauberer](http://razor.occams.info/)'s [dc-code-prototype](https://github.com/JoshData/dc-code-prototype)
as HTML.

## usage

You'll need to git clone in a copy of dc-code-prototype like

    git clone https://github.com/JoshData/dc-code-prototype.git code

Convert XML sources to HTML:

```
node index.js code
```

Or just specific files (pass a regular expression):

```
node index.js code code/Division-I/Title-2/Chapter-17/2-1713.json
```

[Then set up a testing server](https://gist.github.com/tmcw/4989751) like
`serve` or `python -m SimpleHTTPServer 8000` to preview the site.
