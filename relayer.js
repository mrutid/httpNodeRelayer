var http = require('http');
var sys = require('util');
var redis_module = require('redis-client');
var redis = redis_module.createClient(redis_module.DEFAULT_PORT, redis_module.DEFAULT_HOST);
//CommonJs modules make this unnecessary
var MyGlobal = {'STATE_COMPLETED':'completed',
    'STATE_PENDING':'pending',
    'STATE_ERROR':'error',
    'STATE_RETRY_FAIL':'retry_fail',
    'STATUS_OK':'200',
    'STATUS_ERROR':'404',
    'STATUS_WEIRD':'500',
    'RD_STATE':'State',
    'RD_HEADER':'Header',
    'RD_STATUSCODE':'StatusCode',
    'RD_DATA':'Data',
    'RD_METHOD': 'Method',
    'RD_POSTDATA': 'Postdata',
    'RD_RELAYED_REQUEST':'RelayedRequest',
    'HEAD_RETRIEVE_ID':'x-retrieve-id',
    'HEAD_RELAYER_HOST':'x-relayer-host',
    'HEAD_RELAYER_ALTHOST':'x-relayer-alternatehost',
    'HEAD_RELAYER_RETRY':'x-relayer-retry',
    'HEAD_RELAYER_METHOD':'x-relayer-method',
    'HEAD_RELAYER_PORT':'x-relayer-port',
    'log':console.log,
    'timer':setTimeout,
    inspection_str:''};
