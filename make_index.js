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

var title_shards = { };

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
        section_index[file_info[0]] = [file_info[1], file_info[2]];

        // make an ordered list of children of each parent
        section_children[file_info[0]] = [];

        // map children to parents
        find_xincludes(dom, function(node) {
            var child_filename = path.dirname(file) + "/" + node.get('href');
            var child_dom = parse_xml_file(child_filename);
            var child_info = get_file_info(child_dom, child_filename);
            section_parents[child_info[0]] = file_info[0];
            section_children[file_info[0]].push(child_info[0]);
        });

        // make an index for handling searching by citation in the UI
        add_to_title_shard(file_info[2], dom);
    }
}

function find_xincludes(node, func) {
    node.findall("ns0:include").forEach(func);
    node.findall("*").forEach(function(child) { find_xincludes(child, func); });
}

function get_file_info(dom, file) {
    // the part that gets the id is duplicated in render_body.js
    var fn = file.substring(basedir.length);
    var id;
    if (dom.get("type") == "section")
        id = dom.find("num").text;
    else if (dom.get("type") == "placeholder" && dom.find("section"))
        id = dom.find("section").text;
    // TODO: What happens if there's a link to a section in a placeholder page that has a range of sections?
    else
        id = fn.replace(".xml", "");

    // for files that have unique filenames across the whole code
    var output_fn = fn;
    if (dom.get("type") == "section" || dom.get("type") == "placeholder")
        output_fn = "sections/" + path.basename(fn);
    output_fn = output_fn.replace(".xml", ".html")

    return [id, fn, output_fn];
}

function add_to_title_shard(fn, dom) {
    // get the title and section number from the <num> element
    var title_sec;
    if (dom.get("type") == "section")
        title_sec = [dom.find("num").text];
    else if (dom.get("type") == "placeholder" && dom.find("section"))
        title_sec = [dom.find("section").text];
        // TODO: placfeholders with ranges
    else
        return;

    for (var i = 0; i < title_sec.length; i++) {
        var p = title_sec[i].indexOf("-");
        if (p == -1) throw "Invalid section number? " + title_sec[i];

        title = title_sec[i].substring(0, p);
        sec = title_sec[i].substring(p+1);

        if (!(title in title_shards)) {
            title_shards[title] = { "sec": { } };
        }
        
        title_shards[title]["sec"][sec] = fn;
    }
}

function done() {
    fs.writeFileSync(basedir + "section_index.json", JSON.stringify(section_index));
    fs.writeFileSync(basedir + "section_parents_index.json", JSON.stringify(section_parents));
    fs.writeFileSync(basedir + "section_children_index.json", JSON.stringify(section_children));

    // Split up the section to filename mapping by title and create static Javascript-powered
    // redirect-issuing pages for each title. We split by title because it is a handy way to
    // shard. The entire mapping is ~1.5 MB, which is a lot to send to a browser on every request.
    if (!fs.existsSync(basedir + 'by_title')) fs.mkdirSync(basedir + 'by_title');
    for (title in title_shards)
        fs.writeFileSync(basedir + 'by_title/' + title.replace(/:/, '-') + ".json", JSON.stringify(title_shards[title]));

}
