var http = require('http');
var sys = require('util');
var redis_module = require('redis-client');
var redis = redis_module.createClient(redis_module.DEFAULT_PORT, redis_module.DEFAULT_HOST);

var STATE_COMPLETED = 'completed';
var STATE_PENDING = 'pending';
var STATE_ERROR = 'error';
var STATE_RETRY_FAIL = 'retry_fail';

var STATUS_OK = '200';
var STATUS_ERROR = '404';
var STATUS_WEIRD = '500';

var HEAD_RETRIEVE_ID = 'x-retrieve-id';
var HEAD_RELAYER_HOST = 'x-relayer-host';
var HEAD_RELAYER_ALTHOST = 'x-relayer-alternatehost';
var HEAD_RELAYER_RETRY = 'x-relayer-retry';
var HEAD_RELAYER_METHOD = 'x-relayer-method';
var HEAD_RELAYER_PORT = 'x-relayer-port';
var log = console.log;
var timer = setTimeout;

function do_rely(req, res) {
    "use strict";
    function do_relayed_request(id, options, retry, alternate_url) {

        function manage_relayed_response(res_rely) {

            function store_data(id, res_rely, content) {
                        var res_rely_status = res_rely.statusCode,
                            res_rely_state = STATE_COMPLETED;

                        redis.hmset('HR:' + id,
                            'State', res_rely_state,
                            'Header', JSON.stringify(res_rely.headers),
                            'StatusCode', res_rely_status,
                            'Data', content,
                            function (err) {
                                if (err) {
                                    log("DB error (Can not insert):" + sys.inspect(err));
                                }
                                else {
                                    log("Kept response for:" + id);
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

            function retry_timeout_handler() {

                       function retry_manage_fail(socketException) {
                                  log("WARN: Retry Fail");
                                  if (socketException) {
                                      sys.log('RETRY::SocketException:' + sys.inspect(socketException));
                                  }
                                  redis.hset('HR:' + id,
                                      'State', STATE_RETRY_FAIL,
                                      function (err) {
                                          if (err) {
                                              log("DB error (Can not insert-retryfail):" + sys.inspect(err));
                                          }
                                          else {
                                              log("Retry-fail added for:" + id);
                                          }
                                      });
                              }

                       var try_relayed_req = do_relayed_request(id, options, false, false); //no more retries
                       try_relayed_req.end();

                       log('RETRY LAUNCH');
                       try_relayed_req.on('error', retry_manage_fail);
                   }


            if (socketException) {
                sys.log('SocketException:' + sys.inspect(socketException));
            }
            if (retry) {

                if (alternate_url) {
                    options.host = alternate_url;
                    //options.agent=false;
                }
                log('RETRY to' + sys.inspect(options));
                timer(retry_timeout_handler, 5000); //delay interval
            }
        }

        var relayed_req = http.request(options, manage_relayed_response);
        relayed_req.on('error', handle_socket_exception);
        return relayed_req;
    }

    var data = '',
        req_header = req.headers,
        retrieve_id = req_header[HEAD_RETRIEVE_ID] || "",
        relayer_host = req_header[HEAD_RELAYER_HOST],
        retry = req_header[HEAD_RELAYER_RETRY] || false,
        alternate_url = req_header[HEAD_RELAYER_ALTHOST] || false,
        relayer_method = req_header[HEAD_RELAYER_METHOD] || "GET",
        relayer_port = req_header[HEAD_RELAYER_PORT] || '80',
        res_status = STATUS_WEIRD,
        res_header,
        res_data,
        res_state,
        relayed_req,
        options;

    if (retrieve_id) {
        redis.hgetall('HR:' + retrieve_id, function (err, status) {
            if (err) {
                res_status = STATUS_ERROR;
                data = 'DB can\'t retrieve your data' + sys.inspect(err);
            }
            else {
                res_header = status.Header || "";
                res_data = status.Data || "";
                res_data = res_data.toString();
                res_state = status.State || "";
                res_state = res_state.toString();
                res_status = status.StatusCode || "";
                res_status = res_status.toString();

                if (res_state == STATE_PENDING) {
                    res_data = "Not Yet -pending-";
                    res_status = STATUS_ERROR;
                    res_header = req_header;
                }
                else if (res_state == STATE_ERROR || res_state == STATE_RETRY_FAIL) {
                    res_data = "ERROR:" + res_state;
                    res_status = STATUS_ERROR;
                    res_header = req_header;
                }
                else if (res_state == STATE_COMPLETED) {
                    log('COMPLETED::' + sys.inspect(res_data));
                }
                res_header['Content-Length'] = res_data.length;
                res.writeHead(res_status, res_header);
                res.write(res_data);
                res.end();
            }
        });
    }
    else {
        if (relayer_host) {
            redis.incr('HR:GLOBAL_ID_SEQ', function (err, idsec) {
                if (err) {
                    log("Problems getting ID_SEC (no continue): 'HR:GLOBAL_ID_SEQ'");
                    //EXCEPT NO-PERSISTENCE
                }
                else {
                    log("ID_SEC: 'HR:GLOBAL_ID_SEQ:'" + idsec);
                    var id = idsec.toString(); //+new Date().getTime();
                    res_status = STATUS_OK;
                    redis.hmset('HR:' + id, 'State', STATE_PENDING, 'RelayedRequest', relayer_host, function (err) {
                        if (err) {
                            res_status = STATUS_WEIRD; //something weird happends
                            log('WARN -(go) DB Can not insert:' + sys.inspect(err));
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
                        method:relayer_method,
                        path:'/', //unsupported by header
                        agent:false};

                    relayed_req = do_relayed_request(id, options, retry, alternate_url);
                    relayed_req.end();
                }
            });
        }
        else {
            //Maybe good to search for alternate
            data = "NO HEADER PRESENT:" + HEAD_RELAYER_HOST;
            res.writeHead(STATUS_ERROR, {
                    'Content-Length':data.length,
                    'Content-Type':'text/plain'
                }
            );
            res.write(data);
            res.end();
        }
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
                chunk += data;
                req.postdata = data; //extending req-object
                do_rely(req, res);
            });
        }
        else {
            do_rely(req, res);
        }

    }).listen(8000);

