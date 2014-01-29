/* This module creates a simple HTTP server that listens for POST
   requests at /render_body, with raw XML in the 'body' parameter,
   and returns the page rendered as HTML. */

var http = require('http');
var fs = require('fs');
var et = require('elementtree');
var render_body = require('./render_body.js');

var basedir = "code";
var section_to_filename = JSON.parse(fs.readFileSync(basedir + '/section_index.json'));
var section_to_children = JSON.parse(fs.readFileSync(basedir + '/section_children_index.json'));

http.createServer(function (req, res) {
  var incoming_xml = "";
  req.on('data', function(chunk) {
    incoming_xml += chunk;
  }).on('end', function() {
	  var dom = et.parse(incoming_xml)._root;
	  var body = render_body.render_body("file.html", dom, section_to_filename, section_to_children, basedir);

	  res.writeHead(200, {'Content-Type': 'text/html'});
	  res.write(body.rendered)
	  res.end();
  });
}).listen(8001);
