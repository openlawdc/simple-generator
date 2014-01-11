var finder = require('findit')(process.argv[2] || '.'),
    path = require('path'),
    Citation = require('citation'),
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
            if (f.level.text && !Array.isArray(f.level.text)) {
                f.level.text = [f.level.text];
            }
            if (!f.level.text) f.level.text = [];
            fs.writeFileSync(file.replace('json', 'html'),
                templates.section({
                    d: f,
                    cited: cited
                }));
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

function cited(text) {
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

        return linked("./" + cite.dc_code.title + "-" + cite.dc_code.section + '.html',
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
