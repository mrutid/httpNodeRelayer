/**
 * Created by JetBrains WebStorm.
 * User: mru
 * Date: 11/01/12
 * Time: 16:12
 * To change this template use File | Settings | File Templates.
 */

var
 http = require('http'),
 util = require('util'),
 uuid = require('node-uuid'),
 flow = require('async'),
 logger = require('./simpleLogger').log,
 mail = require('./mailAgent'),
 MyGlobal = require('./constantModule').Global,
 log = logger.log,
 dbhost,
 dbport;

exports.do_rely = function (req, res, parsed_url, dao) {
    "use strict";
    var retrieve_id = req.headers[MyGlobal.HEAD_RETRIEVE_ID] || '',
        relayer_host = req.headers[MyGlobal.HEAD_RELAYER_HOST];  //accessed via clousure by inner HNDfunctions

    function retrieve_handler(retrieve_id) {
        dao.get_all(retrieve_id, function (err, dao_data) {
            if (err) {
                dao_data.res_status = MyGlobal.STATUS_ERROR;
                dao_data.res_header = {'Content-Type':'text/plain'};
                dao_data.res_data = "ERROR retrieving from DB:" + util.inspect(err);
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
                    var res_data_str = util.inspect(dao_data.res_data);
                    log('COMPLETED::' + res_data_str);
                }
                delete dao_data.res_header['content-length'];
            }
            res.writeHead(dao_data.res_status, dao_data.res_header);
            res.write(dao_data.res_data);
            res.end();
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
                            log('STATUS: ' + callback_res.statusCode);
                            //log('HEADERS: ' + JSON.stringify(callback_res.headers));
                            //log('RELAYED HEADER!!:'+ JSON.stringify(res_rely.headers));
                        });
                        callback_req.on('error', function (err) {
                            MyGlobal.inspection_str = util.inspect(err);
                            log("EXCEPTION AT CALLBACK REQUEST:" + MyGlobal.inspection_str);
                            //modify state
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
                    dao.store_data(id, res_rely_headers, res_rely_status, content_data);
                    //send CALLBACK
                    send_callback(chunk);
                    log('DATA:' + content_data);
                });
            }

            function handle_socket_exception(socketException) {
                function retry_timeout_handler() {
                    function retry_manage_fail(socketException) {
                        log("WARN: Retry Fail");
                        if (socketException) {
                            MyGlobal.inspection_str = util.inspect(socketException);
                            log('RETRY::SocketException:' + MyGlobal.inspection_str);
                        }
                        dao.update_pending(id);
                    }

                    var try_relayed_req;
                    try_relayed_req = do_relayed_request(id, options); //no more retries
                    try_relayed_req.end();
                    log('RETRY LAUNCH');
                    try_relayed_req.on('error', retry_manage_fail);
                }

                var retry = req.headers[MyGlobal.HEAD_RELAYER_RETRY] || false,
                    alternate_url = req.headers[MyGlobal.HEAD_RELAYER_ALTHOST] || false;
                if (socketException) {
                    MyGlobal.inspection_str = util.inspect(socketException);
                    log('HANDLE_SOCKT:: SocketException:' + MyGlobal.inspection_str);
                }
                if (retry) {
                    if (alternate_url) {
                        options.host = alternate_url;
                    }
                    MyGlobal.inspection_str = util.inspect(options);
                    log('RETRY to' + MyGlobal.inspection_str);
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

    //function rely_handler

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

        //defining for serial execution async.js
        function update_first(callback){
            dao.update_pending(id, relayer_host, req.method, postdata, function (err) {
            if (err) {
                res_status = MyGlobal.STATUS_WEIRD; //something weird happens //
            }
            callback(null, 'stored');
        });
        }

        function request_later (callback){
            options = {
                                host:relayer_host,
                                port:relayer_port,
                                defaultPort:relayer_port,
                                method:relayer_method,
                                path:'/'
                            };
            relayed_req = do_relayed_request(id, options);
            relayed_req.end();
            callback(null, "request sent");
        }
        //launch in series
        flow.series([update_first, request_later], function(err, result){
                    log('SERIAL::'+util.inspect(err)+'::'+util.inspect(result));
                });

        //Quick answer to client
        res.writeHead(res_status);
        res.write(id);
        res.end();
        //Redirect request

    }

    function send_mail_handler() {
        //if must be a post
        if (req.method == 'POST') {
            mail.send(req.postdata);
            res.writeHead(MyGlobal.STATUS_OK, {'Content-Type':'text/plain'});
            res.write("Ready for Send");
            res.end();
        }
        else {
            res.writeHead(MyGlobal.STATUS_ERROR, {'Content-Type':'text/plain'});
            res.write("Expected a POST to send mail");
            res.end();
        }
    }
//function do_rely
    //Main OP DISPATCHING
    //Retrieve
    if (parsed_url.pathname == '/sendmail') {
        send_mail_handler(); //send a mail con POST contents
    }
    else if (retrieve_id) {
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
};

