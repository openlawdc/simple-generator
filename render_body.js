var path = require('path'),
    fs = require('fs'),
    et = require('elementtree'),
    _ = require('lodash'),
    Citation = require('citation');

var body_template = _.template(fs.readFileSync(__dirname + '/templates/body._'));

// Utility function to load an XML file using elementtree.
exports.parse_xml_file = function(file) {
    var xml = fs.readFileSync(file).toString(); // not sure why toSting is needed to make a string
    return et.parse(xml)._root;
}

exports.get_file_id = function(dom, file, basedir) {
    // Gets the "id" of a file, which is how it appears in the pre-made index files.
    // (this is duplicated in make_index.js, except for the +1 for a slash)
    if (basedir.charAt(basedir.length-1) == "/") basedir = basedir.substring(0, basedir.length-1); // chop trailing slash
    var fn = file.substring(basedir.length+1).replace(".xml", "");
    if (dom.get("type") == "section")
        return dom.find("num").text;
    else if (dom.get("type") == "placeholder" && dom.find("section"))
        return dom.find("section").text;
    // TODO: What happens if there's a link to a section in a placeholder page that has a range of sections?
    else
        return fn;
}

function fix_section_dashes(str) {
    // Convert hyphens found in section numbers to en-dashes.
    // Only replace the first hyphen, which separates the title number.
    // Other hyphens are hyphens within section numbers and are hyphens?
    return str.replace(/^(\d+)-/, function(m) { return m[0] + "–"; });
}

