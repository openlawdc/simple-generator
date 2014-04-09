# /simple 2013

This node.js project renders the [dc-code-prototype](https://github.com/JoshData/dc-code-prototype)
into HTML for [dccode.org/simple](http://dccode.org/simple/).

## usage

Install dependencies:

    npm install

Get the code by doing a `git clone` for dc-code-prototype repository:

    git clone https://github.com/JoshData/dc-code-prototype.git code

Make an index of which file contains which sections of the code:

    node make_index.js code

which writes `code/section_index.json` and `code/section_parents_index.json`.

Convert XML sources to HTML, writing to the directory named `simple` and assuming the 'simple' directory will appear at '/simple' on the server:

```
node index.js code/ simple /simple
```

Or just specific files (pass a regular expression):

```
node index.js code/ simple /simple code/Title-2/Chapter-17/2-1713.xml
```

Copy the CSS and by_title directories into the code directory:

```
cp -R css simple
cp -R js simple
cp -R code/by_title simple
```

[Then set up a testing server](https://gist.github.com/tmcw/4989751) like
`serve` or `python -m SimpleHTTPServer 8000` to preview the site.
