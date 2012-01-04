//TODO PARSE URL FROM x-relayer-URL
//TODO DEBUG FLAG
//TODO DB config HOST-PORT
var http = require('http');
var sys = require('util');
var uuid = require('node-uuid');
var cluster = require('cluster');
var DAO_module = require('./relayerDAO.js');
var DAO;
var numCPUs = require('os').cpus().length;
var dbhost;
var dbport;
//CommonJs modules make this unnecessary
var MyGlobal = {
    'args':{},
    'STATE_COMPLETED':'completed',
    'STATE_PENDING':'pending',
    'STATE_ERROR':'error',
    'STATE_RETRY_FAIL':'retry_fail',
    'STATUS_OK':'200',
    'STATUS_ERROR':'404',
    'STATUS_WEIRD':'500',
    'HEAD_RETRIEVE_ID':'x-retrieve-id',
    'HEAD_RELAYER_HOST':'x-relayer-host',
    'HEAD_RELAYER_ALTHOST':'x-relayer-alternatehost',
    'HEAD_RELAYER_RETRY':'x-relayer-retry',
    'HEAD_RELAYER_METHOD':'x-relayer-method',
    'HEAD_RELAYER_PORT':'x-relayer-port',
    'HEAD_RELAYER_HTTPCALLBACK':'x-relayer-httpcallback',
    'HEAD_RELAYER_HTTPCALLBACK_METHOD':'x-relayer-httpcallback_method',
    'HEAD_RELAYER_HTTPCALLBACK_PORT':'x-relayer-httpcallback_port',
    'PARAM_DBHOST':'dbhost',
    'PARAM_DBPORT':'dbport',
    'PARAM_SPAWN':'spawn',
    'PARAM_DEBUG':'debug',
    'PARAM_HELP':'help',
    'log':console.log,
    'timer':setTimeout,
    inspection_str:''};
