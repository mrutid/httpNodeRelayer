var http = require('http');
var sys = require('util');
var redis = require('redis-client').createClient();

var GLOBAL_ID=0;
var STATE_COMPLETED='completed';
var STATE_PENDING='pending';
var STATE_ERROR='error';
var STATE_RETRY_FAIL='retry_fail';

function relayed_request(options, retry, alternate_url) {
    var relayed_req = http.request(options, function(res_rely) {
        //console.log('STATUS: ' + res.statusCode);
        //console.log('HEADERS: ' + JSON.stringify(res.headers));
        var chunk='';
        var res_rely_status = 200;
        var res_rely_state = STATE_COMPLETED;
        if (res_rely.statusCode == 404) {
            res_rely_status = 404;
        }
        res_rely.on("data", function(data) {
                chunk += data;
            }
        );
        res_rely.on('end', function(data) {
            chunk += data;
            //keep in redis
            redis.hmset('HR:' + GLOBAL_ID,
                'State', res_rely_state,
                'Header', JSON.stringify(res_rely.headers),
                'StatusCode', res_rely_status,
                'Data', chunk,
                function(err) {
                    if (err) {
                        console.log("DB error (Can not insert):" + sys.inspect(err));
                    }
                    else {
                        console.log("Kept response for:" + GLOBAL_ID);
                    }
                });
        });
    });
    relayed_req.on('error', function(socketException){
        if (socketException) {
            sys.log('SocketException:'+sys.inspect(socketException));
        }
        if (retry){
                //HR to retrying
                //push into pending collection on timeout

                if (alternate_url){
                    options.host=alternate_url;
                    options.agent=false;
                }
                console.log('RETRY to'+sys.inspect(options));
                setTimeout(function(){
                    relayed_req = relayed_request(options,false);//no more retries
                    relayed_req.end();

                    console.log('RETRY LAUNCH');
                    relayed_req.on('error', function(socketException){
                        console.log("WARN: Retry Fail");
                        if (socketException) {
                            sys.log('RETRY::SocketException:'+sys.inspect(socketException));
                        }
                        redis.hset('HR:' + GLOBAL_ID,
                                    'State', STATE_RETRY_FAIL,
                                    function(err) {
                                        if (err) {
                                            console.log("DB error (Can not insert-retryfail):" + sys.inspect(err));
                                        }
                                        else {
                                            console.log("Retry-fail added for:" + GLOBAL_ID);
                                        }
                        });
                    });
           }, 5000); //delay interval
        }

    });
    return relayed_req;
}

http.createServer(function(req,res){
//extract header params
    GLOBAL_ID++;
    var data;
    var req_header = req.headers;
    var retrieve_id = req_header['x-retrieve-id'];
    var xrelayerhost = req_header['x-relayer-host'];
    var retry = req_header['x-relayer-retry'];
    var alternate_url=req_header['x-relayer-alternatehost'];
    if (retrieve_id){
        redis.hgetall('HR:'+retrieve_id, function(err, status){
            if(err){
                res_status=404;
                data= 'DB can\'t retrieve your data' + sys.inspect(err);

            }
            else {
                var res_header = status['Header'];
                if (!res_header) res_header="";

                var res_status = status['StatusCode'];
                if (res_status) res_status=res_status.toString();
                else res_status="";

                var res_data = status['Data'];
                if (res_data) res_data=res_data.toString();
                else res_data="";

                var res_state = status['State'];
                if (res_state) res_state=res_state.toString();
                else res_state="";

            if(res_state==STATE_PENDING){
               res_data="Not Yet -pending-";
               res_status=404;
               res_header = req_header;

            }
            else if (res_state==STATE_ERROR || res_state==STATE_RETRY_FAIL){
               res_data="ERROR:"+res_state;
               res_status=404;
               res_header = req_header;
             }
            else if(res_state==STATE_COMPLETED){
                console.log('COMPLETED::'+ sys.inspect(res_data));
            }
            res_header['Content-Length']=res_data.length;
            res.writeHead(res_status, res_header);
            res.write(res_data);
            res.end();
            }
        });
    }
    else{
        var g_id=""+GLOBAL_ID;
        var res_status =200;
        redis.hmset('HR:'+GLOBAL_ID, 'State', STATE_PENDING, 'RelayedRequest', xrelayerhost, function(err){
            if(err){
            res_status=500; //something weird happends
            console.log('WARN -(go) DB Can not insert:'+ sys.inspect(err));
        }
        });

        res.writeHead(res_status, {
                    'Content-Length': g_id.length,
                    'Content-Type': 'text/plain'
                    }
        );
        res.write(g_id);
        res.end();
        var res_status =200;


        //redirect request

        var options = {
        host: xrelayerhost,
        port: 80,
        method: 'GET',
        path: '/'
        };
        var relayed_req = relayed_request(options, retry, alternate_url);
        relayed_req.end();

    }
}).listen(8000);

