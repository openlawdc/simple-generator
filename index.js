var basedir = process.argv[2] || '.';

var finder = require('findit')(basedir),
    path = require('path'),
    et = require('elementtree'),
    Citation = require('citation'),
    _ = require('lodash'),
    fs = require('fs');

var body_template = _.template(fs.readFileSync('templates/section._'));

finder.on('directory', ondirectory)
    .on('file', onfile);

var section_to_filename = JSON.parse(fs.readFileSync(basedir + '/section_index.json'));
var section_to_parent = JSON.parse(fs.readFileSync(basedir + '/section_parents_index.json'));

function ondirectory(dir, stat, stop) {
    var base = path.basename(dir);
    if (base === '.git' || base === 'node_modules') stop();
}

function onfile(file, stat) {
    // run a specific file by putting it on the command line
    if (process.argv.length > 3 && !file.match(process.argv[3])) return;
    if (file.match(/\.xml$/))
        convert_file(file);
}

function parse_xml_file(file) {
    var xml = fs.readFileSync(file).toString(); // not sure why toSting is needed to make a string
    return et.parse(xml)._root;
}

function convert_file(file) {
    console.log(file);

    var dom = parse_xml_file(file);
    if (dom.tag != "level") return;

    // Map xs:include's to information we need to make a link.
    var children = dom.findall("ns0:include").map(function(node) {
        return {
            filename: node.get('href').replace(".xml", ".html"),
            title: make_page_title(parse_xml_file(path.dirname(file) + "/" + node.get('href')))
        }; });

    // Get the <text> and <level> nodes that make up the body
    // and flatten it out so the template doesn't have to deal with
    // the recursive nature of <level> nodes.
    var body_paras= [];
    flatten_body(dom, body_paras);

    // Find the ancestors of this file.
    var ancestors = [];
    var parent_id = get_file_id(dom, file);
    while (true) {
        parent_id = section_to_parent[parent_id];
        if (!parent_id) break;
        var parent_file = section_to_filename[parent_id];
        ancestors.push({
            filename: "/" + basedir + "/" + parent_file +".html",
            title: make_page_title(parse_xml_file(basedir + "/" + parent_file + ".xml"))
        })
    }
    ancestors.reverse();

    // Write HTML.
    fs.writeFileSync(file.replace('.xml', '.html'),
        body_template({
            ancestors: ancestors,
            title: make_page_title(dom),
            body: body_paras,
            children: children,
        }));
}

function make_page_title(obj) {
    var level_type = obj.find("type").text;

    var title = null;

    if (level_type == "Section") {
        title = "§" + obj.find("num").text;

    } else if (level_type == "placeholder") {
        var level_section = obj.find("section");
        var level_section_start = obj.find("section-start");
        var level_section_end = obj.find("section-end");
        var level_section_range_type = obj.find("section-range-type");

        if (level_section)
            title = "§" + level_section.text;
        else if (level_section_range_type.text == "range")
            title = "§" + level_section_start.text + "-§" + level_section_end.text;
        else if (level_section_range_type.text == "list")
            title = "§" + level_section_start.text + ", §" + level_section_end.text;

    } else {
        // Division, Title, Part, etc.
        title = level_type;
        if (obj.find("num"))
            title += " " + obj.find("num").text;
    }

    var level_heading = obj.find("heading");
    if (level_heading) {
        if (!title)
            title = "";
        else
            title += ": ";
        title += level_heading.text;
    }

    // For placeholders.
    var level_reason = obj.find("reason");
    if (level_reason)
        title += " (" + level_reason.text + ")";

    return title;
}

