//TODO PARSE URL FROM x-relayer-URL
var
 http = require('http'),
 url = require('url'),
 cluster = require('cluster'),
 logger = require('./simpleLogger').log,
 relayer = require('./relayerHandler'),
 MyGlobal = require('./constantModule').Global,
 dao = require('./relayerDAO'),
 log = logger.log,
 numCPUs = require('os').cpus().length,
 dbhost,
 dbport,
 parsed_url;

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
    dao.ini(dbhost, dbport);
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
                        relayer.do_rely(req, res, parsed_url, dao);
                    });
                }
                else {
                    relayer.do_rely(req, res, parsed_url, dao);
                }
            }).listen(8000);
    }
}