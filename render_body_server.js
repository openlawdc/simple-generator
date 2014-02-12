/* This module creates a simple HTTP server that listens for POST
   requests at /render_body, with raw XML in the 'body' parameter,
   and returns the page rendered as HTML. */

var http = require('http');
var fs = require('fs');
var et = require('elementtree');
var render_body = require('./render_body.js');

var basedir = process.argv[2] || 'code';
var section_to_filename = JSON.parse(fs.readFileSync(basedir + '/section_index.json'));
var section_to_children = JSON.parse(fs.readFileSync(basedir + '/section_children_index.json'));

http.createServer(function (req, res) {
  var incoming_xml = "";
  req.on('data', function(chunk) {
    incoming_xml += chunk;
  }).on('end', function() {
    var dom;
    try {
	   dom = et.parse(incoming_xml)._root;
    } catch (e) {
      res.writeHead(400, {'Content-Type': 'application/json'});
      res.write(JSON.stringify( { "error": "Invalid XML: " + e } ));
      res.end();
      return;
    }

    var body;
    try {
	    body = render_body.render_body("file.html", dom, section_to_filename, section_to_children, basedir);
    } catch (e) {
      res.writeHead(400, {'Content-Type': 'application/json'});
      res.write(JSON.stringify( { "error": "Something is wrong in the code: " + e } ));
      res.end();
      return;
    }

	  res.writeHead(200, {'Content-Type': 'text/html'});
	  res.write(body.rendered)
	  res.end();
  });
}).listen(8001);
