var basedir = process.argv[2] || '.';
var outdir = process.argv[3] || '.';
var rootdir = process.argv[4] || '';

var finder = require('findit')(basedir),
    path = require('path'),
    mkdirp = require('mkdirp'),
    _ = require('lodash'),
    fs = require('fs'),
    et = require('elementtree'),
    moment = require('moment');

function parse_xml_file (file) {
    var xml = fs.readFileSync(file).toString(); // not sure why toSting is needed to make a string
    return et.parse(xml)._root;
}

// Path to the template used to render each page.
// Allow the path to be overridden by an environment
// variable named TEMPLATE.
var page_template_fn = 'templates/section._';
if (process.env.TEMPLATE)
    page_template_fn = process.env.TEMPLATE;

var page_template = _.template(fs.readFileSync(page_template_fn));

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
    if (process.argv.length > 5 && !file.match(process.argv[5])) return;
    if (file.match(/\.xml$/)) {
        convert_file(file);
    }
}

var cluster = require("cluster");
var numCPUs = require("os").cpus().length;
var worker_info = null;

if (cluster.isMaster) {
    // Start multi-threading by forking a child process for each
    // CPU on this machine.
    for (var i = 0; i < numCPUs; i++) {
        // fork a worker and tell it which subset of the files to
        // process, based on its index and numCPUs.
        var worker = cluster.fork();
        worker.send([i, numCPUs]);
    }
    cluster.on('disconnect', function(worker) {
        console.log('Worker #' + worker.id + ' finished.');
    });
} else {
    process.on('message', function(msg) {
        worker_info = msg;
        convert_files(function() { cluster.worker.disconnect(); })
    });

}

function get_file_id (dom, file, basedir) {
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

function convert_files(finished_callback) {
   finder
    .on('directory', ondirectory)
    .on('file', onfile)
    .on('end', finished_callback);
}

function calculateRedirect(id) {
   console.log(id);
   // Title-13/index
   // https://beta.code.dccouncil.us/dc/council/code/titles/1/
   if (id.match(/^Title-([\d\w]+)\/index$/)) {
      var titleNumber = id.match(/^Title-([\d\w]+)\/index$/)[1];
      return 'https://beta.code.dccouncil.us/dc/council/code/titles/' + titleNumber + '/';
   } else if (id.match(/^Title-(\d+)\/Chapter-([\d\w]+)\/index/)) {
      // Title-1/Chapter-11A/index
      var match = id.match(/^Title-(\d+)\/Chapter-([\d\w]+)\/index/)
      var titleNumber = match[1];
      var chapterNumber = match[2];
      return 'https://beta.code.dccouncil.us/dc/council/code/titles/' + titleNumber + '/chapters/' + chapterNumber + '/';
   } else if (id.match(/^Title-(\d+)\/Article-([\d\w]+)\/index/)) {
      // Title-1/Chapter-11A/index
      var match = id.match(/^Title-(\d+)\/Article-([\d\w]+)\/index/);
      var titleNumber = match[1];
      var articleNumber = match[2];
      return 'https://beta.code.dccouncil.us/dc/council/code/titles/' + titleNumber + '/articles/' + articleNumber + '/';
   } else if (id.match(/^Title-(\d+)\/Chapter-([\d\w]+)\/Unit-([\d\w]+)\/index/)) {
      // Title-1/Chapter-11A/index
      var match = id.match(/^Title-(\d+)\/Chapter-([\d\w]+)\/Unit-([\d\w]+)\/index/);
      var titleNumber = match[1];
      var chapterNumber = match[2];
      var unitNumber = match[3];
      // https://beta.code.dccouncil.us/dc/council/code/titles/2/chapters/13/units/A/
      // https://beta.code.dccouncil.us/dc/council/code/titles/2/chapters/13/units/A/
      return 'https://beta.code.dccouncil.us/dc/council/code/titles/' + titleNumber +
         '/chapters/' + chapterNumber + '/units/' + unitNumber;
   } else if (id.match(/^Title-(\d+)\/Chapter-([\d\w]+)\/Subchapter-([\d\w\-]+)\/index/)) {
      // Title-1/Chapter-11A/index
      var match = id.match(/^Title-(\d+)\/Chapter-([\d\w]+)\/Subchapter-([\d\w\-]+)\/index/)
      var titleNumber = match[1];
      var chapterNumber = match[2];
      var subchapterNumber = match[3];
      // https://beta.code.dccouncil.us/dc/council/code/titles/47/chapters/32/subchapters/III/index.html
      return 'https://beta.code.dccouncil.us/dc/council/code/titles/' + titleNumber +
         '/chapters/' + chapterNumber + '/subchapters/' + subchapterNumber;
   } else if (id.match(/^([\d\w]+)-([\d\w]+).?(\d+)?/)) {
      // https://beta.code.dccouncil.us/dc/council/code/sections/1-1171.03.html
      return 'https://beta.code.dccouncil.us/dc/council/code/sections/' + id + '.html';
   } else if (id.match(/~/g)) {
      return 'https://beta.code.dccouncil.us/dc/council/code/sections/' + id.split('~')[0] + '.html';
      // repealed laws
   } else if (id.match(/:/g)) {
      // omitted laws
      return 'https://beta.code.dccouncil.us/dc/council/code/sections/' + id + '.html';
   } else {
      throw new Error('cannot handle' + id);
   }
}

// Main function to convert a code XML file to its HTML rendering.
function convert_file(file) {
    // If this is a worker process, we want to process only a subset of
    // the files. The worker_info global variable holds an array containing
    // our zero-based worker index and the total number of workers. To
    // decide whether to process this file, we'll do a really dumb hash
    // of the file name to yield an integer, and then do integer division.
    if (worker_info) {
        var filename_hash = 0;
        for (var i = 0; i < file.length; i++)
            filename_hash += file.charCodeAt(i);
        if ((filename_hash % worker_info[1]) != worker_info[0])
            return; // procesed by another worker
    }

    // Load the file & sanity check that this is actually a file for the DC Code.
    var dom = parse_xml_file(file);
    if (dom.tag != "level") return;

    // Find the ancestors of this file to show the navigation links to
    // go up the table of contents to higher levels.
    var page_id = get_file_id(dom, file, basedir);
    var parent_id = page_id;

    // Write HTML.
    mkdirp.sync(path.dirname(outdir + "/" + section_to_filename[page_id][1]));
    fs.writeFileSync(outdir + "/" + section_to_filename[page_id][1],
        page_template({
            doctype: process.env.DOCTYPE,
            redirect: calculateRedirect(page_id),
            rootdir: rootdir
        }));
}
