var basedir = process.argv[2] || '.';

var finder = require('findit')(basedir),
    path = require('path'),
    et = require('elementtree'),
    Citation = require('citation'),
    _ = require('lodash'),
    fs = require('fs');

var body_template = _.template(fs.readFileSync('templates/section._'));

var recency_info = parse_xml_file(basedir + "/index.xml").find("meta/recency").text;

// Load pre-made indexes that help us locate the filename for any given section (by citation),
// and to locate the parent and children of any page.
var section_to_filename = JSON.parse(fs.readFileSync(basedir + '/section_index.json'));
var section_to_parent = JSON.parse(fs.readFileSync(basedir + '/section_parents_index.json'));
var section_to_children = JSON.parse(fs.readFileSync(basedir + '/section_children_index.json'));

// Recursively process the code files.
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
finder.on('directory', ondirectory)
    .on('file', onfile);

// Utility function to load an XML file using elementtree.
function parse_xml_file(file) {
    var xml = fs.readFileSync(file).toString(); // not sure why toSting is needed to make a string
    return et.parse(xml)._root;
}

// Main function to convert a code XML file to its HTML rendering.
function convert_file(file) {
    console.log(file);

    // Load the file & sanity check that this is actually a file for the DC Code.
    var dom = parse_xml_file(file);
    if (dom.tag != "level") return;

    // Make links to the child levels from this page (i.e. moving down in the table of contents).
    // Map xs:include's to information we need to make a link.
    var children = dom.findall("ns0:include").map(function(node) {
        var fn = path.dirname(file) + "/" + node.get('href');
        var dom = parse_xml_file(fn);
        var child_id = get_file_id(dom, fn);
        return {
            filename: node.get('href').replace(".xml", ".html"),
            title: make_page_title(dom),
            section_range: [get_section_range(child_id, 0), get_section_range(child_id, 1)]
        }; });

    // Get the <text> and <level> nodes that make up the body
    // and flatten them out so the template doesn't have to deal with
    // the recursive nature of <level> nodes.
    var body_paras = [];
    flatten_body(dom, body_paras);

    // Set the 'has-level-num' class on paragraphs with a level-num span
    // so that the CSS can take care of the un-indentation needed to get
    // level numbering in the right place.
    body_paras.forEach(function(para) {
        para.text.forEach(function(span) {
            if (span.class == "level-num")
                para.class += " has-level-num";
        });
    });

    // Group the paragraphs into <div>s according to the 'grouop' value
    // that we have set on each paragraph so that we can style ranges of
    // paragraphs including annotations, form, and table-styled paragraphs.
    var body_groups = [ { group: null, paras: [] } ];
    body_paras.forEach(function(para) {
        if (para.group != body_groups[body_groups.length-1].group)
            body_groups.push( { group: para.group, paras: [] } );
        body_groups[body_groups.length-1].paras.push(para);
    });

    // Find the ancestors of this file to show the navigation links to
    // go up the table of contents to higher levels.
    var ancestors = [];
    var page_id = get_file_id(dom, file);
    var parent_id = page_id;
    while (true) {
        parent_id = section_to_parent[parent_id];
        if (!parent_id) break;
        ancestors.push(make_page_link(parent_id));
    }
    ancestors.reverse();

    // Write HTML.
    fs.writeFileSync(file.replace('.xml', '.html'),
        body_template({
            ancestors: ancestors,
            sibling_previous: make_page_link(get_sibling(page_id, -1)),
            sibling_next: make_page_link(get_sibling(page_id, +1)),
            title: make_page_title(dom),
            body: body_groups,
            children: children,
            recency_info: recency_info
        }));
}

function make_page_link(page_id) {
    /* This is a utility function to take a page id and make an object
       with information needed to render a link to that page: href and title. */
    if (!page_id) return null;
    var file = section_to_filename[page_id];
    return {
        filename: "/" + basedir + "/" + file +".html",
        title: make_page_title(parse_xml_file(basedir + "/" + file + ".xml"))
    };
}

function make_page_title(obj) {
    /* Create the canonical display name for a page.*/

    var level_type = obj.find("type").text;

    var title = null;

    if (level_type == "document") {
        // this is the root, just use the heading

    } else if (level_type == "Section") {
        // this is a section, so show "§ XX-YY".
        title = "§ " + obj.find("num").text;

    } else if (level_type == "placeholder") {
        // this is a placeholder, which has a bit of a complex display semantics

        var level_section = obj.find("section");
        var level_section_start = obj.find("section-start");
        var level_section_end = obj.find("section-end");
        var level_section_range_type = obj.find("section-range-type");

        // placeholder for a single section
        if (level_section)
            title = "§ " + level_section.text;

        // placeholder for a range of sections "XXX-YYY"
        else if (level_section_range_type.text == "range")
            title = "§" + level_section_start.text + "-§" + level_section_end.text;

        // placeholder for two (typically consecutive) sections, "XXX, YYY"
        else if (level_section_range_type.text == "list")
            title = "§" + level_section_start.text + ", §" + level_section_end.text;

    } else {
        // "Division I", "Title 10", "Part XXX", etc.
        title = level_type;
        if (obj.find("num"))
            title += " " + obj.find("num").text;
    }

    // Concatenate the level's heading text.
    var level_heading = obj.find("heading");
    if (level_heading) {
        if (!title)
            title = "";
        else
            title += ". ";
        title += level_heading.text;
    }

    // For placeholders, indicate the reason for the placeholder in brackets at the end.
    var level_reason = obj.find("reason");
    if (level_reason)
        title += " [" + level_reason.text + "]";

    return title;
}

