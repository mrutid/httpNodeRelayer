/**
 * Created by JetBrains WebStorm.
 * User: mru
 * Date: 04/01/12
 * Time: 09:01
 * To change this template use File | Settings | File Templates.
 */
//REDIS DAO - node module
var redis_module = require('redis-client');
var sys = require('util');
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
    'RD_METHOD':'Method',
    'RD_POSTDATA':'Postdata',
    'RD_RELAYED_REQUEST':'RelayedRequest',
    'log':console.log,
    inspection_str:''};
var redis;
var prefix;
function RelayerDAO(use_port, use_host, use_prefix) {
    "use strict";
    var port = use_port || redis_module.DEFAULT_PORT,
        host = use_host || redis_module.DEFAULT_HOST;
    prefix = use_prefix || "HR";
    try {
        redis = redis_module.createClient(port, host);
    }
    catch(excp){
        MyGlobal.log("ERROR CONNECTING to REDIS:"+host+":"+port);
        MyGlobal.inspection_str = sys.inspect(excp);
        MyGlobal.log(MyGlobal.inspection_str);
    }
}
RelayerDAO.prototype.store_data = function (id, str_header, str_status, content, callback) {
    "use strict";
    redis.hmset(prefix + id,
        MyGlobal.RD_STATE, MyGlobal.STATE_COMPLETED,
        MyGlobal.RD_HEADER, str_header,
        MyGlobal.RD_STATUSCODE, str_status,
        MyGlobal.RD_DATA, content,
        function (err) {
            if (err) {
                MyGlobal.inspection_str = sys.inspect(err);
                MyGlobal.log("DB error (Can not insert):" + MyGlobal.inspection_str);
            }
            else {
                MyGlobal.log("Kept response for:" + id);
            }
            if (callback) {
                callback(err);
            }
        }
    );
};
RelayerDAO.prototype.update_retry_fail = function (id, callback) {
    "use strict";
    redis.hset(prefix + id,
        MyGlobal.RD_STATE, MyGlobal.STATE_RETRY_FAIL,
        function (err) {
            if (err) {
                MyGlobal.inspection_str = sys.inspect(err);
                MyGlobal.log("DB error (Can not insert-retryfail):" + MyGlobal.inspection_str);
            }
            else {
                MyGlobal.log("Retry-fail added for:" + id);
            }
            if (callback) {
                callback(err);
            }
        });
};
RelayerDAO.prototype.update_pending = function (id, relayer_host, method, postdata, callback) {
    "use strict";
    redis.hmset(prefix + id,
        MyGlobal.RD_STATE, MyGlobal.STATE_PENDING,
        MyGlobal.RD_RELAYED_REQUEST, relayer_host,
        MyGlobal.RD_METHOD, method,
        MyGlobal.RD_POSTDATA, postdata,
        function (err) {
            if (err) {
                MyGlobal.inspection_str = sys.inspect(err);
                MyGlobal.log('WARN -(go) DB Can not insert:' + MyGlobal.inspection_str);
            }
            if (callback) {
                callback(err);
            }
        });
};
RelayerDAO.prototype.get_all = function (id, callback) {
    "use strict";
    redis.hgetall(prefix + id, function (err, redis_data) {
        var ret_data = {};
        if (err) {
            MyGlobal.inspection_str = sys.inspect(err);
            MyGlobal.log('DB can\'t retrieve your data' + MyGlobal.inspection_str);
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
RelayerDAO.prototype.get_id = function (callback) {
    "use strict";
    redis.incr(prefix + 'GLOBAL_ID_SEQ', function (err, idsec) {
        if (err) {
            MyGlobal.log("Problems getting ID_SEC: 'HR:GLOBAL_ID_SEQ'");
        }
        else {
            MyGlobal.log("ID_SEC: 'HR:GLOBAL_ID_SEQ:'" + idsec);
        }
        if (callback) {
            callback(err, idsec);
        }
    });
};
exports.RelayerDAO = RelayerDAO;
