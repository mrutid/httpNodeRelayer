/**
 * Created by JetBrains WebStorm.
 * User: mru
 * Date: 10/01/12
 * Time: 13:19
 * To change this template use File | Settings | File Templates.
 */
var logger= require('./simpleLogger');
var util = require('util');
var mailer = require('nodemailer');
var log = logger.log.log;

// one time action to set up SMTP information
    mailer.SMTP = {
        host: 'tid'
    };

exports.send = function(data){
    "use strict";

    log("SENT MAIL(STR)::"+data);
    data = JSON.parse(data);
    var str = util.inspect(data);
    log("SENT MAIL::"+str);
    mailer.send_mail(data, function(err, result){
        if (err){
            str = util.inspect(err);
            log("ERROR SENDING EMAIL::"+str);
        }
    });
};