function do_rely(req, res) {
    "use strict";
    function do_relayed_request(id, options) {
        function manage_relayed_response(res_rely) {
            function store_data(id, res_rely, content) {
                var res_rely_status = res_rely.statusCode,
                    res_rely_headers = JSON.stringify(res_rely.headers);
                redis.hmset('HR:' + id,
                    MyGlobal.RD_STATE, MyGlobal.STATE_COMPLETED,
                    MyGlobal.RD_HEADER, res_rely_headers,
                    MyGlobal.RD_STATUSCODE, res_rely_status,
                    MyGlobal.RD_DATA, content,
                    function (err) {
                        if (err) {
                            MyGlobal.inspection_str = sys.inspect(err);
                            MyGlobal.log("DB error (Can not insert):" + MyGlobal.inspection_str);
                        }
                        else {
                            MyGlobal.log("Kept response for:" + id);
                        }
                    });
            }

            var chunk = '';
            res_rely.on("data", function (data) {
                    chunk += data;
                }
            );
            res_rely.on('end', function (data) {
                chunk += data;
                //keep in redis
                store_data(id, res_rely, chunk);
            });
        }

        function handle_socket_exception(socketException) {
            var retry = req.headers[MyGlobal.HEAD_RELAYER_RETRY] || false,
                alternate_url = req.headers[MyGlobal.HEAD_RELAYER_ALTHOST] || false,
                try_relayed_req;

            function retry_timeout_handler() {
                function retry_manage_fail(socketException) {
                    MyGlobal.log("WARN: Retry Fail");
                    if (socketException) {
                        MyGlobal.inspection_str = sys.inspect(socketException);
                        sys.log('RETRY::SocketException:' + MyGlobal.inspection_str);
                    }
                    redis.hset('HR:' + id,
                        MyGlobal.RD_STATE, MyGlobal.STATE_RETRY_FAIL,
                        function (err) {
                            if (err) {
                                MyGlobal.inspection_str = sys.inspect(err);
                                MyGlobal.log("DB error (Can not insert-retryfail):" + MyGlobal.inspection_str);
                            }
                            else {
                                MyGlobal.log("Retry-fail added for:" + id);
                            }
                        });
                }

                try_relayed_req = do_relayed_request(id, options); //no more retries
                try_relayed_req.end();
                MyGlobal.log('RETRY LAUNCH');
                try_relayed_req.on('error', retry_manage_fail);
            }

            if (socketException) {
                MyGlobal.inspection_str = sys.inspect(socketException);
                sys.log('SocketException:' + MyGlobal.inspection_str);
            }
            if (retry) {
                if (alternate_url) {
                    options.host = alternate_url;
                    //options.agent=false;
                }
                MyGlobal.inspection_str = sys.inspect(options);
                MyGlobal.log('RETRY to' + MyGlobal.inspection_str);
                MyGlobal.timer(retry_timeout_handler, 5000); //delay interval
            }
        }

        var relayed_req = http.request(options, manage_relayed_response);
        relayed_req.on('error', handle_socket_exception);
        if (req.method=='POST') {
            relayed_req.write(req.postdata);
        }
        return relayed_req;
    }

    var res_header,
        res_data,
        res_state,
        relayed_req,
        data = '',
        options,
        res_status = MyGlobal.STATUS_WEIRD,
        retrieve_id = req.headers[MyGlobal.HEAD_RETRIEVE_ID] || '',
        relayer_host = req.headers[MyGlobal.HEAD_RELAYER_HOST];
    if (retrieve_id) {
        redis.hgetall('HR:' + retrieve_id, function (err, redis_data) {
            if (err) {
                res_status = MyGlobal.STATUS_ERROR;
                data = 'DB can\'t retrieve your data' + sys.inspect(err);
            }
            else {
                res_header = redis_data[MyGlobal.RD_HEADER] || "";
                res_data = redis_data[MyGlobal.RD_DATA] || "";
                res_data = res_data.toString();
                res_state = redis_data[MyGlobal.RD_STATE] || "";
                res_state = res_state.toString();
                res_status = redis_data[MyGlobal.RD_STATUSCODE] || "";
                res_status = res_status.toString();
                if (res_state == MyGlobal.STATE_PENDING) {
                    res_data = "Not Yet -pending-";
                    res_status = MyGlobal.STATUS_ERROR;
                    res_header = req.headers;
                }
                else if (res_state == MyGlobal.STATE_ERROR || res_state == MyGlobal.STATE_RETRY_FAIL) {
                    res_data = "ERROR: " + res_state;
                    res_status = MyGlobal.STATUS_ERROR;
                    res_header = req.headers;
                }
                else if (res_state == MyGlobal.STATE_COMPLETED) {
                    var res_data_str = sys.inspect(res_data);
                    MyGlobal.log('COMPLETED::' + res_data_str);
                }
                res_header['Content-Length'] = res_data.length;
                res.writeHead(res_status, res_header);
                res.write(res_data);
                res.end();
            }
        });
    }
    else if (relayer_host) {
        redis.incr('HR:GLOBAL_ID_SEQ', function (err, idsec) {
            var relayer_method = req.headers[MyGlobal.HEAD_RELAYER_METHOD] || 'GET',
                relayer_port = req.headers[MyGlobal.HEAD_RELAYER_PORT] || '80',
                id,
                err_str = '';
            if (err) {
                MyGlobal.log("Problems getting ID_SEC (no continue): 'HR:GLOBAL_ID_SEQ'");
                //EXCEPT NO-PERSISTENCE
            }
            else {
                MyGlobal.log("ID_SEC: 'HR:GLOBAL_ID_SEQ:'" + idsec);
                id = idsec.toString(); //+new Date().getTime();
                res_status = MyGlobal.STATUS_OK;
                redis.hmset('HR:' + id,
                    MyGlobal.RD_STATE, MyGlobal.STATE_PENDING,
                    MyGlobal.RD_RELAYED_REQUEST, relayer_host,
                    MyGlobal.RD_METHOD, req.method,
                    MyGlobal.RD_POSTDATA, req.postdata,
                    function (err) {
                        if (err) {
                            err_str = sys.inspect(err);
                            res_status = MyGlobal.STATUS_WEIRD; //something weird happens
                            MyGlobal.log('WARN -(go) DB Can not insert:' + err_str);
                        }
                    });
                res.writeHead(res_status, {
                        'Content-Length':id.length,
                        'Content-Type':'text/plain'
                    }
                );
                res.write(id);
                res.end();
                //redirect request
                options = {
                    host:relayer_host,
                    port:relayer_port,
                    defaultPort: relayer_port,
                    method:relayer_method,
                    path:'/',
                    agent:false,
                    'Content-Length':req.postdata.length};

                relayed_req = do_relayed_request(id, options);
                relayed_req.end();
            }
        });
    }
    else {
        //Maybe good to search for alternate
        data = "NO HEADER PRESENT:" + MyGlobal.HEAD_RELAYER_HOST;
        res.writeHead(MyGlobal.STATUS_ERROR, {
                'Content-Length':data.length,
                'Content-Type':'text/plain'
            }
        );
        res.write(data);
        res.end();
    }
}
http.createServer(
    function (req, res) {
        "use strict";
        if (req.method == 'POST') {
            var chunk = "";
            req.on('data', function (data) {
                chunk += data;
            });
            req.on('end', function (data) {
                chunk += data?data:'';
                req.postdata = chunk; //extending req-object
                do_rely(req, res);
            });
        }
        else {
            do_rely(req, res);
        }
    }).listen(8000);