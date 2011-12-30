var http = require('http');
var sys = require('util');
var redis = require('redis-client').createClient();

const STATE_COMPLETED = 'completed';
const STATE_PENDING = 'pending';
const STATE_ERROR = 'error';
const STATE_RETRY_FAIL = 'retry_fail';

const STATUS_OK = 200;
const STATUS_ERROR = 404;
const STATUS_WEIRD = 500;

const HEAD_RETRIEVE_ID = 'x-retrieve-id';
const HEAD_RELAYER_HOST = 'x-relayer-host';
const HEAD_RELAYER_ALTHOST = 'x-relayer-alternatehost';
const HEAD_RELAYER_RETRY = 'x-relayer-retry';
const HEAD_RELAYER_METHOD = 'x-relayer-method';
const HEAD_RELAYER_PORT = 'x-relayer-port';

function relayed_request(id, options, retry, alternate_url) {
    var relayed_req = http.request(options, function(res_rely) {
        //console.log('STATUS: ' + res.statusCode);
        //console.log('HEADERS: ' + JSON.stringify(res.headers));
        var chunk = '';
        var res_rely_status = res_rely.statusCode;
        var res_rely_state = STATE_COMPLETED;

        res_rely.on("data", function(data) {
                chunk += data;
            }
        );
        res_rely.on('end', function(data) {
            chunk += data;
            //keep in redis
            redis.hmset('HR:' + id,
                'State', res_rely_state,
                'Header', JSON.stringify(res_rely.headers),
                'StatusCode', res_rely_status,
                'Data', chunk,
                function(err) {
                    if (err) {
                        console.log("DB error (Can not insert):" + sys.inspect(err));
                    }
                    else {
                        console.log("Kept response for:" + id);
                    }
                });
        });
    });
    relayed_req.on('error', function(socketException) {
        if (socketException) {
            sys.log('SocketException:' + sys.inspect(socketException));
        }
        if (retry) {
            //HR to retrying
            //push into pending collection on timeout

            if (alternate_url) {
                options.host = alternate_url;
                //options.agent=false;
            }
            console.log('RETRY to' + sys.inspect(options));
            setTimeout(function() {
                relayed_req = relayed_request(id, options, false, false);//no more retries
                relayed_req.end();

                console.log('RETRY LAUNCH');
                relayed_req.on('error', function(socketException) {
                    console.log("WARN: Retry Fail");
                    if (socketException) {
                        sys.log('RETRY::SocketException:' + sys.inspect(socketException));
                    }
                    redis.hset('HR:' + id,
                        'State', STATE_RETRY_FAIL,
                        function(err) {
                            if (err) {
                                console.log("DB error (Can not insert-retryfail):" + sys.inspect(err));
                            }
                            else {
                                console.log("Retry-fail added for:" + id);
                            }
                        });
                });
            }, 5000); //delay interval
        }

    });
    return relayed_req;
}

http.createServer(
    function(req, res) {
//extract header params
        var data;
        var req_header = req.headers;
        var retrieve_id = req_header[HEAD_RETRIEVE_ID] || "";
        var relayer_host = req_header[HEAD_RELAYER_HOST];
        var retry = req_header[HEAD_RELAYER_RETRY] || false;
        var alternate_url = req_header[HEAD_RELAYER_ALTHOST] || false;
        var relayer_method = req_header[HEAD_RELAYER_METHOD] || "GET";
        var relayer_port = req_header[HEAD_RELAYER_PORT] || '80';

        if (retrieve_id) {
            redis.hgetall('HR:' + retrieve_id, function(err, status) {
                if (err) {
                    res_status = STATUS_ERROR;
                    data = 'DB can\'t retrieve your data' + sys.inspect(err);

                }
                else {
                    var res_header = status['Header'] || "";

                    var res_status = status['StatusCode'] || "";
                    res_status = res_status.toString();


                    var res_data = status['Data'] || "";
                    res_data = res_data.toString();

                    var res_state = status['State'] || "";
                    res_state = res_state.toString();

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
                        console.log('COMPLETED::' + sys.inspect(res_data));
                    }
                    res_header['Content-Length'] = res_data.length;
                    res.writeHead(res_status, res_header);
                    res.write(res_data);
                    res.end();
                }
            });
        }
        else {
            if(relayer_host){
            redis.incr('HR:GLOBAL_ID_SEQ', function(err, idsec){
                if(err){
                    console.log("Problems getting ID_SEC (no continue): 'HR:GLOBAL_ID_SEQ'");
                    //EXCEPT NO-PERSISTENCE
                }
                else{
                    console.log("ID_SEC: 'HR:GLOBAL_ID_SEQ:'"+idsec);
                    var id=idsec.toString(); //+new Date().getTime();
                    var res_status = STATUS_OK;
                    redis.hmset('HR:' + id, 'State', STATE_PENDING, 'RelayedRequest', relayer_host, function(err) {
                        if (err) {
                            res_status = STATUS_WEIRD; //something weird happends
                            console.log('WARN -(go) DB Can not insert:' + sys.inspect(err));
                        }
                    });

                    res.writeHead(res_status, {
                            'Content-Length': id.length,
                            'Content-Type': 'text/plain'
                        }
                    );
                    res.write(id);
                    res.end();

                    //redirect request

                    var options = {
                        host: relayer_host,
                        port: relayer_port,
                        method: relayer_method,
                        path: '/', //unsupported by header
                        agent: false};
                    var relayed_req = relayed_request(id, options, retry, alternate_url);
                    relayed_req.end();
                }
            });
            }
            else{
                //Maybe good to search for alternate
                var data="NO HEADER PRESENT:"+HEAD_RELAYER_HOST;
                res.writeHead(STATUS_ERROR, {
                            'Content-Length': data.length,
                            'Content-Type': 'text/plain'
                        }
                    );
                    res.write(data);
                    res.end();
            }


        }
    }).listen(8000);

