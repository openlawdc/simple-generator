var finder = require('findit')(process.argv[2] || '.'),
    path = require('path'),
    _ = require('lodash'),
    fs = require('fs');

var templates = {
    chapter: _.template(fs.readFileSync('templates/chapter._')),
    title: _.template(fs.readFileSync('templates/title._')),
    section: _.template(fs.readFileSync('templates/section._')),
    subtitle: _.template(fs.readFileSync('templates/subtitle._')),
    division: _.template(fs.readFileSync('templates/subtitle._')),
    subchapter: _.template(fs.readFileSync('templates/subchapter._')),
    article: _.template(fs.readFileSync('templates/article._')),
    unit: _.template(fs.readFileSync('templates/unit._')),
    part: _.template(fs.readFileSync('templates/part._')),
    subdivision: _.template(fs.readFileSync('templates/subdivision._')),
    subpart: _.template(fs.readFileSync('templates/subpart._')),
    placeholder: _.template(fs.readFileSync('templates/placeholder._'))
};

finder.on('directory', ondirectory)
    .on('file', onfile);

function ondirectory(dir, stat, stop) {
    var base = path.basename(dir);
    if (base === '.git' || base === 'node_modules') stop();
}

function onfile(file, stat) {
    if (file.match(/json$/)) {
        var f = JSON.parse(fs.readFileSync(file));
        if (!f.level) return;
        if (!Array.isArray(f.level['ns0:include'])) {
            f.level['ns0:include'] = [f.level['ns0:include']];
        }
        if (f.level.type == 'Title') {
            fs.writeFileSync(file.replace('json', 'html'),
                templates.title(f));
        } else if (f.level.type == 'Chapter') {
            fs.writeFileSync(file.replace('json', 'html'),
                templates.chapter(f));
        } else if (f.level.type == 'Subtitle') {
            fs.writeFileSync(file.replace('json', 'html'),
                templates.subtitle(f));
        } else if (f.level.type == 'Section') {
            if (f.level.level && !Array.isArray(f.level.level)) {
                f.level.level = [f.level.level];
            }
            fs.writeFileSync(file.replace('json', 'html'),
                templates.section(f));
        } else if (f.level.type == 'Division') {
            fs.writeFileSync(file.replace('json', 'html'),
                templates.division(f));
        } else if (f.level.type == 'placeholder') {
            fs.writeFileSync(file.replace('json', 'html'),
                templates.placeholder(f));
        } else if (f.level.type == 'Subchapter') {
            fs.writeFileSync(file.replace('json', 'html'),
                templates.subchapter(f));
        } else if (f.level.type == 'Unit') {
            fs.writeFileSync(file.replace('json', 'html'),
                templates.unit(f));
        } else if (f.level.type == 'Article') {
            fs.writeFileSync(file.replace('json', 'html'),
                templates.article(f));
        } else if (f.level.type == 'Part') {
            fs.writeFileSync(file.replace('json', 'html'),
                templates.part(f));
        } else if (f.level.type == 'Subdivision') {
            fs.writeFileSync(file.replace('json', 'html'),
                templates.subdivision(f));
        } else if (f.level.type == 'Subpart') {
            fs.writeFileSync(file.replace('json', 'html'),
                templates.subpart(f));
        } else {
            console.log(f.level.type);
        }
    }
}
