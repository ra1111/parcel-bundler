'use strict';

let resolve = (() => {
  var _ref = _asyncToGenerator(function* (filepath, filenames, root = path.parse(filepath).root) {
    filepath = path.dirname(filepath);

    // Don't traverse above the module root
    if (filepath === root || path.basename(filepath) === 'node_modules') {
      return null;
    }

    var _iteratorNormalCompletion = true;
    var _didIteratorError = false;
    var _iteratorError = undefined;

    try {
      for (var _iterator = filenames[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
        const filename = _step.value;

        let file = path.join(filepath, filename);
        let exists = existsCache.has(file) ? existsCache.get(file) : yield fs.exists(file);
        if (exists) {
          existsCache.set(file, true);
          return file;
        }

        existsCache.set(file, false);
      }
    } catch (err) {
      _didIteratorError = true;
      _iteratorError = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion && _iterator.return) {
          _iterator.return();
        }
      } finally {
        if (_didIteratorError) {
          throw _iteratorError;
        }
      }
    }

    return resolve(filepath, filenames, root);
  });

  return function resolve(_x, _x2) {
    return _ref.apply(this, arguments);
  };
})();

let load = (() => {
  var _ref2 = _asyncToGenerator(function* (filepath, filenames, root = path.parse(filepath).root) {
    let configFile = yield resolve(filepath, filenames, root);
    if (configFile) {
      if (path.extname(configFile) === '.js') {
        return require(configFile);
      }

      let configStream = yield fs.readFile(configFile);
      return json5.parse(configStream.toString());
    }

    return null;
  });

  return function load(_x3, _x4) {
    return _ref2.apply(this, arguments);
  };
})();

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const fs = require('./fs');
const path = require('path');
const json5 = require('json5');

const existsCache = new Map();

exports.resolve = resolve;
exports.load = load;