function flatten_body(node, paras, indentation, parent_node_text, parent_node_indents) {
    node.getchildren()
        .filter(function(node) { return node.tag == "text" || node.tag == "level" })
        .forEach(function(child, i) {
            if (child.tag == "text") {
                var initial_text = [];
                var my_indentation = indentation || 0;
                if (i == 0 && parent_node_text) {
                    // This is the first paragraph within a level. Put the
                    // parent number and heading here.
                    initial_text = parent_node_text;
                    my_indentation -= parent_node_indents;
                }

                paras.push({ text: initial_text.concat(flatten_text(child)), indentation: my_indentation });

            } else if (child.tag == "level") {
                /*if (i == 0 && parent_node_text) {
                    paras.push({ text: parent_node_text, indentation: indentation||0 });
                    parent_node_text = null;
                }*/

                var type = child.find("type");
                if (type && type.text == "annotations") {
                    paras.push({ text: [{text: "Annotations"}], indentation: indentation||0, class: "heading" });
                } else if (type && type.text == "appendices") {
                    paras.push({ text: [{text: "Appendices"}], indentation: indentation||0, class: "heading" });
                }

                // TODO: form and table

                // Don't display the level's num and heading here but rather on the first
                // paragraph within the level. 
                var my_num_heading = [];
                if (child.find("num")) my_num_heading.push( { text: child.find("num").text } );
                if (child.find("heading")) my_num_heading.push( { text: child.find("heading").text + " --- ", style: "font-style: italic" } );
                if (my_num_heading.length == 0) my_num_heading = null;

                // If we're the first paragraph within a level, continue to pass down the parent node's
                // number and heading until it reaches a text node where it gets displayed.
                var pni = parent_node_indents || 0;
                if (i == 0 && parent_node_text) {
                    my_num_heading = parent_node_text.concat(my_num_heading);
                    pni += 1;
                }

                // The children at the top level are indentation zero, but inside that the
                // indentation has to go up by 1.
                flatten_body(child, paras, indentation == null ? 0 : indentation+1, my_num_heading, pni);
            }
        });
}

function flatten_text(node) {
    var ret = [];
    ret.push({ text: cited(node.text), style: "" })
    node.getchildren()
        .forEach(function(child) {
            ret.push({ text: cited(child.text), style: child.get("style") })
            if (child.tail) ret.push({ text: cited(child.tail), style: "" })
        });
    return ret;
}

function cited(text) {
    function escape_html(html) {
      return String(html)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    text = escape_html(text);

    var c = Citation.find(text, {
        context: {
            dc_code: {
                source: 'dc_code'
            }
        },
        excerpt: 40,
        types: ['dc_code', 'dc_register', 'law', 'stat'],
        replace: {
            dc_code: codeCited,
            law: lawCited,
            dc_register: dcrCited,
            stat: statCited
        }
    }).text;

    return c;

    function linked(url, text) {
        return "<a href='" + url + "'>" + text + "</a>";
    }

    function statCited(cite) {
        if (parseInt(cite.stat.volume, 10) < 65)
            return;

        return linked('http://api.fdsys.gov/link?collection=statute&volume=' + cite.stat.volume + '&page=' + cite.stat.page,
            cite.match);
    }

    // is this a current DC Code cite (something we should cross-link),
    // or is it to a prior version of the DC Code?
    function codeCited(cite) {
        var index = cite.excerpt.search(/ior\s+codifications\s+1981\s+Ed\.?\,?/i);
        if (index > 0 && index < 40) // found, and to the left of the cite
            return;

        return linked("/" + basedir + "/" + section_to_filename[cite.dc_code.title + "-" + cite.dc_code.section] + '.html',
            cite.match);
    }

    function lawCited(cite) {
        var lawName = cite.law.type + " law " + cite.law.congress + "-" + cite.law.number;
        var url = 'http://www.govtrack.us/search?q=' + encodeURIComponent(lawName);
        return linked(url, cite.match);
    }

    // just link to that year's copy on the DC Register website
    function dcrCited(cite) {
        if (parseInt(cite.dc_register.volume, 10) < 57)
            return;

        var year = parseInt(cite.dc_register.volume, 10) + 1953;
        return linked('http://www.dcregs.dc.gov/Gateway/IssueList.aspx?IssueYear=' + year,
            cite.match);
    }
}

function get_file_id(dom, file) {
    // this is duplicated in make_index.js, except for the +1 for a slash
    var fn = file.substring(basedir.length+1).replace(".xml", "");
    if (dom.find("type").text == "Section")
        return dom.find("num").text;
    else
        return fn;
}
