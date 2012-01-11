//TODO PARSE URL FROM x-relayer-URL
var http = require('http');
var util = require('util');
var url = require('url');
var uuid = require('node-uuid');
var cluster = require('cluster');
var DAO = require('./relayerDAO');
var logger = require('./simpleLogger').log;
var mail = require('./mailAgent');
var relayer = require('./relayerHandler');
var MyGlobal = require('./constantModule').Global;
var log = logger.log;
var numCPUs = require('os').cpus().length;
var dbhost;
var dbport;
var parsed_url;
//CommonJs modules make this unnecessary

function extract_params() {
    "use strict";
    var i,
        arg;
    for (i = 2; i < process.argv.length; i++) {
        //-debug
        //-dbport port
        //-dhost host
        //-spawn
        arg = process.argv[i];
        if (arg.charAt(0) == '-') {//new param
            MyGlobal.args[arg.substr(1)] = process.argv[++i];
        }
    }
}

extract_params();
if (MyGlobal.args[MyGlobal.PARAM_HELP]) {
    //print help and exit
    console.log(
        '-help :this message\n' +
            '-dbhost HOST :DbRedis host\n' +
            '-dbport PORT :DbRedis port\n' +
            '-debug true  :Debug mode\n' +
            '-spawn true  :spawn mode\n');
}
else {
//setting debug mode
    logger.set_prefix("RLY::");
    logger.set_level("E");
    logger.set_enabled(MyGlobal.args[MyGlobal.PARAM_DEBUG] ? true : false);
//setting DB
    if (MyGlobal.args[MyGlobal.PARAM_DBHOST]) {
        dbhost = MyGlobal.args[MyGlobal.PARAM_DBHOST];
    }
    if (MyGlobal.args[MyGlobal.PARAM_DBPORT]) {
        dbport = MyGlobal.args[MyGlobal.PARAM_DBPORT];
    }
    DAO.ini(dbhost, dbport);
    //Launching clusters
    if (MyGlobal.args[MyGlobal.PARAM_SPAWN]) {
        if (cluster.isMaster) {
            // Fork workers.
            log("CPU::" + numCPUs);
            for (var i = 0; i < numCPUs; i++) {
                cluster.fork();
            }
            cluster.on('death', function (worker) {
                "use strict";
                log('worker ' + worker.pid + ' died');
            });
        }
    }
    if (!MyGlobal.args[MyGlobal.PARAM_SPAWN] || cluster.isWorker) {
        http.createServer(
            function (req, res) {
                "use strict";
                http.globalAgent.maxSockets = 100;
                parsed_url = url.parse(req.url);
                req.setEncoding('utf8');
                if (req.method == 'POST') {
                    var chunk = "";
                    req.on('data', function (data) {
                        chunk += data;
                        log("POST DATA RECEIVED FROM CLIENT");
                    });
                    req.on('end', function (data) {
                        chunk += data ? data : '';
                        req.postdata = chunk; //extending req-object
                        log("POST DATA END FROM CLIENT");
                        relayer.do_rely(req, res, parsed_url);
                    });
                }
                else {
                    relayer.do_rely(req, res, parsed_url);
                }
            }).listen(8000);
    }
}