function flatten_body(node, paras, indentation, parent_node_text, parent_node_indents, para_group) {
    /* This function flattens the recursive nesting of <level> and <text> nodes that make up
       the body content of a page. Each call fills node's paragraphs into the 'paras' argument.

       As we descend into the hierarchy, 'indentation' is incremented by one. The top-level call
       doesn't pass indentation or further arguments, so it comes in first as undefined, which is
       why we use (indentation||0) below to turn it into a number.

       The numbering on levels is (semantically) encoded with the <level> but in display appears
       within its first child paragraph. For instance:

          <level>
            <num>(a)</num>
            <heading>In General</heading>
            <text>Lorem ipsum</text>.
          </level>

        Is rendered as:

          (a) In General -- Lorem ipsum.

        So at each level, we pass the level's number & heading down in parent_node_text and place
        it into the flattened text when we encounter the first child.

        There is a more complex case though. Consider:

          <level>
            <num>(a)</num>
            <level>
              <num>(1)</num>
              <text>Lorem ipsum</text>.
            </level>
            <level>
              <num>(2)</num>
              <text>Dolor sit amet.</text>.
            </level>
          </level>

        This is rendered as:

          (a) (1) Lorem ipsum.
              (2) Dolor sit amet.

        Two odd things happen in this case. First, we stack two levels worth of numbering into
        the same paragraph "(a) (1)". Second, the indentation of the first paragraph is pulled
        back. Even though "Lorem ipsum" would have an 'indentation' of 1 (versus zero), the "(a)"
        has to get rendered at an indentation of zero. When we hit stacked numbering like this,
        we increment 'parent_node_indents' as we recurse into the children to track that we have
        to have special un-indentation in the paragraph where that numbering gets serialized into.

        Finally, we add a group value to each paragraph ('para_group'), which allows us to have
        CSS rendering that spans consecutive paragraphs of the same group (e.g. indentation, form,
        and table paragraphs).
        */

    node.getchildren()
        .filter(function(node) { return node.tag == "text" || node.tag == "level" })
        .forEach(function(child, i) {
            if (child.tag == "text") {
                // Create a paragraph object and add it to 'paras'.

                // Check if we have any numbering or headings
                var initial_text = [];
                var my_indentation = indentation || 0;
                if (i == 0 && parent_node_text) {
                    if (para_group) {
                        // In any of the special paragraph classes that we track for grouping,
                        // if there is any numbering or heading text coming from a parent level
                        // don't display it inline in this paragraph. Make a separate heading
                        // for it.
                        paras.push({ text: parent_node_text, indentation: indentation, class: "subheading", group: para_group });
                    } else {
                        // This is the first paragraph within a level and we have a number or
                        // heading from its parent to display. Put the parent number and heading here.
                        initial_text = parent_node_text;
                        my_indentation -= parent_node_indents;
                    }
                }

                // Flatten the text of the child, which takes care of turning mixed-content
                // text like "lorem<span>ipsum</span> dolor" into a flat array of objects.
                var child_text = flatten_text(child);

                // Append the paragraph.
                paras.push({ text: initial_text.concat(child_text), indentation: my_indentation, group: para_group, class: "" });

            } else if (child.tag == "level") {
                // What group will we pass down into the child? If this level is of a certain type,
                // then pass that group information down into all child paragraphs here.
                var child_para_group = para_group;
                var type = child.find("type");
                if (type && ["annotations", "appendices", "form", "table"].indexOf(type.text) >= 0) {
                    child_para_group = type.text;
                }

                // Don't display the level's num and heading here but rather on the first
                // paragraph within the level.
                var my_num_heading = [];
                if (child.find("num")) my_num_heading.push( { text: child.find("num").text + " ", class: "level-num" } );
                if (child.find("heading")) my_num_heading.push( { text: child.find("heading").text + (child_para_group ? "" : " — "), class: "level-heading" } );

                // If we're the first paragraph within a level, continue to pass down the parent node's
                // number and heading until it reaches a text node where it gets displayed. But don't
                // indent the text paragraph until we've discharged the parent level's heading.
                var pni = parent_node_indents || 0;
                if (i == 0 && parent_node_text) {
                    my_num_heading = parent_node_text.concat(my_num_heading);
                    pni += 1;
                }

                // Don't pass an empty array.
                if (my_num_heading.length == 0) my_num_heading = null;

                // The children at the top level are indentation zero, but inside that the
                // indentation has to go up by 1.
                flatten_body(child, paras,
                    indentation == null ? 0 : indentation+1,
                    my_num_heading, pni,
                    child_para_group);
            }
        });
}

