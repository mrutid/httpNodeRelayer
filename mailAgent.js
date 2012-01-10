/**
 * Created by JetBrains WebStorm.
 * User: mru
 * Date: 09/01/12
 * Time: 14:55
 * To change this template use File | Settings | File Templates.
 */

/*

    */

var email = require('mailer');
var logger = require('./simpleLogger').log;
var util = require('util');
var log = logger.log;

var mailAgent = (function(){
    "use strict";
    exports.send_with_template = function(data){
        //sed a mail with a basic template
        //foo
        log("SENt A FOO MAIL"+util.inspect(data));

    };

})();