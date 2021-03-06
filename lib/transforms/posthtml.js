'use strict';

let getConfig = (() => {
  var _ref2 = _asyncToGenerator(function* (asset) {
    let config = asset.package.posthtml || (yield Config.load(asset.name, ['.posthtmlrc', '.posthtmlrc.js', 'posthtml.config.js']));
    if (!config && !asset.options.minify) {
      return;
    }

    config = config || {};
    config.plugins = loadPlugins(config.plugins, asset.name);

    if (asset.options.minify) {
      config.plugins.push(htmlnano());
    }

    config.skipParse = true;
    return config;
  });

  return function getConfig(_x2) {
    return _ref2.apply(this, arguments);
  };
})();

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const loadPlugins = require('../utils/loadPlugins');
const posthtml = require('posthtml');
const Config = require('../utils/config');
const htmlnano = require('htmlnano');

module.exports = (() => {
  var _ref = _asyncToGenerator(function* (asset) {
    let config = yield getConfig(asset);
    if (!config) {
      return;
    }

    yield asset.parseIfNeeded();
    let res = yield posthtml(config.plugins).process(asset.ast, config);

    asset.ast = res.tree;
    asset.isAstDirty = true;
  });

  return function (_x) {
    return _ref.apply(this, arguments);
  };
})();