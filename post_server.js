/**
 * Created by JetBrains WebStorm.
 * User: mru
 * Date: 02/01/12
 * Time: 11:31
 * To change this template use File | Settings | File Templates.
 */
var http = require('http');

http.createServer(function(req,res){
    "use strict";
        if (req.method == 'POST') {
            var chunk = "";
            req.on('data', function (data) {
                chunk += data;
            });
            req.on('end', function (data) {
                chunk += data?data:'';
                req.postdata = chunk; //extending req-object
                console.log("RETRIEVED POSTDATA:"+chunk);
            });
        }
        else {
                console.log('not a POST');
        }
        res.writeHead(200);
        res.end();
    }).listen(8001);