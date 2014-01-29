var path = require('path'),
    fs = require('fs'),
    et = require('elementtree'),
    _ = require('lodash'),
    Citation = require('citation');

var body_template = _.template(fs.readFileSync('templates/body._'));

// Utility function to load an XML file using elementtree.
exports.parse_xml_file = function(file) {
    var xml = fs.readFileSync(file).toString(); // not sure why toSting is needed to make a string
    return et.parse(xml)._root;
}

exports.get_file_id = function(dom, file, basedir) {
    // Gets the "id" of a file, which is how it appears in the pre-made index files.
    // (this is duplicated in make_index.js, except for the +1 for a slash)
    var fn = file.substring(basedir.length+1).replace(".xml", "");
    if (dom.find("type").text == "Section")
        return dom.find("num").text;
    else if (dom.find("type").text == "placeholder" && dom.find("section"))
        return dom.find("section").text;
    // TODO: What happens if there's a link to a section in a placeholder page that has a range of sections?
    else
        return fn;
}

exports.make_page_title = function(obj) {
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

exports.render_body = function(filename, dom, section_to_filename, section_to_children, basedir) {
    body_info = exports.process_body(filename, dom, section_to_filename, section_to_children, basedir);
    body_info.rendered = body_template(body_info);
    return body_info;
}

exports.process_body = function(filename, dom, section_to_filename, section_to_children, basedir) {
    // Get the <text> and <level> nodes that make up the body
    // and flatten them out so the template doesn't have to deal with
    // the recursive nature of <level> nodes.
    var body_paras = [];
    flatten_body(dom, body_paras, section_to_filename, basedir);

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

    // Make links to the child levels from this page (i.e. moving down in the table of contents).
    // Map xs:include's to information we need to make a link.
    var children = dom.findall("ns0:include").map(function(node) {
        var fn = path.dirname(filename) + "/" + node.get('href');
        var dom = exports.parse_xml_file(fn);
        var child_id = exports.get_file_id(dom, fn, basedir);
        var title = exports.make_page_title(dom);
        return {
            filename: node.get('href').replace(".xml", ".html"),
            title: title,
            is_placeholder: dom.find("type").text == "placeholder" || (title.indexOf("[Repealed]") >= 0),
            section_range: [get_section_range(child_id, 0, section_to_filename, section_to_children, basedir), get_section_range(child_id, 1, section_to_filename, section_to_children, basedir)]
        }; });

    return {
        title: exports.make_page_title(dom),
        body: body_groups,
        children: children,
    }
}

flatten_body = function(node, paras, section_to_filename, basedir, indentation, parent_node_text, parent_node_indents, para_group) {
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
                var child_text = flatten_text(child, section_to_filename, basedir);

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
                flatten_body(child, paras, section_to_filename, basedir,
                    indentation == null ? 0 : indentation+1,
                    my_num_heading, pni,
                    child_para_group);
            }
        });
}

function flatten_text(node, section_to_filename, basedir) {
    /* Turns mixed content <text> nodes into a flat array of text with styling information.
       For example:
          lorem<span style="xyz">ipsum</span>
       turns into
          [ {text: "lorem"}, {text: "ipsum", style: "xyz"} ]
       Also HTML-escape the text and do citation link processing.
    */

    function link_citations(text) {
        return cited(text, section_to_filename, basedir);
    }

    var ret = [];
    ret.push({ text: link_citations(node.text), class: "", style: "" })
    node.getchildren()
        .forEach(function(child) {
            ret.push({ text: link_citations(child.text), class: "", style: child.get("style") })
            if (child.tail) ret.push({ text: link_citations(child.tail), class: "" })
        });
    return ret;
}

function cited(text, section_to_filename, basedir) {
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
            },
            dc_law: {
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

        var fn = section_to_filename[cite.dc_code.title + "-" + cite.dc_code.section];
        if (!fn) return; // section not actually in the code?

        return linked("/" + basedir + "/" + fn + '.html',
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

function get_section_range(id, start_or_end, section_to_filename, section_to_children, basedir, depth) {
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
        var dom = exports.parse_xml_file(basedir + "/" + section_to_filename[id] + ".xml");

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
        var title = exports.make_page_title(dom);
        return title;
    }

    // Recurse into either the first or last child, as appropriate.
    return get_section_range(
        children[start_or_end == 0 ? 0 : children.length-1],
        start_or_end,
        section_to_filename,
        section_to_children,
        basedir,
        (depth||0)+1
        );
}
