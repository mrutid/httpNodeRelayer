/**
 * Created by JetBrains WebStorm.
 * User: mru
 * Date: 02/01/12
 * Time: 11:31
 * To change this template use File | Settings | File Templates.
 */
var http = require('http');
var sys = require('util');
http.createServer(
    function (req, res) {
        "use strict";
        req.setEncoding('utf8');
        console.log('REQUEST ARRIVE');
        console.log(sys.inspect(req.headers));
        var chunk = '';
        req.on('data', function (data) {
            chunk += data;
            console.log('retrieved data');
            console.log(data);
            console.log("SIZE OF DATA at data EVENT:" + data.length);
        });
        req.on('end', function () {
            console.log("RETRIEVED POSTDATA:\n" + chunk);
            res.writeHead(200);
            res.end();
        });
    }).listen(8001);