function do_rely(req, res) {
    "use strict";
    var retrieve_id = req.headers[MyGlobal.HEAD_RETRIEVE_ID] || '',
        relayer_host = req.headers[MyGlobal.HEAD_RELAYER_HOST];  //accessed via clousure by inner HNDfunctions
    function retrieve_handler(retrieve_id) {
        DAO.get_all(retrieve_id, function (err, dao_data) {
            if (err) {
                dao_data.res_status = MyGlobal.STATUS_ERROR;
            }
            else {
                if (dao_data.res_state == MyGlobal.STATE_PENDING) {
                    dao_data.res_data = "Not Yet -pending-";
                    dao_data.res_status = MyGlobal.STATUS_ERROR;
                    dao_data.res_header = req.headers;
                }
                else if (dao_data.res_state == MyGlobal.STATE_ERROR || dao_data.res_state == MyGlobal.STATE_RETRY_FAIL) {
                    dao_data.res_data = "ERROR: " + dao_data.res_state;
                    dao_data.res_status = MyGlobal.STATUS_ERROR;
                    dao_data.res_header = req.headers;
                }
                else if (dao_data.res_state == MyGlobal.STATE_COMPLETED) {
                    var res_data_str = sys.inspect(dao_data.res_data);
                    MyGlobal.log('COMPLETED::' + res_data_str);
                }
                delete dao_data.res_header['content-length'];
                res.writeHead(dao_data.res_status, dao_data.res_header);
                res.write(dao_data.res_data);
                res.end();
            }
        });
    }

    function relay_handler() {
        function do_relayed_request(id, options) {
            function manage_relayed_response(res_rely) {
                function send_callback(res_data) {
                    var callback_host = req.headers[MyGlobal.HEAD_RELAYER_HTTPCALLBACK] || false,
                        callback_port = req.headers[MyGlobal.HEAD_RELAYER_HTTPCALLBACK_PORT] || '80',
                        callback_method = 'POST',
                        callback_req,
                        callbackoptions;
                    if (callback_host) {
                        callbackoptions = {
                            host:callback_host,
                            port:callback_port,
                            defaultPort:callback_port,
                            method:callback_method,
                            path:'/',
                            headers:res_rely.headers
                        };
                        callback_req = http.request(callbackoptions, function (callback_res) {
                            //Check 200 on callback
                            MyGlobal.log('STATUS: ' + callback_res.statusCode);
                            //MyGlobal.log('HEADERS: ' + JSON.stringify(callback_res.headers));
                            //MyGlobal.log('RELAYED HEADER!!:'+ JSON.stringify(res_rely.headers));
                        });
                        callback_req.on('error', function (err) {
                            MyGlobal.inspection_str = sys.inspect(err);
                            MyGlobal.log("EXCEPTION AT CALLBACK REQUEST:" + MyGlobal.inspection_str);
                        });
                        if (res_data) {
                            callback_req.write(res_data);
                        }
                        callback_req.end();
                    }
                }

                var content_data = '';
                res_rely.on('data', function (chunk) {
                        content_data += chunk;
                    }
                );
                res_rely.on('end', function (chunk) {
                    content_data += chunk ? chunk : '';
                    //keep in DB
                    var res_rely_status = res_rely.statusCode,
                        res_rely_headers = JSON.stringify(res_rely.headers);
                    DAO.store_data(id, res_rely_headers, res_rely_status, content_data);
                    //send CALLBACK
                    send_callback(chunk);
                    MyGlobal.log('DATA:' + content_data);
                });
            }

            function handle_socket_exception(socketException) {
                function retry_timeout_handler() {
                    function retry_manage_fail(socketException) {
                        MyGlobal.log("WARN: Retry Fail");
                        if (socketException) {
                            MyGlobal.inspection_str = sys.inspect(socketException);
                            sys.log('RETRY::SocketException:' + MyGlobal.inspection_str);
                        }
                        DAO.update_retry_fail(id);
                    }

                    var try_relayed_req;
                    try_relayed_req = do_relayed_request(id, options); //no more retries
                    try_relayed_req.end();
                    MyGlobal.log('RETRY LAUNCH');
                    try_relayed_req.on('error', retry_manage_fail);
                }

                var retry = req.headers[MyGlobal.HEAD_RELAYER_RETRY] || false,
                    alternate_url = req.headers[MyGlobal.HEAD_RELAYER_ALTHOST] || false;
                if (socketException) {
                    MyGlobal.inspection_str = sys.inspect(socketException);
                    sys.log('HANDLE_SOCKT:: SocketException:' + MyGlobal.inspection_str);
                }
                if (retry) {
                    if (alternate_url) {
                        options.host = alternate_url;
                    }
                    MyGlobal.inspection_str = sys.inspect(options);
                    MyGlobal.log('RETRY to' + MyGlobal.inspection_str);
                    MyGlobal.timer(retry_timeout_handler, 5000); //delay interval
                }
            }

            var relayed_req = http.request(options, manage_relayed_response);
            relayed_req.on('error', handle_socket_exception);
            if (req.method == 'POST') {
                relayed_req.write(req.postdata);
            }
            return relayed_req;
        }

        var res_status,
            options,
            relayer_method = req.headers[MyGlobal.HEAD_RELAYER_METHOD] || 'GET',
            relayer_port = req.headers[MyGlobal.HEAD_RELAYER_PORT] || '80',
            relayed_req,
            id,
            postdata;
        id = uuid.v1();
        res_status = MyGlobal.STATUS_OK;
        postdata = req.postdata ? req.postdata : '';
        DAO.update_pending(id, relayer_host, req.method, postdata, function (err) {
            if (err) {
                res_status = MyGlobal.STATUS_WEIRD; //something weird happens //
            }
        });
        //Quick answer to client
        res.writeHead(res_status);
        res.write(id);
        res.end();
        //Redirect request
        options = {
            host:relayer_host,
            port:relayer_port,
            defaultPort:relayer_port,
            method:relayer_method,
            path:'/'
        };
        relayed_req = do_relayed_request(id, options);
        relayed_req.end();
    }

    //Main OP DISPATCHING
    //Retrieve
    if (retrieve_id) {
        retrieve_handler();
    }
    //Rely
    else if (relayer_host) {
        relay_handler();
    }
    //unsupported option
    else {
        //Maybe good to search for alternate
        res.writeHead(MyGlobal.STATUS_ERROR, {'Content-Type':'text/plain'});
        res.write("NO HEADER PRESENT:" + MyGlobal.HEAD_RELAYER_HOST);
        res.end();
    }
}
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
function no_debug() {
    "use strict";
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
    MyGlobal.log = MyGlobal.args[MyGlobal.PARAM_DEBUG] ? console.log : no_debug;
//setting DB
    if (MyGlobal.args[MyGlobal.PARAM_DBHOST]) {
        dbhost = MyGlobal.args[MyGlobal.PARAM_DBHOST];
    }
    if (MyGlobal.args[MyGlobal.PARAM_DBPORT]) {
        dbport = MyGlobal.args[MyGlobal.PARAM_DBPORT];
    }
    DAO = new DAO_module.RelayerDAO(dbhost, dbport);
//Launchin clusters
    if (cluster.isMaster) {
        // Fork workers.
        MyGlobal.log("CPU::" + numCPUs);
        for (var i = 0; i < numCPUs; i++) {
            cluster.fork();
            if (!MyGlobal.args[MyGlobal.PARAM_SPAWN]) {
                break;
            } //just one child
        }
        cluster.on('death', function (worker) {
            "use strict";
            MyGlobal.log('worker ' + worker.pid + ' died');
        });
    }
    else {
        http.createServer(
            function (req, res) {
                "use strict";
                http.globalAgent.maxSockets = 100;
                req.setEncoding('utf8');
                if (req.method == 'POST') {
                    var chunk = "";
                    req.on('data', function (data) {
                        chunk += data;
                        MyGlobal.log("POST DATA");
                    });
                    req.on('end', function (data) {
                        chunk += data ? data : '';
                        req.postdata = chunk; //extending req-object
                        MyGlobal.log("POST END");
                        do_rely(req, res);
                    });
                }
                else {
                    do_rely(req, res);
                }
            }).listen(8000);
    }
}