function flatten_text(node) {
    /* Turns mixed content <text> nodes into a flat array of text with styling information.
       For example:
          lorem<span style="xyz">ipsum</span>
       turns into
          [ {text: "lorem"}, {text: "ipsum", style: "xyz"} ]
       Also HTML-escape the text and do citation link processing.
    */

    var ret = [];
    ret.push({ text: cited(node.text), class: "", style: "" })
    node.getchildren()
        .forEach(function(child) {
            ret.push({ text: cited(child.text), class: "", style: child.get("style") })
            if (child.tail) ret.push({ text: cited(child.tail), class: "" })
        });
    return ret;
}

function cited(text) {
    /* Add links to any recognized citations. */

    // HTML-escape the content first because we'll be adding raw HTML for the links.
    function escape_html(html) {
      return String(html)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    text = escape_html(text);

    // Process citations.
    var c = Citation.find(text, {
        context: {
            dc_code: {
                source: 'dc_code'
            }
        },
        excerpt: 40,
        types: ['dc_code', 'dc_law', 'dc_register', 'law', 'stat'],
        replace: {
            dc_code: codeCited,
            dc_law:dclawCited,
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
        var index = cite.excerpt.search(/Pior\s+codifications\s+\d{4}\s+Ed\.?\,?|\d{4} Ed\., /i);
        if (index >= 0 && index < 40) // found, and to the left of the cite
            return;

        return linked("/" + basedir + "/" + section_to_filename[cite.dc_code.title + "-" + cite.dc_code.section] + '.html',
            cite.match);
    }

    // Take advantage of the new openlims feature of DC Laws
    function dclawCited(cite) {

        var lawName = 'L' + cite.dc_law.period + "-" + cite.dc_law.number + '.pdf';
        var url = 'http://openlims.org/public/' + lawName;
        return linked(url, cite.match);
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
    // Gets the "id" of a file, which is how it appears in the pre-made index files.
    // (this is duplicated in make_index.js, except for the +1 for a slash)
    var fn = file.substring(basedir.length+1).replace(".xml", "");
    if (dom.find("type").text == "Section")
        return dom.find("num").text;
    else
        return fn;
}

function get_section_range(id, start_or_end, depth) {
    /* Gets the first (start_or_end=0) or last (start_or_end=1) section number
       of all descendants of this page in the code. */

    var children = section_to_children[id];

    // base case has to be a Section or placeholder level... except in weird
    // cases where a big level has no children.
    if (!children || children.length == 0) {
        if (!depth) {
            // Don't return a range that's just the page itself.
            return null;
        }

        // Parse the XML of the child.
        var dom = parse_xml_file(basedir + "/" + section_to_filename[id] + ".xml");

        // For sections, return just the section number. Omit the section symbol
        // because that's handled in the template.
        if (dom.find("type").text == "Section") {
            var num = dom.find("num").text;
            return num;
        }

        // For placeholders...
        if (dom.find("type").text == "placeholder") {
            var level_section = dom.find("section");
            var level_section_start = dom.find("section-start");
            var level_section_end = dom.find("section-end");

            // This placeholder stands in for a single section, so return that number.
            if (level_section)
                return level_section.text;

            // This placeholder stands in for a range of sections. Return the first or
            // last component of the range depending on whether the caller is looking for
            // the first or last section number.
            else
                return start_or_end == 0 ? level_section_start.text : level_section_end.text;
        }

        // This is a weird case where a big level has no children. Use our title string
        // generator to provide a value.
        var title = make_page_title(dom);
        return title;
    }

    // Recurse into either the first or last child, as appropriate.
    return get_section_range(
        children[start_or_end == 0 ? 0 : children.length-1],
        start_or_end,
        (depth||0)+1);
}

function get_sibling(id, direction) {
    /* Gets the previous (direction == -1) or next (direction == 1) document
       in the Code starting at the document whose id is id.

       The preceding document is the document's preceding sibling, if it has
       one. This perhaps should be changed one day to be the preceding sibling's
       last-most decedendant. Not sure if that'll be obvious in the UI though.
        
       If the document doesn't have a preceding sibling, then the previous
       document will be its parent. If the document doesn't have a following
       sibling then the next document will be its parent's next document. */

    if (!(id in section_to_parent)) return null;

    // Get the parent document. If we're already at the root, just return null.
    var parent = section_to_parent[id];
    if (!(parent in section_to_children)) return null;

    // Look for the previous/next sibling.
    var seen_me = false;
    var sibling = null;
    section_to_children[parent].forEach(function(child_id) {
        // Looking for the first sibling after the document.
        if (seen_me && direction == 1 && !sibling)
            sibling = child_id;

        if (child_id == id) seen_me = true;

        // Looking for the last sibling before the document.
        if (!seen_me && direction == -1)
            sibling = child_id;
    });

    if (!sibling) {
        if (direction == -1)
            return parent;
        else
            return get_sibling(parent, direction);
    }
    
    return sibling;
}
