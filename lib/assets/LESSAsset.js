'use strict';

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const CSSAsset = require('./CSSAsset');
const config = require('../utils/config');
const localRequire = require('../utils/localRequire');
const promisify = require('../utils/promisify');

class LESSAsset extends CSSAsset {
  parse(code) {
    var _this = this;

    return _asyncToGenerator(function* () {
      // less should be installed locally in the module that's being required
      let less = localRequire('less', _this.name);
      let render = promisify(less.render.bind(less));

      let opts = _this.package.less || (yield config.load(_this.name, ['.lessrc', '.lessrc.js'])) || {};
      opts.filename = _this.name;
      opts.plugins = (opts.plugins || []).concat(urlPlugin(_this));

      let res = yield render(code, opts);
      res.render = function () {
        return res.css;
      };
      return res;
    })();
  }

  collectDependencies() {
    var _iteratorNormalCompletion = true;
    var _didIteratorError = false;
    var _iteratorError = undefined;

    try {
      for (var _iterator = this.ast.imports[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
        let dep = _step.value;

        this.addDependency(dep, { includedInParent: true });
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
  }
}

function urlPlugin(asset) {
  return {
    install: (less, pluginManager) => {
      let visitor = new less.visitors.Visitor({
        visitUrl: (node, args) => {
          node.value.value = asset.addURLDependency(node.value.value, node.currentFileInfo.filename);
          return node;
        }
      });

      visitor.run = visitor.visit;
      pluginManager.addVisitor(visitor);
    }
  };
}

module.exports = LESSAsset;