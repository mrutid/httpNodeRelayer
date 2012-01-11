/**
 * Created by JetBrains WebStorm.
 * User: mru
 * Date: 04/01/12
 * Time: 19:46
 * To change this template use File | Settings | File Templates.
 */
//Singleton
exports.log = (function simpleLogger() {
    "use strict";
    var utils = require('util'),
        _prefix = '',
        _enabled = true,
        _level = 'W',
        _set_prefix = function (str) {
            _prefix = str;
        },
        _set_enabled = function (flag) {
            _enabled = flag;
        },
        _set_level = function (level) {
            _level = level;
        },
        _log = function (str) {
            if (_enabled) {
                utils.log(_prefix + '::' + str);
            }
        };

        return {
            log:_log,
            set_prefix : _set_prefix,
            set_level : _set_level,
            set_enabled : _set_enabled
        };
})();

