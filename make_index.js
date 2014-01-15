var basedir = (process.argv[2] || '.') + '/';

var finder = require('findit')(basedir),
    path = require('path'),
    et = require('elementtree'),
    fs = require('fs');

// map section numbers to filename

var section_index = { };

// scan code directory

finder.on('directory', ondirectory)
    .on('file', onfile)
    .on('end', done);

function ondirectory(dir, stat, stop) {
    var base = path.basename(dir);
    if (base === '.git' || base === 'node_modules') stop();
}

// functions

function onfile(file, stat) {
    // run a specific file by putting it on the command line
    if (file.match(/\.xml$/)) {
        // parse file
        var xml = fs.readFileSync(file).toString();
        dom = et.parse(xml)._root;
        if (dom.tag != "level") return;
        
        if (dom.find("type").text != "Section") return;
        var fn = file.substring(basedir.length).replace(".xml", "");
        var id = dom.find("num").text;
        section_index[id] = fn;
    }
}


function done() {
    fs.writeFileSync(basedir + "section_index.js", JSON.stringify(section_index));
}
