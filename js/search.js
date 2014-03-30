$('#search-form').submit(searchCitation);
$('#search-button').click(searchCitation);

function searchCitation(e) {

    e.preventDefault();

    var val = $('#search-box').val();
    if (val.length === 0) { return false; }

    val = val.replace("§", "").replace(" ", "");
    var p = val.indexOf("-");

    if (p == -1) {
        alert('Search by citation, such as §50-102.');
        return false;
    }

    var title = val.substring(0, p).replace(/:/, '-');
    var sec = val.substring(p + 1);

    $.ajax({
        url: ROOTDIR + '/by_title/' + title + '.json',
        dataType: 'json',
        success: titleLoad
    });

    function titleLoad(title_shard) {
        if (!(sec in title_shard.sec)) {
            alert('Citation not found.');
        } else {
            window.location = ROOTDIR + '/' + title_shard.sec[sec];
        }
    }
}