exports.make_page_title = function(obj) {
    /* Create the canonical display name for a page.*/

    if (!obj.get("type")) throw "Document does not have a <type> element.";

    var level_type = obj.get("type");

    var title = null;

    if (level_type == "document") {
        // this is the root, just use the heading

    } else if (level_type == "section") {
        // this is a section, so show "§ XX-YY".
        if (!obj.find("num")) throw "Section does not have a <num> element.";
        title = "§ " + fix_section_dashes(obj.find("num").text);

    } else if (level_type == "placeholder") {
        // this is a placeholder, which has a bit of a complex display semantics

        var level_section = obj.find("section");
        var level_section_start = obj.find("section-start");
        var level_section_end = obj.find("section-end");
        var level_section_range_type = obj.find("section-range-type");

        // placeholder for a single section
        if (level_section) {
            title = "§ " + fix_section_dashes(level_section.text);
        } else {
            title = "§§ ";
            title += fix_section_dashes(level_section_start.text);
            if (level_section_range_type.text == "range")
                // placeholder for a range of sections "XXX-YYY"
                title += " - ";
            else
                // placeholder for two (typically consecutive) sections, "XXX, YYY"
                title += ", ";
            title += fix_section_dashes(level_section_end.text);
        }

    } else {
        // "Division I", "Title 10", "Part XXX", etc.
        if (!obj.find("prefix")) throw "Document does not have a <prefix> element.";
        title = obj.find("prefix").text;
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

exports.render_body = function(filename, dom, section_to_filename, section_to_children, basedir, rootdir, other_resources) {
    body_info = exports.process_body(filename, dom, section_to_filename, section_to_children, basedir, rootdir, other_resources);
    body_info.rendered = body_template(body_info);
    return body_info;
}

exports.process_body = function(filename, dom, section_to_filename, section_to_children, basedir, rootdir, other_resources) {
    // Get the <text> and <level> nodes that make up the body
    // and flatten them out so the template doesn't have to deal with
    // the recursive nature of <level> nodes.

    var body_paras = [];

    var should_render_deeply = 
        dom.find("prefix")
        && ["Chapter", "Subchapter", "Part", "Subpart"].indexOf(dom.find("prefix").text) >= 0
        && !other_resources; // don't render deeply when viewing in the DC Code Editor

    for (var deep = 0; deep <= 1; deep++) {
        if (deep) {
            if (!should_render_deeply) break;
            body_paras.push({ html: "<hr>", text: [], indentation: 0, group: "", class: "" });
        }

        flatten_body(dom, {
            paras: body_paras,
            section_to_filename: section_to_filename,
            section_to_children: section_to_children,
            basedir: basedir,
            rootdir: rootdir,
            filename: filename,
            deep: !!deep,
            other_resources: other_resources
            });
    }

    // Group the paragraphs into <div>s according to the 'grouop' value
    // that we have set on each paragraph so that we can style ranges of
    // paragraphs including annotations, form, and table-styled paragraphs.
    var body_groups = [ { group: null, paras: [] } ];
    body_paras.forEach(function(para) {
        if (!para.group) para.group = "primary-content";
        if (para.group != body_groups[body_groups.length-1].group)
            body_groups.push( { group: para.group, paras: [], needs_separator: para.needs_separator } );
        body_groups[body_groups.length-1].paras.push(para);
    });

    return {
        title: exports.make_page_title(dom),
        body: body_groups,
    }
}

function flatten_body(node, flatten_args, indentation, parent_node_text, parent_node_indents, para_group) {
    /* This function flattens the recursive nesting of <level> and <text> nodes that make up
       the body content of a page. Each call fills node's paragraphs into the 'flatten_args.paras' argument.

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

    // Reset the paragraph group mode when we pass through certain level types.
    if (node.get("type") == "document" || node.get("type") == "toc")
        para_group = "toc";
    if (node.get("type") == "section")
        para_group = "";

    function render_heading() {
        if (parent_node_text) {
            flatten_args.paras.push({ text: parent_node_text, indentation: indentation||0, class: "subheading", group: para_group });
        }
    }

    var renderers = {
        text: function(child, i) {
            // Create a paragraph object and add it to 'flatten_args.paras'.

            // Check if we have any numbering or headings
            var initial_text = [];
            var my_indentation = indentation || 0;
            if (i == 0 && parent_node_text) {
                if (para_group) {
                    // In any of the special paragraph classes that we track for grouping,
                    // if there is any numbering or heading text coming from a parent level
                    // don't display it inline in this paragraph. Make a separate heading
                    // for it.
                    flatten_args.paras.push({ text: parent_node_text, indentation: indentation, class: "subheading", group: para_group });
                } else {
                    // This is the first paragraph within a level and we have a number or
                    // heading from its parent to display. Put the parent number and heading here.
                    initial_text = parent_node_text;
                    my_indentation -= parent_node_indents;
                }
            }

            // Flatten the text of the child, which takes care of turning mixed-content
            // text like "lorem<span>ipsum</span> dolor" into a flat array of objects.
            var child_text = flatten_text(child, flatten_args);

            // Append the paragraph.
            flatten_args.paras.push({ text: initial_text.concat(child_text), indentation: my_indentation, group: para_group, class: "" });
        },

        table: function(child, i) {
            // This is an HTML-like table.

            // We may have heading text from a higher level to display.
            if (i == 0) render_heading();

            // Render HTML.
            function render_row(child) {
                html += "<tr>"
                child.getchildren()
                    .forEach(function(child) {
                        html += "<" + child.tag;
                        if (child.get("colspan"))
                            html += " colspan=\"" + parseInt(child.get("colspan")) + "\"";
                        if (child.get("rowspan"))
                            html += " rowspan=\"" + parseInt(child.get("rowspan")) + "\"";
                        html += ">" + flatten_text(child, flatten_args, true) + "</" + child.tag + ">\n"
                    });
                html += "</tr>\n"
            }

            function render_table(node) {
                node.getchildren()
                    .forEach(function(child) {
                        if (child.tag == "tr") {
                            render_row(child)
                        } else if (child.tag == "thead") {
                            render_table(child);
                        } else if (child.tag == "caption") {
                            html += "<" + child.tag + ">" 
                                + flatten_text(child, flatten_args, true)
                                + "</" + child.tag + ">\n"
                        }
                    });
            }

            html = "<table>"
            render_table(child);
            html += "</table>\n"

            // Append the paragraph.
            flatten_args.paras.push({ html: html, text: [], indentation: (indentation||0)+1, group: para_group, class: "" });
        },

        level: function(child, i) {
            // What group will we pass down into the child? If this level is of a certain type,
            // then pass that group information down into all child paragraphs here.
            var child_para_group = para_group;
            var type = child.get("type");
            if (["annotations", "appendices", "form"].indexOf(type) >= 0)
                child_para_group = type;

            // Numbering and headings of levels aren't usually displayed a way that matches
            // the DOM hierarchy. For instance:
            //   <level>
            //      <num>(a)</num>
            //      <level>
            //        <num>(b)</num>
            //        <text>Lorem ipsum...</text>
            // is rendered into:
            //    <p>(a) (b) Lorem ipsum...</p>
            // all in one <p>. We handle this by pushing down the "(a)" and any heading into
            // the first child (recursively) until we find a text paragraph where we'll
            // "discharge" all of the parent numbering/headings.
            //
            // One exception is that we should not have a heading run into another heading or
            // number. So we should never see <p>(a) In general -- (b) Definitions -- Lorem</p>
            // in a single paragraph. Instead we should render these in separate paragraphs.
            // We'll check for this case at the point where we're seeing the child ("(b) Definitions...").

            var my_num_heading = [];
            if (!child.get("type") && child_para_group != "annotations") {
                // Check if we have two headings bumping together, as noted in the comment block above.
                // If so, render/discharge the parent heading immediately.
                if (i == 0 && parent_node_text && parent_node_text.filter(function(x){ return x.class == "level-heading" }).length > 0 && (child.find("num") || child.find("heading"))) {
                    flatten_args.paras.push({ text: parent_node_text, indentation: indentation - parent_node_indents, class: "", group: para_group });
                    parent_node_text = null;
                }

                // Otherwise pass the heading into the child.
                if (child.find("num")) my_num_heading.push( { text: child.find("num").text + " ", class: "level-num" } );
                if (child.find("heading")) my_num_heading.push( { text: child.find("heading").text + (child_para_group ? "" : " — "), class: "level-heading" } );

            } else {
                // This might be a big level like a Division or an annotation level.
                // Don't use the level-num class, because the indentation CSS only
                // makes sense for bullet-like numbering. Render the heading now.
                var heading = "";
                if (child.find("prefix")) heading = child.find("prefix").text + " ";
                if (child.find("num")) heading += child.find("num").text + ". ";
                if (child.find("heading")) heading += child.find("heading").text;
                if (heading)
                    flatten_args.paras.push({ text: [{ text: heading, class: null }], indentation: indentation||0, class: "subheading", group: child_para_group });
            }

            // If we're the first paragraph within a level, continue to pass down the parent node's
            // number and heading until it reaches a text node where it gets displayed. But don't
            // indent the text paragraph until we've discharged the parent level's heading.
            var pni = 0;
            if (i == 0 && parent_node_text) {
                pni = (parent_node_indents || 0) + 1;
                my_num_heading = parent_node_text.concat(my_num_heading);
            }

            // Don't pass an empty array.
            if (my_num_heading.length == 0) my_num_heading = null;

            // The children at the top level are indentation zero, but inside that the
            // indentation has to go up by 1.
            flatten_body(child, flatten_args,
                indentation == null ? 0 : indentation+1,
                my_num_heading, pni,
                child_para_group);
        },

        "ns0:include": function(child, i) {
            // This is an XInclude tag that references a child that should be linked from here.

            // We may have heading text from a higher level to display.
            if (i == 0) render_heading();

            // Resolve the XInclude to a filename and parse the XML.
            var fn = path.join(path.dirname(flatten_args.filename), child.get('href'));
            var dom;
            if (flatten_args.other_resources && fn in flatten_args.other_resources) {
                // Allow the caller to provide us with the DOM itself for any referenced
                // files. In the DC Code Editor, the page being rendered any any referenced
                // files may all have been edited, so we don't want to go to disk to retrieve
                // their contents.
                dom = flatten_args.other_resources[fn];
            } else {
                dom = exports.parse_xml_file(fn);
            }

            var title = exports.make_page_title(dom);

            // Expand out chapters to render the whole content inline.
            // Recurse with a different flatten_args because the base URL of
            // nested XIncludes is different within the referenced file.
            if (flatten_args.deep) {
                function shallow_copy(obj) {
                    return _.isArray(obj) ? obj.slice() : _.extend({}, obj);
                };
                var inner_flatten_args = shallow_copy(flatten_args);
                inner_flatten_args.filename = fn;
                inner_flatten_args.heading_level = (inner_flatten_args.heading_level||0) + 1;

                // Append a heading for the inner file.
                flatten_args.paras.push({
                    text: [{ text: title, class: null }],
                    indentation: indentation||0,
                    class: "heading heading-" + inner_flatten_args.heading_level,
                    needs_separator: i > 0, // put a separator between levels (not before the first)
                    group: para_group });

                // Append the inner file.
                flatten_body(dom, inner_flatten_args,
                    indentation,
                    parent_node_text, parent_node_indents,
                    para_group);
                return;
            }

            // Append a paragraph for the XInclude.
            var section_range = [null, null];
            var child_filename = child.get('href').replace(".xml", ".html");
            if (flatten_args.basedir) {
                // flatten_args.basedir won't be available when called from the DC Code Editor
                var child_id = exports.get_file_id(dom, fn, flatten_args.basedir);
                section_range = [get_section_range(child_id, 0, flatten_args), get_section_range(child_id, 1, flatten_args)];
                child_filename = flatten_args.rootdir + "/" + flatten_args.section_to_filename[child_id][1];
                child_filename = child_filename.replace(/\/index\.html$/, ''); // no need to put /index.html on URLs
            }
            flatten_args.paras.push({
                group: para_group,
                indentation: (indentation||0),
                class: "child-link",
                text: [],

                filename: child_filename,
                title: title,
                is_placeholder: dom.get("type") == "placeholder" || (title.indexOf("[Repealed]") >= 0),
                section_range: section_range
            });
        }
    };

    // Render the children of this element.
    node.getchildren()
        .filter(function(node) { return node.tag in renderers })
        .forEach(function(child, i) {
            // When we have a <text><table>...</table></text> element,
            // execute the <table>-renderer on that element.
            var table = child.find("table");
            if (table)
                child = table;

            // Execute the renderer.
            renderers[child.tag](child, i);
        });
}

function flatten_text(node, flatten_args, as_html) {
    /* Turns mixed content <text> nodes into a flat array of text with styling information.
       For example:
          lorem<span style="xyz">ipsum</span>
       turns into
          [ {text: "lorem"}, {text: "ipsum", style: "xyz"} ]
       Also HTML-escape the text and do citation link processing.
    */

    function link_citations(text) {
        return cited(text, flatten_args);
    }

    var ret = [];
    ret.push({ text: link_citations(node.text), class: "", style: "" })
    node.getchildren()
        .forEach(function(child) {
            ret.push({ text: link_citations(child.text), class: "", style: child.get("style") })
            if (child.tail) ret.push({ text: link_citations(child.tail), class: "" })
        });

    if (as_html) {
        ret = ret.map(function(item) { return (
              "<span "
            + "class=\""
            + escape_html(item.class)
            + "\" style=\""
            + escape_html(item.style)
            + "\">"
            + item.text
            + "</span>");
        }).join(" ");
    }

    return ret;
}

function escape_html(html) {
  return String(html)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function cited(text, flatten_args) {
    /* Add links to any recognized citations. */

    // HTML-escape the content first because we'll be adding raw HTML for the links.
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

        if (!flatten_args.section_to_filename)
            return linked("javascript:no_linking()", cite.match);

        var fn = flatten_args.section_to_filename[cite.dc_code.title + "-" + cite.dc_code.section];
        if (!fn) return; // section not actually in the code?

        var cite_text = cite.match;

        // Don't allow any line break immediately after a section symbol.
        cite_text = cite_text.replace(/§ /g, "§&nbsp;");

        // Don't allow any line break immediately after a hyphen. Use the non-breaking hyphen.
        cite_text = cite_text.replace(/-/g, "\u2011");

        return linked(flatten_args.rootdir + "/" + fn[1], cite_text);
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

function get_section_range(id, start_or_end, flatten_args, depth) {
    /* Gets the first (start_or_end=0) or last (start_or_end=1) section number
       of all descendants of this page in the code. */

    if (!flatten_args.section_to_filename || !flatten_args.section_to_children)
        return null;

    var children = flatten_args.section_to_children[id];

    // base case has to be a Section or placeholder level... except in weird
    // cases where a big level has no children.
    if (!children || children.length == 0) {
        if (!depth) {
            // Don't return a range that's just the page itself.
            return null;
        }

        // Parse the XML of the child.
        var dom = exports.parse_xml_file(flatten_args.basedir + "/" + flatten_args.section_to_filename[id][0]);

        // For sections, return just the section number. Omit the section symbol
        // because that's handled in the template.
        if (dom.get("type") == "section") {
            return fix_section_dashes(dom.find("num").text);
        }

        // For placeholders...
        if (dom.get("type") == "placeholder") {
            var level_section = dom.find("section");
            var level_section_start = dom.find("section-start");
            var level_section_end = dom.find("section-end");

            // This placeholder stands in for a single section, so return that number.
            if (level_section)
                return fix_section_dashes(level_section.text);

            // This placeholder stands in for a range of sections. Return the first or
            // last component of the range depending on whether the caller is looking for
            // the first or last section number.
            else
                return start_or_end == 0 ? fix_section_dashes(level_section_start.text)
                    : fix_section_dashes(level_section_end.text);
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
        flatten_args,
        (depth||0)+1
        );
}
