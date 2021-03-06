'use strict';

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const CSSAsset = require('./CSSAsset');
const config = require('../utils/config');
const localRequire = require('../utils/localRequire');
const Resolver = require('../Resolver');

const URL_RE = /^(?:url\s*\(\s*)?['"]?(?:[#/]|(?:https?:)?\/\/)/i;

class StylusAsset extends CSSAsset {
  parse(code) {
    var _this = this;

    return _asyncToGenerator(function* () {
      // stylus should be installed locally in the module that's being required
      let stylus = localRequire('stylus', _this.name);
      let opts = _this.package.stylus || (yield config.load(_this.name, ['.stylusrc', '.stylusrc.js']));
      let style = stylus(code, opts);
      style.set('filename', _this.name);
      style.set('include css', true);
      style.set('Evaluator', createEvaluator(_this));

      // Setup a handler for the URL function so we add dependencies for linked assets.
      style.define('url', function (node) {
        let filename = _this.addURLDependency(node.val, node.filename);
        return new stylus.nodes.Literal(`url(${JSON.stringify(filename)})`);
      });

      return style;
    })();
  }

  collectDependencies() {
    // Do nothing. Dependencies are collected by our custom evaluator.
  }

  generateErrorMessage(err) {
    let index = err.message.indexOf('\n');
    err.codeFrame = err.message.slice(index + 1);
    err.message = err.message.slice(0, index);
    return err;
  }
}

function createEvaluator(asset) {
  const Evaluator = localRequire('stylus/lib/visitor/evaluator', asset.name);
  const utils = localRequire('stylus/lib/utils', asset.name);
  const resolver = new Resolver(asset.options);

  // This is a custom stylus evaluator that extends stylus with support for the node
  // require resolution algorithm. It also adds all dependencies to the parcel asset
  // tree so the file watcher works correctly, etc.
  class CustomEvaluator extends Evaluator {
    visitImport(imported) {
      let node = this.visit(imported.path).first;
      let path = node.string;
      if (node.name !== 'url' && path && !URL_RE.test(path)) {
        try {
          // First try resolving using the node require resolution algorithm.
          // This allows stylus files in node_modules to be resolved properly.
          // If we find something, update the AST so stylus gets the absolute path to load later.
          node.string = resolver.resolveSync(path, imported.filename).path;
          asset.addDependency(node.string, { includedInParent: true });
        } catch (err) {
          // If we couldn't resolve, try the normal stylus resolver.
          // We just need to do this to keep track of the dependencies - stylus does the real work.

          // support optional .styl
          if (!/\.styl$/i.test(path)) {
            path += '.styl';
          }

          let found = utils.find(path, this.paths, this.filename);
          if (!found) {
            found = utils.lookupIndex(node.string, this.paths, this.filename);
          }

          if (!found) {
            let nodeName = imported.once ? 'require' : 'import';
            throw new Error('failed to locate @' + nodeName + ' file ' + node.string);
          }

          var _iteratorNormalCompletion = true;
          var _didIteratorError = false;
          var _iteratorError = undefined;

          try {
            for (var _iterator = found[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
              let file = _step.value;

              asset.addDependency(file, { includedInParent: true });
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

      // Done. Let stylus do its thing.
      return super.visitImport(imported);
    }
  }

  return CustomEvaluator;
}

module.exports = StylusAsset;