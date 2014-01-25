var basedir = (process.argv[2] || '.') + '/';

var finder = require('findit')(basedir),
    path = require('path'),
    et = require('elementtree'),
    fs = require('fs');

// map section numbers to filename

var section_index = { };
var section_parents = { };
var section_children = { };

// scan code directory

finder.on('directory', ondirectory)
    .on('file', onfile)
    .on('end', done);

function ondirectory(dir, stat, stop) {
    var base = path.basename(dir);
    if (base === '.git' || base === 'node_modules') stop();
}

// functions

function parse_xml_file(file) {
    var xml = fs.readFileSync(file).toString(); // not sure why toSting is needed to make a string
    return et.parse(xml)._root;
}

function onfile(file, stat) {
    // run a specific file by putting it on the command line
    if (file.match(/\.xml$/)) {
        // parse file
        var dom = parse_xml_file(file);
        if (dom.tag != "level") return;
        
        // remember the file name for each section
        var file_info = get_file_info(dom, file);
        section_index[file_info[0]] = file_info[1];

        // make an ordered list of children of each parent
        section_children[file_info[0]] = [];

        // map children to parents
        var children = dom.findall("ns0:include").forEach(function(node) {
            var child_filename = path.dirname(file) + "/" + node.get('href');
            var child_dom = parse_xml_file(child_filename);
            var child_info = get_file_info(child_dom, child_filename);
            section_parents[child_info[0]] = file_info[0];
            section_children[file_info[0]].push(child_info[0]);
        });
    }
}

function get_file_info(dom, file) {
    // this is duplicated in index.js
    var fn = file.substring(basedir.length).replace(".xml", "");
    var id;
    if (dom.find("type").text == "Section")
        id = dom.find("num").text;
    else if (dom.find("type").text == "placeholder" && dom.find("section"))
        id = dom.find("section").text;
    // TODO: What happens if there's a link to a section in a placeholder page that has a range of sections?
    else
        id = fn;
    return [id, fn];
}

function done() {
    fs.writeFileSync(basedir + "section_index.json", JSON.stringify(section_index));
    fs.writeFileSync(basedir + "section_parents_index.json", JSON.stringify(section_parents));
    fs.writeFileSync(basedir + "section_children_index.json", JSON.stringify(section_children));
}
