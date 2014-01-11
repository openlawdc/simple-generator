var finder = require('findit')(process.argv[2] || '.'),
    path = require('path'),
    fs = require('fs');

finder.on('directory', ondirectory)
    .on('file', onfile);

function ondirectory(dir, stat, stop) {
    var base = path.basename(dir);
    if (base === '.git' || base === 'node_modules') stop();
}

function onfile(file, stat) {
    if (file.match(/json$/)) {
        var f = JSON.parse(fs.readFileSync(file));
        console.log(f);
    }
}
