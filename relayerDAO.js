/**
 * Created by JetBrains WebStorm.
 * User: mru
 * Date: 04/01/12
 * Time: 09:01
 * To change this template use File | Settings | File Templates.
 */
//REDIS DAO - node module
var
 redis_module = require('redis-client'),
 util = require('util'),
 logger = require('./simpleLogger').log,
 MyGlobal = require('./constantModule').Global,
 log = logger.log,
 redis,
 redis_key_prefix;


exports.ini = function _init(use_host, use_port, use_prefix) {
    "use strict";
    var
        port = use_port || redis_module.DEFAULT_PORT,
        host = use_host || redis_module.DEFAULT_HOST;
    redis_key_prefix = use_prefix || "HR:";
    try {
        redis = redis_module.createClient(port, host);
    }
    catch (excp) {
        log("ERROR CONNECTING to REDIS:" + host + ":" + port);
        MyGlobal.inspection_str = util.inspect(excp);
        log(MyGlobal.inspection_str);
    }
};

exports.store_data = function _store_data(id, str_header, str_status, content, callback) {
    "use strict";
    redis.hmset(redis_key_prefix + id,
        MyGlobal.RD_STATE, MyGlobal.STATE_COMPLETED,
        MyGlobal.RD_HEADER, str_header,
        MyGlobal.RD_STATUSCODE, str_status,
        MyGlobal.RD_DATA, content,
        function (err) {
            if (err) {
                MyGlobal.inspection_str = util.inspect(err);
                log("DB error (Can not insert):" + MyGlobal.inspection_str);
            }
            else {
                log("Kept response for:" + id);
            }
            if (callback) {
                callback(err);
            }
        }
    );
};
exports.update_retry_fail = function _update_retry_fail(id, callback) {
    "use strict";
    redis.hset(redis_key_prefix + id,
        MyGlobal.RD_STATE, MyGlobal.STATE_RETRY_FAIL,
        function (err) {
            if (err) {
                MyGlobal.inspection_str = util.inspect(err);
                log("DB error (Can not insert-retryfail):" + MyGlobal.inspection_str);
            }
            else {
                log("Retry-fail added for:" + id);
            }
            if (callback) {
                callback(err);
            }
        });
};
exports.update_pending = function _update_pending(id, relayer_host, method, postdata, callback) {
    "use strict";
    redis.hmset(redis_key_prefix + id,
        MyGlobal.RD_STATE, MyGlobal.STATE_PENDING,
        MyGlobal.RD_RELAYED_REQUEST, relayer_host,
        MyGlobal.RD_METHOD, method,
        MyGlobal.RD_POSTDATA, postdata,
        function (err) {
            if (err) {
                MyGlobal.inspection_str = util.inspect(err);
                log('WARN -(go) DB Can not insert:' + MyGlobal.inspection_str);
            }
            if (callback) {
                callback(err);
            }
        });
};
exports.get_all = function _get_all(id, callback) {
    "use strict";
    redis.hgetall(redis_key_prefix + id, function (err, redis_data) {
        var ret_data = {};
        if (err) {
            MyGlobal.inspection_str = util.inspect(err);
            log('DB can\'t retrieve your data' + MyGlobal.inspection_str);
        }
        else {
            ret_data.res_header = redis_data[MyGlobal.RD_HEADER] || "";
            ret_data.res_header = ret_data.res_header.toString();
            ret_data.res_header = JSON.parse(ret_data.res_header);
            ret_data.res_data = redis_data[MyGlobal.RD_DATA] || "";
            ret_data.res_data = ret_data.res_data.toString();
            ret_data.res_state = redis_data[MyGlobal.RD_STATE] || "";
            ret_data.res_state = ret_data.res_state.toString();
            ret_data.res_status = redis_data[MyGlobal.RD_STATUSCODE] || "";
            ret_data.res_status = ret_data.res_status.toString();
        }
        if (callback) {
            callback(err, ret_data);
        }
    });
};

/*
exports.get_id = function _get_id(callback) {
    "use strict";
    redis.incr(redis_key_prefix + 'GLOBAL_ID_SEQ', function (err, idsec) {
        if (err) {
            log("Problems getting ID_SEC: 'HR:GLOBAL_ID_SEQ'");
        }
        else {
            log("ID_SEC: 'HR:GLOBAL_ID_SEQ:'" + idsec);
        }
        if (callback) {
            callback(err, idsec);
        }
    });
};
*/